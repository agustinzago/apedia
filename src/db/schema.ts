import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// Auth.js will extend this table when sign-in lands.
export const learner = pgTable("learner", {
  id: id(),
  email: text("email").notNull().unique(),
  createdAt: createdAt(),
});

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
