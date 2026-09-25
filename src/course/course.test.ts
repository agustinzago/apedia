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

describe("course: reading an Example course Lesson", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({ db });
    await course.ensureExampleCourse();
  });

  it("returns the Lesson's content in Column order to a visitor", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 3, visitor);

    expect(lesson).toMatchObject({
      course: { id: EXAMPLE_COURSE_ID, isExample: true },
      index: 3,
      title: "The major scale",
      finishedAt: null,
      answers: [],
    });
    expect(lesson?.content?.hook).toMatch(/scale/);
    expect(lesson?.content?.sections.map((s) => s.heading)).toEqual([
      "One pattern of steps",
      "Starting somewhere else",
    ]);
    expect(lesson?.content?.keyIdea).toBe(
      "Every major scale follows the same steps: T T S T T T S.",
    );
    expect(lesson?.content?.practice.steps).toHaveLength(4);
    expect(lesson?.content?.quiz).toHaveLength(3);
    expect(lesson?.content?.quiz.map((q) => q.review)).toEqual([
      false,
      false,
      true,
    ]);
    expect(lesson?.content?.newTerms.map((t) => t.term)).toEqual([
      "Scale",
      "Major scale",
    ]);
  });

  it("resolves citations and Read next to numbered Resources with URLs", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 3, visitor);

    expect(
      lesson?.content?.sections.map((s) =>
        s.citations.map((c) => [c.number, c.url]),
      ),
    ).toEqual([
      [
        [1, "https://www.musictheory.net/lessons"],
        [2, "https://viva.pressbooks.pub/openmusictheory/"],
      ],
      [
        [1, "https://www.musictheory.net/lessons"],
        [3, "https://www.justinguitar.com/"],
      ],
    ]);
    expect(lesson?.content?.readNext).toMatchObject({
      number: 1,
      title: "musictheory.net — Lessons",
      url: "https://www.musictheory.net/lessons",
    });
  });

  it("never exposes internal Resource ids", async () => {
    for (const index of [1, 2, 3]) {
      const lesson = await course.readLesson(EXAMPLE_COURSE_ID, index, visitor);
      expect(JSON.stringify(lesson)).not.toMatch(/"r\d+"|\br\d+\b/);
    }
  });

  it("returns the recorded answers of a finished Lesson", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 2, visitor);

    expect(lesson?.finishedAt).toEqual(new Date("2026-09-03T19:15:00Z"));
    expect(lesson?.answers).toEqual([
      { questionIndex: 0, chosenOption: 2 },
      { questionIndex: 1, chosenOption: 0 },
      { questionIndex: 2, chosenOption: 3 },
    ]);
  });

  it("estimates the sitting from reading and practice time", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 3, visitor);

    // 258 words at 200 a minute, plus 7 minutes of practice, rounded up.
    expect(lesson?.content?.minutes).toBe(9);
  });

  it("returns null for a Lesson that does not exist", async () => {
    expect(await course.readLesson(EXAMPLE_COURSE_ID, 99, visitor)).toBeNull();
    expect(await course.readLesson("no-such-course", 1, visitor)).toBeNull();
  });

  it("seeds Resources into an Example course seeded before they existed", async () => {
    await db.delete(schema.resource);

    await course.ensureExampleCourse();

    expect(await db.$count(schema.resource)).toBe(5);
    expect(await db.$count(schema.lesson)).toBe(3);
  });
});
