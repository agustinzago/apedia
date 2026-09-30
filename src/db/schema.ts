import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
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

// Every magic link sent, for the per-address and per-IP limits. Not tied to
// a Learner: it holds a keyed hash of the address, never the address, and
// rows older than a day are pruned.
export const magicLinkRequest = pgTable(
  "magic_link_request",
  {
    id: id(),
    // HMAC-SHA256 of the normalised address, keyed with AUTH_SECRET.
    emailHash: text("email_hash").notNull(),
    // The first address in x-forwarded-for; null when there is none (local dev).
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("magic_link_request_email_idx").on(t.emailHash, t.createdAt),
    index("magic_link_request_ip_idx").on(t.ip, t.createdAt),
  ],
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

// An Interview is held by a signed-in Learner and backed by one of their
// Course credits (ADR 0007): only its Learner may continue it.
export const interview = pgTable(
  "interview",
  {
    id: id(),
    // Null only for anonymous Interviews started before ADR 0007, which
    // nobody can reach any more.
    learnerId: text("learner_id").references(() => learner.id, {
      onDelete: "cascade",
    }),
    // The Course credit backing the Interview, reserved when it starts and
    // used by "Write my course". Unique: a credit backs at most one
    // Interview. Null for a redirected subject, which uses no credit, and
    // for Interviews started before ADR 0007.
    courseCreditId: text("course_credit_id")
      .unique()
      .references((): AnyPgColumn => courseCredit.id, { onDelete: "set null" }),
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
    // When an anonymous Interview was claimed at sign-in, before ADR 0007.
    // No longer written.
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("interview_learner_idx").on(t.learnerId)],
);

// Every Interview start that went on to the Teacher, for the per-Learner
// daily limit on starts. Discarding the Interview deletes its row but not
// this one, so letting an Interview go gives no start back. It holds nothing
// the Learner said.
export const interviewStart = pgTable(
  "interview_start",
  {
    id: id(),
    learnerId: text("learner_id")
      .notNull()
      .references(() => learner.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [index("interview_start_learner_idx").on(t.learnerId, t.createdAt)],
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
    // When the Learner confirmed the Course Done; null while active.
    doneAt: timestamp("done_at", { withTimezone: true }),
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
// broken: a later check found the URL gone (404, 410, 5xx, DNS failure,
// timeout). Course creation drops such URLs, so only a re-check writes it;
// the success_metrics view counts it.
export const resourceCheckOutcome = pgEnum("resource_check_outcome", [
  "ok",
  "blocked",
  "broken",
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
    // What the latest URL check found, at verifiedAt. Null for Resources that
    // were never checked (the Example course's).
    checkOutcome: resourceCheckOutcome("check_outcome"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("resource_course_ref_uq").on(t.courseId, t.ref)],
);

// The Course's Glossary: a term is added only once the Learner has shown
// they understand it, so it is written at Finish, never at Lesson writing.
export const glossaryTerm = pgTable(
  "glossary_term",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    term: text("term").notNull(),
    definition: text("definition").notNull(),
    // The Lesson whose Finish added the term.
    lessonId: text("lesson_id").references(() => lesson.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  // One entry per term, whatever its casing.
  (t) => [
    uniqueIndex("glossary_term_course_term_uq").on(
      t.courseId,
      sql`lower(${t.term})`,
    ),
  ],
);

// The Reference sheet's topic-specific sections, such as a table of the
// twelve notes. Finish adds or rewrites them.
export const referenceSection = pgTable(
  "reference_section",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    // 1-based order on the sheet.
    position: integer("position").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reference_section_course_position_uq").on(
      t.courseId,
      t.position,
    ),
  ],
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

export const chatMessageFrom = pgEnum("chat_message_from", ["teacher", "learner"]);

// A Lesson's "Ask your teacher" chat. Finish reads it as evidence, citing
// messages as "C1", "C2"… by their number.
export const chatMessage = pgTable(
  "chat_message",
  {
    id: id(),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lesson.id, { onDelete: "cascade" }),
    // Numbered per Lesson: 1, 2, 3… in the order the messages were written.
    number: integer("number").notNull(),
    from: chatMessageFrom("from").notNull(),
    // As written; a Teacher answer may cite Resources by ref, such as "[r3]".
    text: text("text").notNull(),
    // The Community a Teacher answer suggests, if any.
    communityId: text("community_id").references(() => community.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chat_message_lesson_number_uq").on(t.lessonId, t.number)],
);

export const proposalKind = pgEnum("proposal_kind", ["mission_change", "done"]);

// open: waiting for the Learner. confirmed / declined: the Learner chose.
// withdrawn: overtaken before the Learner chose, by a newer proposal of the
// same kind or by the other kind being confirmed.
export const proposalStatus = pgEnum("proposal_status", [
  "open",
  "confirmed",
  "declined",
  "withdrawn",
]);

export const proposalSource = pgEnum("proposal_source", ["finish", "chat"]);

/** A proposed Mission, as it replaces the Course's on confirmation. */
export type ProposedMission = {
  why: string;
  success: string[];
  constraints: string[];
  outOfScope: string[];
  /** The mission-change Learning record written on confirmation. */
  record: { title: string; body: string };
};

/** Which standing Learning records (by number) show each success item (1-based). */
export type DoneEvidence = { successItem: number; records: number[] }[];

// Something the Teacher proposes that changes the Course only once the
// Learner confirms it: a Mission change, or that the Course is Done.
export const proposal = pgTable(
  "proposal",
  {
    id: id(),
    courseId: text("course_id")
      .notNull()
      .references(() => course.id, { onDelete: "cascade" }),
    kind: proposalKind("kind").notNull(),
    status: proposalStatus("status").notNull().default("open"),
    // Raised by a Lesson's Finish or in its chat.
    source: proposalSource("source").notNull(),
    lessonId: text("lesson_id").references(() => lesson.id, {
      onDelete: "set null",
    }),
    // Why the Teacher proposes it, to the Learner, in the Course's language.
    reason: text("reason").notNull(),
    // Set for a mission_change.
    mission: jsonb("mission").$type<ProposedMission>(),
    // Set for done.
    evidence: jsonb("evidence").$type<DoneEvidence>(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("proposal_course_idx").on(t.courseId),
    // At most one open proposal of each kind per Course.
    uniqueIndex("proposal_course_kind_open_uq")
      .on(t.courseId, t.kind)
      .where(sql`${t.status} = 'open'`),
  ],
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

export const jobKind = pgEnum("job_kind", [
  "course_creation",
  "lesson_generation",
  "finish",
]);

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
    // The Lesson a lesson_generation job writes or a finish job finishes;
    // null for course_creation.
    lessonId: text("lesson_id").references(() => lesson.id, {
      onDelete: "cascade",
    }),
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
    // "Try again"s used at `step`; back to 0 when the job moves on.
    retries: integer("retries").notNull().default(0),
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
    // One job of each kind per Lesson: it is written once and finished once.
    uniqueIndex("job_lesson_kind_uq").on(t.lessonId, t.kind),
  ],
);

// Every call the Teacher makes to Claude, for the org-wide spend alarm and
// for the operator. Not tied to a Learner: the spend limits are org-wide.
export const teacherCall = pgTable(
  "teacher_call",
  {
    id: id(),
    // The Teacher operation, such as "writeLesson".
    operation: text("operation").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheWriteTokens: integer("cache_write_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").notNull(),
    webSearches: integer("web_searches").notNull(),
    // At list prices, in US dollars.
    costUsd: doublePrecision("cost_usd").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("teacher_call_created_at_idx").on(t.createdAt)],
);

// One row per UTC day on which spend crossed the alarm threshold: the
// operator is emailed once per day, by whichever request inserts it.
export const spendAlarm = pgTable("spend_alarm", {
  day: date("day").primaryKey(),
  spentUsd: doublePrecision("spent_usd").notNull(),
  thresholdUsd: doublePrecision("threshold_usd").notNull(),
  createdAt: createdAt(),
});

// available: bought, not yet used; it may back one open Interview. used:
// "Write my course" created a Course with it; it comes back to available if
// the Learner gives up on a Course whose creation failed before finding any
// Resources. refunded: the payment was fully refunded before the credit was
// used, so it can no longer start or continue an Interview.
export const courseCreditStatus = pgEnum("course_credit_status", [
  "available",
  "used",
  "refunded",
]);

// One Course credit per payment: what buying a Course gives the Learner. The
// payment itself lives with the provider (Polar); this is Apedia's record of
// it, written only by a verified webhook. Deleting the Learner deletes it.
export const courseCredit = pgTable(
  "course_credit",
  {
    id: id(),
    learnerId: text("learner_id")
      .notNull()
      .references(() => learner.id, { onDelete: "cascade" }),
    // Who took the payment, such as "polar", and its id there (Polar's order id).
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    // What the Learner paid for the Course, in the currency's smallest unit.
    amountCents: integer("amount_cents").notNull(),
    // ISO 4217, lowercase, as the provider reports it: "usd".
    currency: text("currency").notNull(),
    status: courseCreditStatus("status").notNull().default("available"),
    // Times giving up on a Course whose creation failed made it available again.
    givenBack: integer("given_back").notNull().default(0),
    // Set by a full refund, whatever the status; a used credit keeps "used".
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("course_credit_learner_idx").on(t.learnerId),
    // One credit per payment, however many times the webhook is delivered.
    uniqueIndex("course_credit_payment_uq").on(t.provider, t.providerPaymentId),
  ],
);

// A claim on one piece of work that asks the Teacher, such as answering an
// Interview question or confirming a Mission change, so that the same
// request sent twice at once asks only once. The holder deletes its row when
// done; a row past `expiresAt` lost its holder and may be claimed again.
export const lease = pgTable("lease", {
  // What is being worked on, such as "interview-answer:<interview id>".
  key: text("key").primaryKey(),
  // Who holds it: only they release it.
  holder: text("holder").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// A full refund (or void) that arrived before its payment: webhooks may come
// in any order. When the payment arrives, its Course credit is recorded
// already refunded, so it never backs an Interview.
export const paymentReversal = pgTable(
  "payment_reversal",
  {
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerPaymentId] })],
);
