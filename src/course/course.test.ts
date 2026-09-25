import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createTestDb } from "@/test/db";
import { createCourseModule, EXAMPLE_COURSE_ID, type CourseModule } from ".";

const visitor = { learnerId: null };

describe("course: reading the Example course's Path", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({ db });
    await course.ensureExampleCourse();
  });

  it("shows the Mission to a visitor", async () => {
    const path = await course.readCoursePath(EXAMPLE_COURSE_ID, visitor);

    expect(path).toMatchObject({
      id: EXAMPLE_COURSE_ID,
      subject: "Music theory",
      isExample: true,
      status: "active",
      mission: {
        why: expect.stringContaining("guitar"),
        sittingMinutes: 10,
      },
    });
    expect(path?.mission.success.length).toBeGreaterThan(0);
    expect(path?.mission.constraints).toContain("10 minutes per sitting");
    expect(path?.mission.outOfScope).toContain("Reading staff notation");
  });

  it("lists finished Lessons in order with quiz scores, then Up next", async () => {
    const path = await course.readCoursePath(EXAMPLE_COURSE_ID, visitor);

    expect(
      path?.finishedLessons.map((l) => [l.index, l.title, l.score]),
    ).toEqual([
      [1, "Notes and the musical alphabet", { correct: 3, total: 3 }],
      [2, "Tones and semitones", { correct: 2, total: 3 }],
    ]);
    expect(path?.upNext).toEqual({
      index: 3,
      title: "The major scale",
      goal: "Build a major scale from any note on one string",
      started: true,
    });
  });

  it("lists Learning records newest first", async () => {
    const path = await course.readCoursePath(EXAMPLE_COURSE_ID, visitor);

    expect(path?.learningRecords.map((r) => [r.number, r.kind])).toEqual([
      [2, "understanding"],
      [1, "prior_knowledge"],
    ]);
  });

  it("seeds the Example course only once", async () => {
    await course.ensureExampleCourse();

    expect(await db.$count(schema.course)).toBe(1);
    expect(await db.$count(schema.lesson)).toBe(3);
  });

  it("returns null for a Course that does not exist", async () => {
    expect(await course.readCoursePath("no-such-course", visitor)).toBeNull();
  });

  it("does not show a Learner's Course to anyone else", async () => {
    await db.insert(schema.learner).values([
      { id: "owner", email: "owner@example.com" },
      { id: "other", email: "other@example.com" },
    ]);
    await db.insert(schema.course).values({
      id: "private",
      learnerId: "owner",
      subject: "Chess",
      title: "Chess for weekend games",
      language: "en",
      missionWhy: "Beat my brother",
      missionSuccess: ["Win a game against my brother"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes: 10,
    });

    expect(await course.readCoursePath("private", visitor)).toBeNull();
    expect(
      await course.readCoursePath("private", { learnerId: "other" }),
    ).toBeNull();
    expect(
      await course.readCoursePath("private", { learnerId: "owner" }),
    ).toMatchObject({ id: "private", finishedLessons: [], upNext: null });
  });
});

describe("course: listing a Learner's Courses", () => {
  let db: Db;
  let course: CourseModule;

  const aCourse = (id: string, learnerId: string, createdAt: string) => ({
    id,
    learnerId,
    subject: id,
    title: `${id} course`,
    language: "en",
    missionWhy: "Because",
    missionSuccess: ["It works"],
    missionConstraints: [],
    missionOutOfScope: [],
    sittingMinutes: 10,
    createdAt: new Date(createdAt),
  });

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({ db });
    await course.ensureExampleCourse();
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  });

  it("is empty for a new Learner, even though the Example course exists", async () => {
    expect(await course.listCourses("ana")).toEqual([]);
  });

  it("returns only that Learner's Courses, newest first", async () => {
    await db.insert(schema.course).values([
      aCourse("chess", "ana", "2026-01-01T00:00:00Z"),
      aCourse("spanish", "ana", "2026-02-01T00:00:00Z"),
      aCourse("drawing", "ben", "2026-03-01T00:00:00Z"),
    ]);

    expect((await course.listCourses("ana")).map((c) => c.id)).toEqual([
      "spanish",
      "chess",
    ]);
    expect(await course.listCourses("ben")).toEqual([
      {
        id: "drawing",
        subject: "drawing",
        title: "drawing course",
        status: "active",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);
    expect(await course.listCourses("nobody")).toEqual([]);
  });
});
