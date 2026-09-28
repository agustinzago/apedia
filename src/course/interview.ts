import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import type { InterviewMessage } from "@/db/schema";
import type { Teacher } from "@/teacher";
import { insertCourseCreationJob } from "./course-creation";
import type { DailyCaps, DailyLimitReached } from "./limits";
import type { Spend, SpendPaused } from "./spend";

export type { InterviewMessage } from "@/db/schema";

/** The sitting lengths offered as chips, in minutes. */
export const SITTING_MINUTES = [5, 10, 20, 30] as const;
export type SittingMinutes = (typeof SITTING_MINUTES)[number];

export type InterviewStage = (typeof schema.interviewStage.enumValues)[number];

type QuestionKey = "why" | "know" | "success" | "sitting";
const ORDER: QuestionKey[] = ["why", "know", "success", "sitting"];

/** The four Interview questions, in English. Later ones are asked in the visitor's language. */
function question(key: QuestionKey, subject: string): string {
  switch (key) {
    case "why":
      return `Why do you want to learn ${subject}? The real reason helps me shape every lesson.`;
    case "know":
      return "What do you already know about it? “Nothing yet” is a perfectly good answer.";
    case "success":
      return "Imagine it’s a month from now and it worked. What can you do?";
    case "sitting":
      return "Last question. How long is one sitting?";
  }
}

/** What the Teacher and visitor say before the Interview is stored: greeting, subject, first question. */
export function openingMessages(subject: string): InterviewMessage[] {
  return [
    { from: "teacher", text: "Hello. What would you like to learn?" },
    { from: "learner", text: subject },
    { from: "teacher", text: question("why", subject) },
  ];
}

/** What the Interview screen shows. */
export type InterviewView = {
  id: string;
  subject: string;
  stage: InterviewStage;
  messages: InterviewMessage[];
  /** 1–4 while a question is being asked, otherwise null. */
  questionNumber: number | null;
  /** Set once a Course has been written from this Interview. */
  courseId: string | null;
};

export type WriteCourseResult =
  | {
      ok: true;
      courseId: string;
      /** The Course creation job to run, or null for a Course written before jobs existed. */
      jobId: string | null;
    }
  | { ok: false; reason: "not-found" | "not-yours" | "not-finished" }
  /** The Learner has started today's new Courses; the Interview keeps for later. */
  | DailyLimitReached
  /** The Teacher is paused for the day; the Interview keeps for later. */
  | SpendPaused;

export type ClaimResult = "claimed" | "not-found" | "not-yours";

const Subject = z.string().trim().min(1).max(120);
const Answer = z.string().trim().max(1000);

type InterviewRow = typeof schema.interview.$inferSelect;

export function createInterviewOperations({
  db,
  teacher,
  caps,
  spend,
}: {
  db: Db;
  teacher: Teacher;
  caps: DailyCaps;
  spend: Spend;
}) {
  async function findRow(interviewId: string): Promise<InterviewRow | null> {
    const [row] = await db
      .select()
      .from(schema.interview)
      .where(eq(schema.interview.id, interviewId));
    return row ?? null;
  }

  async function toView(row: InterviewRow): Promise<InterviewView> {
    const [course] = await db
      .select({ id: schema.course.id })
      .from(schema.course)
      .where(eq(schema.course.interviewId, row.id));
    const index = ORDER.indexOf(row.stage as QuestionKey);
    return {
      id: row.id,
      subject: row.subject,
      stage: row.stage,
      messages: row.messages,
      questionNumber: index === -1 ? null : index + 1,
      courseId: course?.id ?? null,
    };
  }

  /** Anyone holding the id may continue an unclaimed Interview; a claimed one is its Learner's only. */
  function mayUse(row: InterviewRow, learnerId: string | null) {
    return row.learnerId === null || row.learnerId === learnerId;
  }

  return {
    /**
     * Starts an Interview from the subject and the answer to "why". The
     * Teacher first checks the two for safety: a redirected subject gets a
     * kind message and nothing else runs. Once the day's spend reaches the
     * alarm, sales pause: no new Interview starts until the next UTC day.
     */
    async startInterview(input: {
      subject: string;
      why: string;
    }): Promise<InterviewView | SpendPaused> {
      const subject = Subject.parse(input.subject);
      const why = Answer.parse(input.why);
      const paused = await spend.newSale();
      if (paused) return paused;

      const safety = await teacher.checkSafety({ subject, why });
      const language = canonicalLanguage(safety.language);
      const messages: InterviewMessage[] = [
        ...openingMessages(subject),
        { from: "learner", text: why },
      ];

      if (safety.verdict === "redirect") {
        const [row] = await db
          .insert(schema.interview)
          .values({
            subject,
            language,
            stage: "redirected",
            why,
            messages: [...messages, { from: "teacher", text: safety.message }],
          })
          .returning();
        return toView(row);
      }

      const reply = await teacher.interviewFollowUp({
        subject,
        language,
        question: question("why", subject),
        answer: why,
        mayFollowUp: true,
        nextQuestion: question("know", subject),
      });
      const [row] = await db
        .insert(schema.interview)
        .values(
          reply.followUp
            ? {
                subject,
                language,
                stage: "why",
                why,
                followUpAsked: true,
                awaitingFollowUp: true,
                messages: [...messages, { from: "teacher", text: reply.followUp }],
              }
            : {
                subject,
                language,
                stage: "know",
                why,
                messages: [...messages, { from: "teacher", text: reply.nextQuestion }],
              },
        )
        .returning();
      return toView(row);
    },

    /**
     * Answers the question being asked. The Teacher may ask one follow-up in
     * the whole Interview, only for an empty or vague answer. Null if the
     * Interview is not found or not the caller's; unchanged if it is not
     * waiting for a written answer. Past the spend stop, nothing is saved.
     */
    async answerInterview(
      interviewId: string,
      rawAnswer: string,
      learnerId: string | null = null,
    ): Promise<InterviewView | SpendPaused | null> {
      const row = await findRow(interviewId);
      if (!row || !mayUse(row, learnerId)) return null;
      const stage = row.stage;
      if (stage !== "why" && stage !== "know" && stage !== "success") return toView(row);

      const answer = Answer.parse(rawAnswer);
      const paused = await spend.teacherCall();
      if (paused) return paused;
      const next = ORDER[ORDER.indexOf(stage) + 1];
      const asked = lastTeacherMessage(row.messages);
      const mayFollowUp = !row.followUpAsked;

      const reply = await teacher.interviewFollowUp({
        subject: row.subject,
        language: row.language,
        question: asked,
        answer,
        mayFollowUp,
        nextQuestion: question(next, row.subject),
      });

      // An answer to a follow-up adds to the original answer.
      const combined = row.awaitingFollowUp
        ? [row[stage], answer].filter(Boolean).join("\n")
        : answer;
      const messages: InterviewMessage[] = [...row.messages, { from: "learner", text: answer }];
      const followUp = mayFollowUp ? reply.followUp : null;

      const [updated] = await db
        .update(schema.interview)
        .set(
          followUp
            ? {
                [stage]: combined,
                followUpAsked: true,
                awaitingFollowUp: true,
                messages: [...messages, { from: "teacher", text: followUp }],
              }
            : {
                [stage]: combined,
                stage: next,
                awaitingFollowUp: false,
                messages: [...messages, { from: "teacher", text: reply.nextQuestion }],
              },
        )
        // Guards against a double submit racing past this question.
        .where(and(eq(schema.interview.id, row.id), eq(schema.interview.stage, stage)))
        .returning();
      return toView(updated ?? (await findRow(interviewId))!);
    },

    /** Answers the last question with one of the sitting-length chips; the Interview is then complete. */
    async chooseSittingLength(
      interviewId: string,
      minutes: number,
      learnerId: string | null = null,
    ): Promise<InterviewView | null> {
      if (!SITTING_MINUTES.includes(minutes as SittingMinutes)) {
        throw new RangeError(`Sitting length must be one of ${SITTING_MINUTES.join(", ")} minutes.`);
      }
      const row = await findRow(interviewId);
      if (!row || !mayUse(row, learnerId)) return null;
      if (row.stage !== "sitting") return toView(row);

      const [updated] = await db
        .update(schema.interview)
        .set({
          stage: "complete",
          sittingMinutes: minutes,
          messages: [...row.messages, { from: "learner", text: `${minutes} minutes` }],
        })
        .where(and(eq(schema.interview.id, row.id), eq(schema.interview.stage, "sitting")))
        .returning();
      return toView(updated ?? (await findRow(interviewId))!);
    },

    /** The Interview as its screen shows it. Null if not found or not the caller's. */
    async readInterview(
      interviewId: string,
      learnerId: string | null = null,
    ): Promise<InterviewView | null> {
      const row = await findRow(interviewId);
      if (!row || !mayUse(row, learnerId)) return null;
      return toView(row);
    },

    /** Gives an anonymous Interview to the Learner who just signed in. */
    async claimInterview(interviewId: string, learnerId: string): Promise<ClaimResult> {
      await db
        .update(schema.interview)
        .set({ learnerId, claimedAt: new Date() })
        .where(and(eq(schema.interview.id, interviewId), isNull(schema.interview.learnerId)));
      const row = await findRow(interviewId);
      if (!row) return "not-found";
      return row.learnerId === learnerId ? "claimed" : "not-yours";
    },

    /**
     * "Write my course": creates the Course from the Learner's finished
     * Interview, with its Mission and the prior-knowledge Learning record
     * 0001, and queues its Course creation job (research, then Up next) for
     * the caller to run. Writing the same Interview again returns the same
     * Course and job. A new Course counts toward the Learner's daily limit.
     * It is not a new sale, so it goes ahead once sales pause, until the
     * spend stop.
     */
    async writeCourse(interviewId: string, learnerId: string): Promise<WriteCourseResult> {
      const row = await findRow(interviewId);
      if (!row) return { ok: false, reason: "not-found" };
      if (row.learnerId !== learnerId) return { ok: false, reason: "not-yours" };
      if (row.stage !== "complete" || row.sittingMinutes === null) {
        return { ok: false, reason: "not-finished" };
      }

      const existing = await findCourseFor(row.id);
      if (existing) return { ok: true, ...existing };
      const limited = (await caps.newCourse(learnerId)) ?? (await spend.teacherCall());
      if (limited) return limited;

      const sittingMinutes = row.sittingMinutes;
      const mission = await teacher.writeMission({
        subject: row.subject,
        language: row.language,
        why: row.why ?? "",
        know: row.know ?? "",
        success: row.success ?? "",
        sittingMinutes,
      });

      const written = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.course)
          .values({
            learnerId,
            interviewId: row.id,
            subject: row.subject,
            title: mission.title.trim() || row.subject,
            language: row.language,
            missionWhy: mission.why.trim() || (row.why ?? ""),
            missionSuccess: nonEmpty(mission.successLooksLike),
            missionConstraints: withSittingLength(nonEmpty(mission.constraints), sittingMinutes),
            missionOutOfScope: nonEmpty(mission.outOfScope),
            sittingMinutes,
          })
          .onConflictDoNothing({ target: schema.course.interviewId })
          .returning({ id: schema.course.id });
        // Another request wrote this Interview's Course first.
        if (!created) return null;

        await tx.insert(schema.learningRecord).values({
          courseId: created.id,
          number: 1,
          kind: "prior_knowledge",
          title: mission.priorKnowledge.title.trim(),
          body: mission.priorKnowledge.body.trim(),
        });
        const jobId = await insertCourseCreationJob(tx, created.id);
        return { courseId: created.id, jobId };
      });

      return { ok: true, ...(written ?? (await findCourseFor(row.id))!) };
    },
  };

  async function findCourseFor(
    interviewId: string,
  ): Promise<{ courseId: string; jobId: string | null } | null> {
    const [found] = await db
      .select({ courseId: schema.course.id, jobId: schema.job.id })
      .from(schema.course)
      .leftJoin(
        schema.job,
        and(eq(schema.job.courseId, schema.course.id), eq(schema.job.kind, "course_creation")),
      )
      .where(eq(schema.course.interviewId, interviewId));
    return found ?? null;
  }
}

function lastTeacherMessage(messages: InterviewMessage[]): string {
  return messages.findLast((m) => m.from === "teacher")?.text ?? "";
}

function nonEmpty(items: string[]): string[] {
  return items.map((s) => s.trim()).filter(Boolean);
}

/** Constraints always include the sitting length. */
function withSittingLength(constraints: string[], minutes: number): string[] {
  const mentioned = constraints.some((c) => new RegExp(`\\b${minutes}\\b`).test(c));
  return mentioned ? constraints : [`${minutes} minutes per sitting`, ...constraints];
}

/** A well-formed BCP 47 tag, or English if the Teacher returned something else. */
function canonicalLanguage(tag: string): string {
  try {
    return Intl.getCanonicalLocales(tag.trim())[0] ?? "en";
  } catch {
    return "en";
  }
}
