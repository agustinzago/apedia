import { and, asc, count, desc, eq, notExists, sql } from "drizzle-orm";
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

/** The four Interview questions, in English. Later ones are asked in the Learner's language. */
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

/** What the Teacher and Learner say before the Interview is stored: greeting, subject, first question. */
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
  /**
   * Whether a Course credit backs the Interview: available while it is
   * open, used once its Course is written. False once the credit of an
   * unwritten Interview is refunded (it can't go on or be written), and for
   * a redirected subject, which uses no credit.
   */
  backed: boolean;
};

/** Returned instead of doing the work when no available Course credit backs the Interview. */
export type NoCourseCredit = { ok: false; reason: "no-credit" };

export type StartInterviewResult =
  | InterviewView
  /** No available Course credit is free to back a new Interview: buy a Course first. */
  | NoCourseCredit
  /** The Learner has started today's Interviews; the credit keeps for later. */
  | DailyLimitReached
  /** The Teacher is paused for the day. */
  | SpendPaused;

export type WriteCourseResult =
  | {
      ok: true;
      courseId: string;
      /** The Course creation job to run, or null for a Course written before jobs existed. */
      jobId: string | null;
    }
  | { ok: false; reason: "not-found" | "not-yours" | "not-finished" }
  /** The credit backing the Interview is no longer available, say it was refunded. */
  | NoCourseCredit
  /** The Teacher is paused for the day; the Interview keeps for later. */
  | SpendPaused;

export type DiscardInterviewResult = { ok: true } | { ok: false; reason: "not-found" };

/** An Interview the Learner may come back to: no Course yet, backed by an available credit. */
export type OpenInterview = { id: string; subject: string; stage: InterviewStage };

/** What the Learner may do about Interviews right now. */
export type InterviewStart = {
  /** Available Course credits backing no Interview: how many new Interviews may start. */
  creditsToStart: number;
  /** Newest first. */
  openInterviews: OpenInterview[];
};

const NO_CREDIT: NoCourseCredit = { ok: false, reason: "no-credit" };

const Subject = z.string().trim().min(1).max(120);
const Answer = z.string().trim().max(1000);

type InterviewRow = typeof schema.interview.$inferSelect;

/** Thrown inside "Write my course" to roll it back when its credit is gone. */
class CreditGone extends Error {}

export function createInterviewOperations({
  db,
  teacher,
  caps,
  spend,
  now,
}: {
  db: Db;
  teacher: Teacher;
  caps: DailyCaps;
  spend: Spend;
  now: () => Date;
}) {
  async function findRow(interviewId: string): Promise<InterviewRow | null> {
    const [row] = await db
      .select()
      .from(schema.interview)
      .where(eq(schema.interview.id, interviewId));
    return row ?? null;
  }

  /** An available Course credit that backs no Interview. */
  function unreserved() {
    return and(
      eq(schema.courseCredit.status, "available"),
      notExists(
        db
          .select({ one: sql`1` })
          .from(schema.interview)
          .where(eq(schema.interview.courseCreditId, schema.courseCredit.id)),
      ),
    );
  }

  /** The Learner's oldest available Course credit that backs no Interview, or null. */
  async function creditToStart(learnerId: string): Promise<string | null> {
    const [credit] = await db
      .select({ id: schema.courseCredit.id })
      .from(schema.courseCredit)
      .where(and(eq(schema.courseCredit.learnerId, learnerId), unreserved()))
      .orderBy(asc(schema.courseCredit.createdAt), asc(schema.courseCredit.id))
      .limit(1);
    return credit?.id ?? null;
  }

  /** Whether an available Course credit backs the Interview, so it may go on. */
  async function isBacked(row: InterviewRow): Promise<boolean> {
    if (row.courseCreditId === null) return false;
    const [credit] = await db
      .select({ status: schema.courseCredit.status })
      .from(schema.courseCredit)
      .where(eq(schema.courseCredit.id, row.courseCreditId));
    return credit?.status === "available";
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
      backed: course !== undefined || (await isBacked(row)),
    };
  }

  /** An Interview is its Learner's only. */
  function mayUse(row: InterviewRow, learnerId: string | null) {
    return learnerId !== null && row.learnerId === learnerId;
  }

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

  return {
    /**
     * Starts the Learner's Interview from the subject and the answer to
     * "why". It needs an available Course credit that backs no other
     * Interview; without one, nothing runs. Each start counts toward the
     * Learner's daily limit, discarded or not; past it, or past the spend
     * stop, nothing runs and the credit stays free. The Teacher first checks
     * the two for safety: a redirected subject gets a kind message, nothing
     * else runs, and no credit is reserved. Otherwise the Interview reserves
     * the Learner's oldest such credit, which "Write my course" later uses.
     */
    async startInterview(
      input: { subject: string; why: string },
      learnerId: string,
    ): Promise<StartInterviewResult> {
      const subject = Subject.parse(input.subject);
      const why = Answer.parse(input.why);
      if ((await creditToStart(learnerId)) === null) return NO_CREDIT;
      const limited = (await caps.interviewStart(learnerId)) ?? (await spend.teacherCall());
      if (limited) return limited;
      // It counts from here: the Teacher is called, whatever comes of it.
      await db.insert(schema.interviewStart).values({ learnerId, createdAt: now() });

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
            learnerId,
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
      const values: typeof schema.interview.$inferInsert = reply.followUp
        ? {
            learnerId,
            subject,
            language,
            stage: "why",
            why,
            followUpAsked: true,
            awaitingFollowUp: true,
            messages: [...messages, { from: "teacher", text: reply.followUp }],
          }
        : {
            learnerId,
            subject,
            language,
            stage: "know",
            why,
            messages: [...messages, { from: "teacher", text: reply.nextQuestion }],
          };

      // A credit backs one Interview (a unique link): if another Interview,
      // say in a second tab, reserved this one meanwhile, take the next.
      for (;;) {
        const courseCreditId = await creditToStart(learnerId);
        if (courseCreditId === null) return NO_CREDIT;
        const [row] = await db
          .insert(schema.interview)
          .values({ ...values, courseCreditId })
          .onConflictDoNothing({ target: schema.interview.courseCreditId })
          .returning();
        if (row) return toView(row);
      }
    },

    /**
     * Answers the question being asked. The Teacher may ask one follow-up in
     * the whole Interview, only for an empty or vague answer. Null if the
     * Interview is not found or not the Learner's; unchanged if it is not
     * waiting for a written answer. Refused once its Course credit is no
     * longer available, and past the spend stop; either way nothing is saved.
     */
    async answerInterview(
      interviewId: string,
      rawAnswer: string,
      learnerId: string,
    ): Promise<InterviewView | NoCourseCredit | SpendPaused | null> {
      const row = await findRow(interviewId);
      if (!row || !mayUse(row, learnerId)) return null;
      const stage = row.stage;
      if (stage !== "why" && stage !== "know" && stage !== "success") return toView(row);

      const answer = Answer.parse(rawAnswer);
      if (!(await isBacked(row))) return NO_CREDIT;
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

    /**
     * Answers the last question with one of the sitting-length chips; the
     * Interview is then complete. Refused once its Course credit is no
     * longer available.
     */
    async chooseSittingLength(
      interviewId: string,
      minutes: number,
      learnerId: string,
    ): Promise<InterviewView | NoCourseCredit | null> {
      if (!SITTING_MINUTES.includes(minutes as SittingMinutes)) {
        throw new RangeError(`Sitting length must be one of ${SITTING_MINUTES.join(", ")} minutes.`);
      }
      const row = await findRow(interviewId);
      if (!row || !mayUse(row, learnerId)) return null;
      if (row.stage !== "sitting") return toView(row);
      if (!(await isBacked(row))) return NO_CREDIT;

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

    /** The Interview as its screen shows it. Null if not found or not the viewer's. */
    async readInterview(
      interviewId: string,
      learnerId: string | null,
    ): Promise<InterviewView | null> {
      const row = await findRow(interviewId);
      if (!row || !mayUse(row, learnerId)) return null;
      return toView(row);
    },

    /**
     * How many new Interviews the Learner may start (one per available
     * Course credit backing no Interview), and the open Interviews they may
     * come back to.
     */
    async readInterviewStart(learnerId: string): Promise<InterviewStart> {
      const [[credits], openInterviews] = await Promise.all([
        db
          .select({ n: count() })
          .from(schema.courseCredit)
          .where(and(eq(schema.courseCredit.learnerId, learnerId), unreserved())),
        db
          .select({
            id: schema.interview.id,
            subject: schema.interview.subject,
            stage: schema.interview.stage,
          })
          .from(schema.interview)
          .innerJoin(
            schema.courseCredit,
            eq(schema.courseCredit.id, schema.interview.courseCreditId),
          )
          .where(
            and(
              eq(schema.interview.learnerId, learnerId),
              // A used credit's Interview has its Course.
              eq(schema.courseCredit.status, "available"),
            ),
          )
          .orderBy(desc(schema.interview.createdAt), asc(schema.interview.id)),
      ]);
      return { creditsToStart: credits?.n ?? 0, openInterviews };
    },

    /**
     * Lets go of an Interview no Course was written from, for good. The
     * Course credit it held, if any, is free to back another Interview.
     */
    async discardInterview(
      interviewId: string,
      learnerId: string,
    ): Promise<DiscardInterviewResult> {
      const [discarded] = await db
        .delete(schema.interview)
        .where(
          and(
            eq(schema.interview.id, interviewId),
            eq(schema.interview.learnerId, learnerId),
            notExists(
              db
                .select({ one: sql`1` })
                .from(schema.course)
                .where(eq(schema.course.interviewId, schema.interview.id)),
            ),
          ),
        )
        .returning({ id: schema.interview.id });
      return discarded ? { ok: true } : { ok: false, reason: "not-found" };
    },

    /**
     * "Write my course": creates the Course from the Learner's finished
     * Interview, with its Mission and the prior-knowledge Learning record
     * 0001, and queues its Course creation job (research, then Up next) for
     * the caller to run. The Course credit backing the Interview becomes
     * used in the same transaction, so every Course uses exactly one credit.
     * Writing the same Interview again returns the same Course and job and
     * uses nothing more. A new Course waits past the spend stop; it needs
     * no daily cap, since its credit pays for it.
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
      const creditId = row.courseCreditId;
      if (creditId === null || !(await isBacked(row))) return NO_CREDIT;
      const paused = await spend.teacherCall();
      if (paused) return paused;

      const sittingMinutes = row.sittingMinutes;
      const mission = await teacher.writeMission({
        subject: row.subject,
        language: row.language,
        why: row.why ?? "",
        know: row.know ?? "",
        success: row.success ?? "",
        sittingMinutes,
      });

      let written: { courseId: string; jobId: string } | null;
      try {
        written = await db.transaction(async (tx) => {
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
          // Another request wrote this Interview's Course first, with the credit.
          if (!created) return null;

          const [used] = await tx
            .update(schema.courseCredit)
            .set({ status: "used", updatedAt: now() })
            .where(
              and(
                eq(schema.courseCredit.id, creditId),
                eq(schema.courseCredit.status, "available"),
              ),
            )
            .returning({ id: schema.courseCredit.id });
          // Refunded since the check above: no Course without its credit.
          if (!used) throw new CreditGone();

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
      } catch (error) {
        if (error instanceof CreditGone) return NO_CREDIT;
        throw error;
      }

      return { ok: true, ...(written ?? (await findCourseFor(row.id))!) };
    },
  };
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
