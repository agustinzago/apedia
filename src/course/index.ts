import { and, asc, count, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { Teacher } from "@/teacher";
import type { UrlFetcher } from "@/url-fetcher";
import {
  createCourseCreationOperations,
  readCreationView,
  type CourseCreationView,
} from "./course-creation";
import { countedLessonIds, questionsLeft } from "./allowance";
import { createChatOperations, readChat } from "./chat";
import { COURSE_CREDIT } from "./course-credit";
import { createCreditOperations } from "./credits";
import { seedExampleCourses } from "./example-course";
import { createFinishOperations } from "./finish";
import { createInterviewOperations } from "./interview";
import {
  resumeJob,
  runJobStep,
  stuckJobIds,
  viewOf,
  type JobKind,
  type JobStepResult,
  type JobView,
} from "./jobs";
import { createLessonOperations, isLessonIndex } from "./lessons";
import { createProposalOperations, readOpenProposals, type ProposalView } from "./proposals";
import { createDailyCaps, DEFAULT_DAILY_LIMITS, type DailyLimits } from "./limits";
import {
  createSpendOperations,
  DEFAULT_SPEND_LIMITS,
  type SpendAlarm,
  type SpendLimits,
  type SpendPaused,
} from "./spend";
import {
  LessonContent,
  lessonMinutes,
  type Question,
  type Term,
} from "./lesson-content";

export { EXAMPLE_COURSE_CARDS, EXAMPLE_COURSE_ID, type ExampleCourseCard } from "./example-course";
export {
  openingMessages,
  SITTING_MINUTES,
  type DiscardInterviewResult,
  type InterviewMessage,
  type InterviewStage,
  type InterviewStart,
  type InterviewView,
  type NoCourseCredit,
  type OpenInterview,
  type SittingMinutes,
  type StartInterviewResult,
  type WriteCourseResult,
} from "./interview";
export type { Question, Term } from "./lesson-content";
export { MAX_QUESTION_LENGTH, type AskTeacherResult } from "./chat";
export { COURSE_CREDIT } from "./course-credit";
export type { LessonsUsedUp, QuestionsUsedUp } from "./allowance";
export type { CourseCredits, CourseCreditStatus, RecordPaymentResult } from "./credits";
export {
  DEFAULT_DAILY_LIMITS,
  type DailyLimitReached,
  type DailyLimits,
} from "./limits";
export {
  DEFAULT_SPEND_LIMITS,
  type SpendAlarm,
  type SpendAlert,
  type SpendLimits,
  type SpendPaused,
} from "./spend";
export type {
  CourseCreationView,
  RetryCourseCreationResult,
} from "./course-creation";
export type { FinishLessonResult, RetryFinishResult } from "./finish";
export type { DecideProposalResult, ProposalView } from "./proposals";
export type { JobStepResult, JobView } from "./jobs";
export { MAX_ATTEMPTS_PER_STEP } from "./jobs";
export type { Busy } from "./locks";
export type {
  AnswerQuestionResult,
  OpenLessonResult,
  QuizAttemptEntry,
  RetryLessonGenerationResult,
} from "./lessons";

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
  /** True once it is written: usually in the background, before it is first opened. */
  ready: boolean;
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
  /** When the Learner confirmed the Course Done; null while active. */
  doneAt: Date | null;
  mission: Mission;
  /** True while a new Course waits for its Resources and first Lesson. */
  preparing: boolean;
  /** The Course creation job, while preparing; null if there is none to show. */
  creation: CourseCreationView | null;
  /**
   * True while deleting the Course gives its Course credit back: its
   * creation failed before finding any Resources, so the Learner may give
   * up on it instead of trying again.
   */
  givesCreditBack: boolean;
  finishedLessons: FinishedLesson[];
  /** Null once the Course is Done. */
  upNext: UpNextLesson | null;
  /**
   * The Lessons the Course's allowance holds, and how many are written or
   * being written; null for the Example course, which has none.
   */
  lessonAllowance: { lessons: number; written: number } | null;
  /**
   * True when Up next is unwritten and the allowance's Lessons are all
   * written: it stays shown, but won't be written in this Course.
   */
  lessonsUsedUp: boolean;
  /** Newest first. */
  learningRecords: LearningRecordEntry[];
  /** Mission changes and Done suggestions waiting for the Learner, oldest first. */
  proposals: ProposalView[];
};

/** One of a Learner's Courses, as listed under "Your courses". */
export type CourseSummary = {
  id: string;
  subject: string;
  title: string;
  status: "active" | "done";
  /** When the Learner confirmed the Course Done; null while active. */
  doneAt: Date | null;
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

export type DeleteCourseResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "read-only" };

export type LessonSection = {
  heading: string;
  body: string;
  citations: LessonResource[];
};

/** A piece of a chat message: plain text, or a citation shown as a numbered link. */
export type ChatPart = { text: string } | { cite: LessonResource };

/** One message in a Lesson's "Ask your teacher" chat. */
export type ChatMessage = {
  from: "teacher" | "learner";
  parts: ChatPart[];
  /** The Community a Teacher answer suggests; null otherwise. */
  community: CommunityEntry | null;
};

/** What the Lesson page shows. */
export type LessonView = {
  course: {
    id: string;
    subject: string;
    title: string;
    isExample: boolean;
    /** A Done Course's Lessons stay readable, but take no answers, questions or Finish. */
    done: boolean;
  };
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
  /** The Lesson's "Ask your teacher" chat, oldest first. */
  chat: ChatMessage[];
  /** The questions left to ask across the Course's Lessons; null for the Example course. */
  questionsLeft: number | null;
  /** True for the read-only Example course: answers are not saved and Finish is off. */
  readOnly: boolean;
  /** The Lesson generation job while the Lesson is unwritten; null if there is none. */
  generation: JobView | null;
  /** The Finish job once Finish is pressed, until the Lesson is finished; null otherwise. */
  finishing: JobView | null;
  /** Mission changes proposed in this Lesson's chat, waiting for the Learner. */
  proposals: ProposalView[];
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

/** Makes sure the read-only Example courses are in the database. Safe to call repeatedly. */
export async function ensureExampleCourse(db: Db): Promise<void> {
  await seedExampleCourses(db);
}

export function createCourseModule({
  db,
  teacher,
  fetchUrl,
  random = Math.random,
  limits = DEFAULT_DAILY_LIMITS,
  spendLimits = DEFAULT_SPEND_LIMITS,
  spendAlarm = null,
  now = () => new Date(),
}: {
  db: Db;
  teacher: Teacher;
  /** The network half of the Resource URL check. */
  fetchUrl: UrlFetcher;
  /** Shuffles quiz options. */
  random?: () => number;
  /** Per-Learner daily caps. */
  limits?: DailyLimits;
  /** Org-wide daily spend limits: the alarm pauses sales, the stop pauses the Teacher. */
  spendLimits?: SpendLimits;
  /** Tells the operator when the day's spend reaches the alarm; null for nobody. */
  spendAlarm?: SpendAlarm | null;
  /** The clock that decides which day it is. */
  now?: () => Date;
}) {
  const caps = createDailyCaps({ db, limits, now });
  const spend = createSpendOperations({ db, limits: spendLimits, alarm: spendAlarm, now });
  const creation = createCourseCreationOperations({ db, teacher, fetchUrl, spend });
  const lessons = createLessonOperations({ db, teacher, random, caps, spend });
  const finish = createFinishOperations({ db, teacher, spend });
  const proposals = createProposalOperations({ db, teacher, spend });
  const credits = createCreditOperations({ db, now });

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

  const chat = createChatOperations({ db, teacher, readResourcesByRef, caps, spend });

  return {
    ...createInterviewOperations({ db, teacher, caps, spend, now }),
    readCourseCreation: creation.readCourseCreation,
    retryCourseCreation: creation.retryCourseCreation,
    openLesson: lessons.openLesson,
    readLessonGeneration: lessons.readLessonGeneration,
    retryLessonGeneration: lessons.retryLessonGeneration,
    answerQuestion: lessons.answerQuestion,
    finishLesson: finish.finishLesson,
    readFinish: finish.readFinish,
    retryFinish: finish.retryFinish,
    askTeacher: chat.askTeacher,
    confirmProposal: proposals.confirmProposal,
    declineProposal: proposals.declineProposal,
    /**
     * Records a verified payment event from the `payments` webhook: paid
     * grants one Course credit, a full refund takes an unused one back.
     * Idempotent: a repeated delivery changes nothing.
     */
    recordPayment: credits.recordPayment,
    /** The Learner's Course credits by status; `available` ones can back an Interview. */
    readCourseCredits: credits.readCourseCredits,
    /** Records one call the Teacher made to Claude; wire it to the Teacher's `recordCall`. */
    recordTeacherCall: spend.recordTeacherCall,

    /**
     * Whether a new sale ("Buy a Course") may happen today: null, or the
     * pause and when it lifts. Credits already bought still start Interviews.
     */
    async readSalesPause(): Promise<SpendPaused | null> {
      return spend.newSale();
    },

    /**
     * Runs the next step of a pending generation job (Course creation,
     * Lesson generation or Finish) and reports whether another step waits. Each call
     * runs one step, so the app can give every step its own invocation.
     * Past the spend stop, the job pauses at its step instead.
     */
    async runJobStep(jobId: string): Promise<JobStepResult> {
      return runJobStep(
        db,
        jobId,
        {
          course_creation: creation.runCourseCreationStep,
          lesson_generation: lessons.runLessonGenerationStep,
          finish: finish.runFinishStep,
        },
        spend.teacherCall,
      );
    },

    /**
     * Resumes the jobs that stopped through no fault of their own (Claude
     * was unavailable, or the runner was cut off), for free and up to a cap:
     * the ids to start. None past the spend stop. See `stuckJobIds`.
     */
    async resumeStuckJobs(): Promise<string[]> {
      if (await spend.teacherCall()) return [];
      const resumed: string[] = [];
      for (const id of await stuckJobIds(db)) {
        if ((await resumeJob(db, id, "Picking up where I left off.")) === "resumed") resumed.push(id);
      }
      return resumed;
    },

    /**
     * Once a job that picks Up next (Course creation or Finish) is done,
     * starts writing that Lesson in the background. The Lesson generation
     * job to start, or null. See `writeUpNextAhead` in ./lessons.
     */
    async writeUpNextAfter(jobId: string): Promise<string | null> {
      const [job] = await db.select().from(schema.job).where(eq(schema.job.id, jobId));
      if (!job || job.status !== "done" || job.kind === "lesson_generation") return null;
      return lessons.writeUpNextAhead(job.courseId);
    },

    /**
     * After the Learner decides a proposal: starts writing Up next in the
     * background, now that no Mission change can re-pick it. The Lesson
     * generation job to start, or null.
     */
    async writeUpNextAhead(courseId: string, learnerId: string): Promise<string | null> {
      const [course] = await db
        .select({ learnerId: schema.course.learnerId })
        .from(schema.course)
        .where(eq(schema.course.id, courseId));
      if (!course || course.learnerId !== learnerId) return null;
      return lessons.writeUpNextAhead(courseId);
    },

    /** Makes sure the read-only Example courses are in the database. Safe to call repeatedly. */
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
          doneAt: schema.course.doneAt,
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
          written: isNotNull(schema.lesson.content).mapWith(Boolean),
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

      // A Done Course has nothing up next.
      const next = course.status === "done" ? undefined : lessons.find((l) => !l.finishedAt);
      const upNext: UpNextLesson | null = next
        ? {
            index: next.index,
            title: next.title,
            goal: next.goal,
            minutes: next.minutes,
            started: next.openedAt !== null,
            ready: next.written,
          }
        : null;

      // Every Course a Learner owns has the allowance its credit buys, even
      // one written before Course credits; the Example course writes nothing.
      const counted = course.isExample ? null : await countedLessonIds(db, course.id);
      const lessonAllowance = counted && {
        lessons: COURSE_CREDIT.lessons,
        written: counted.size,
      };
      const lessonsUsedUp =
        next !== undefined &&
        lessonAllowance !== null &&
        !counted?.has(next.id) &&
        lessonAllowance.written >= lessonAllowance.lessons;

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
      const creation = preparing ? await readCreationView(db, course.id) : null;
      const stopped = creation?.status === "failed" || creation?.status === "paused";

      return {
        id: course.id,
        subject: course.subject,
        title: course.title,
        isExample: course.isExample,
        status: course.status,
        doneAt: course.doneAt,
        mission: {
          why: course.missionWhy,
          success: course.missionSuccess,
          constraints: course.missionConstraints,
          sittingMinutes: course.sittingMinutes,
          outOfScope: course.missionOutOfScope,
        },
        preparing,
        creation,
        givesCreditBack: stopped && (await credits.creditGivenBackBy(course.id)) !== null,
        finishedLessons,
        upNext,
        lessonAllowance,
        lessonsUsedUp,
        learningRecords: records.map(({ supersededById, ...r }) => ({
          ...r,
          superseded: supersededById !== null,
        })),
        proposals: await readOpenProposals(db, course),
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

    /**
     * "Delete course": removes the Course and everything under it, for good.
     * The schema's cascades remove its Lessons, records and jobs; the
     * Interview it was written from goes too, so it cannot be written again.
     * A Course whose creation failed before finding any Resources gives its
     * Course credit back (see `givesCreditBack`). Only the Course's own
     * Learner may; the Example course cannot be deleted.
     */
    async deleteCourse(courseId: string, learnerId: string): Promise<DeleteCourseResult> {
      const course = await findReadableCourse(courseId, { learnerId });
      if (!course) return { ok: false, reason: "not-found" };
      if (course.isExample) return { ok: false, reason: "read-only" };

      await db.transaction(async (tx) => {
        const creditId = await credits.creditGivenBackBy(course.id, tx);
        if (creditId !== null) await credits.giveBack(creditId, tx);
        await tx.delete(schema.course).where(eq(schema.course.id, course.id));
        if (course.interviewId !== null) {
          await tx.delete(schema.interview).where(eq(schema.interview.id, course.interviewId));
        }
      });
      return { ok: true };
    },

    /**
     * "Delete account": removes the Learner and, through the schema's
     * cascades, their sessions, Interviews, Courses and everything under
     * them, and their Course credits, along with any magic-link tokens still
     * out for their email. The payments themselves stay with the provider.
     * The caller signs them out.
     */
    async deleteAccount(learnerId: string): Promise<void> {
      await db.transaction(async (tx) => {
        const [learner] = await tx
          .delete(schema.learner)
          .where(eq(schema.learner.id, learnerId))
          .returning({ email: schema.learner.email });
        if (learner) {
          await tx
            .delete(schema.verificationToken)
            .where(eq(schema.verificationToken.identifier, learner.email));
        }
      });
    },

    /** One Lesson, with its citations resolved to Resources. Null if not found or not the viewer's. */
    async readLesson(
      courseId: string,
      lessonIndex: number,
      viewer: Viewer,
    ): Promise<LessonView | null> {
      if (!isLessonIndex(lessonIndex)) return null;
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

      const resources = await readResourcesByRef(course.id);
      let content: LessonView["content"] = null;
      if (lesson.content !== null) {
        const c = LessonContent.parse(lesson.content);
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

      let generation: JobView | null = null;
      let finishing: JobView | null = null;
      if (!course.isExample && (content === null || lesson.finishedAt === null)) {
        const jobs = await db
          .select()
          .from(schema.job)
          .where(eq(schema.job.lessonId, lesson.id));
        const ofKind = (kind: JobKind) => jobs.find((j) => j.kind === kind);
        const writing = content === null ? ofKind("lesson_generation") : undefined;
        const finishJob = lesson.finishedAt === null ? ofKind("finish") : undefined;
        generation = writing ? viewOf(writing) : null;
        finishing = finishJob ? viewOf(finishJob) : null;
      }

      return {
        course: {
          id: course.id,
          subject: course.subject,
          title: course.title,
          isExample: course.isExample,
          done: course.status === "done",
        },
        index: lesson.index,
        title: lesson.title,
        goal: lesson.goal,
        finishedAt: lesson.finishedAt,
        content,
        answers,
        chat: await readChat(db, lesson.id, resources),
        questionsLeft: course.isExample ? null : await questionsLeft(db, course.id),
        readOnly: course.isExample,
        generation,
        finishing,
        proposals: await readOpenProposals(db, course, lesson.id),
      };
    },
  };
}

/** "r3" → 3. */
function resourceNumber(ref: string): number {
  return Number(ref.slice(1));
}
