import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import type { Teacher } from "@/teacher";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import followUpVague from "@/teacher/fixtures/follow-up-vague.json";
import missionEs from "@/teacher/fixtures/mission-es.json";
import missionMusicTheory from "@/teacher/fixtures/mission-music-theory.json";
import researchSearch from "@/teacher/fixtures/research-search-music-theory.json";
import researchStructure from "@/teacher/fixtures/research-structure-music-theory.json";
import safetyAllowEs from "@/teacher/fixtures/safety-allow-es.json";
import safetyRedirect from "@/teacher/fixtures/safety-redirect.json";
import upNext from "@/teacher/fixtures/up-next-music-theory.json";
import { buyCourse, refundCourse } from "@/test/credits";
import { createTestDb } from "@/test/db";
import {
  createCourseModule,
  type CourseModule,
  type InterviewView,
  type NoCourseCredit,
  type SpendPaused,
} from ".";

/** The Interview itself, not a refusal: these Learners hold a credit and nothing is spent. */
function going<T>(result: T | SpendPaused | NoCourseCredit): T {
  if (result !== null && typeof result === "object" && "reason" in result) {
    throw new Error(`The Interview was refused: ${result.reason}.`);
  }
  return result;
}

const start = async (
  course: CourseModule,
  input: { subject: string; why: string },
  learnerId = "ana",
) => going(await course.startInterview(input, learnerId));

const answer = async (course: CourseModule, interviewId: string, text: string, learnerId = "ana") =>
  going(await course.answerInterview(interviewId, text, learnerId));

describe("course: the Interview, from subject to Course", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;

  const setUp = async (replies: FakeTeacherReplies = {}) => {
    db = await createTestDb();
    teacher = createFakeTeacher(replies);
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
    await buyCourse(course, "ana");
  };

  /** Answers all four questions as Ana; returns the Interview id. */
  const interviewAbout = async (subject = "Music theory") => {
    const started = await start(course, {
      subject,
      why: "To understand the songs I already play on guitar",
    });
    await course.answerInterview(started.id, "I can strum G, C, D, Em and Am from chord charts", "ana");
    await course.answerInterview(started.id, "Work out the chords of a song myself", "ana");
    await course.chooseSittingLength(started.id, 10, "ana");
    return started.id;
  };

  beforeEach(async () => {
    await setUp();
  });

  it("asks four questions in order, the last with sitting-length chips, and stores them for the Learner", async () => {
    const started = await start(course, {
      subject: "Music theory",
      why: "To understand the songs I already play on guitar",
    });

    expect(started).toMatchObject({
      stage: "know",
      questionNumber: 2,
      courseId: null,
      backed: true,
    });
    expect(started.messages.map((m) => m.from)).toEqual([
      "teacher",
      "learner",
      "teacher",
      "learner",
      "teacher",
    ]);
    expect(started.messages[2].text).toMatch(/^Why do you want to learn Music theory\?/);
    expect(started.messages[4].text).toMatch(/^What do you already know about it\?/);

    const third = await answer(course, started.id, "A few open chords");
    expect(third).toMatchObject({ stage: "success", questionNumber: 3 });
    expect(third?.messages.at(-1)?.text).toMatch(/a month from now/);

    const fourth = await answer(course, started.id, "Work out a song's chords");
    expect(fourth).toMatchObject({ stage: "sitting", questionNumber: 4 });
    expect(fourth?.messages.at(-1)?.text).toBe("Last question. How long is one sitting?");

    const done = going(await course.chooseSittingLength(started.id, 20, "ana"));
    expect(done).toMatchObject({ stage: "complete", questionNumber: null });
    expect(done?.messages.at(-1)).toEqual({ from: "learner", text: "20 minutes" });

    const [row] = await db.select().from(schema.interview);
    expect(row).toMatchObject({
      learnerId: "ana",
      subject: "Music theory",
      language: "en",
      why: "To understand the songs I already play on guitar",
      know: "A few open chords",
      success: "Work out a song's chords",
      sittingMinutes: 20,
    });
  });

  it("offers only 5, 10, 20 and 30 minute sittings", async () => {
    const started = await start(course, { subject: "Chess", why: "Beat my brother" });
    await course.answerInterview(started.id, "The moves", "ana");
    await course.answerInterview(started.id, "Win a game", "ana");

    await expect(course.chooseSittingLength(started.id, 15, "ana")).rejects.toThrow(RangeError);
  });

  it("writes a Course with its Mission and prior-knowledge record", async () => {
    await setUp({ writeMission: missionMusicTheory });
    const interviewId = await interviewAbout();

    const written = await course.writeCourse(interviewId, "ana");

    expect(written.ok).toBe(true);
    const courseId = written.ok ? written.courseId : "";
    const path = await course.readCoursePath(courseId, { learnerId: "ana" });
    expect(path).toMatchObject({
      subject: "Music theory",
      title: "Music theory for the guitar you already play",
      isExample: false,
      status: "active",
      preparing: true,
      finishedLessons: [],
      upNext: null,
      mission: {
        why: "Understand the songs I already play on guitar, so they stop feeling like memorised shapes.",
        success: [
          "Explain why the chords of a song belong to the same key",
          "Work out the chords of a key from its major scale",
        ],
        constraints: ["10 minutes per sitting", "Learns on guitar only; no piano at home"],
        sittingMinutes: 10,
        outOfScope: [],
      },
    });
    expect(path?.learningRecords).toEqual([
      expect.objectContaining({
        number: 1,
        kind: "prior_knowledge",
        title: "Plays open chords from chord charts",
        superseded: false,
      }),
    ]);

    const [row] = await db.select().from(schema.course).where(eq(schema.course.id, courseId));
    expect(row).toMatchObject({ learnerId: "ana", language: "en", interviewId });
    expect(await course.listCourses("ana")).toHaveLength(1);
    expect(await course.readInterview(interviewId, "ana")).toMatchObject({ courseId, backed: true });
  });

  it("gives the Teacher every answer when writing the Mission", async () => {
    const interviewId = await interviewAbout();
    await course.writeCourse(interviewId, "ana");

    expect(teacher.calls.filter((c) => c.op === "writeMission")).toEqual([
      {
        op: "writeMission",
        input: {
          subject: "Music theory",
          language: "en",
          why: "To understand the songs I already play on guitar",
          know: "I can strum G, C, D, Em and Am from chord charts",
          success: "Work out the chords of a song myself",
          sittingMinutes: 10,
        },
      },
    ]);
  });

  it("always includes the sitting length in the Mission's constraints", async () => {
    await setUp({
      writeMission: { ...missionMusicTheory, constraints: ["Learns on guitar only"] },
    });
    const interviewId = await interviewAbout();
    const written = await course.writeCourse(interviewId, "ana");

    const path = await course.readCoursePath(written.ok ? written.courseId : "", {
      learnerId: "ana",
    });
    expect(path?.mission.constraints).toEqual(["10 minutes per sitting", "Learns on guitar only"]);
  });

  it("holds the Interview and the Course in the language the Learner writes in", async () => {
    await setUp({
      checkSafety: safetyAllowEs,
      interviewFollowUp: (input) => ({
        followUp: null,
        nextQuestion: `[es] ${input.nextQuestion}`,
      }),
      writeMission: missionEs,
    });

    const started = await start(course, {
      subject: "Ajedrez",
      why: "Quiero ganarle a mi hermano los domingos",
    });
    expect(started.messages.at(-1)?.text).toMatch(/^\[es\] What do you already know/);
    expect(teacher.calls[1]).toMatchObject({ op: "interviewFollowUp", input: { language: "es" } });

    await course.answerInterview(started.id, "Sé mover las piezas", "ana");
    await course.answerInterview(started.id, "Ganarle una partida", "ana");
    await course.chooseSittingLength(started.id, 20, "ana");
    const written = await course.writeCourse(started.id, "ana");

    const [row] = await db
      .select()
      .from(schema.course)
      .where(eq(schema.course.id, written.ok ? written.courseId : ""));
    expect(row).toMatchObject({
      subject: "Ajedrez",
      language: "es",
      title: "Ajedrez para ganarle a mi hermano",
      missionConstraints: ["20 minutos por sesión"],
      sittingMinutes: 20,
    });
  });

  it("writes one Course per Interview, however often Write my course is pressed", async () => {
    const interviewId = await interviewAbout();

    const first = await course.writeCourse(interviewId, "ana");
    const again = await course.writeCourse(interviewId, "ana");

    expect(again).toEqual(first);
    expect(await db.$count(schema.course)).toBe(1);
    expect(await db.$count(schema.learningRecord)).toBe(1);
    expect(teacher.calls.filter((c) => c.op === "writeMission")).toHaveLength(1);
  });

  it("keeps an Interview to its Learner, and writes a Course only from a finished one", async () => {
    const interviewId = await interviewAbout();

    expect(await course.readInterview(interviewId, "ana")).not.toBeNull();
    expect(await course.readInterview(interviewId, null)).toBeNull();
    expect(await course.readInterview(interviewId, "ben")).toBeNull();
    expect(await course.answerInterview(interviewId, "Me too", "ben")).toBeNull();
    expect(await course.chooseSittingLength(interviewId, 5, "ben")).toBeNull();
    expect(await course.writeCourse(interviewId, "ben")).toEqual({
      ok: false,
      reason: "not-yours",
    });
    expect(await course.writeCourse("no-such-interview", "ana")).toEqual({
      ok: false,
      reason: "not-found",
    });

    await buyCourse(course, "ana");
    const unfinished = await start(course, { subject: "Chess", why: "Beat my brother" });
    expect(await course.writeCourse(unfinished.id, "ana")).toEqual({
      ok: false,
      reason: "not-finished",
    });
    expect(await db.$count(schema.course)).toBe(0);
  });

  it("deletes a Learner's Interviews with the Learner", async () => {
    const interviewId = await interviewAbout();
    await course.writeCourse(interviewId, "ana");

    await db.delete(schema.learner).where(eq(schema.learner.id, "ana"));

    expect(await db.$count(schema.interview)).toBe(0);
    expect(await db.$count(schema.course)).toBe(0);
  });
});

describe("course: a harmful subject at Interview start", () => {
  it("shows a kind redirect, runs nothing else and uses no Course credit", async () => {
    const db = await createTestDb();
    const teacher = createFakeTeacher({ checkSafety: safetyRedirect });
    const course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });
    await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
    await buyCourse(course, "ana");

    const started = await start(course, {
      subject: "Making explosives",
      why: "To hurt someone",
    });

    expect(started).toMatchObject({ stage: "redirected", questionNumber: null, backed: false });
    expect(started.messages.at(-1)).toEqual({ from: "teacher", text: safetyRedirect.message });
    expect(teacher.calls.map((c) => c.op)).toEqual(["checkSafety"]);
    expect(teacher.calls[0]).toEqual({
      op: "checkSafety",
      input: { subject: "Making explosives", why: "To hurt someone" },
    });

    // The Interview cannot be carried on or written.
    expect(await course.answerInterview(started.id, "Please", "ana")).toMatchObject({
      stage: "redirected",
    });
    expect(await course.writeCourse(started.id, "ana")).toEqual({
      ok: false,
      reason: "not-finished",
    });
    expect(teacher.calls.map((c) => c.op)).toEqual(["checkSafety"]);
    expect(await db.$count(schema.course)).toBe(0);

    // The credit is untouched, free for another Interview.
    expect(await course.readCourseCredits("ana")).toEqual({ available: 1, used: 0, refunded: 0 });
    expect(await course.readInterviewStart("ana")).toEqual({
      creditsToStart: 1,
      openInterviews: [],
    });
  });
});

describe("course: Course credits back Interviews", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;

  const setUp = async (replies: FakeTeacherReplies = {}) => {
    db = await createTestDb();
    teacher = createFakeTeacher({
      researchSearch,
      researchStructure,
      pickUpNext: upNext,
      ...replies,
    });
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  };

  const chess = { subject: "Chess", why: "To beat my brother on Sundays" };

  /** Answers the remaining questions of a started Interview. */
  const finish = async (interviewId: string) => {
    await course.answerInterview(interviewId, "How the pieces move", "ana");
    await course.answerInterview(interviewId, "Win a game against him", "ana");
    return course.chooseSittingLength(interviewId, 10, "ana");
  };

  /** Interview and "Write my course" as Ana; returns the Course creation job's ids. */
  const writeCourse = async () => {
    const started = await start(course, chess);
    await finish(started.id);
    const written = await course.writeCourse(started.id, "ana");
    if (!written.ok || !written.jobId) throw new Error(`Not written: ${JSON.stringify(written)}`);
    return { interviewId: started.id, courseId: written.courseId, jobId: written.jobId };
  };

  const runToEnd = async (jobId: string) => {
    for (let i = 0; i < 10; i++) {
      if ((await course.runJobStep(jobId)) === "stop") return;
    }
    throw new Error("The job never stopped.");
  };

  const credits = () => course.readCourseCredits("ana");

  beforeEach(async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses to start an Interview without one, before asking the Teacher anything", async () => {
    expect(await course.startInterview(chess, "ana")).toEqual({ ok: false, reason: "no-credit" });

    expect(teacher.calls).toEqual([]);
    expect(await db.$count(schema.interview)).toBe(0);
    expect(await course.readInterviewStart("ana")).toEqual({
      creditsToStart: 0,
      openInterviews: [],
    });
  });

  it("uses exactly one credit for an Interview and its Course, however often Write my course is pressed", async () => {
    await buyCourse(course, "ana");
    await buyCourse(course, "ana");
    const started = await start(course, chess);

    // The Interview reserves one credit; the other is still free.
    expect(await credits()).toEqual({ available: 2, used: 0, refunded: 0 });
    expect(await course.readInterviewStart("ana")).toEqual({
      creditsToStart: 1,
      openInterviews: [{ id: started.id, subject: "Chess", stage: "know" }],
    });

    await finish(started.id);
    const [first, again] = await Promise.all([
      course.writeCourse(started.id, "ana"),
      course.writeCourse(started.id, "ana"),
    ]);

    expect(again).toEqual(first);
    expect(await course.writeCourse(started.id, "ana")).toEqual(first);
    expect(await credits()).toEqual({ available: 1, used: 1, refunded: 0 });
    expect(await course.readInterviewStart("ana")).toEqual({
      creditsToStart: 1,
      openInterviews: [],
    });
    expect(await course.listCourses("ana")).toHaveLength(1);
  });

  it("lets two Interviews never share one credit, even started at once", async () => {
    await buyCourse(course, "ana");

    const [one, two] = await Promise.all([
      course.startInterview(chess, "ana"),
      course.startInterview({ subject: "Astronomy", why: "To name the stars" }, "ana"),
    ]);

    const refused = [one, two].filter((r) => "reason" in r);
    expect(refused).toEqual([{ ok: false, reason: "no-credit" }]);
    expect(await db.$count(schema.interview)).toBe(1);
    expect(await course.startInterview(chess, "ana")).toEqual({ ok: false, reason: "no-credit" });

    // Another credit starts another Interview.
    await buyCourse(course, "ana");
    expect(await start(course, chess)).toMatchObject({ stage: "know" });
    expect(await course.readInterviewStart("ana")).toMatchObject({ creditsToStart: 0 });
    expect((await course.readInterviewStart("ana")).openInterviews).toHaveLength(2);
  });

  it("keeps each Learner's credits to their own Interviews", async () => {
    await buyCourse(course, "ben");

    expect(await course.startInterview(chess, "ana")).toEqual({ ok: false, reason: "no-credit" });
    expect(await start(course, chess, "ben")).toMatchObject({ stage: "know" });
  });

  it("lets the Learner leave an open Interview and come back to it", async () => {
    await buyCourse(course, "ana");
    const started = await start(course, chess);

    const [open] = (await course.readInterviewStart("ana")).openInterviews;
    expect(await course.readInterview(open.id, "ana")).toMatchObject({
      subject: "Chess",
      stage: "know",
      backed: true,
    });
    expect(await answer(course, started.id, "How the pieces move")).toMatchObject({
      stage: "success",
    });
  });

  it("frees the credit of an Interview the Learner discards", async () => {
    await buyCourse(course, "ana");
    const started = await start(course, chess);

    expect(await course.discardInterview(started.id, "ben")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await course.discardInterview(started.id, "ana")).toEqual({ ok: true });

    expect(await course.readInterview(started.id, "ana")).toBeNull();
    expect(await course.readInterviewStart("ana")).toEqual({
      creditsToStart: 1,
      openInterviews: [],
    });
    expect(await start(course, { subject: "Astronomy", why: "To name the stars" })).toMatchObject({
      stage: "know",
    });
  });

  it("never discards an Interview a Course was written from", async () => {
    await buyCourse(course, "ana");
    const { interviewId } = await writeCourse();

    expect(await course.discardInterview(interviewId, "ana")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await credits()).toEqual({ available: 0, used: 1, refunded: 0 });
  });

  it("stops an open Interview whose credit is refunded", async () => {
    const paymentId = await buyCourse(course, "ana");
    const started = await start(course, chess);
    await refundCourse(course, paymentId);
    const asked = teacher.calls.length;

    expect(await course.answerInterview(started.id, "How the pieces move", "ana")).toEqual({
      ok: false,
      reason: "no-credit",
    });
    expect(teacher.calls).toHaveLength(asked);
    expect(await course.readInterview(started.id, "ana")).toMatchObject({
      stage: "know",
      backed: false,
    });
    expect(await course.readInterviewStart("ana")).toEqual({
      creditsToStart: 0,
      openInterviews: [],
    });
    expect(await credits()).toEqual({ available: 0, used: 0, refunded: 1 });
  });

  it("writes no Course for a finished Interview whose credit is refunded", async () => {
    const paymentId = await buyCourse(course, "ana");
    const started = await start(course, chess);
    await course.answerInterview(started.id, "How the pieces move", "ana");
    await course.answerInterview(started.id, "Win a game against him", "ana");
    await refundCourse(course, paymentId);

    expect(await course.chooseSittingLength(started.id, 10, "ana")).toEqual({
      ok: false,
      reason: "no-credit",
    });
    await db.update(schema.interview).set({ stage: "complete", sittingMinutes: 10 });
    expect(await course.writeCourse(started.id, "ana")).toEqual({
      ok: false,
      reason: "no-credit",
    });
    expect(teacher.calls.filter((c) => c.op === "writeMission")).toEqual([]);
    expect(await db.$count(schema.course)).toBe(0);
  });

  it("writes no Course when the credit is refunded while the Mission is being written", async () => {
    const paymentId = await buyCourse(course, "ana");
    const fake = createFakeTeacher();
    const refunding: Teacher = {
      ...fake,
      writeMission: async (input) => {
        await refundCourse(course, paymentId);
        return fake.writeMission(input);
      },
    };
    course = createCourseModule({ db, teacher: refunding, fetchUrl: createFakeUrlFetcher() });
    const started = await start(course, chess);
    await finish(started.id);

    expect(await course.writeCourse(started.id, "ana")).toEqual({
      ok: false,
      reason: "no-credit",
    });
    expect(await db.$count(schema.course)).toBe(0);
    expect(await db.$count(schema.job)).toBe(0);
    expect(await credits()).toEqual({ available: 0, used: 0, refunded: 1 });
  });

  describe("when Course creation fails", () => {
    it("gives the credit back once the Learner gives up on a Course that found no Resources", async () => {
      await setUp({
        researchSearch: () => {
          throw new Error("The web search is down.");
        },
      });
      await buyCourse(course, "ana");
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);
      expect(await credits()).toEqual({ available: 0, used: 1, refunded: 0 });
      expect(await course.readCoursePath(courseId, { learnerId: "ana" })).toMatchObject({
        creation: { status: "failed" },
        givesCreditBack: true,
      });

      // Trying again keeps the credit with the Course.
      expect(await course.retryCourseCreation(courseId, "ana")).toMatchObject({ ok: true });
      await runToEnd(jobId);
      expect(await credits()).toEqual({ available: 0, used: 1, refunded: 0 });

      // Giving up returns it, to start again or be refunded.
      expect(await course.deleteCourse(courseId, "ana")).toEqual({ ok: true });
      expect(await credits()).toEqual({ available: 1, used: 0, refunded: 0 });
      expect(await course.readInterviewStart("ana")).toEqual({
        creditsToStart: 1,
        openInterviews: [],
      });
      expect(await start(course, chess)).toMatchObject({ stage: "know" });
    });

    it("keeps the credit used for a Course that found Resources before failing", async () => {
      await setUp({
        pickUpNext: () => {
          throw new Error("Up next failed.");
        },
      });
      await buyCourse(course, "ana");
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);
      expect(await course.readCoursePath(courseId, { learnerId: "ana" })).toMatchObject({
        creation: { status: "failed" },
        givesCreditBack: false,
      });

      await course.deleteCourse(courseId, "ana");

      expect(await credits()).toEqual({ available: 0, used: 1, refunded: 0 });
    });

    it("keeps the credit used for a Course still being prepared, or prepared", async () => {
      await buyCourse(course, "ana");
      await buyCourse(course, "ana");
      const preparing = await writeCourse();
      expect(await course.readCoursePath(preparing.courseId, { learnerId: "ana" })).toMatchObject({
        creation: { status: "working" },
        givesCreditBack: false,
      });
      await course.deleteCourse(preparing.courseId, "ana");

      const prepared = await writeCourse();
      await runToEnd(prepared.jobId);
      await course.deleteCourse(prepared.courseId, "ana");

      expect(await credits()).toEqual({ available: 0, used: 2, refunded: 0 });
    });

    it("marks a given-back credit refunded if its payment was refunded meanwhile", async () => {
      await setUp({
        researchSearch: () => {
          throw new Error("The web search is down.");
        },
      });
      const paymentId = await buyCourse(course, "ana");
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);
      await refundCourse(course, paymentId);
      expect(await credits()).toEqual({ available: 0, used: 1, refunded: 0 });

      await course.deleteCourse(courseId, "ana");

      expect(await credits()).toEqual({ available: 0, used: 0, refunded: 1 });
    });
  });
});

describe("course: the Interview's one follow-up", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;

  const newCourse = async (replies: FakeTeacherReplies) => {
    teacher = createFakeTeacher(replies);
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });
    await buyCourse(course, "ana");
  };

  beforeEach(async () => {
    db = await createTestDb();
    await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
    // This Teacher finds every answer vague.
    await newCourse({
      interviewFollowUp: (input) => ({
        followUp: "Could you tell me a little more?",
        nextQuestion: input.nextQuestion,
      }),
    });
  });

  it("asks one follow-up for a vague answer, then moves on", async () => {
    const started = await start(course, { subject: "Chess", why: "idk" });

    expect(started).toMatchObject({ stage: "why", questionNumber: 1 });
    expect(started.messages.at(-1)).toEqual({
      from: "teacher",
      text: "Could you tell me a little more?",
    });

    const next = await answer(course, started.id, "To beat my brother on Sundays");
    expect(next).toMatchObject({ stage: "know", questionNumber: 2 });
    expect(next?.messages.at(-1)?.text).toMatch(/^What do you already know/);
    expect(teacher.calls.at(-1)).toMatchObject({
      op: "interviewFollowUp",
      input: { question: "Could you tell me a little more?", mayFollowUp: false },
    });

    const [row] = await db.select().from(schema.interview);
    expect(row.why).toBe("idk\nTo beat my brother on Sundays");
  });

  it("never asks a second follow-up, even for more vague answers", async () => {
    const started = await start(course, { subject: "Chess", why: "idk" });
    await course.answerInterview(started.id, "fun", "ana");
    const third = await answer(course, started.id, "");
    const fourth: InterviewView | null = await answer(course, started.id, "stuff");

    expect(third).toMatchObject({ stage: "success" });
    expect(fourth).toMatchObject({ stage: "sitting" });
    const followUps = fourth!.messages.filter((m) => m.text === "Could you tell me a little more?");
    expect(followUps).toHaveLength(1);
    expect(
      teacher.calls.filter((c) => c.op === "interviewFollowUp").map((c) => c.input.mayFollowUp),
    ).toEqual([true, false, false, false]);
  });

  it("asks the follow-up on a later question when the first answers were clear", async () => {
    const replies = [null, null, followUpVague.followUp];
    await newCourse({
      interviewFollowUp: (input) => ({
        followUp: replies.shift() ?? null,
        nextQuestion: input.nextQuestion,
      }),
    });

    const started = await start(course, { subject: "Chess", why: "Beat my brother" });
    await course.answerInterview(started.id, "The moves", "ana");
    const vague = await answer(course, started.id, "be good");

    expect(vague).toMatchObject({ stage: "success", questionNumber: 3 });
    expect(vague?.messages.at(-1)?.text).toBe(followUpVague.followUp);

    const done = await answer(course, started.id, "Win one game against him");
    expect(done).toMatchObject({ stage: "sitting" });
  });

  it("does not ask a follow-up when the Teacher finds the answer clear", async () => {
    await newCourse({});

    const started = await start(course, { subject: "Chess", why: "Beat my brother" });

    expect(started).toMatchObject({ stage: "know" });
  });
});
