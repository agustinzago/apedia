import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { EXAMPLE_COURSE_ID, seedExampleCourse } from "./example-course";

export { EXAMPLE_COURSE_ID };

export type Mission = {
  why: string;
  success: string[];
  constraints: string[];
  sittingMinutes: number;
  outOfScope: string[];
};

export type FinishedLesson = {
  index: number;
  title: string;
  goal: string;
  finishedAt: Date;
  score: { correct: number; total: number };
};

export type UpNextLesson = {
  index: number;
  title: string;
  goal: string;
  started: boolean;
};

export type LearningRecordKind =
  (typeof schema.learningRecordKind.enumValues)[number];

export type LearningRecordEntry = {
  number: number;
  kind: LearningRecordKind;
  title: string;
  body: string;
  createdAt: Date;
  superseded: boolean;
};

/** What the Path tab of a Course page shows. */
export type CoursePath = {
  id: string;
  subject: string;
  title: string;
  isExample: boolean;
  status: "active" | "done";
  mission: Mission;
  finishedLessons: FinishedLesson[];
  upNext: UpNextLesson | null;
  /** Newest first. */
  learningRecords: LearningRecordEntry[];
};

/** Who is asking. Null until sign-in exists, or for a visitor. */
export type Viewer = { learnerId: string | null };

export type CourseModule = ReturnType<typeof createCourseModule>;

export function createCourseModule({ db }: { db: Db }) {
  /** Returns the course row if the viewer may read it, otherwise null. */
  async function findReadableCourse(courseId: string, viewer: Viewer) {
    const [row] = await db
      .select()
      .from(schema.course)
      .where(eq(schema.course.id, courseId));
    if (!row) return null;
    if (row.isExample) return row;
    if (viewer.learnerId !== null && row.learnerId === viewer.learnerId) {
      return row;
    }
    return null;
  }

  return {
    /** Makes sure the read-only Example course is in the database. Safe to call repeatedly. */
    async ensureExampleCourse(): Promise<void> {
      await seedExampleCourse(db);
    },

    /** The Path tab: Mission, finished Lessons, Up next and Learning records. Null if not found or not the viewer's. */
    async readCoursePath(
      courseId: string,
      viewer: Viewer,
    ): Promise<CoursePath | null> {
      const course = await findReadableCourse(courseId, viewer);
      if (!course) return null;

      const lessons = await db
        .select({
          id: schema.lesson.id,
          index: schema.lesson.index,
          title: schema.lesson.title,
          goal: schema.lesson.goal,
          openedAt: schema.lesson.openedAt,
          finishedAt: schema.lesson.finishedAt,
        })
        .from(schema.lesson)
        .where(eq(schema.lesson.courseId, course.id))
        .orderBy(asc(schema.lesson.index));

      const finishedIds = lessons.filter((l) => l.finishedAt).map((l) => l.id);
      const scores =
        finishedIds.length === 0
          ? []
          : await db
              .select({
                lessonId: schema.quizAttempt.lessonId,
                correct: schema.quizAttempt.correct,
                attempts: count(),
              })
              .from(schema.quizAttempt)
              .where(inArray(schema.quizAttempt.lessonId, finishedIds))
              .groupBy(
                schema.quizAttempt.lessonId,
                schema.quizAttempt.correct,
              );

      const scoreFor = (lessonId: string) => {
        const rows = scores.filter((s) => s.lessonId === lessonId);
        return {
          correct: rows.find((r) => r.correct)?.attempts ?? 0,
          total: rows.reduce((sum, r) => sum + r.attempts, 0),
        };
      };

      const finishedLessons: FinishedLesson[] = lessons.flatMap((l) =>
        l.finishedAt
          ? [
              {
                index: l.index,
                title: l.title,
                goal: l.goal,
                finishedAt: l.finishedAt,
                score: scoreFor(l.id),
              },
            ]
          : [],
      );

      const next = lessons.find((l) => !l.finishedAt);
      const upNext: UpNextLesson | null = next
        ? {
            index: next.index,
            title: next.title,
            goal: next.goal,
            started: next.openedAt !== null,
          }
        : null;

      const records = await db
        .select({
          number: schema.learningRecord.number,
          kind: schema.learningRecord.kind,
          title: schema.learningRecord.title,
          body: schema.learningRecord.body,
          createdAt: schema.learningRecord.createdAt,
          supersededById: schema.learningRecord.supersededById,
        })
        .from(schema.learningRecord)
        .where(eq(schema.learningRecord.courseId, course.id))
        .orderBy(desc(schema.learningRecord.number));

      return {
        id: course.id,
        subject: course.subject,
        title: course.title,
        isExample: course.isExample,
        status: course.status,
        mission: {
          why: course.missionWhy,
          success: course.missionSuccess,
          constraints: course.missionConstraints,
          sittingMinutes: course.sittingMinutes,
          outOfScope: course.missionOutOfScope,
        },
        finishedLessons,
        upNext,
        learningRecords: records.map(({ supersededById, ...r }) => ({
          ...r,
          superseded: supersededById !== null,
        })),
      };
    },
  };
}
