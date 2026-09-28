import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { SearchFindings } from "@/teacher/contract";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// Auth.js's user table: the adapter reads and writes id, name, email,
// emailVerified and image. A row is created on first sign-in.
export const learner = pgTable("learner", {
  id: id(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  createdAt: createdAt(),
});

// Auth.js's OAuth account links. Magic-link sign-in never writes here, but
// the Drizzle adapter requires the table.
export const account = pgTable(
  "account",
  {
    // Auth.js names this key userId.
    userId: text("learner_id")
      .notNull()
      .references(() => learner.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

// Auth.js's database sessions: one row per signed-in browser.
export const session = pgTable(
  "session",
  {
    sessionToken: text("session_token").primaryKey(),
    // Auth.js names this key userId.
    userId: text("learner_id")
      .notNull()
      .references(() => learner.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [index("session_learner_idx").on(t.userId)],
);

// Auth.js's magic-link tokens, deleted once used.
export const verificationToken = pgTable(
  "verification_token",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

// Where an Interview is: the question being asked, done, or redirected
// because the subject is harmful.
export const interviewStage = pgEnum("interview_stage", [
  "why",
  "know",
  "success",
  "sitting",
  "complete",
  "redirected",
]);

export type InterviewMessage = { from: "teacher" | "learner"; text: string };

// An Interview runs before sign-in, so it starts anonymous: whoever holds its
// id may continue it. It is claimed by a Learner at "Write my course".
export const interview = pgTable(
  "interview",
  {
    id: id(),
    // Null until claimed.
    learnerId: text("learner_id").references(() => learner.id, {
      onDelete: "cascade",
    }),
    subject: text("subject").notNull(),
    // BCP 47 tag of the language the visitor writes in.
    language: text("language").notNull(),
    stage: interviewStage("stage").notNull(),
    why: text("why"),
    know: text("know"),
    success: text("success"),
    sittingMinutes: integer("sitting_minutes"),
    // At most one follow-up per Interview.
    followUpAsked: boolean("follow_up_asked").notNull().default(false),
    // True while the question at `stage` waits for the answer to its follow-up.
    awaitingFollowUp: boolean("awaiting_follow_up").notNull().default(false),
    // The conversation as shown, in order.
    messages: jsonb("messages").$type<InterviewMessage[]>().notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("interview_learner_idx").on(t.learnerId)],
);

export const courseStatus = pgEnum("course_status", ["active", "done"]);

export const course = pgTable(
  "course",
  {
    id: id(),
    // Null only for the Example course, which belongs to nobody.
    learnerId: text("learner_id").references(() => learner.id, {
      onDelete: "cascade",
    }),
    isExample: boolean("is_example").notNull().default(false),
    subject: text("subject").notNull(),
    title: text("title").notNull(),
    // BCP 47 tag of the language the Interview was held in.
    language: text("language").notNull(),
    missionWhy: text("mission_why").notNull(),
    missionSuccess: jsonb("mission_success").$type<string[]>().notNull(),
    missionConstraints: jsonb("mission_constraints").$type<string[]>().notNull(),
    missionOutOfScope: jsonb("mission_out_of_scope").$type<string[]>().notNull(),
    sittingMinutes: integer("sitting_minutes").notNull(),
    status: courseStatus("status").notNull().default("active"),
    communityOptOut: boolean("community_opt_out").notNull().default(false),
    // The Interview the Course was written from; one Course per Interview.
    interviewId: text("interview_id")
      .unique()
      .references(() => interview.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("course_learner_idx").on(t.learnerId)],
);

export const lesson = pgTable(
  "lesson",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    // 1-based position in the Course.
    index: integer("index").notNull(),
    title: text("title").notNull(),
    // Starts with an observable verb.
    goal: text("goal").notNull(),
    // How long the Teacher expects one sitting of it to take. Null for
    // Lessons chosen before Up next carried minutes.
    minutes: integer("minutes"),
    // Written on first open; null until then. Shape is owned by the teacher module.
    content: jsonb("content"),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lesson_course_index_uq").on(t.courseId, t.index)],
);

export const quizAttempt = pgTable(
  "quiz_attempt",
  {
    id: id(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    questionIndex: integer("question_index").notNull(),
    chosenOption: integer("chosen_option").notNull(),
    correct: boolean("correct").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("quiz_attempt_lesson_question_uq").on(
      t.lessonId,
      t.questionIndex,
    ),
  ],
);

export const learningRecordKind = pgEnum("learning_record_kind", [
  "understanding",
  "prior_knowledge",
  "misconception",
  "mission_change",
]);

export const learningRecord = pgTable(
  "learning_record",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    // Numbered per Course: 1, 2, 3… (shown as 0001, 0002, …).
    number: integer("number").notNull(),
    kind: learningRecordKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    lessonId: text("lesson_id").references(() => lesson.id, {
      onDelete: "set null",
    }),
    supersededById: text("superseded_by_id").references(
      (): AnyPgColumn => learningRecord.id,
      { onDelete: "set null" },
    ),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("learning_record_course_number_uq").on(t.courseId, t.number),
  ],
);

export const resourceKind = pgEnum("resource_kind", [
  "book",
  "docs",
  "course",
  "article",
  "site",
]);

// ok: the URL answered below 400. blocked: 403 or 429, kept because the URL
// came from the web search results (bot walls are common on live sites).
export const resourceCheckOutcome = pgEnum("resource_check_outcome", [
  "ok",
  "blocked",
]);

export const resource = pgTable(
  "resource",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    // The id Lesson content cites, such as "r1"; unique within the Course.
    // Never shown to the Learner: the UI shows its number instead.
    ref: text("ref").notNull(),
    kind: resourceKind("kind").notNull(),
    title: text("title").notNull(),
    author: text("author").notNull(),
    url: text("url").notNull(),
    why: text("why").notNull(),
    // BCP 47 tag of the Resource's language.
    language: text("language").notNull(),
    // What the URL check found. Null for Resources that were never checked
    // (the Example course's).
    checkOutcome: resourceCheckOutcome("check_outcome"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("resource_course_ref_uq").on(t.courseId, t.ref)],
);

export const community = pgTable(
  "community",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Where it meets: a website, an app, or a kind of place nearby.
    where: text("where").notNull(),
    url: text("url"),
    why: text("why").notNull(),
    offline: boolean("offline").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("community_course_idx").on(t.courseId)],
);

export const gap = pgTable(
  "gap",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("gap_course_idx").on(t.courseId)],
);

export const jobKind = pgEnum("job_kind", ["course_creation"]);

// pending: waiting for a runner. running: a runner holds it (see runId).
// failed: stopped at `step`; a retry resumes there.
export const jobStatus = pgEnum("job_status", [
  "pending",
  "running",
  "failed",
  "done",
]);

export type JobProgressMessage = { at: string; text: string };

// Generation work that outlives the request that started it (ADR 0004). Each
// step runs in its own function invocation, so each must fit its limit.
export const job = pgTable(
  "job",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    kind: jobKind("kind").notNull(),
    status: jobStatus("status").notNull().default("pending"),
    // The step to run next, or the one that failed. Its values depend on kind.
    step: text("step").notNull(),
    // Calm messages for the Learner, oldest first.
    progress: jsonb("progress")
      .$type<JobProgressMessage[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    searchOutput: jsonb("search_output").$type<SearchFindings>(),
    // For the operator; the Learner sees a friendly message instead.
    error: text("error"),
    // Set when a runner claims the job; only that runner may advance it.
    runId: text("run_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("job_course_idx").on(t.courseId),
    uniqueIndex("job_course_creation_uq")
      .on(t.courseId)
      .where(sql`${t.kind} = 'course_creation'`),
  ],
);
