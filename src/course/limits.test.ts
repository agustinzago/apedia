import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import researchSearch from "@/teacher/fixtures/research-search-music-theory.json";
import researchStructure from "@/teacher/fixtures/research-structure-music-theory.json";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import {
  createCourseModule,
  DEFAULT_DAILY_LIMITS,
  type CourseModule,
  type DailyLimits,
  type SpendAlarm,
  type SpendAlert,
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
    spendAlarm = null,
  }: {
    replies?: FakeTeacherReplies;
    limits?: DailyLimits;
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
      spendAlarm,
      now: () => clock,
    });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  };

  /** A finished Interview, claimed by the Learner. */
  const interview = async (learnerId: string, subject = "Music theory") => {
    const started = await course.startInterview({ subject, why: "To play better" });
    await course.answerInterview(started.id, "A few chords");
    await course.answerInterview(started.id, "Work out a song's chords");
    await course.chooseSittingLength(started.id, 10);
    await course.claimInterview(started.id, learnerId);
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

  describe("spend", () => {
    const alarmAt = (thresholdUsd: number): SpendAlarm => ({
      thresholdUsd,
      notify: async (alert) => {
        alerts.push(alert);
      },
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
      await setUp({ spendAlarm: alarmAt(1) });

      // A Course costs about $0.62 in the fake Teacher's measurements.
      await writeAndPrepare("ana");
      expect(alerts).toEqual([]);

      await writeAndPrepare("ben");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].day).toBe(clock.toISOString().slice(0, 10));
      expect(alerts[0].thresholdUsd).toBe(1);
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
      await setUp({ spendAlarm: alarmAt(0.5) });
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
        spendAlarm: {
          thresholdUsd: 0.5,
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
});
