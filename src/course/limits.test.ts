import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import researchSearch from "@/teacher/fixtures/research-search-music-theory.json";
import researchStructure from "@/teacher/fixtures/research-structure-music-theory.json";
import { buyCourse } from "@/test/credits";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import {
  createCourseModule,
  DEFAULT_DAILY_LIMITS,
  DEFAULT_SPEND_LIMITS,
  type CourseModule,
  type DailyLimits,
  type SpendAlarm,
  type SpendAlert,
  type SpendLimits,
} from ".";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC after `at`: when today's limits reset. */
const nextMidnight = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));

describe("course: daily limits and the spend alarm", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;
  /** The day the module thinks it is; rows written by Postgres use the real clock. */
  let clock: Date;
  /** Alerts the operator received. */
  let alerts: SpendAlert[];

  const setUp = async ({
    replies = {},
    limits,
    spendLimits,
    spendAlarm = null,
  }: {
    replies?: FakeTeacherReplies;
    limits?: DailyLimits;
    spendLimits?: SpendLimits;
    spendAlarm?: SpendAlarm | null;
  } = {}) => {
    db = await createTestDb();
    clock = new Date();
    alerts = [];
    teacher = createFakeTeacher(replies, {
      recordCall: (call) => course.recordTeacherCall(call),
    });
    course = createCourseModule({
      db,
      teacher,
      fetchUrl: createFakeUrlFetcher(),
      limits,
      spendLimits,
      spendAlarm,
      now: () => clock,
    });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  };

  /** A bought Course credit and an Interview with only its first question answered. */
  const startInterview = async (learnerId: string, subject = "Music theory") => {
    await buyCourse(course, learnerId);
    const started = await course.startInterview({ subject, why: "To play better" }, learnerId);
    if ("reason" in started) throw new Error(`The Interview was refused: ${started.reason}.`);
    return started;
  };

  /** A finished Interview. */
  const interview = async (learnerId: string, subject = "Music theory") => {
    const started = await startInterview(learnerId, subject);
    await course.answerInterview(started.id, "A few chords", learnerId);
    await course.answerInterview(started.id, "Work out a song's chords", learnerId);
    await course.chooseSittingLength(started.id, 10, learnerId);
    return started.id;
  };

  /** Runs a job's steps the way the app does, until it stops. */
  const runToEnd = async (jobId: string) => {
    for (let i = 0; i < 10; i++) {
      if ((await course.runJobStep(jobId)) === "stop") return;
    }
    throw new Error("The job never stopped.");
  };

  /** Interview, "Write my course" and the Course creation job. */
  const writeAndPrepare = async (learnerId: string, subject?: string) => {
    const written = await course.writeCourse(await interview(learnerId, subject), learnerId);
    if (!written.ok || !written.jobId) throw new Error(`Not written: ${JSON.stringify(written)}`);
    await runToEnd(written.jobId);
    return written;
  };

  const calls = (op: FakeTeacher["calls"][number]["op"]) =>
    teacher.calls.filter((c) => c.op === op);

  const yesterday = () => new Date(Date.now() - DAY_MS);

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("are configuration, set by default to the spec's limits", () => {
    expect(DEFAULT_DAILY_LIMITS).toEqual({ newCourses: 1, lessonGenerations: 10, chatMessages: 60 });
  });

  describe("new Courses", () => {
    beforeEach(async () => {
      await setUp();
    });

    it("lets a Learner start one a day, then says when they can start another", async () => {
      await writeAndPrepare("ana");
      const second = await interview("ana", "Chess");

      expect(await course.writeCourse(second, "ana")).toEqual({
        ok: false,
        reason: "daily-limit",
        limit: 1,
        resetsAt: nextMidnight(clock),
      });
      // Nothing was written, and the Interview keeps for tomorrow.
      expect(calls("writeMission")).toHaveLength(1);
      expect(await course.listCourses("ana")).toHaveLength(1);
      expect(await course.readInterview(second, "ana")).toMatchObject({
        stage: "complete",
        courseId: null,
      });
    });

    it("counts each Learner's Courses apart", async () => {
      await writeAndPrepare("ana");
      await expect(writeAndPrepare("ben")).resolves.toMatchObject({ ok: true });
    });

    it("counts only today's Courses", async () => {
      await writeAndPrepare("ana");
      await db.update(schema.course).set({ createdAt: yesterday() });

      await expect(writeAndPrepare("ana", "Chess")).resolves.toMatchObject({ ok: true });
    });

    it("still returns a Course already written from the same Interview", async () => {
      const interviewId = await interview("ana");
      const first = await course.writeCourse(interviewId, "ana");

      expect(await course.writeCourse(interviewId, "ana")).toEqual(first);
    });

    it("does not count a Course whose research failed without finding Resources", async () => {
      await setUp({
        replies: {
          researchSearch: () => {
            throw new Error("The web search is down.");
          },
        },
      });
      const failed = await writeAndPrepare("ana");
      expect(await course.readCourseCreation(failed.courseId, "ana")).toMatchObject({
        status: "failed",
      });

      await expect(writeAndPrepare("ana", "Chess")).resolves.toMatchObject({ ok: true });
    });

    it("counts a Course whose research failed after it found Resources", async () => {
      await setUp({
        replies: {
          pickUpNext: () => {
            throw new Error("Up next failed.");
          },
        },
      });
      const failed = await writeAndPrepare("ana");
      expect(await course.readCourseCreation(failed.courseId, "ana")).toMatchObject({
        status: "failed",
      });

      expect(await course.writeCourse(await interview("ana", "Chess"), "ana")).toMatchObject({
        ok: false,
        reason: "daily-limit",
      });
      // Retrying it runs no new research, so it needs no room today.
      expect(await course.retryCourseCreation(failed.courseId, "ana")).toMatchObject({ ok: true });
    });

    it("lets a failed research run be retried only while today's limit has room", async () => {
      let searchDown = true;
      await setUp({
        replies: {
          researchSearch: () => {
            if (searchDown) throw new Error("The web search is down.");
            return researchSearch;
          },
          researchStructure,
        },
      });
      const failed = await writeAndPrepare("ana");
      // With no other Course today, the retry fits.
      expect(await course.retryCourseCreation(failed.courseId, "ana")).toMatchObject({ ok: true });
      await runToEnd(failed.jobId!);

      searchDown = false;
      await writeAndPrepare("ana", "Chess");

      expect(await course.retryCourseCreation(failed.courseId, "ana")).toEqual({
        ok: false,
        reason: "daily-limit",
        limit: 1,
        resetsAt: nextMidnight(clock),
      });
      expect(calls("researchSearch")).toHaveLength(3);
    });

    it("follows the configured limit", async () => {
      await setUp({ limits: { ...DEFAULT_DAILY_LIMITS, newCourses: 2 } });
      await writeAndPrepare("ana");
      await writeAndPrepare("ana", "Chess");

      expect(await course.writeCourse(await interview("ana", "Astronomy"), "ana")).toMatchObject({
        ok: false,
        reason: "daily-limit",
        limit: 2,
      });
    });
  });

  describe("Lesson generations", () => {
    let courseId: string;

    beforeEach(async () => {
      await setUp();
      courseId = (await writeAndPrepare("ana")).courseId;
      // Lesson 1 is Up next; add ten more, as if picked after earlier Finishes.
      await db.insert(schema.lesson).values(
        Array.from({ length: 10 }, (_, i) => ({
          courseId,
          index: i + 2,
          title: `Lesson ${i + 2}`,
          goal: "Name the next idea",
          minutes: 10,
        })),
      );
    });

    it("lets a Learner have ten Lessons written a day, then says when the next can be", async () => {
      for (let index = 1; index <= 10; index++) {
        expect(await course.openLesson(courseId, index, "ana")).toMatchObject({ ok: true, start: true });
      }

      expect(await course.openLesson(courseId, 11, "ana")).toEqual({
        ok: false,
        reason: "daily-limit",
        limit: 10,
        resetsAt: nextMidnight(clock),
      });
      expect(await course.retryLessonGeneration(courseId, 11, "ana")).toMatchObject({
        ok: false,
        reason: "daily-limit",
      });
      expect(await course.readLesson(courseId, 11, { learnerId: "ana" })).toMatchObject({
        generation: null,
      });
    });

    it("still opens Lessons already written or being written", async () => {
      const first = await course.openLesson(courseId, 1, "ana");
      if (!first.ok || !first.generation) throw new Error("Lesson 1 did not start.");
      await runToEnd(first.generation.jobId);
      for (let index = 2; index <= 10; index++) await course.openLesson(courseId, index, "ana");

      expect(await course.openLesson(courseId, 1, "ana")).toEqual({
        ok: true,
        generation: null,
        start: false,
      });
      expect(await course.openLesson(courseId, 5, "ana")).toMatchObject({ ok: true, start: true });
    });

    it("counts only today's", async () => {
      for (let index = 1; index <= 10; index++) await course.openLesson(courseId, index, "ana");
      await db.update(schema.job).set({ createdAt: yesterday() });

      expect(await course.openLesson(courseId, 11, "ana")).toMatchObject({ ok: true, start: true });
    });
  });

  describe("chat messages", () => {
    let courseId: string;

    beforeEach(async () => {
      await setUp();
      courseId = (await writeAndPrepare("ana")).courseId;
      const opened = await course.openLesson(courseId, 1, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Lesson 1 did not start.");
      await runToEnd(opened.generation.jobId);
    });

    it("lets a Learner ask sixty questions a day, then says when they can ask again", async () => {
      for (let i = 1; i <= 60; i++) {
        expect(await course.askTeacher(courseId, 1, `Question ${i}?`, "ana")).toMatchObject({
          ok: true,
        });
      }

      expect(await course.askTeacher(courseId, 1, "One more?", "ana")).toEqual({
        ok: false,
        reason: "daily-limit",
        limit: 60,
        resetsAt: nextMidnight(clock),
      });
      // The Teacher was not asked, and nothing was saved.
      expect(calls("askTeacher")).toHaveLength(60);
      expect(await db.select().from(schema.chatMessage)).toHaveLength(120);
    });

    it("counts only today's questions, in every Lesson", async () => {
      await setUp({ limits: { ...DEFAULT_DAILY_LIMITS, chatMessages: 2 } });
      courseId = (await writeAndPrepare("ana")).courseId;
      const opened = await course.openLesson(courseId, 1, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Lesson 1 did not start.");
      await runToEnd(opened.generation.jobId);

      await course.askTeacher(courseId, 1, "First?", "ana");
      await course.askTeacher(courseId, 1, "Second?", "ana");
      expect(await course.askTeacher(courseId, 1, "Third?", "ana")).toMatchObject({
        reason: "daily-limit",
        limit: 2,
      });

      await db.update(schema.chatMessage).set({ createdAt: yesterday() });
      expect(await course.askTeacher(courseId, 1, "Third?", "ana")).toMatchObject({ ok: true });
    });
  });

  /** The operator's inbox. */
  const operator: SpendAlarm = {
    notify: async (alert) => {
      alerts.push(alert);
    },
  };

  describe("spend", () => {
    /** An alarm at `alarmUsd` that tells the operator, and a stop far above it. */
    const alarmAt = (alarmUsd: number) => ({
      spendLimits: { alarmUsd, stopUsd: 100 },
      spendAlarm: operator,
    });

    it("records every call's tokens, web searches and cost", async () => {
      await setUp();
      await writeAndPrepare("ana");

      const recorded = await db.select().from(schema.teacherCall);
      expect(recorded.map((c) => c.operation).sort()).toEqual(
        teacher.calls.map((c) => c.op).sort(),
      );
      expect(recorded.find((c) => c.operation === "researchSearch")).toMatchObject({
        model: "fake",
        inputTokens: 0,
        outputTokens: 0,
        webSearches: 8,
        costUsd: 0.55,
      });
    });

    it("emails the operator once, when the day's spend crosses the threshold", async () => {
      await setUp(alarmAt(1));

      // A Course costs about $0.62 in the fake Teacher's measurements.
      await writeAndPrepare("ana");
      expect(alerts).toEqual([]);

      await writeAndPrepare("ben");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].day).toBe(clock.toISOString().slice(0, 10));
      expect(alerts[0].thresholdUsd).toBe(1);
      expect(alerts[0].stopUsd).toBe(100);
      expect(alerts[0].spentUsd).toBeGreaterThanOrEqual(1);
      expect(alerts[0].spentUsd).toBeLessThan(1.3);

      // More spend the same day sends nothing more.
      const opened = await course.openLesson((await course.listCourses("ana"))[0].id, 1, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Lesson 1 did not start.");
      await runToEnd(opened.generation.jobId);
      expect(calls("writeLesson")).toHaveLength(1);
      expect(alerts).toHaveLength(1);
    });

    it("alerts again on a later day", async () => {
      await setUp(alarmAt(0.5));
      await writeAndPrepare("ana");
      expect(alerts).toHaveLength(1);

      clock = new Date(clock.getTime() + DAY_MS);
      await writeAndPrepare("ben");

      expect(alerts.map((a) => a.day)).toEqual([
        new Date(clock.getTime() - DAY_MS).toISOString().slice(0, 10),
        clock.toISOString().slice(0, 10),
      ]);
    });

    it("tries again on the next call when the alert could not be sent", async () => {
      let down = true;
      await setUp({
        spendLimits: { alarmUsd: 0.5, stopUsd: 100 },
        spendAlarm: {
          notify: async (alert) => {
            if (down) throw new Error("Resend is down.");
            alerts.push(alert);
          },
        },
      });
      const failed = await course.writeCourse(await interview("ana"), "ana");
      if (!failed.ok || !failed.jobId) throw new Error("Not written.");
      // The research search takes spend past $0.50, but the alert fails.
      await course.runJobStep(failed.jobId);
      expect(alerts).toEqual([]);

      down = false;
      await runToEnd(failed.jobId);
      expect(alerts).toHaveLength(1);
    });

    it("never alerts without an alarm, but still records", async () => {
      await setUp({ spendAlarm: null });
      await writeAndPrepare("ana");

      expect(await db.select().from(schema.spendAlarm)).toEqual([]);
      expect((await db.select().from(schema.teacherCall)).length).toBeGreaterThan(0);
    });
  });

  describe("spend limits", () => {
    const spendLimits: SpendLimits = { alarmUsd: 1, stopUsd: 2 };
    const ana = { learnerId: "ana" };

    /** Records calls the Teacher made elsewhere today, costing `usd` in all. */
    const spent = (usd: number) =>
      course.recordTeacherCall({
        operation: "writeLesson",
        model: "fake",
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        webSearches: 0,
        costUsd: usd,
      });

    /** What `course` returns while the day's spend is past a limit. */
    const paused = () => ({ ok: false, reason: "paused", resumesAt: nextMidnight(clock) });

    /** Ana's Course, with Lesson 1 written and every question answered. About $0.66. */
    const readyToFinish = async () => {
      const { courseId } = await writeAndPrepare("ana");
      const opened = await course.openLesson(courseId, 1, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Lesson 1 did not start.");
      await runToEnd(opened.generation.jobId);
      const lesson = await course.readLesson(courseId, 1, ana);
      for (const i of lesson?.content?.quiz.keys() ?? []) {
        await course.answerQuestion(courseId, 1, i, 0, "ana");
      }
      return courseId;
    };

    const finish = async (courseId: string) => {
      const pressed = await course.finishLesson(courseId, 1, "ana");
      if (!pressed.ok) throw new Error(`Not finished: ${JSON.stringify(pressed)}`);
      await runToEnd(pressed.finishing.jobId);
      return course.readFinish(courseId, 1, "ana");
    };

    it("are configuration, set by default to an alarm at $20 and a stop at $40", () => {
      expect(DEFAULT_SPEND_LIMITS).toEqual({ alarmUsd: 20, stopUsd: 40 });
    });

    it("under both, sell and teach as usual", async () => {
      await setUp({ spendLimits });
      await spent(0.1);
      const courseId = await readyToFinish();

      expect(await course.readSalesPause()).toBeNull();
      await expect(startInterview("ana", "Chess")).resolves.toMatchObject({ stage: "know" });
      expect(await course.askTeacher(courseId, 1, "Why?", "ana")).toMatchObject({ ok: true });
      expect(await finish(courseId)).toMatchObject({ status: "done" });
    });

    it("between them, pause sales but let credits already bought start Interviews and Courses keep going", async () => {
      await setUp({ spendLimits, spendAlarm: operator });
      const courseId = await readyToFinish();
      const finished = await interview("ben", "Chess");
      const started = await startInterview("ana", "Astronomy");
      await buyCourse(course, "ben");
      await spent(0.4);
      expect(alerts).toHaveLength(1);

      // No Course credit is sold.
      expect(await course.readSalesPause()).toEqual(paused());

      // A credit already bought is paid for: its Interview starts.
      expect(
        await course.startInterview({ subject: "Drawing", why: "For fun" }, "ben"),
      ).toMatchObject({ stage: "know" });

      // An Interview already started goes on, and a finished one is written.
      expect(await course.answerInterview(started.id, "Nothing yet", "ana")).toMatchObject({
        stage: "success",
      });
      const written = await course.writeCourse(finished, "ben");
      if (!written.ok || !written.jobId) throw new Error(`Not written: ${JSON.stringify(written)}`);
      await runToEnd(written.jobId);
      expect(await course.readCourseCreation(written.courseId, "ben")).toMatchObject({
        status: "done",
      });

      // Ana's Course keeps teaching.
      expect(await course.askTeacher(courseId, 1, "Why?", "ana")).toMatchObject({ ok: true });
      expect(await finish(courseId)).toMatchObject({ status: "done" });
    });

    it("over both, refuse everything that calls the Teacher until midnight, and keep everything readable", async () => {
      await setUp({ spendLimits });
      const courseId = await readyToFinish();
      const [lesson1] = await db.select({ id: schema.lesson.id }).from(schema.lesson);
      // An unwritten Lesson 2 Up next, and a Mission change that would re-pick it.
      await db.insert(schema.lesson).values({
        courseId,
        index: 2,
        title: "Lesson 2",
        goal: "Name the next idea",
        minutes: 10,
      });
      const [proposal] = await db
        .insert(schema.proposal)
        .values({
          courseId,
          lessonId: lesson1.id,
          kind: "mission_change",
          source: "chat",
          reason: "You want to write your own songs now.",
          mission: {
            why: "To write my own songs",
            success: ["Write a verse and chorus"],
            constraints: ["10 minutes per sitting"],
            outOfScope: [],
            record: { title: "Now writing songs", body: "Ana wants to write her own songs." },
          },
        })
        .returning({ id: schema.proposal.id });
      const finished = await interview("ben", "Chess");
      const started = await startInterview("ana", "Astronomy");
      await buyCourse(course, "ben");
      await spent(2);
      const asked = teacher.calls.length;

      expect(await course.startInterview({ subject: "Drawing", why: "For fun" }, "ben")).toEqual(
        paused(),
      );
      expect(await course.answerInterview(started.id, "Nothing yet", "ana")).toEqual(paused());
      expect(await course.writeCourse(finished, "ben")).toEqual(paused());
      expect(await course.openLesson(courseId, 2, "ana")).toEqual(paused());
      expect(await course.retryLessonGeneration(courseId, 2, "ana")).toEqual(paused());
      expect(await course.askTeacher(courseId, 1, "Why?", "ana")).toEqual(paused());
      expect(await course.finishLesson(courseId, 1, "ana")).toEqual(paused());
      expect(await course.confirmProposal(courseId, proposal.id, "ana")).toEqual(paused());

      // The Teacher was not asked, and nothing was saved or started.
      expect(teacher.calls).toHaveLength(asked);
      expect(await course.readInterview(started.id, "ana")).toMatchObject({ stage: "know" });
      expect(await course.listCourses("ben")).toEqual([]);
      expect(await db.select().from(schema.job)).toHaveLength(2);
      expect(await db.select().from(schema.chatMessage)).toEqual([]);

      // Everything already written stays readable.
      expect(await course.readCoursePath(courseId, ana)).toMatchObject({
        upNext: { index: 1 },
        proposals: [{ id: proposal.id }],
      });
      expect((await course.readLesson(courseId, 1, ana))?.content).not.toBeNull();
      expect((await course.readResources(courseId, ana))?.resources.length).toBeGreaterThan(0);
      expect(await course.readReferenceSheet(courseId, ana)).not.toBeNull();
    });

    it("pause a Course creation job at its step, to resume from it once the day resets", async () => {
      await setUp({ spendLimits });
      const written = await course.writeCourse(await interview("ana"), "ana");
      if (!written.ok || !written.jobId) throw new Error(`Not written: ${JSON.stringify(written)}`);
      const { courseId, jobId } = written;
      expect(await course.runJobStep(jobId)).toBe("more");
      await spent(2);

      expect(await course.runJobStep(jobId)).toBe("stop");
      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({
        status: "paused",
        resumesAt: nextMidnight(clock),
      });
      expect(await db.select().from(schema.job)).toMatchObject([
        { status: "failed", step: "structure" },
      ]);
      expect(calls("researchStructure")).toEqual([]);
      // Not before midnight.
      expect(await course.retryCourseCreation(courseId, "ana")).toEqual(paused());

      clock = new Date(clock.getTime() + DAY_MS);
      expect(await course.retryCourseCreation(courseId, "ana")).toEqual({ ok: true, jobId });
      await runToEnd(jobId);

      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({
        status: "done",
        resumesAt: null,
      });
      // It picked up at the structure step: the search was not run again.
      expect(calls("researchSearch")).toHaveLength(1);
    });

    it("pause Lesson writing the same way", async () => {
      await setUp({ spendLimits });
      const { courseId } = await writeAndPrepare("ana");
      const opened = await course.openLesson(courseId, 1, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Lesson 1 did not start.");
      await spent(2);

      expect(await course.runJobStep(opened.generation.jobId)).toBe("stop");
      expect(await course.openLesson(courseId, 1, "ana")).toMatchObject({
        ok: true,
        generation: { status: "paused", resumesAt: nextMidnight(clock) },
        start: false,
      });
      expect(await course.retryLessonGeneration(courseId, 1, "ana")).toEqual(paused());

      clock = new Date(clock.getTime() + DAY_MS);
      expect(await course.retryLessonGeneration(courseId, 1, "ana")).toMatchObject({ ok: true });
      await runToEnd(opened.generation.jobId);
      expect((await course.readLesson(courseId, 1, ana))?.content).not.toBeNull();
    });
  });
});
