import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Teacher } from "@/teacher";
import type { UrlFetcher } from "@/url-fetcher";
import {
  createCourseCreationOperations,
  readCreationView,
  type CourseCreationView,
} from "./course-creation";
import { EXAMPLE_COURSE_ID, seedExampleCourse } from "./example-course";
import { createInterviewOperations } from "./interview";
import {
  LessonContent,
  lessonMinutes,
  type Question,
  type Term,
} from "./lesson-content";

export { EXAMPLE_COURSE_ID };
export {
  openingMessages,
  SITTING_MINUTES,
  type ClaimResult,
  type InterviewMessage,
  type InterviewStage,
  type InterviewView,
  type SittingMinutes,
  type WriteCourseResult,
} from "./interview";
export type { Question, Term } from "./lesson-content";
export type {
  CourseCreationView,
  JobStepResult,
  RetryCourseCreationResult,
} from "./course-creation";

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
  /** Expected length of one sitting; null for Lessons chosen before Up next carried minutes. */
  minutes: number | null;
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
  /** True while a new Course waits for its Resources and first Lesson. */
  preparing: boolean;
  /** The Course creation job, while preparing; null if there is none to show. */
  creation: CourseCreationView | null;
  finishedLessons: FinishedLesson[];
  upNext: UpNextLesson | null;
  /** Newest first. */
  learningRecords: LearningRecordEntry[];
};

/** One of a Learner's Courses, as listed under "Your courses". */
export type CourseSummary = {
  id: string;
  subject: string;
  title: string;
  status: "active" | "done";
  createdAt: Date;
};

export type ResourceKind = (typeof schema.resourceKind.enumValues)[number];

/** A Resource as a Lesson shows it: by its number, never its internal id. */
export type LessonResource = {
  /** The Resource's number in its Course, shown as the citation marker [n]. */
  number: number;
  kind: ResourceKind;
  title: string;
  author: string;
  url: string;
  why: string;
};

/** What the Resources tab shows. */
export type CourseResources = {
  /** In number order. */
  resources: LessonResource[];
  /** Parts of the Mission no Resource covers yet. */
  gaps: string[];
};

export type CommunityEntry = {
  name: string;
  where: string;
  /** Null for places with no single address, such as a local jam. */
  url: string | null;
  why: string;
  offline: boolean;
};

/** What the Communities tab shows. */
export type CourseCommunities = {
  /** Online first, then offline. */
  communities: CommunityEntry[];
  /** The Learner said "Not for me": the Teacher stops pointing them to Communities. */
  optedOut: boolean;
  /** False for the read-only Example course. */
  canOptOut: boolean;
};

export type SetCommunityOptOutResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "read-only" };

export type LessonSection = {
  heading: string;
  body: string;
  citations: LessonResource[];
};

/** What the Lesson page shows. */
export type LessonView = {
  course: { id: string; subject: string; title: string; isExample: boolean };
  index: number;
  title: string;
  goal: string;
  finishedAt: Date | null;
  /** Null until the Lesson has been written. */
  content: {
    hook: string;
    sections: LessonSection[];
    keyIdea: string;
    practice: { title: string; steps: string[] };
    /** Reading plus practice, rounded up. */
    minutes: number;
    quiz: Question[];
    readNext: LessonResource | null;
    newTerms: Term[];
  } | null;
  /** Quiz answers already recorded, in question order. */
  answers: { questionIndex: number; chosenOption: number }[];
};

/** The Key idea of one finished Lesson. */
export type KeyIdea = {
  /** 1, 2, 3… in Lesson order. */
  number: number;
  lessonIndex: number;
  lessonTitle: string;
  text: string;
};

export type ReferenceSection = { title: string; body: string };

/** What the Reference sheet tab shows and prints. */
export type ReferenceSheet = {
  course: { id: string; subject: string; title: string; isExample: boolean };
  /** Alphabetical, in the Course's language. */
  glossary: Term[];
  /** Finished Lessons only, in Lesson order. */
  keyIdeas: KeyIdea[];
  /** Topic-specific sections, in sheet order. */
  sections: ReferenceSection[];
};

/** Who is asking: a signed-in Learner, or a visitor (null). */
export type Viewer = { learnerId: string | null };

export type CourseModule = ReturnType<typeof createCourseModule>;

/** Makes sure the read-only Example course is in the database. Safe to call repeatedly. */
export async function ensureExampleCourse(db: Db): Promise<void> {
  await seedExampleCourse(db);
}

export function createCourseModule({
  db,
  teacher,
  fetchUrl,
}: {
  db: Db;
  teacher: Teacher;
  /** The network half of the Resource URL check. */
  fetchUrl: UrlFetcher;
}) {
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

  async function readResourcesByRef(courseId: string) {
    const rows = await db
      .select()
      .from(schema.resource)
      .where(eq(schema.resource.courseId, courseId));
    return new Map<string, LessonResource>(
      rows.map((r) => [
        r.ref,
        {
          number: resourceNumber(r.ref),
          kind: r.kind,
          title: r.title,
          author: r.author,
          url: r.url,
          why: r.why,
        },
      ]),
    );
  }

  return {
    ...createInterviewOperations({ db, teacher }),
    ...createCourseCreationOperations({ db, teacher, fetchUrl }),

    /** Makes sure the read-only Example course is in the database. Safe to call repeatedly. */
    async ensureExampleCourse(): Promise<void> {
      await ensureExampleCourse(db);
    },

    /** The Learner's own Courses, newest first. Never includes the Example course. */
    async listCourses(learnerId: string): Promise<CourseSummary[]> {
      return db
        .select({
          id: schema.course.id,
          subject: schema.course.subject,
          title: schema.course.title,
          status: schema.course.status,
          createdAt: schema.course.createdAt,
        })
        .from(schema.course)
        .where(
          and(
            eq(schema.course.learnerId, learnerId),
            eq(schema.course.isExample, false),
          ),
        )
        .orderBy(desc(schema.course.createdAt), asc(schema.course.id));
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
          minutes: schema.lesson.minutes,
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
            minutes: next.minutes,
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

      // Research and the first Lesson arrive with the Course creation job.
      const preparing =
        !course.isExample && course.status === "active" && lessons.length === 0;

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
        preparing,
        creation: preparing ? await readCreationView(db, course.id) : null,
        finishedLessons,
        upNext,
        learningRecords: records.map(({ supersededById, ...r }) => ({
          ...r,
          superseded: supersededById !== null,
        })),
      };
    },

    /** The Reference sheet: Glossary, Key ideas so far and topic-specific sections. Null if not found or not the viewer's. */
    async readReferenceSheet(
      courseId: string,
      viewer: Viewer,
    ): Promise<ReferenceSheet | null> {
      const course = await findReadableCourse(courseId, viewer);
      if (!course) return null;

      const [terms, finishedLessons, sections] = await Promise.all([
        db
          .select({
            term: schema.glossaryTerm.term,
            definition: schema.glossaryTerm.definition,
          })
          .from(schema.glossaryTerm)
          .where(eq(schema.glossaryTerm.courseId, course.id)),
        db
          .select({
            index: schema.lesson.index,
            title: schema.lesson.title,
            content: schema.lesson.content,
          })
          .from(schema.lesson)
          .where(
            and(
              eq(schema.lesson.courseId, course.id),
              isNotNull(schema.lesson.finishedAt),
            ),
          )
          .orderBy(asc(schema.lesson.index)),
        db
          .select({
            title: schema.referenceSection.title,
            body: schema.referenceSection.body,
          })
          .from(schema.referenceSection)
          .where(eq(schema.referenceSection.courseId, course.id))
          .orderBy(asc(schema.referenceSection.position)),
      ]);

      const collator = new Intl.Collator(course.language, {
        sensitivity: "base",
      });

      return {
        course: {
          id: course.id,
          subject: course.subject,
          title: course.title,
          isExample: course.isExample,
        },
        glossary: terms.sort((a, b) => collator.compare(a.term, b.term)),
        keyIdeas: finishedLessons
          .filter((l) => l.content !== null)
          .map((l, i) => ({
            number: i + 1,
            lessonIndex: l.index,
            lessonTitle: l.title,
            text: LessonContent.parse(l.content).keyIdea,
          })),
        sections,
      };
    },

    /** The Resources tab: numbered Resources and the Gaps. Null if not found or not the viewer's. */
    async readResources(
      courseId: string,
      viewer: Viewer,
    ): Promise<CourseResources | null> {
      const course = await findReadableCourse(courseId, viewer);
      if (!course) return null;

      const resources = [...(await readResourcesByRef(course.id)).values()].sort(
        (a, b) => a.number - b.number,
      );
      const gaps = await db
        .select({ description: schema.gap.description })
        .from(schema.gap)
        .where(eq(schema.gap.courseId, course.id))
        .orderBy(asc(schema.gap.createdAt), asc(schema.gap.description));

      return { resources, gaps: gaps.map((g) => g.description) };
    },

    /** The Communities tab, with the Learner's opt-out. Null if not found or not the viewer's. */
    async readCommunities(
      courseId: string,
      viewer: Viewer,
    ): Promise<CourseCommunities | null> {
      const course = await findReadableCourse(courseId, viewer);
      if (!course) return null;

      const communities = await db
        .select({
          name: schema.community.name,
          where: schema.community.where,
          url: schema.community.url,
          why: schema.community.why,
          offline: schema.community.offline,
        })
        .from(schema.community)
        .where(eq(schema.community.courseId, course.id))
        .orderBy(asc(schema.community.offline), asc(schema.community.name));

      return {
        communities,
        optedOut: course.communityOptOut,
        canOptOut: !course.isExample,
      };
    },

    /** "Not for me" on the Communities tab, or turning Communities back on. Only the Course's own Learner may. */
    async setCommunityOptOut(
      courseId: string,
      learnerId: string,
      optedOut: boolean,
    ): Promise<SetCommunityOptOutResult> {
      const course = await findReadableCourse(courseId, { learnerId });
      if (!course) return { ok: false, reason: "not-found" };
      if (course.isExample) return { ok: false, reason: "read-only" };

      await db
        .update(schema.course)
        .set({ communityOptOut: optedOut })
        .where(eq(schema.course.id, course.id));
      return { ok: true };
    },

    /** One Lesson, with its citations resolved to Resources. Null if not found or not the viewer's. */
    async readLesson(
      courseId: string,
      lessonIndex: number,
      viewer: Viewer,
    ): Promise<LessonView | null> {
      const course = await findReadableCourse(courseId, viewer);
      if (!course) return null;

      const [lesson] = await db
        .select()
        .from(schema.lesson)
        .where(
          and(
            eq(schema.lesson.courseId, course.id),
            eq(schema.lesson.index, lessonIndex),
          ),
        );
      if (!lesson) return null;

      const answers = await db
        .select({
          questionIndex: schema.quizAttempt.questionIndex,
          chosenOption: schema.quizAttempt.chosenOption,
        })
        .from(schema.quizAttempt)
        .where(eq(schema.quizAttempt.lessonId, lesson.id))
        .orderBy(asc(schema.quizAttempt.questionIndex));

      let content: LessonView["content"] = null;
      if (lesson.content !== null) {
        const c = LessonContent.parse(lesson.content);
        const resources = await readResourcesByRef(course.id);
        const cite = (ref: string) => resources.get(ref) ?? [];
        content = {
          hook: c.hook,
          sections: c.sections.map((s) => ({
            heading: s.heading,
            body: s.body,
            citations: s.citations.flatMap(cite),
          })),
          keyIdea: c.keyIdea,
          practice: c.practice,
          minutes: lessonMinutes(c),
          quiz: c.quiz,
          readNext: resources.get(c.readNext) ?? null,
          newTerms: c.newTerms,
        };
      }

      return {
        course: {
          id: course.id,
          subject: course.subject,
          title: course.title,
          isExample: course.isExample,
        },
        index: lesson.index,
        title: lesson.title,
        goal: lesson.goal,
        finishedAt: lesson.finishedAt,
        content,
        answers,
      };
    },
  };
}

/** "r3" → 3. */
function resourceNumber(ref: string): number {
  return Number(ref.slice(1));
}
