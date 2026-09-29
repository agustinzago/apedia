import { and, asc, desc, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { LessonDraft, QuestionDraft, Teacher, WriteLessonInput } from "@/teacher";
import { missionOf } from "./course-creation";
import { resumeJob, viewOf, type JobRow, type JobRun, type JobStepResult, type JobView } from "./jobs";
import { LessonContent, readingMinutes } from "./lesson-content";
import { lessonsUsedUp, type LessonsUsedUp } from "./allowance";
import type { DailyCaps, DailyLimitReached } from "./limits";
import type { Spend, SpendPaused } from "./spend";

/**
 * Lessons: the Up next Lesson is written by a Lesson generation job (ADR
 * 0004), started in the background as soon as Up next is picked, or on its
 * first open if it wasn't, then checked and cached for good; the Learner's
 * quiz answers are stored as quiz attempts.
 */

export type LessonGenerationStep = "write";

export const MAX_SECTIONS = 3;
export const MIN_SECTIONS = 2;
export const QUIZ_LENGTH = 3;
export const OPTIONS_PER_QUESTION = 4;
export const MAX_NEW_TERMS = 3;
/** The shortest option must be at least this share of the longest. */
const MIN_OPTION_LENGTH_RATIO = 0.7;

/** Resource ids, such as "r3", which belong only in citations and Read next. */
const RESOURCE_ID = /\br\d+\b/;

export type OpenLessonResult =
  | {
      ok: true;
      /** The Lesson's generation job; null when the Lesson is already written. */
      generation: JobView | null;
      /** True when the job waits for a runner: start it. */
      start: boolean;
    }
  | { ok: false; reason: "not-found" | "read-only" }
  /** The Lesson is unwritten and the Course is Done: no new Lessons are written. */
  | { ok: false; reason: "done" }
  /**
   * The Lesson is unwritten and the Course has had all the Lessons its
   * allowance holds written. Up next stays shown; nothing else changes.
   */
  | LessonsUsedUp
  /** The Lesson is unwritten and the Learner has had today's Lessons written. */
  | DailyLimitReached
  /** The Lesson is unwritten and the Teacher is paused for the day. */
  | SpendPaused;

export type RetryLessonGenerationResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not-found" | "read-only" | "nothing-to-retry" | "done" }
  | LessonsUsedUp
  | DailyLimitReached
  | SpendPaused;

export type QuizAttemptEntry = {
  questionIndex: number;
  chosenOption: number;
  correct: boolean;
  at: Date;
};

export type AnswerQuestionResult =
  | {
      ok: true;
      /** The stored attempt: the first answer given, since a question locks once answered. */
      attempt: QuizAttemptEntry;
      /** True once every question of the Lesson has an attempt: Finish is on. */
      allAnswered: boolean;
    }
  | {
      ok: false;
      reason: "not-found" | "read-only" | "not-written" | "finished" | "invalid" | "done";
    };

export type LessonRow = typeof schema.lesson.$inferSelect;

/** The Learner's own Lesson with its Course, or why they may not change it. */
export async function findOwnLessonIn(
  db: Db,
  courseId: string,
  lessonIndex: number,
  learnerId: string,
): Promise<
  | { ok: true; lesson: LessonRow; course: typeof schema.course.$inferSelect }
  | { ok: false; reason: "not-found" | "read-only" }
> {
  const [row] = await db
    .select({ lesson: schema.lesson, course: schema.course })
    .from(schema.lesson)
    .innerJoin(schema.course, eq(schema.course.id, schema.lesson.courseId))
    .where(and(eq(schema.course.id, courseId), eq(schema.lesson.index, lessonIndex)));
  if (!row) return { ok: false, reason: "not-found" };
  if (row.course.isExample) return { ok: false, reason: "read-only" };
  if (row.course.learnerId !== learnerId) return { ok: false, reason: "not-found" };
  return { ok: true, lesson: row.lesson, course: row.course };
}

/** The Lesson's job of one kind, if it has one. */
export async function findLessonJob(
  db: Db,
  lessonId: string,
  kind: "lesson_generation" | "finish",
): Promise<JobRow | null> {
  const [job] = await db
    .select()
    .from(schema.job)
    .where(and(eq(schema.job.lessonId, lessonId), eq(schema.job.kind, kind)));
  return job ?? null;
}

export function createLessonOperations({
  db,
  teacher,
  random,
  caps,
  spend,
}: {
  db: Db;
  teacher: Teacher;
  /** Shuffles quiz options; `Math.random` in the app. */
  random: () => number;
  caps: DailyCaps;
  spend: Spend;
}) {
  const findOwnLesson = (courseId: string, lessonIndex: number, learnerId: string) =>
    findOwnLessonIn(db, courseId, lessonIndex, learnerId);
  const findGenerationJob = (lessonId: string) =>
    findLessonJob(db, lessonId, "lesson_generation");

  /**
   * Whether a Lesson with no generation job may start one: the Course's
   * allowance, today's cap and the spend stop all allow it. Null if so.
   */
  async function generationRefused(
    lesson: LessonRow,
    learnerId: string,
  ): Promise<LessonsUsedUp | DailyLimitReached | SpendPaused | null> {
    return (
      (await lessonsUsedUp(db, lesson.courseId)) ??
      (await caps.lessonGeneration(learnerId)) ??
      (await spend.teacherCall())
    );
  }

  async function insertGenerationJob(lesson: LessonRow): Promise<JobRow> {
    await db
      .insert(schema.job)
      .values({
        courseId: lesson.courseId,
        kind: "lesson_generation",
        lessonId: lesson.id,
        step: "write" satisfies LessonGenerationStep,
      })
      .onConflictDoNothing();
    return (await findGenerationJob(lesson.id))!;
  }

  /** Everything the Teacher is given to write the Lesson. */
  async function lessonInput(lesson: LessonRow): Promise<Omit<WriteLessonInput, "feedback">> {
    const [[course], resources, glossary, earlier, records] = await Promise.all([
      db.select().from(schema.course).where(eq(schema.course.id, lesson.courseId)),
      db.select().from(schema.resource).where(eq(schema.resource.courseId, lesson.courseId)),
      db
        .select({ term: schema.glossaryTerm.term, definition: schema.glossaryTerm.definition })
        .from(schema.glossaryTerm)
        .where(eq(schema.glossaryTerm.courseId, lesson.courseId))
        .orderBy(asc(schema.glossaryTerm.createdAt), asc(schema.glossaryTerm.term)),
      db
        .select({
          index: schema.lesson.index,
          title: schema.lesson.title,
          content: schema.lesson.content,
        })
        .from(schema.lesson)
        .where(
          and(
            eq(schema.lesson.courseId, lesson.courseId),
            lt(schema.lesson.index, lesson.index),
            isNotNull(schema.lesson.finishedAt),
            isNotNull(schema.lesson.content),
          ),
        )
        .orderBy(asc(schema.lesson.index)),
      db
        .select()
        .from(schema.learningRecord)
        .where(eq(schema.learningRecord.courseId, lesson.courseId))
        .orderBy(asc(schema.learningRecord.number)),
    ]);
    // In the Teacher's order: r1, r2, … r10.
    resources.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));

    return {
      subject: course.subject,
      language: course.language,
      mission: missionOf(course),
      lesson: { index: lesson.index, title: lesson.title, goal: lesson.goal },
      resources: resources.map((r) => ({
        id: r.ref,
        kind: r.kind,
        title: r.title,
        author: r.author,
        why: r.why,
      })),
      glossary,
      keyIdeas: earlier.map((l) => ({
        lessonIndex: l.index,
        lessonTitle: l.title,
        text: LessonContent.parse(l.content).keyIdea,
      })),
      learningRecords: records.map((r) => ({
        number: r.number,
        kind: r.kind,
        title: r.title,
        body: r.body,
      })),
    };
  }

  /** Writes a draft that keeps the rules, sending it back once with the reason. */
  async function writeDraft(
    run: JobRun,
    input: Omit<WriteLessonInput, "feedback">,
  ): Promise<LessonDraft> {
    const rules = {
      refs: new Set(input.resources.map((r) => r.id)),
      sittingMinutes: input.mission.sittingMinutes,
    };
    let feedback: string | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      let draft: LessonDraft;
      try {
        draft = await teacher.writeLesson({ ...input, feedback });
      } catch (error) {
        // A structured call that fails usually succeeds the second time.
        if (attempt === 1) throw error;
        console.warn("Writing a Lesson failed; trying once more.", error);
        continue;
      }
      feedback = lessonProblem(draft, rules);
      if (feedback === null) return draft;
      if (attempt === 0) await run.say("Tidying up a few details.");
    }
    throw new Error(`The Lesson broke its rules twice: ${feedback}`);
  }

  /**
   * Each question that breaks the quiz rule is rewritten alone, once, with
   * the reason. One that still breaks it is shipped as it is, and logged.
   */
  async function lintQuiz(
    lesson: LessonRow,
    input: Omit<WriteLessonInput, "feedback">,
    draft: LessonDraft,
  ): Promise<QuestionDraft[]> {
    return Promise.all(
      draft.quiz.map(async (question, i) => {
        const problem = quizRuleProblem(question);
        if (problem === null) return question;

        let shipped = question;
        try {
          const rewritten = await teacher.rewriteQuestion({
            subject: input.subject,
            language: input.language,
            lesson: { title: lesson.title, keyIdea: draft.keyIdea },
            question,
            problem,
          });
          const broken = questionProblem(rewritten, `The rewritten question ${i + 1}`);
          if (broken === null) shipped = rewritten;
          else console.warn(`Lesson ${lesson.id}: ${broken} Keeping the original.`);
        } catch (error) {
          console.warn(`Lesson ${lesson.id}: rewriting question ${i + 1} failed.`, error);
        }

        const still = quizRuleProblem(shipped);
        if (still !== null) {
          console.warn(
            `Lesson ${lesson.id}: question ${i + 1} still breaks the quiz rule; shipping it. ${still}`,
          );
        }
        return shipped;
      }),
    );
  }

  return {
    /**
     * Starts writing the Course's Up next ahead of its first open, so it is
     * ready when the Learner is. It counts against the allowance and today's
     * cap just as an open would, and is skipped (left for the first open)
     * whenever an open would be refused, and while a Mission change waits
     * for the Learner, since confirming it may re-pick Up next. Returns the
     * Lesson generation job to start, or null when there is nothing to start.
     */
    async writeUpNextAhead(courseId: string): Promise<string | null> {
      const [course] = await db.select().from(schema.course).where(eq(schema.course.id, courseId));
      if (!course || course.isExample || course.status !== "active" || !course.learnerId) {
        return null;
      }
      const [waiting] = await db
        .select({ id: schema.proposal.id })
        .from(schema.proposal)
        .where(
          and(
            eq(schema.proposal.courseId, courseId),
            eq(schema.proposal.kind, "mission_change"),
            eq(schema.proposal.status, "open"),
          ),
        )
        .limit(1);
      if (waiting) return null;

      const [upNext] = await db
        .select()
        .from(schema.lesson)
        .where(and(eq(schema.lesson.courseId, courseId), isNull(schema.lesson.finishedAt)))
        .orderBy(desc(schema.lesson.index))
        .limit(1);
      if (!upNext || upNext.content !== null) return null;
      if (await findGenerationJob(upNext.id)) return null;
      if (await generationRefused(upNext, course.learnerId)) return null;

      const job = await insertGenerationJob(upNext);
      return job.status === "pending" ? job.id : null;
    },

    /** Runs the one step of a Lesson generation job; see `runJobStep` in ./jobs. */
    async runLessonGenerationStep(job: JobRow, run: JobRun): Promise<JobStepResult> {
      const [lesson] = job.lessonId
        ? await db.select().from(schema.lesson).where(eq(schema.lesson.id, job.lessonId))
        : [];
      if (!lesson) throw new Error("The Lesson to write is missing.");
      // A written Lesson is never written again.
      if (lesson.content !== null) {
        await run.advance(null, "Your Lesson is ready.");
        return "stop";
      }
      // A Done Course gets no new Lessons.
      const [{ status }] = await db
        .select({ status: schema.course.status })
        .from(schema.course)
        .where(eq(schema.course.id, lesson.courseId));
      if (status === "done") {
        await run.advance(null, "This Course is Done, so no new Lessons are written.");
        return "stop";
      }

      await run.say(`Writing “${lesson.title}”.`);
      const input = await lessonInput(lesson);
      const draft = await writeDraft(run, input);

      await run.say("Checking the quiz.");
      const quiz = await lintQuiz(lesson, input, draft);

      const reviews = input.keyIdeas.length > 0;
      const known = new Set(input.glossary.map((t) => t.term.trim().toLocaleLowerCase()));
      const content = LessonContent.parse({
        hook: draft.hook.trim(),
        sections: draft.sections.map((s) => ({
          heading: s.heading.trim(),
          body: s.body.trim(),
          citations: [...new Set(s.citations)],
        })),
        keyIdea: draft.keyIdea.trim(),
        practice: {
          title: draft.practice.title.trim(),
          steps: draft.practice.steps.map((step) => step.trim()),
        },
        practiceMinutes: draft.practiceMinutes,
        quiz: quiz.map((q, i) => ({
          ...shuffle(q, random),
          // From the second Lesson on, the last question is the review.
          review: reviews && i === quiz.length - 1,
        })),
        readNext: draft.readNext,
        newTerms: draft.newTerms
          .map((t) => ({ term: t.term.trim(), definition: t.definition.trim() }))
          .filter((t) => !known.has(t.term.toLocaleLowerCase())),
      });

      await db.transaction(async (tx) => {
        await run.advance(null, "Your Lesson is ready.", {}, tx);
        await tx
          .update(schema.lesson)
          .set({ content })
          .where(and(eq(schema.lesson.id, lesson.id), isNull(schema.lesson.content)));
      });
      return "stop";
    },

    /**
     * The Learner opens a Lesson. The first open of an unwritten Lesson not
     * already being written ahead starts its generation job, within the
     * Course's allowance, the Learner's daily limit and the spend stop;
     * later opens report on that job. A written
     * Lesson needs nothing. A refused open leaves the Lesson unopened.
     */
    async openLesson(
      courseId: string,
      lessonIndex: number,
      learnerId: string,
    ): Promise<OpenLessonResult> {
      const found = await findOwnLesson(courseId, lessonIndex, learnerId);
      if (!found.ok) return found;
      const { lesson, course } = found;
      if (lesson.content === null && course.status === "done") return { ok: false, reason: "done" };
      const written = lesson.content !== null || lesson.finishedAt !== null;
      const existing = written ? null : await findGenerationJob(lesson.id);
      if (!written && !existing) {
        const refused = await generationRefused(lesson, learnerId);
        if (refused) return refused;
      }

      await db
        .update(schema.lesson)
        .set({ openedAt: new Date() })
        .where(and(eq(schema.lesson.id, lesson.id), isNull(schema.lesson.openedAt)));
      if (written) return { ok: true, generation: null, start: false };

      const job = existing ?? (await insertGenerationJob(lesson));
      return { ok: true, generation: viewOf(job), start: job.status === "pending" };
    },

    /** The Lesson's generation job, for its progress screen. Null if not found, not theirs, or it has none. */
    async readLessonGeneration(
      courseId: string,
      lessonIndex: number,
      learnerId: string | null,
    ): Promise<JobView | null> {
      if (learnerId === null) return null;
      const found = await findOwnLesson(courseId, lessonIndex, learnerId);
      if (!found.ok) return null;
      const job = await findGenerationJob(found.lesson.id);
      return job ? viewOf(job) : null;
    },

    /** "Try again" after writing the Lesson failed, the spend stop paused it, or its runner was cut off. */
    async retryLessonGeneration(
      courseId: string,
      lessonIndex: number,
      learnerId: string,
    ): Promise<RetryLessonGenerationResult> {
      const found = await findOwnLesson(courseId, lessonIndex, learnerId);
      if (!found.ok) return found;
      const { lesson } = found;
      if (lesson.content !== null || lesson.finishedAt !== null) {
        return { ok: false, reason: "nothing-to-retry" };
      }
      if (found.course.status === "done") return { ok: false, reason: "done" };

      const job = await findGenerationJob(lesson.id);
      if (!job) {
        const refused = await generationRefused(lesson, learnerId);
        if (refused) return refused;
        return { ok: true, jobId: (await insertGenerationJob(lesson)).id };
      }
      const paused = await spend.teacherCall();
      if (paused) return paused;
      await resumeJob(db, job.id, "Trying again.");
      // Pending, running or done: nothing to reset; starting it again is harmless.
      return { ok: true, jobId: job.id };
    },

    /**
     * The Learner picks an option: stored as a quiz attempt, which locks the
     * question. Answering a locked question again returns the first answer.
     */
    async answerQuestion(
      courseId: string,
      lessonIndex: number,
      questionIndex: number,
      chosenOption: number,
      learnerId: string,
    ): Promise<AnswerQuestionResult> {
      const found = await findOwnLesson(courseId, lessonIndex, learnerId);
      if (!found.ok) return found;
      const { lesson } = found;
      if (lesson.content === null) return { ok: false, reason: "not-written" };
      if (lesson.finishedAt !== null) return { ok: false, reason: "finished" };
      if (found.course.status === "done") return { ok: false, reason: "done" };

      const { quiz } = LessonContent.parse(lesson.content);
      const question = Number.isInteger(questionIndex) ? quiz[questionIndex] : undefined;
      if (
        !question ||
        !Number.isInteger(chosenOption) ||
        chosenOption < 0 ||
        chosenOption >= question.options.length
      ) {
        return { ok: false, reason: "invalid" };
      }

      await db
        .insert(schema.quizAttempt)
        .values({
          lessonId: lesson.id,
          questionIndex,
          chosenOption,
          correct: chosenOption === question.answer,
        })
        .onConflictDoNothing();
      const attempts = await db
        .select()
        .from(schema.quizAttempt)
        .where(eq(schema.quizAttempt.lessonId, lesson.id));
      const stored = attempts.find((a) => a.questionIndex === questionIndex)!;

      return {
        ok: true,
        attempt: {
          questionIndex,
          chosenOption: stored.chosenOption,
          correct: stored.correct,
          at: stored.createdAt,
        },
        allAnswered: quiz.every((_, i) => attempts.some((a) => a.questionIndex === i)),
      };
    },
  };
}

/** Why a draft breaks the Lesson's rules, or null if it keeps them. Lists every problem at once. */
export function lessonProblem(
  draft: LessonDraft,
  { refs, sittingMinutes }: { refs: Set<string>; sittingMinutes: number },
): string | null {
  const problems: string[] = [];

  const sections = draft.sections.length;
  if (sections < MIN_SECTIONS || sections > MAX_SECTIONS) {
    problems.push(`There are ${sections} sections; write ${MIN_SECTIONS} or ${MAX_SECTIONS}.`);
  }
  draft.sections.forEach((s, i) => {
    if (s.citations.length === 0) {
      problems.push(`Section ${i + 1} cites no Resource; cite at least one.`);
    }
  });
  const unknown = [
    ...new Set([...draft.sections.flatMap((s) => s.citations), draft.readNext]),
  ].filter((id) => !refs.has(id));
  if (unknown.length > 0) {
    problems.push(
      `${unknown.map((id) => `"${id}"`).join(", ")} ${unknown.length === 1 ? "is not a Resource" : "are not Resources"} of this Course; cite and pick Read next only from ${[...refs].join(", ")}.`,
    );
  }

  const steps = draft.practice.steps.length;
  if (steps < 3 || steps > 4) problems.push(`The practice has ${steps} steps; give 3 or 4.`);
  if (draft.practiceMinutes < 1) problems.push("practiceMinutes must be at least 1.");
  const reading = readingMinutes(draft);
  if (reading + draft.practiceMinutes > sittingMinutes) {
    problems.push(
      `Reading takes about ${reading.toFixed(1)} minutes and practice ${draft.practiceMinutes}; together they must fit one ${sittingMinutes}-minute sitting.`,
    );
  }

  if (draft.quiz.length !== QUIZ_LENGTH) {
    problems.push(`The quiz has ${draft.quiz.length} questions; write exactly ${QUIZ_LENGTH}.`);
  }
  draft.quiz.forEach((q, i) => {
    const problem = questionProblem(q, `Question ${i + 1}`);
    if (problem) problems.push(problem);
  });
  if (draft.newTerms.length > MAX_NEW_TERMS) {
    problems.push(`There are ${draft.newTerms.length} new terms; give at most ${MAX_NEW_TERMS}.`);
  }

  const withIds = [
    ["the hook", draft.hook],
    ...draft.sections.flatMap((s, i) => [
      [`the heading of section ${i + 1}`, s.heading],
      [`the body of section ${i + 1}`, s.body],
    ]),
    ["the Key idea", draft.keyIdea],
    ["the practice", [draft.practice.title, ...draft.practice.steps].join(" ")],
    ["the new terms", draft.newTerms.map((t) => `${t.term} ${t.definition}`).join(" ")],
  ].flatMap(([field, text]) => (RESOURCE_ID.test(text) ? [field] : []));
  if (withIds.length > 0) {
    problems.push(
      `Resource ids appear in ${withIds.join(", ")}; put ids only in "citations" and "readNext".`,
    );
  }

  return problems.length > 0 ? problems.join(" ") : null;
}

/** Why a question is malformed (not the quiz rule), or null. */
function questionProblem(q: QuestionDraft, name: string): string | null {
  if (q.options.length !== OPTIONS_PER_QUESTION) {
    return `${name} has ${q.options.length} options; give exactly ${OPTIONS_PER_QUESTION}.`;
  }
  if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= OPTIONS_PER_QUESTION) {
    return `${name} has answer ${q.answer}; it must be the index of the right option, 0 to ${OPTIONS_PER_QUESTION - 1}.`;
  }
  if ([q.question, ...q.options, q.explanation].some((text) => RESOURCE_ID.test(text))) {
    return `${name} mentions a Resource id; put ids only in "citations" and "readNext".`;
  }
  return null;
}

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The quiz rule: no formatting clues. All 4 options have exactly the same
 * number of words, and the shortest is at least 70% of the longest.
 */
export function quizRuleProblem(q: QuestionDraft): string | null {
  const words = q.options.map(wordCount);
  if (new Set(words).size > 1) {
    return `The options have ${words.join(", ")} words; give every option exactly the same number of words.`;
  }
  const lengths = q.options.map((o) => [...o.trim()].length);
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  if (shortest < longest * MIN_OPTION_LENGTH_RATIO) {
    return `The options are ${shortest} to ${longest} characters long; keep their lengths within 30% of each other.`;
  }
  return null;
}

/** The options in a random order, with the answer following its option. */
function shuffle(q: QuestionDraft, random: () => number) {
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    question: q.question.trim(),
    options: order.map((i) => q.options[i].trim()),
    answer: order.indexOf(q.answer),
    explanation: q.explanation.trim(),
  };
}
