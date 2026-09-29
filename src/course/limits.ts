import { and, count, eq, gte, ne, not, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { creationFailedEmpty } from "./course-creation";

/**
 * Per-Learner daily caps, which keep one Learner from running up large
 * costs. Each is enforced by counting the Learner's rows for the current
 * day. Days run midnight to midnight UTC: Apedia does not know Learners'
 * time zones.
 */

/** How much of each costly thing one Learner may start per day. Configuration: see `DEFAULT_DAILY_LIMITS`. */
export type DailyLimits = {
  /** New Courses. A Course whose research failed counts only if it produced Resources. */
  newCourses: number;
  /** Lessons written (first opens of an Up next Lesson). */
  lessonGenerations: number;
  /** Questions asked in Lesson chats. */
  chatMessages: number;
};

/** The limits the MVP spec sets; the app may override them from its environment. */
export const DEFAULT_DAILY_LIMITS: DailyLimits = {
  newCourses: 1,
  lessonGenerations: 10,
  chatMessages: 60,
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
    /**
     * Whether the Learner may start another Course today. A Course counts
     * unless its research failed without producing Resources. `except`
     * leaves one Course out, such as the one being retried.
     */
    newCourse(learnerId: string, { except }: { except?: string } = {}) {
      return check(limits.newCourses, (since) => {
        const conditions: SQL[] = [
          eq(schema.course.learnerId, learnerId),
          eq(schema.course.isExample, false),
          gte(schema.course.createdAt, since),
          not(creationFailedEmpty(db, schema.course.id)),
        ];
        if (except) conditions.push(ne(schema.course.id, except));
        return one(
          db
            .select({ n: count() })
            .from(schema.course)
            .where(and(...conditions)),
        );
      });
    },

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

    /** Whether the Learner may ask the Teacher another question today. */
    chatMessage(learnerId: string) {
      return check(limits.chatMessages, (since) =>
        one(
          db
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
  };
}
