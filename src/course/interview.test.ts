import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import followUpVague from "@/teacher/fixtures/follow-up-vague.json";
import missionEs from "@/teacher/fixtures/mission-es.json";
import missionMusicTheory from "@/teacher/fixtures/mission-music-theory.json";
import safetyAllowEs from "@/teacher/fixtures/safety-allow-es.json";
import safetyRedirect from "@/teacher/fixtures/safety-redirect.json";
import { createTestDb } from "@/test/db";
import { createCourseModule, type CourseModule, type SpendPaused } from ".";

/** Nothing is spent in these tests, so the spend limits never pause the Interview. */
function unpaused<T>(result: T | SpendPaused): T {
  if (result !== null && typeof result === "object" && "reason" in result) {
    throw new Error("The Interview was paused.");
  }
  return result;
}

const start = async (course: CourseModule, input: { subject: string; why: string }) =>
  unpaused(await course.startInterview(input));

const answer = async (course: CourseModule, interviewId: string, text: string) =>
  unpaused(await course.answerInterview(interviewId, text));

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
  };

  /** Answers all four questions; returns the Interview id. */
  const interviewAbout = async (subject = "Music theory") => {
    const started = await start(course, {
      subject,
      why: "To understand the songs I already play on guitar",
    });
    await course.answerInterview(started.id, "I can strum G, C, D, Em and Am from chord charts");
    await course.answerInterview(started.id, "Work out the chords of a song myself");
    await course.chooseSittingLength(started.id, 10);
    return started.id;
  };

  beforeEach(async () => {
    await setUp();
  });

  it("asks four questions in order, the last with sitting-length chips, and stores them anonymously", async () => {
    const started = await start(course, {
      subject: "Music theory",
      why: "To understand the songs I already play on guitar",
    });

    expect(started).toMatchObject({ stage: "know", questionNumber: 2, courseId: null });
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

    const done = await course.chooseSittingLength(started.id, 20);
    expect(done).toMatchObject({ stage: "complete", questionNumber: null });
    expect(done?.messages.at(-1)).toEqual({ from: "learner", text: "20 minutes" });

    const [row] = await db.select().from(schema.interview);
    expect(row).toMatchObject({
      learnerId: null,
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
    await course.answerInterview(started.id, "The moves");
    await course.answerInterview(started.id, "Win a game");

    await expect(course.chooseSittingLength(started.id, 15)).rejects.toThrow(RangeError);
  });

  it("claims the Interview at sign-in and writes a Course with its Mission and prior-knowledge record", async () => {
    await setUp({ writeMission: missionMusicTheory });
    const interviewId = await interviewAbout();

    expect(await course.claimInterview(interviewId, "ana")).toBe("claimed");
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
    expect(await course.readInterview(interviewId, "ana")).toMatchObject({ courseId });
  });

  it("gives the Teacher every answer when writing the Mission", async () => {
    const interviewId = await interviewAbout();
    await course.claimInterview(interviewId, "ana");
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
    await course.claimInterview(interviewId, "ana");
    const written = await course.writeCourse(interviewId, "ana");

    const path = await course.readCoursePath(written.ok ? written.courseId : "", {
      learnerId: "ana",
    });
    expect(path?.mission.constraints).toEqual(["10 minutes per sitting", "Learns on guitar only"]);
  });

  it("holds the Interview and the Course in the language the visitor writes in", async () => {
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

    await course.answerInterview(started.id, "Sé mover las piezas");
    await course.answerInterview(started.id, "Ganarle una partida");
    await course.chooseSittingLength(started.id, 20);
    await course.claimInterview(started.id, "ana");
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
    await course.claimInterview(interviewId, "ana");

    const first = await course.writeCourse(interviewId, "ana");
    const again = await course.writeCourse(interviewId, "ana");

    expect(again).toEqual(first);
    expect(await db.$count(schema.course)).toBe(1);
    expect(await db.$count(schema.learningRecord)).toBe(1);
    expect(teacher.calls.filter((c) => c.op === "writeMission")).toHaveLength(1);
  });

  it("writes a Course only for the Learner who claimed a finished Interview", async () => {
    const interviewId = await interviewAbout();

    expect(await course.writeCourse(interviewId, "ana")).toEqual({
      ok: false,
      reason: "not-yours",
    });
    expect(await course.claimInterview(interviewId, "ana")).toBe("claimed");
    expect(await course.claimInterview(interviewId, "ben")).toBe("not-yours");
    expect(await course.writeCourse(interviewId, "ben")).toEqual({
      ok: false,
      reason: "not-yours",
    });
    expect(await course.claimInterview("no-such-interview", "ana")).toBe("not-found");
    expect(await course.writeCourse("no-such-interview", "ana")).toEqual({
      ok: false,
      reason: "not-found",
    });

    const unfinished = await start(course, { subject: "Chess", why: "Beat my brother" });
    await course.claimInterview(unfinished.id, "ana");
    expect(await course.writeCourse(unfinished.id, "ana")).toEqual({
      ok: false,
      reason: "not-finished",
    });
    expect(await db.$count(schema.course)).toBe(0);
  });

  it("keeps a claimed Interview from anyone but its Learner", async () => {
    const interviewId = await interviewAbout();
    await course.claimInterview(interviewId, "ana");

    expect(await course.readInterview(interviewId, "ana")).not.toBeNull();
    expect(await course.readInterview(interviewId, null)).toBeNull();
    expect(await course.readInterview(interviewId, "ben")).toBeNull();
  });

  it("deletes a Learner's Interviews with the Learner", async () => {
    const interviewId = await interviewAbout();
    await course.claimInterview(interviewId, "ana");
    await course.writeCourse(interviewId, "ana");

    await db.delete(schema.learner).where(eq(schema.learner.id, "ana"));

    expect(await db.$count(schema.interview)).toBe(0);
    expect(await db.$count(schema.course)).toBe(0);
  });
});

describe("course: a harmful subject at Interview start", () => {
  it("shows a kind redirect and runs nothing else", async () => {
    const db = await createTestDb();
    const teacher = createFakeTeacher({ checkSafety: safetyRedirect });
    const course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });

    const started = await start(course, {
      subject: "Making explosives",
      why: "To hurt someone",
    });

    expect(started).toMatchObject({ stage: "redirected", questionNumber: null });
    expect(started.messages.at(-1)).toEqual({ from: "teacher", text: safetyRedirect.message });
    expect(teacher.calls.map((c) => c.op)).toEqual(["checkSafety"]);
    expect(teacher.calls[0]).toEqual({
      op: "checkSafety",
      input: { subject: "Making explosives", why: "To hurt someone" },
    });

    // The Interview cannot be carried on or written.
    expect(await course.answerInterview(started.id, "Please")).toMatchObject({
      stage: "redirected",
    });
    await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
    await course.claimInterview(started.id, "ana");
    expect(await course.writeCourse(started.id, "ana")).toEqual({
      ok: false,
      reason: "not-finished",
    });
    expect(teacher.calls.map((c) => c.op)).toEqual(["checkSafety"]);
    expect(await db.$count(schema.course)).toBe(0);
  });
});

describe("course: the Interview's one follow-up", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    // This Teacher finds every answer vague.
    teacher = createFakeTeacher({
      interviewFollowUp: (input) => ({
        followUp: "Could you tell me a little more?",
        nextQuestion: input.nextQuestion,
      }),
    });
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });
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
    await course.answerInterview(started.id, "fun");
    const third = await answer(course, started.id, "");
    const fourth = await answer(course, started.id, "stuff");

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
    teacher = createFakeTeacher({
      interviewFollowUp: (input) => ({
        followUp: replies.shift() ?? null,
        nextQuestion: input.nextQuestion,
      }),
    });
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });

    const started = await start(course, { subject: "Chess", why: "Beat my brother" });
    await course.answerInterview(started.id, "The moves");
    const vague = await answer(course, started.id, "be good");

    expect(vague).toMatchObject({ stage: "success", questionNumber: 3 });
    expect(vague?.messages.at(-1)?.text).toBe(followUpVague.followUp);

    const done = await answer(course, started.id, "Win one game against him");
    expect(done).toMatchObject({ stage: "sitting" });
  });

  it("does not ask a follow-up when the Teacher finds the answer clear", async () => {
    teacher = createFakeTeacher();
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher() });

    const started = await start(course, { subject: "Chess", why: "Beat my brother" });

    expect(started).toMatchObject({ stage: "know" });
  });
});
