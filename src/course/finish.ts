import { and, asc, eq, inArray, isNotNull, isNull, max } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type {
  FinishDraft,
  FinishLessonInput,
  QuizAttemptEvidence,
  Teacher,
  UpNextDraft,
} from "@/teacher";
import { chatEvidence } from "./chat";
import { missionOf, upNextProblem } from "./course-creation";
import { resumeJob, viewOf, type JobRow, type JobRun, type JobStepResult, type JobView } from "./jobs";
import { LessonContent, type Question } from "./lesson-content";
import { findLessonJob, findOwnLessonIn, type LessonRow } from "./lessons";
import {
  doneEvidence,
  insertProposal,
  missionChangeProblem,
  proposalContext,
  proposedMission,
} from "./proposals";
import type { Spend, SpendPaused } from "./spend";

/**
 * Finish (ADR 0002, ADR 0004): once every quiz question is answered, a
 * Finish job weighs the Lesson's evidence in one Teacher call, then writes
 * the Learning records it earned, promotes Glossary terms, grows the
 * Reference sheet and picks the next Up next, whose content waits for its
 * first open. The evidence rules are asked for in the prompt and checked
 * here: a record or term that breaks them is dropped, and logged. The Teacher
 * may also propose a Mission change or suggest Done, which wait for the
 * Learner (see ./proposals); Done only when every success item has a
 * standing record behind it.
 */

export type FinishStep = "finish";

/** Topic-specific sections one Finish may add or rewrite. */
export const MAX_REFERENCE_SECTIONS = 2;

export type FinishLessonResult =
  | {
      ok: true;
      /** The Lesson's Finish job. */
      finishing: JobView;
      /** True when the job waits for a runner: start it. */
      start: boolean;
    }
  | {
      ok: false;
      reason: "not-found" | "read-only" | "not-written" | "unanswered" | "finished" | "done";
    }
  /** The Teacher is paused for the day; the answers keep. */
  | SpendPaused;

export type RetryFinishResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not-found" | "read-only" | "nothing-to-retry" | "done" }
  | SpendPaused;

/** A quiz attempt as a record's evidence, by its id ("L2Q3"). */
type AttemptFact = { lessonIndex: number; correct: boolean; at: Date };

/** What a Learning record may cite. */
export type Evidence = {
  attempts: Map<string, AttemptFact>;
  /** Ids of the Learner's own chat messages. */
  learnerChat: Set<string>;
};

type RecordDraft = FinishDraft["learningRecords"][number];

/** "L2Q3": Lesson 2, question 3. */
const attemptId = (lessonIndex: number, questionIndex: number) =>
  `L${lessonIndex}Q${questionIndex + 1}`;

/** How terms and titles are compared: case and spacing aside. */
const keyOf = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase();

export function createFinishOperations({
  db,
  teacher,
  spend,
}: {
  db: Db;
  teacher: Teacher;
  spend: Spend;
}) {
  const findFinishJob = (lessonId: string) => findLessonJob(db, lessonId, "finish");

  /** Everything the Teacher weighs, and the evidence its records may cite. */
  async function finishInput(lesson: LessonRow, content: LessonContent) {
    const courseId = lesson.courseId;
    const [[course], lessons, attempts, records, [{ last }], glossary, sections, resources] =
      await Promise.all([
        db.select().from(schema.course).where(eq(schema.course.id, courseId)),
        db
          .select()
          .from(schema.lesson)
          .where(and(eq(schema.lesson.courseId, courseId), isNotNull(schema.lesson.content)))
          .orderBy(asc(schema.lesson.index)),
        db
          .select({
            lessonId: schema.quizAttempt.lessonId,
            questionIndex: schema.quizAttempt.questionIndex,
            chosenOption: schema.quizAttempt.chosenOption,
            correct: schema.quizAttempt.correct,
            at: schema.quizAttempt.createdAt,
          })
          .from(schema.quizAttempt)
          .innerJoin(schema.lesson, eq(schema.lesson.id, schema.quizAttempt.lessonId))
          .where(eq(schema.lesson.courseId, courseId))
          .orderBy(asc(schema.lesson.index), asc(schema.quizAttempt.questionIndex)),
        db
          .select()
          .from(schema.learningRecord)
          .where(
            and(
              eq(schema.learningRecord.courseId, courseId),
              isNull(schema.learningRecord.supersededById),
            ),
          )
          .orderBy(asc(schema.learningRecord.number)),
        db
          .select({ last: max(schema.learningRecord.number) })
          .from(schema.learningRecord)
          .where(eq(schema.learningRecord.courseId, courseId)),
        db
          .select({ term: schema.glossaryTerm.term, definition: schema.glossaryTerm.definition })
          .from(schema.glossaryTerm)
          .where(eq(schema.glossaryTerm.courseId, courseId))
          .orderBy(asc(schema.glossaryTerm.createdAt), asc(schema.glossaryTerm.term)),
        db
          .select()
          .from(schema.referenceSection)
          .where(eq(schema.referenceSection.courseId, courseId))
          .orderBy(asc(schema.referenceSection.position)),
        db.select().from(schema.resource).where(eq(schema.resource.courseId, courseId)),
      ]);
    // In the Teacher's order: r1, r2, … r10.
    resources.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));

    // Finished Lessons, and this one: attempts elsewhere are not evidence yet.
    const counted = new Map(
      lessons
        .filter((l) => l.finishedAt !== null || l.id === lesson.id)
        .map((l) => [l.id, { lesson: l, quiz: LessonContent.parse(l.content).quiz }]),
    );
    const quizAttempts: QuizAttemptEvidence[] = [];
    const evidence: Evidence = { attempts: new Map(), learnerChat: new Set() };
    for (const a of attempts) {
      const entry = counted.get(a.lessonId);
      const question = entry?.quiz[a.questionIndex];
      if (!entry || !question) continue;
      const id = attemptId(entry.lesson.index, a.questionIndex);
      quizAttempts.push({
        id,
        lessonIndex: entry.lesson.index,
        question: question.question,
        rightOption: question.options[question.answer],
        chosenOption: question.options[a.chosenOption],
        correct: a.correct,
        review: question.review,
      });
      evidence.attempts.set(id, { lessonIndex: entry.lesson.index, correct: a.correct, at: a.at });
    }

    const [chat, proposals] = await Promise.all([
      chatEvidence(db, lesson.id),
      proposalContext(db, courseId),
    ]);
    for (const m of chat) if (m.from === "learner") evidence.learnerChat.add(m.id);

    const input: FinishLessonInput = {
      subject: course.subject,
      language: course.language,
      mission: missionOf(course),
      lesson: {
        index: lesson.index,
        title: lesson.title,
        goal: lesson.goal,
        keyIdea: content.keyIdea,
        newTerms: content.newTerms,
      },
      quizAttempts,
      chat,
      learningRecords: records.map((r) => ({
        number: r.number,
        kind: r.kind,
        title: r.title,
        body: r.body,
      })),
      nextRecordNumber: (last ?? 0) + 1,
      proposals,
      glossary,
      referenceSections: sections.map((s) => ({ title: s.title, body: s.body })),
      finishedLessons: [...counted.values()].map(({ lesson: l }) => ({
        title: l.title,
        goal: l.goal,
      })),
      resources: resources.map((r) => ({ kind: r.kind, title: r.title, why: r.why })),
    };
    return { course, input, evidence, sections, lastNumber: last ?? 0 };
  }

  /** The Teacher's Finish; a structured call that fails usually succeeds the second time. */
  async function weigh(input: FinishLessonInput): Promise<FinishDraft> {
    try {
      return await teacher.finishLesson(input);
    } catch (error) {
      console.warn("Finishing a Lesson failed; trying once more.", error);
      return teacher.finishLesson(input);
    }
  }

  /**
   * The Finish's Up next if it keeps the rules, otherwise one more pick with
   * the reason, given the Learning records as they now stand.
   */
  async function nextLesson(
    input: FinishLessonInput,
    draft: FinishDraft,
    records: FinishLessonInput["learningRecords"],
  ): Promise<UpNextDraft> {
    const problem = (next: UpNextDraft) =>
      upNextProblem(next, input.mission.sittingMinutes) ?? repeatProblem(next, input);
    let feedback = problem(draft.upNext);
    if (feedback === null) return draft.upNext;

    const picked = await teacher.pickUpNext({
      subject: input.subject,
      language: input.language,
      mission: input.mission,
      learningRecords: records,
      finishedLessons: input.finishedLessons,
      resources: input.resources,
      feedback,
    });
    feedback = problem(picked);
    if (feedback === null) return picked;
    throw new Error(`Up next broke its rules twice: ${feedback}`);
  }

  return {
    /** Runs the one step of a Finish job; see `runJobStep` in ./jobs. */
    async runFinishStep(job: JobRow, run: JobRun): Promise<JobStepResult> {
      const [lesson] = job.lessonId
        ? await db.select().from(schema.lesson).where(eq(schema.lesson.id, job.lessonId))
        : [];
      if (!lesson) throw new Error("The Lesson to finish is missing.");
      // A finished Lesson is never finished again.
      if (lesson.finishedAt !== null) {
        await run.advance(null, "This Lesson is finished.");
        return "stop";
      }
      if (lesson.content === null) throw new Error("The Lesson to finish is not written.");
      const content = LessonContent.parse(lesson.content);

      await run.say(`Weighing what you showed in “${lesson.title}”.`);
      const { course, input, evidence, sections, lastNumber } = await finishInput(lesson, content);
      const draft = await weigh(input);

      await run.say("Writing down what you learned.");
      const standing = new Set(input.learningRecords.map((r) => r.number));
      // Each kept record by the number the Teacher cites it by (from
      // `nextRecordNumber`, in draft order), with the number it will get.
      const cited = new Map<number, { number: number; kind: RecordKind }>();
      const records = draft.learningRecords.flatMap((record, i) => {
        const problem = recordProblem(record, evidence, lesson.index);
        if (problem !== null) {
          console.warn(`Lesson ${lesson.id}: dropping the record “${record.title}”: ${problem}`);
          return [];
        }
        cited.set(input.nextRecordNumber + i, { number: lastNumber + cited.size + 1, kind: record.kind });
        // Each standing record is replaced at most once.
        const supersedes = [...new Set(record.supersedes)].filter((n) => standing.delete(n));
        return [
          {
            kind: record.kind,
            title: record.title.trim(),
            body: record.body.trim(),
            supersedes,
          },
        ];
      });
      const terms = promotedTerms(draft, {
        content,
        attempts: evidence.attempts,
        lessonIndex: lesson.index,
        glossary: input.glossary,
        language: course.language,
      });
      const sectionChanges = referenceSectionChanges(draft, sections);

      const kept = input.learningRecords.filter((r) => standing.has(r.number));
      const next = await nextLesson(input, draft, [
        ...kept,
        ...records.map((r, i) => ({
          number: lastNumber + i + 1,
          kind: r.kind,
          title: r.title,
          body: r.body,
        })),
      ]);
      const proposals = proposalsFrom(draft, {
        courseId: course.id,
        lessonId: lesson.id,
        mission: input.mission,
        standing: [
          ...kept.map((r) => ({ number: r.number, kind: r.kind as RecordKind })),
          ...[...cited].map(([number, { kind }]) => ({ number, kind })),
        ],
        renumber: (n) => cited.get(n)?.number ?? n,
      });

      await db.transaction(async (tx) => {
        await run.advance(null, `Up next: “${next.title.trim()}”.`, {}, tx);
        const finished = await tx
          .update(schema.lesson)
          .set({ finishedAt: new Date() })
          .where(and(eq(schema.lesson.id, lesson.id), isNull(schema.lesson.finishedAt)))
          .returning({ id: schema.lesson.id });
        if (finished.length === 0) return;

        // Numbered per Course, 1, 2, 3…, whatever their kind.
        const [{ last }] = await tx
          .select({ last: max(schema.learningRecord.number) })
          .from(schema.learningRecord)
          .where(eq(schema.learningRecord.courseId, course.id));
        let number = last ?? 0;
        // Records written since the Teacher was given the numbers move these along.
        const shift = number - lastNumber;
        for (const record of records) {
          const [row] = await tx
            .insert(schema.learningRecord)
            .values({
              courseId: course.id,
              number: ++number,
              kind: record.kind,
              title: record.title,
              body: record.body,
              lessonId: lesson.id,
            })
            .returning({ id: schema.learningRecord.id });
          if (record.supersedes.length > 0) {
            await tx
              .update(schema.learningRecord)
              .set({ supersededById: row.id })
              .where(
                and(
                  eq(schema.learningRecord.courseId, course.id),
                  inArray(schema.learningRecord.number, record.supersedes),
                  isNull(schema.learningRecord.supersededById),
                ),
              );
          }
        }

        if (terms.length > 0) {
          await tx
            .insert(schema.glossaryTerm)
            .values(terms.map((t) => ({ ...t, courseId: course.id, lessonId: lesson.id })))
            .onConflictDoNothing();
        }

        for (const change of sectionChanges) {
          if (change.id !== null) {
            await tx
              .update(schema.referenceSection)
              .set({ title: change.title, body: change.body })
              .where(eq(schema.referenceSection.id, change.id));
          } else {
            await tx.insert(schema.referenceSection).values({
              courseId: course.id,
              position: change.position,
              title: change.title,
              body: change.body,
            });
          }
        }

        // A Course confirmed Done meanwhile gets no Up next and no proposals.
        const [{ status }] = await tx
          .select({ status: schema.course.status })
          .from(schema.course)
          .where(eq(schema.course.id, course.id));
        if (status === "done") return;

        // Up next's content is written on its first open, not now.
        await tx
          .insert(schema.lesson)
          .values({
            courseId: course.id,
            index: lesson.index + 1,
            title: next.title.trim(),
            goal: next.goal.trim(),
            minutes: next.minutes,
          })
          .onConflictDoNothing();

        for (const proposal of proposals) {
          await insertProposal(
            tx,
            proposal.kind === "done"
              ? {
                  ...proposal,
                  evidence: proposal.evidence.map((e) => ({
                    ...e,
                    records: e.records.map((n) => (n > lastNumber ? n + shift : n)),
                  })),
                }
              : proposal,
          );
        }
      });
      return "stop";
    },

    /**
     * The Learner presses Finish: starts the Lesson's Finish job, once every
     * quiz question has an answer, unless the Teacher is paused for the day.
     * Pressing it again reports on that job.
     */
    async finishLesson(
      courseId: string,
      lessonIndex: number,
      learnerId: string,
    ): Promise<FinishLessonResult> {
      const found = await findOwnLessonIn(db, courseId, lessonIndex, learnerId);
      if (!found.ok) return found;
      const { lesson } = found;
      if (lesson.finishedAt !== null) return { ok: false, reason: "finished" };
      if (lesson.content === null) return { ok: false, reason: "not-written" };
      if (found.course.status === "done") return { ok: false, reason: "done" };

      const { quiz } = LessonContent.parse(lesson.content);
      const answered = await db
        .select({ questionIndex: schema.quizAttempt.questionIndex })
        .from(schema.quizAttempt)
        .where(eq(schema.quizAttempt.lessonId, lesson.id));
      if (!quiz.every((_, i) => answered.some((a) => a.questionIndex === i))) {
        return { ok: false, reason: "unanswered" };
      }
      if (!(await findFinishJob(lesson.id))) {
        const paused = await spend.teacherCall();
        if (paused) return paused;
      }

      await db
        .insert(schema.job)
        .values({
          courseId: lesson.courseId,
          kind: "finish",
          lessonId: lesson.id,
          step: "finish" satisfies FinishStep,
        })
        .onConflictDoNothing();
      const job = (await findFinishJob(lesson.id))!;
      return { ok: true, finishing: viewOf(job), start: job.status === "pending" };
    },

    /** The Lesson's Finish job, for its progress screen. Null if not found, not theirs, or it has none. */
    async readFinish(
      courseId: string,
      lessonIndex: number,
      learnerId: string | null,
    ): Promise<JobView | null> {
      if (learnerId === null) return null;
      const found = await findOwnLessonIn(db, courseId, lessonIndex, learnerId);
      if (!found.ok) return null;
      const job = await findFinishJob(found.lesson.id);
      return job ? viewOf(job) : null;
    },

    /** "Try again" after a Finish failed, the spend stop paused it, or its runner was cut off. */
    async retryFinish(
      courseId: string,
      lessonIndex: number,
      learnerId: string,
    ): Promise<RetryFinishResult> {
      const found = await findOwnLessonIn(db, courseId, lessonIndex, learnerId);
      if (!found.ok) return found;
      const job = await findFinishJob(found.lesson.id);
      if (!job || found.lesson.finishedAt !== null) return { ok: false, reason: "nothing-to-retry" };
      if (found.course.status === "done") return { ok: false, reason: "done" };
      const paused = await spend.teacherCall();
      if (paused) return paused;
      await resumeJob(db, job.id, "Trying again.");
      // Pending, running or done: nothing to reset; starting it again is harmless.
      return { ok: true, jobId: job.id };
    },
  };
}

/**
 * Why a Learning record breaks the evidence rules, or null if it keeps them.
 * Every record rests on something from this Lesson. A wrong answer alone is
 * only a quiz attempt. A misconception is written once corrected: a wrong
 * attempt, then a later right one, or the chat. An understanding needs two
 * right attempts, one of them in this Lesson, or an explanation in the chat.
 */
export function recordProblem(
  record: Pick<RecordDraft, "kind" | "evidence">,
  evidence: Evidence,
  lessonIndex: number,
): string | null {
  const ids = [...new Set(record.evidence.map((id) => id.trim().toUpperCase()))];
  const attempts = ids.flatMap((id) => evidence.attempts.get(id) ?? []);
  const chat = ids.filter((id) => evidence.learnerChat.has(id));
  if (attempts.length === 0 && chat.length === 0) {
    return "it cites no quiz attempt or chat message of this Course.";
  }
  if (chat.length === 0 && !attempts.some((a) => a.lessonIndex === lessonIndex)) {
    return "it cites no evidence from this Lesson.";
  }

  const right = attempts.filter((a) => a.correct);
  if (record.kind === "understanding") {
    if (chat.length > 0) return null;
    if (right.length >= 2 && right.some((a) => a.lessonIndex === lessonIndex)) return null;
    return "an understanding needs two correct attempts on the idea, or an explanation in the chat.";
  }

  if (chat.length > 0) return null;
  const wrong = attempts.filter((a) => !a.correct);
  if (wrong.length === 0) return "a misconception needs the wrong attempt that showed it.";
  const later = (a: AttemptFact, b: AttemptFact) =>
    a.lessonIndex > b.lessonIndex || (a.lessonIndex === b.lessonIndex && a.at > b.at);
  if (!right.some((r) => wrong.some((w) => later(r, w)))) {
    return "a misconception is recorded only once corrected: a later correct attempt, or the chat.";
  }
  return null;
}

/**
 * The Lesson's new terms to add to the Glossary: each one whose question
 * (not the review) was answered correctly in this Lesson. Casing is
 * normalised to a capital first letter; a term already there, in any
 * casing, is not added again.
 */
export function promotedTerms(
  draft: Pick<FinishDraft, "glossary">,
  {
    content,
    attempts,
    lessonIndex,
    glossary,
    language,
  }: {
    content: Pick<LessonContent, "newTerms" | "quiz">;
    attempts: Map<string, Pick<AttemptFact, "correct">>;
    lessonIndex: number;
    glossary: { term: string }[];
    language: string;
  },
): { term: string; definition: string }[] {
  const known = new Set(glossary.map((t) => keyOf(t.term)));
  return draft.glossary.flatMap(({ term, question }) => {
    const found = content.newTerms.find((t) => keyOf(t.term) === keyOf(term));
    if (!found || question === null) return [];
    const q: Question | undefined = content.quiz[question - 1];
    if (!q || q.review || !attempts.get(attemptId(lessonIndex, question - 1))?.correct) {
      return [];
    }
    const normalised = normaliseTerm(found.term, language);
    const key = keyOf(normalised);
    if (normalised === "" || known.has(key)) return [];
    known.add(key);
    return [{ term: normalised, definition: found.definition.trim() }];
  });
}

/** "home  chord" → "Home chord": spacing tidied, first letter capital, the rest as written. */
export function normaliseTerm(term: string, language: string): string {
  const tidy = term.trim().replace(/\s+/g, " ");
  const [first = "", ...rest] = [...tidy];
  return first.toLocaleUpperCase(language) + rest.join("");
}

/** New sections go at the end; one whose title is already on the sheet is rewritten in place. */
function referenceSectionChanges(
  draft: Pick<FinishDraft, "referenceSections">,
  existing: { id: string; position: number; title: string }[],
): { id: string | null; position: number; title: string; body: string }[] {
  let position = Math.max(0, ...existing.map((s) => s.position));
  const changes: { id: string | null; position: number; title: string; body: string }[] = [];
  for (const section of draft.referenceSections) {
    const title = section.title.trim();
    const body = section.body.trim();
    if (title === "" || body === "" || changes.some((c) => keyOf(c.title) === keyOf(title))) {
      continue;
    }
    if (changes.length === MAX_REFERENCE_SECTIONS) break;
    const same = existing.find((e) => keyOf(e.title) === keyOf(title));
    changes.push(
      same
        ? { id: same.id, position: same.position, title, body }
        : { id: null, position: ++position, title, body },
    );
  }
  return changes;
}

type RecordKind = (typeof schema.learningRecordKind.enumValues)[number];

type FinishProposal = Parameters<typeof insertProposal>[1];

/**
 * The Mission change and Done suggestion a Finish may raise, each only if it
 * keeps the rules; one that breaks them is dropped, and logged. Done rests on
 * the records standing once this Finish is written, cited by the numbers the
 * Teacher gave them; `renumber` turns those into the numbers they get.
 */
function proposalsFrom(
  draft: Pick<FinishDraft, "missionChange" | "done">,
  {
    courseId,
    lessonId,
    mission,
    standing,
    renumber,
  }: {
    courseId: string;
    lessonId: string;
    mission: FinishLessonInput["mission"];
    standing: { number: number; kind: RecordKind }[];
    renumber: (cited: number) => number;
  },
): FinishProposal[] {
  const proposals: FinishProposal[] = [];
  const base = { courseId, lessonId, source: "finish" as const };
  if (draft.missionChange) {
    const problem = missionChangeProblem(draft.missionChange, mission);
    if (problem === null) {
      proposals.push({
        ...base,
        kind: "mission_change",
        reason: draft.missionChange.reason,
        mission: proposedMission(draft.missionChange),
      });
    } else {
      console.warn(`Lesson ${lessonId}: dropping the proposed Mission change: ${problem}`);
    }
  }
  if (draft.done) {
    const checked = doneEvidence(draft.done, mission.successLooksLike, standing);
    if (checked.ok) {
      proposals.push({
        ...base,
        kind: "done",
        reason: draft.done.reason,
        evidence: checked.evidence.map((e) => ({ ...e, records: e.records.map(renumber) })),
      });
    } else {
      console.warn(`Lesson ${lessonId}: dropping the Done suggestion: ${checked.problem}`);
    }
  }
  return proposals;
}

/** Why Up next repeats a finished Lesson, or null. */
function repeatProblem(next: UpNextDraft, input: FinishLessonInput): string | null {
  const title = keyOf(next.title);
  return input.finishedLessons.some((l) => keyOf(l.title) === title)
    ? `“${next.title.trim()}” is a finished Lesson; choose a new one.`
    : null;
}
