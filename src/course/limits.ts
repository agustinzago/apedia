import { and, count, eq, gte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Tx } from "./jobs";

/**
 * Per-Learner daily caps. What a Course costs is bounded by its allowance
 * (./allowance), which its Course credit pays for; the Lesson and chat caps
 * are only an abuse guard, so that no one account, however many credits it
 * holds, can take a day's spend to the spend stop, which would pause the
 * Teacher for everyone. Each is enforced by counting the Learner's rows for
 * the current day. Days run midnight to midnight UTC: Apedia does not know
 * Learners' time zones.
 */

/** How much of each costly thing one Learner may start per day. Configuration: see `DEFAULT_DAILY_LIMITS`. */
export type DailyLimits = {
  /** Lessons written (first opens of an Up next Lesson). */
  lessonGenerations: number;
  /** Questions asked in Lesson chats. */
  chatMessages: number;
  /** Interviews started. Discarding one gives no start back; answering or coming back to one is not starting. */
  interviews: number;
};

/**
 * The defaults; the app may override them from its environment. Lessons and
 * chat: two whole Courses' allowances a day, generous for anyone learning.
 */
export const DEFAULT_DAILY_LIMITS: DailyLimits = {
  lessonGenerations: 40,
  chatMessages: 400,
  interviews: 5,
};

/** Returned instead of doing the work once today's limit is reached. */
export type DailyLimitReached = {
  ok: false;
  reason: "daily-limit";
  /** The day's limit that was reached. */
  limit: number;
  /** When the next day starts and the count begins again. */
  resetsAt: Date;
};

/** The UTC day `now` falls in. */
export function utcDay(now: Date): { start: Date; end: Date; key: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, key: start.toISOString().slice(0, 10) };
}

export type DailyCaps = ReturnType<typeof createDailyCaps>;

export function createDailyCaps({
  db,
  limits,
  now,
}: {
  db: Db;
  limits: DailyLimits;
  now: () => Date;
}) {
  async function check(
    limit: number,
    countToday: (since: Date) => Promise<number>,
  ): Promise<DailyLimitReached | null> {
    const day = utcDay(now());
    if ((await countToday(day.start)) < limit) return null;
    return { ok: false, reason: "daily-limit", limit, resetsAt: day.end };
  }

  const one = async (query: Promise<{ n: number }[]>) => (await query)[0]?.n ?? 0;

  return {
    /** Whether the Learner may have another Lesson written today. */
    lessonGeneration(learnerId: string) {
      return check(limits.lessonGenerations, (since) =>
        one(
          db
            .select({ n: count() })
            .from(schema.job)
            .innerJoin(schema.course, eq(schema.course.id, schema.job.courseId))
            .where(
              and(
                eq(schema.course.learnerId, learnerId),
                eq(schema.job.kind, "lesson_generation"),
                gte(schema.job.createdAt, since),
              ),
            ),
        ),
      );
    },

    /** Whether the Learner may ask the Teacher another question today. Inside `tx` when given. */
    chatMessage(learnerId: string, tx: Tx | Db = db) {
      return check(limits.chatMessages, (since) =>
        one(
          tx
            .select({ n: count() })
            .from(schema.chatMessage)
            .innerJoin(schema.lesson, eq(schema.lesson.id, schema.chatMessage.lessonId))
            .innerJoin(schema.course, eq(schema.course.id, schema.lesson.courseId))
            .where(
              and(
                eq(schema.course.learnerId, learnerId),
                eq(schema.chatMessage.from, "learner"),
                gte(schema.chatMessage.createdAt, since),
              ),
            ),
        ),
      );
    },

    /** Whether the Learner may start another Interview today. Inside `tx` when given. */
    interviewStart(learnerId: string, tx: Tx | Db = db) {
      return check(limits.interviews, (since) =>
        one(
          tx
            .select({ n: count() })
            .from(schema.interviewStart)
            .where(
              and(
                eq(schema.interviewStart.learnerId, learnerId),
                gte(schema.interviewStart.createdAt, since),
              ),
            ),
        ),
      );
    },
  };
}
