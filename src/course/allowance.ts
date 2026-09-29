import { and, count, eq, exists, isNotNull, or } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { COURSE_CREDIT } from "./course-credit";

/**
 * A Course's allowance: the Lessons and chat questions its Course credit
 * buys, so its worst-case cost stays below what the credit brings in. Both
 * are counted from the Course's own rows, so every Course a Learner owns has
 * the same allowance, including one written before Course credits existed.
 * The numbers are `COURSE_CREDIT`'s, which the Terms quote: they are not
 * configured anywhere else, so what is sold and what is enforced can't drift.
 */

/** Returned instead of writing a Lesson once the Course's Lessons are used up. */
export type LessonsUsedUp = {
  ok: false;
  reason: "lessons-used-up";
  /** The Lessons the Course may have written. */
  allowance: number;
};

/** Returned instead of asking the Teacher once the Course's questions are used up. */
export type QuestionsUsedUp = {
  ok: false;
  reason: "questions-used-up";
  /** The questions the Learner may ask across the Course's Lessons. */
  allowance: number;
};

/**
 * The Course's Lessons that count against its allowance: written, or with
 * a Lesson generation job, so a Lesson counts from its first open, even
 * while its writing is failed or paused. Finish writes none.
 */
export async function countedLessonIds(db: Db, courseId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: schema.lesson.id })
    .from(schema.lesson)
    .where(
      and(
        eq(schema.lesson.courseId, courseId),
        or(
          isNotNull(schema.lesson.content),
          exists(
            db
              .select({ id: schema.job.id })
              .from(schema.job)
              .where(
                and(
                  eq(schema.job.lessonId, schema.lesson.id),
                  eq(schema.job.kind, "lesson_generation"),
                ),
              ),
          ),
        ),
      ),
    );
  return new Set(rows.map((r) => r.id));
}

/** The questions the Learner has asked across the Course's Lessons. */
export async function countQuestions(db: Db, courseId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.chatMessage)
    .innerJoin(schema.lesson, eq(schema.lesson.id, schema.chatMessage.lessonId))
    .where(and(eq(schema.lesson.courseId, courseId), eq(schema.chatMessage.from, "learner")));
  return row?.n ?? 0;
}

/** Null while the Course may have another Lesson written. */
export async function lessonsUsedUp(db: Db, courseId: string): Promise<LessonsUsedUp | null> {
  const allowance = COURSE_CREDIT.lessons;
  if ((await countedLessonIds(db, courseId)).size < allowance) return null;
  return { ok: false, reason: "lessons-used-up", allowance };
}

/** The questions left to ask across the Course's Lessons, never below 0. */
export async function questionsLeft(db: Db, courseId: string): Promise<number> {
  return Math.max(0, COURSE_CREDIT.chatQuestions - (await countQuestions(db, courseId)));
}

export const QUESTIONS_USED_UP: QuestionsUsedUp = {
  ok: false,
  reason: "questions-used-up",
  allowance: COURSE_CREDIT.chatQuestions,
};
