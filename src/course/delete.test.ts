import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createFakeTeacher } from "@/teacher/fake";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, EXAMPLE_COURSE_ID, type CourseModule } from ".";

/** Every table in the schema. */
const tables = Object.values(schema as Record<string, unknown>).filter((value): value is PgTable => is(value, PgTable));

/**
 * Tables not tied to any Learner or Course: the org-wide spend records, and
 * the magic links sent, which hold only a keyed hash of the address and are
 * pruned after a day.
 */
const unowned = new Set(["teacher_call", "spend_alarm", "magic_link_request"]);

/** Every row of every table, keyed by table name, in a stable order. */
async function snapshot(db: Db): Promise<Record<string, string[]>> {
  const entries = await Promise.all(
    tables.map(async (table) => {
      const rows = await db.select().from(table);
      return [getTableName(table), rows.map((r) => JSON.stringify(r)).sort()] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * A claimed Interview and the Course written from it, with a row in every
 * table under a Course: Lessons, quiz attempts, Learning records (one
 * superseding another), Resources, Glossary, Reference sheet, Communities,
 * chat, proposals, Gaps and jobs.
 */
async function seedCourse(db: Db, learnerId: string, key: string): Promise<string> {
  const id = (name: string) => `${key}-${name}`;
  await db.insert(schema.interview).values({
    id: id("interview"),
    learnerId,
    subject: "Chess",
    language: "en",
    stage: "complete",
    why: "To beat my brother",
    sittingMinutes: 10,
    messages: [{ from: "learner", text: "To beat my brother" }],
    claimedAt: new Date(),
  });
  await db.insert(schema.course).values({
    id: id("course"),
    learnerId,
    interviewId: id("interview"),
    subject: "Chess",
    title: "Chess for Sunday games",
    language: "en",
    missionWhy: "To beat my brother on Sundays.",
    missionSuccess: ["Win a game against my brother"],
    missionConstraints: ["10 minutes per sitting"],
    missionOutOfScope: [],
    sittingMinutes: 10,
  });
  await db.insert(schema.lesson).values([
    {
      id: id("lesson-1"),
      courseId: id("course"),
      index: 1,
      title: "How the pieces move",
      goal: "Move every piece legally",
      minutes: 10,
      openedAt: new Date(),
      finishedAt: new Date(),
    },
    {
      id: id("lesson-2"),
      courseId: id("course"),
      index: 2,
      title: "Opening principles",
      goal: "Play the first five moves of a sound opening",
      minutes: 10,
    },
  ]);
  await db.insert(schema.quizAttempt).values({
    lessonId: id("lesson-1"),
    questionIndex: 0,
    chosenOption: 2,
    correct: true,
  });
  await db.insert(schema.learningRecord).values([
    {
      id: id("record-2"),
      courseId: id("course"),
      number: 2,
      kind: "understanding",
      title: "Moves every piece legally",
      body: "Answered every movement question right.",
      lessonId: id("lesson-1"),
    },
    {
      id: id("record-1"),
      courseId: id("course"),
      number: 1,
      kind: "prior_knowledge",
      title: "Knows how some pieces move",
      body: "Said so in the Interview.",
      supersededById: id("record-2"),
    },
  ]);
  await db.insert(schema.resource).values({
    courseId: id("course"),
    ref: "r1",
    kind: "site",
    title: "Lichess learn",
    author: "Lichess",
    url: "https://lichess.org/learn",
    why: "Interactive basics.",
    language: "en",
  });
  await db.insert(schema.glossaryTerm).values({
    courseId: id("course"),
    term: "Castling",
    definition: "The king and a rook move together.",
    lessonId: id("lesson-1"),
  });
  await db.insert(schema.referenceSection).values({
    courseId: id("course"),
    position: 1,
    title: "Piece values",
    body: "Pawn 1, knight 3, bishop 3, rook 5, queen 9.",
  });
  await db.insert(schema.community).values({
    id: id("community"),
    courseId: id("course"),
    name: "A local chess club",
    where: "A library or café near you",
    why: "Play people across the board.",
    offline: true,
  });
  await db.insert(schema.chatMessage).values([
    { lessonId: id("lesson-1"), number: 1, from: "learner", text: "Can pawns move back?" },
    {
      lessonId: id("lesson-1"),
      number: 2,
      from: "teacher",
      text: "No, never [r1].",
      communityId: id("community"),
    },
  ]);
  await db.insert(schema.proposal).values({
    courseId: id("course"),
    kind: "done",
    source: "finish",
    lessonId: id("lesson-1"),
    reason: "You won.",
    evidence: [{ successItem: 1, records: [2] }],
  });
  await db.insert(schema.gap).values({
    courseId: id("course"),
    description: "Endgames",
  });
  await db.insert(schema.job).values([
    { courseId: id("course"), kind: "course_creation", step: "research", status: "done" },
    {
      courseId: id("course"),
      kind: "lesson_generation",
      lessonId: id("lesson-2"),
      step: "write",
      status: "running",
    },
  ]);
  return id("course");
}

/** Spend records, which belong to no Learner and must survive every deletion. */
async function seedSpend(db: Db) {
  await db.insert(schema.teacherCall).values({
    operation: "writeLesson",
    model: "claude",
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    webSearches: 0,
    costUsd: 0.01,
  });
  await db.insert(schema.spendAlarm).values({ day: "2026-09-28", spentUsd: 60, thresholdUsd: 50 });
}

describe("course: deleting", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await course.ensureExampleCourse();
    await seedSpend(db);
    await db.insert(schema.learner).values({ id: "ben", email: "ben@example.com" });
    // Someone else's Course and sign-in, which must be left alone.
    await seedCourse(db, "ben", "ben");
    await db.insert(schema.session).values({
      sessionToken: "ben-session",
      userId: "ben",
      expires: new Date(Date.now() + 86_400_000),
    });
  });

  describe("a Course", () => {
    beforeEach(async () => {
      await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
    });

    it("removes the Course, everything under it and its Interview, and nothing else", async () => {
      await seedCourse(db, "ana", "ana-keep");
      const before = await snapshot(db);
      const courseId = await seedCourse(db, "ana", "ana-gone");

      expect(await course.deleteCourse(courseId, "ana")).toEqual({ ok: true });

      expect(await snapshot(db)).toEqual(before);
      expect(await course.readCoursePath(courseId, { learnerId: "ana" })).toBeNull();
    });

    it("refuses someone else's Course", async () => {
      const before = await snapshot(db);

      expect(await course.deleteCourse("ben-course", "ana")).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await snapshot(db)).toEqual(before);
    });

    it("refuses the Example course", async () => {
      const before = await snapshot(db);

      expect(await course.deleteCourse(EXAMPLE_COURSE_ID, "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });
      expect(await snapshot(db)).toEqual(before);
      expect(await course.readCoursePath(EXAMPLE_COURSE_ID, { learnerId: null })).not.toBeNull();
    });

    it("refuses a Course that does not exist", async () => {
      expect(await course.deleteCourse("no-such-course", "ana")).toEqual({
        ok: false,
        reason: "not-found",
      });
    });
  });

  describe("an account", () => {
    it("removes the Learner and every row of theirs, and nothing else", async () => {
      const before = await snapshot(db);

      await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
      await seedCourse(db, "ana", "ana-1");
      await seedCourse(db, "ana", "ana-2");
      // An Interview not yet written into a Course.
      await db.insert(schema.interview).values({
        learnerId: "ana",
        subject: "Welsh",
        language: "en",
        stage: "know",
        messages: [],
        claimedAt: new Date(),
      });
      await db.insert(schema.session).values({
        sessionToken: "ana-session",
        userId: "ana",
        expires: new Date(Date.now() + 86_400_000),
      });
      await db.insert(schema.account).values({
        userId: "ana",
        type: "oauth",
        provider: "example",
        providerAccountId: "ana",
      });
      await db.insert(schema.verificationToken).values({
        identifier: "ana@example.com",
        token: "hashed",
        expires: new Date(Date.now() + 86_400_000),
      });

      // The seed covers every table a Learner can own, so a new table
      // without a cascade fails here.
      const seeded = await snapshot(db);
      for (const table of tables) {
        const name = getTableName(table);
        if (unowned.has(name)) continue;
        expect(seeded[name].length, name).toBeGreaterThan(before[name].length);
      }

      await course.deleteAccount("ana");

      expect(await snapshot(db)).toEqual(before);
      expect(await course.listCourses("ana")).toEqual([]);
    });

    it("does nothing for a Learner that does not exist", async () => {
      const before = await snapshot(db);

      await course.deleteAccount("no-such-learner");

      expect(await snapshot(db)).toEqual(before);
    });
  });
});
