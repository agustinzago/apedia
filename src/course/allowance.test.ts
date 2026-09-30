import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import type { FinishDraft } from "@/teacher";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import finishFixture from "@/teacher/fixtures/finish-music-theory.json";
import lessonFixture from "@/teacher/fixtures/lesson-music-theory.json";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { COURSE_CREDIT, createCourseModule, EXAMPLE_COURSE_ID, type CourseModule } from ".";

const ana = { learnerId: "ana" };

describe("course: a Course's allowance", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;
  /** Lesson 1's content as the Teacher wrote it, to seed Lessons written earlier. */
  let content: unknown;

  const setUp = async (replies: FakeTeacherReplies = {}) => {
    db = await createTestDb();
    teacher = createFakeTeacher({
      writeLesson: lessonFixture,
      // A new Up next every Finish: "Lesson 2", "Lesson 3"…
      finishLesson: (input) => ({
        ...(finishFixture as FinishDraft),
        upNext: { ...finishFixture.upNext, title: `Lesson ${input.lesson.index + 1}` },
      }),
      ...replies,
    });
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });
    await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
    // Two Courses of Ana's, with no Course credit behind them: as if written
    // during the free MVP. The allowance holds all the same.
    for (const id of ["c1", "c2"]) {
      await db.insert(schema.course).values({
        id,
        learnerId: "ana",
        subject: "Music theory",
        title: "Music theory for the guitar you already play",
        language: "en",
        missionWhy: "Understand the songs I already play on guitar.",
        missionSuccess: ["Explain why the chords of a song belong to the same key"],
        missionConstraints: ["10 minutes per sitting"],
        missionOutOfScope: [],
        sittingMinutes: 10,
      });
      await db.insert(schema.resource).values(
        ["r1", "r2", "r3"].map((ref) => ({
          courseId: id,
          ref,
          kind: "site" as const,
          title: `Resource ${ref.slice(1)}`,
          author: "Someone",
          url: `https://example.org/${ref}`,
          why: "It fits.",
          language: "en",
        })),
      );
      await db.insert(schema.learningRecord).values({
        courseId: id,
        number: 1,
        kind: "prior_knowledge",
        title: "Plays open chords from chord charts",
        body: "Said in the Interview they can strum G, C, D, Em and Am.",
      });
      await db.insert(schema.lesson).values({
        courseId: id,
        index: 1,
        title: "Lesson 1",
        goal: "Name the key of a song from its chord chart",
        minutes: 10,
      });
    }
  };

  /** Runs a job's steps the way the app does, until it stops. */
  const runToEnd = async (jobId: string) => {
    for (let i = 0; i < 10; i++) {
      if ((await course.runJobStep(jobId)) === "stop") return;
    }
    throw new Error("The job never stopped.");
  };

  const openAndWrite = async (index: number, courseId = "c1") => {
    const opened = await course.openLesson(courseId, index, "ana");
    if (!opened.ok || !opened.generation) {
      throw new Error(`Lesson ${index} did not start: ${JSON.stringify(opened)}`);
    }
    await runToEnd(opened.generation.jobId);
  };

  const answerAndFinish = async (index: number) => {
    const lesson = await course.readLesson("c1", index, ana);
    for (const q of lesson?.content?.quiz.keys() ?? []) {
      await course.answerQuestion("c1", index, q, 0, "ana");
    }
    const pressed = await course.finishLesson("c1", index, "ana");
    if (!pressed.ok) throw new Error(`Lesson ${index} not finished: ${JSON.stringify(pressed)}`);
    await runToEnd(pressed.finishing.jobId);
  };

  const lessonRow = async (index: number, courseId = "c1") => {
    const [row] = await db
      .select()
      .from(schema.lesson)
      .where(and(eq(schema.lesson.courseId, courseId), eq(schema.lesson.index, index)));
    return row;
  };

  /** Lessons 1…n of Course c1 written and finished, and Lesson n + 1 Up next, unwritten. */
  const finishedUpTo = async (n: number) => {
    await db
      .update(schema.lesson)
      .set({ content, openedAt: new Date(), finishedAt: new Date() })
      .where(eq(schema.lesson.id, (await lessonRow(1)).id));
    await db.insert(schema.lesson).values([
      ...Array.from({ length: n - 1 }, (_, i) => ({
        courseId: "c1",
        index: i + 2,
        title: `Lesson ${i + 2}`,
        goal: "Name the next idea",
        minutes: 10,
        content,
        openedAt: new Date(),
        finishedAt: new Date(),
      })),
      { courseId: "c1", index: n + 1, title: `Lesson ${n + 1}`, goal: "Name the next idea", minutes: 10 },
    ]);
  };

  /** `count` questions from Ana, each with the Teacher's answer, in one Lesson. */
  const asked = async (lessonId: string, count: number) => {
    await db.insert(schema.chatMessage).values(
      Array.from({ length: count }, (_, i) => [
        { lessonId, number: 2 * i + 1, from: "learner" as const, text: `Question ${i + 1}?` },
        { lessonId, number: 2 * i + 2, from: "teacher" as const, text: "An answer." },
      ]).flat(),
    );
  };

  const calls = (op: FakeTeacher["calls"][number]["op"]) =>
    teacher.calls.filter((c) => c.op === op);

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp();
    await openAndWrite(1);
    content = (await lessonRow(1)).content;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is what a Course credit buys: 20 Lessons and 100 questions", async () => {
    expect(COURSE_CREDIT).toMatchObject({ lessons: 20, chatQuestions: 100 });
    expect(await course.readCoursePath("c1", ana)).toMatchObject({
      lessonAllowance: { lessons: 20, written: 1 },
      lessonsUsedUp: false,
    });
    expect((await course.readLesson("c1", 1, ana))?.questionsLeft).toBe(100);
  });

  describe("Lessons", () => {
    it("are written up to the allowance, the last one's Finish included, then the next is refused", async () => {
      await finishedUpTo(18);
      expect(await course.readCoursePath("c1", ana)).toMatchObject({
        upNext: { index: 19 },
        lessonAllowance: { lessons: 20, written: 18 },
        lessonsUsedUp: false,
      });

      // Under the allowance: the 19th.
      await openAndWrite(19);
      await answerAndFinish(19);
      // At it: the 20th, and its Finish, which picks Up next.
      await openAndWrite(20);
      expect(await course.readCoursePath("c1", ana)).toMatchObject({
        upNext: { index: 20 },
        lessonAllowance: { written: 20 },
        lessonsUsedUp: false,
      });
      await answerAndFinish(20);
      const writes = calls("writeLesson").length;

      // Over it: the 21st is not written, and opening it changes nothing.
      const usedUp = { ok: false, reason: "lessons-used-up", allowance: 20 };
      expect(await course.openLesson("c1", 21, "ana")).toEqual(usedUp);
      expect(await course.retryLessonGeneration("c1", 21, "ana")).toEqual(usedUp);
      expect(calls("writeLesson")).toHaveLength(writes);
      const lesson21 = await lessonRow(21);
      expect(lesson21).toMatchObject({ content: null, openedAt: null });
      expect(await db.select().from(schema.job).where(eq(schema.job.lessonId, lesson21.id))).toEqual(
        [],
      );

      // The Teacher's last Up next stays shown, and everything written stays.
      const path = await course.readCoursePath("c1", ana);
      expect(path).toMatchObject({
        upNext: { index: 21, title: "Lesson 21", started: false },
        lessonAllowance: { lessons: 20, written: 20 },
        lessonsUsedUp: true,
      });
      expect(path?.finishedLessons).toHaveLength(20);
      expect(path?.learningRecords.length).toBeGreaterThan(0);
      expect((await course.readLesson("c1", 20, ana))?.content).not.toBeNull();
      expect((await course.readReferenceSheet("c1", ana))?.keyIdeas).toHaveLength(20);
    });

    it("count from the first open, so writing that failed can still be tried again", async () => {
      let down = true;
      await setUp({
        writeLesson: () => {
          if (down) throw new Error("Claude is down.");
          return lessonFixture;
        },
      });
      await finishedUpTo(19);

      const opened = await course.openLesson("c1", 20, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Lesson 20 did not start.");
      await runToEnd(opened.generation.jobId);
      expect(await course.readLessonGeneration("c1", 20, "ana")).toMatchObject({ status: "failed" });
      expect(await course.readCoursePath("c1", ana)).toMatchObject({
        lessonAllowance: { written: 20 },
        lessonsUsedUp: false,
      });

      down = false;
      expect(await course.retryLessonGeneration("c1", 20, "ana")).toMatchObject({ ok: true });
      await runToEnd(opened.generation.jobId);
      expect((await course.readLesson("c1", 20, ana))?.content).not.toBeNull();
    });

    it("are counted per Course", async () => {
      await finishedUpTo(20);
      expect(await course.openLesson("c1", 21, "ana")).toMatchObject({ reason: "lessons-used-up" });

      await expect(openAndWrite(1, "c2")).resolves.toBeUndefined();
      expect(await course.readCoursePath("c2", ana)).toMatchObject({
        lessonAllowance: { written: 1 },
      });
    });
  });

  describe("chat questions", () => {
    it("are taken up to the allowance across the Course's Lessons, then refused", async () => {
      await finishedUpTo(1);
      await openAndWrite(2);
      // 98 asked in Lesson 1; Ana's questions in another Course don't count.
      await asked((await lessonRow(1)).id, 98);
      await asked((await lessonRow(1, "c2")).id, 5);
      expect((await course.readLesson("c1", 2, ana))?.questionsLeft).toBe(2);

      // Under the allowance: the 99th.
      expect(await course.askTeacher("c1", 2, "Why G?", "ana")).toMatchObject({
        ok: true,
        questionsLeft: 1,
      });
      // At it: the 100th.
      expect(await course.askTeacher("c1", 2, "And D?", "ana")).toMatchObject({
        ok: true,
        questionsLeft: 0,
      });
      // Over it: the Teacher is not asked, and nothing is saved.
      expect(await course.askTeacher("c1", 2, "And C?", "ana")).toEqual({
        ok: false,
        reason: "questions-used-up",
        allowance: 100,
      });
      expect(calls("askTeacher")).toHaveLength(2);

      const lesson = await course.readLesson("c1", 2, ana);
      expect(lesson?.questionsLeft).toBe(0);
      expect(lesson?.chat).toHaveLength(4);
      // The other Course still has its own.
      expect((await course.readLesson("c2", 1, ana))?.questionsLeft).toBe(95);
    });
  });

  describe("the Example course", () => {
    it("has none, and stays read-only", async () => {
      await course.ensureExampleCourse();
      const path = await course.readCoursePath(EXAMPLE_COURSE_ID, ana);
      expect(path).toMatchObject({ lessonAllowance: null, lessonsUsedUp: false });
      expect(path?.finishedLessons.length).toBeGreaterThan(0);
      expect((await course.readLesson(EXAMPLE_COURSE_ID, 1, ana))?.questionsLeft).toBeNull();
      expect(await course.openLesson(EXAMPLE_COURSE_ID, 1, "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });
      expect(await course.askTeacher(EXAMPLE_COURSE_ID, 1, "Why?", "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });
    });
  });
});
