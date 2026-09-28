import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import type { AskTeacherInput, FinishDraft } from "@/teacher";
import { createFakeTeacher, type FakeTeacher } from "@/teacher/fake";
import chatFixture from "@/teacher/fixtures/chat-music-theory.json";
import finishFixture from "@/teacher/fixtures/finish-music-theory.json";
import lessonFixture from "@/teacher/fixtures/lesson-music-theory.json";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, EXAMPLE_COURSE_ID, MAX_QUESTION_LENGTH, type CourseModule } from ".";
import { chatParts } from "./chat";

const ana = { learnerId: "ana" };

/** Always 0: the shuffle moves every right option to the end, so option 3 is right. */
const firstToLast = () => 0;
const RIGHT = 3;

type ChatReply = (input: AskTeacherInput) => { answer: string; community: number | null };

describe("course: asking your teacher", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;
  /** Replies for the next questions, in order; then the fixture. */
  let answers: ChatReply[];
  /** What Finish writes. */
  let finishDraft: FinishDraft;

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    answers = [];
    finishDraft = finishFixture as FinishDraft;
    db = await createTestDb();
    teacher = createFakeTeacher({
      writeLesson: lessonFixture,
      askTeacher: (input) => (answers.shift() ?? (() => chatFixture))(input),
      finishLesson: () => finishDraft,
    });
    course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher(), random: firstToLast });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
    await db.insert(schema.course).values({
      id: "c1",
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
        courseId: "c1",
        ref,
        kind: "site" as const,
        title: `Resource ${ref.slice(1)}`,
        author: "Someone",
        url: `https://example.org/${ref}`,
        why: "It fits.",
        language: "en",
      })),
    );
    await db.insert(schema.community).values([
      {
        courseId: "c1",
        name: "Local jam night",
        where: "A music shop or bar near you",
        url: null,
        why: "Play with others.",
        offline: true,
      },
      {
        courseId: "c1",
        name: "r/musictheory",
        where: "Reddit",
        url: "https://www.reddit.com/r/musictheory/",
        why: "Beginners’ questions welcome.",
        offline: false,
      },
    ]);
    await db.insert(schema.lesson).values({
      courseId: "c1",
      index: 1,
      title: "Why these chords belong together",
      goal: "Name the key of a song from its chord chart",
      minutes: 10,
    });
    const opened = await course.openLesson("c1", 1, "ana");
    if (opened.ok && opened.generation) await course.runJobStep(opened.generation.jobId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const askInputs = () => teacher.calls.flatMap((c) => (c.op === "askTeacher" ? [c.input] : []));
  const readChat = async () => (await course.readLesson("c1", 1, ana))?.chat;

  it("answers from the Mission, the Lesson, the Resources and this Lesson's earlier messages", async () => {
    await course.askTeacher("c1", 1, "What is a key?", "ana");
    await course.askTeacher("c1", 1, "  And the home chord?  ", "ana");

    const [first, second] = askInputs();
    expect(first).toMatchObject({
      subject: "Music theory",
      language: "en",
      mission: { why: "Understand the songs I already play on guitar.", sittingMinutes: 10 },
      lesson: {
        index: 1,
        title: "Why these chords belong together",
        goal: "Name the key of a song from its chord chart",
        hook: lessonFixture.hook,
        keyIdea: lessonFixture.keyIdea,
        sections: [
          { heading: "A key is a family", citations: ["r1", "r2"] },
          { heading: "The home chord", citations: ["r3"] },
        ],
      },
      resources: [{ id: "r1" }, { id: "r2" }, { id: "r3" }],
      history: [],
      question: "What is a key?",
    });
    expect(second.question).toBe("And the home chord?");
    expect(second.history).toEqual([
      { from: "learner", text: "What is a key?" },
      { from: "teacher", text: chatFixture.answer },
    ]);
  });

  it("saves the chat per Lesson and shows it on revisit, citations as numbered Resources", async () => {
    const asked = await course.askTeacher("c1", 1, "Why does G feel like home?", "ana");
    expect(asked.ok).toBe(true);
    if (!asked.ok) throw new Error("Not asked.");

    const shown = await readChat();
    expect(shown).toEqual(asked.messages);
    expect(shown).toHaveLength(2);
    expect(shown?.[0]).toEqual({
      from: "learner",
      parts: [{ text: "Why does G feel like home?" }],
      community: null,
    });
    const answer = shown![1];
    expect(answer.from).toBe("teacher");
    expect(answer.parts).toEqual([
      { text: "The home chord is where the song rests, so it is usually the first and last chord of the chart" },
      { cite: expect.objectContaining({ number: 3, url: "https://example.org/r3", title: "Resource 3" }) },
      { text: ". Some songs end away from home on purpose; people who play a lot of songs can show you examples." },
    ]);
    // Ids never show.
    expect(JSON.stringify(answer.parts.filter((p) => "text" in p))).not.toMatch(/\br\d+\b/);

    // Another Lesson's chat is its own.
    await db.insert(schema.lesson).values({
      courseId: "c1",
      index: 2,
      title: "Chords that share a key",
      goal: "Spot which chords in a chart belong to G major",
    });
    expect((await course.readLesson("c1", 2, ana))?.chat).toEqual([]);
  });

  it("numbers the saved messages 1, 2, 3… per Lesson, question before answer", async () => {
    await course.askTeacher("c1", 1, "One?", "ana");
    await course.askTeacher("c1", 1, "Two?", "ana");

    const rows = await db.select().from(schema.chatMessage);
    expect(
      rows.sort((a, b) => a.number - b.number).map((r) => [r.number, r.from, r.text.slice(0, 4)]),
    ).toEqual([
      [1, "learner", "One?"],
      [2, "teacher", "The "],
      [3, "learner", "Two?"],
      [4, "teacher", "The "],
    ]);
  });

  describe("Communities", () => {
    it("suggests the Community the Teacher picked, numbered online first as on the Communities tab", async () => {
      const asked = await course.askTeacher("c1", 1, "Which guitar should I buy?", "ana");

      expect(askInputs()[0]).toMatchObject({
        mayPointToCommunities: true,
        communities: [
          { number: 1, name: "r/musictheory", offline: false },
          { number: 2, name: "Local jam night", offline: true },
        ],
      });
      expect(asked.ok && asked.messages[1].community).toEqual({
        name: "r/musictheory",
        where: "Reddit",
        url: "https://www.reddit.com/r/musictheory/",
        why: "Beginners’ questions welcome.",
        offline: false,
      });
      expect((await readChat())?.[1].community).toMatchObject({ name: "r/musictheory" });
    });

    it("respects the opt-out: the Teacher is told, given none, and a suggestion is dropped", async () => {
      expect(await course.setCommunityOptOut("c1", "ana", true)).toEqual({ ok: true });

      const asked = await course.askTeacher("c1", 1, "How do I stay motivated?", "ana");

      expect(askInputs()[0]).toMatchObject({ mayPointToCommunities: false, communities: [] });
      expect(asked.ok && asked.messages[1].community).toBeNull();
      expect((await readChat())?.[1].community).toBeNull();
      expect((await db.select().from(schema.chatMessage)).every((m) => m.communityId === null)).toBe(true);
    });

    it("drops a Community number that is not on the list", async () => {
      answers = [() => ({ answer: "I’m not sure.", community: 7 })];
      const asked = await course.askTeacher("c1", 1, "What do pros do?", "ana");
      expect(asked.ok && asked.messages[1].community).toBeNull();
    });
  });

  describe("refusals", () => {
    it("takes no question from someone else, in the Example course, or on an unwritten or finished Lesson", async () => {
      expect(await course.askTeacher("c1", 1, "Hi?", "ben")).toEqual({ ok: false, reason: "not-found" });
      await course.ensureExampleCourse();
      expect(await course.askTeacher(EXAMPLE_COURSE_ID, 1, "Hi?", "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });

      await db.insert(schema.lesson).values({ courseId: "c1", index: 2, title: "Later", goal: "Play later" });
      expect(await course.askTeacher("c1", 2, "Hi?", "ana")).toEqual({ ok: false, reason: "not-written" });

      for (const i of [0, 1, 2]) await course.answerQuestion("c1", 1, i, RIGHT, "ana");
      const pressed = await course.finishLesson("c1", 1, "ana");
      if (!pressed.ok) throw new Error("Finish was refused.");
      await course.runJobStep(pressed.finishing.jobId);
      expect(await course.askTeacher("c1", 1, "Hi?", "ana")).toEqual({ ok: false, reason: "finished" });

      expect(askInputs()).toHaveLength(0);
      expect(await db.select().from(schema.chatMessage)).toEqual([]);
    });

    it("takes no empty or overlong question", async () => {
      expect(await course.askTeacher("c1", 1, "   ", "ana")).toEqual({ ok: false, reason: "invalid" });
      expect(await course.askTeacher("c1", 1, "?".repeat(MAX_QUESTION_LENGTH + 1), "ana")).toEqual({
        ok: false,
        reason: "invalid",
      });
      expect(askInputs()).toHaveLength(0);
    });

    it("saves nothing when the Teacher cannot answer, after trying twice", async () => {
      const fail: ChatReply = () => {
        throw new Error("Overloaded.");
      };
      answers = [fail, fail];

      expect(await course.askTeacher("c1", 1, "Hello?", "ana")).toEqual({ ok: false, reason: "unavailable" });
      expect(askInputs()).toHaveLength(2);
      expect(await readChat()).toEqual([]);
    });
  });

  describe("Finish", () => {
    it("receives this Lesson's chat by id, and may write a record on the Learner's own words", async () => {
      answers = [() => ({ answer: "Close! The home chord names the key [r3].", community: null })];
      await course.askTeacher("c1", 1, "So the chord a song ends on names its key?", "ana");
      await course.askTeacher("c1", 1, "Thanks!", "ana");
      finishDraft = {
        ...(finishFixture as FinishDraft),
        learningRecords: [
          {
            kind: "understanding",
            title: "Names a key from its home chord",
            body: "Explained in the chat that the chord a song ends on names its key.",
            evidence: ["C1"],
            supersedes: [],
          },
          {
            kind: "understanding",
            title: "Cites only the Teacher",
            body: "The Teacher's words are not the Learner's evidence.",
            evidence: ["C2"],
            supersedes: [],
          },
        ],
      };

      for (const i of [0, 1, 2]) await course.answerQuestion("c1", 1, i, RIGHT, "ana");
      const pressed = await course.finishLesson("c1", 1, "ana");
      if (!pressed.ok) throw new Error("Finish was refused.");
      await course.runJobStep(pressed.finishing.jobId);

      const input = teacher.calls.flatMap((c) => (c.op === "finishLesson" ? [c.input] : []))[0];
      expect(input.chat).toEqual([
        { id: "C1", from: "learner", text: "So the chord a song ends on names its key?" },
        { id: "C2", from: "teacher", text: "Close! The home chord names the key [r3]." },
        { id: "C3", from: "learner", text: "Thanks!" },
        { id: "C4", from: "teacher", text: chatFixture.answer },
      ]);
      const records = await db.select().from(schema.learningRecord);
      expect(records.map((r) => r.title)).toEqual(["Names a key from its home chord"]);
    });
  });
});

describe("course: chat citations", () => {
  const resource = (number: number) => ({
    number,
    kind: "site" as const,
    title: `Resource ${number}`,
    author: "Someone",
    url: `https://example.org/r${number}`,
    why: "It fits.",
  });
  const resources = new Map([
    ["r1", resource(1)],
    ["r2", resource(2)],
  ]);

  it("turns each cited id into its Resource, and drops ids the Course does not have", () => {
    expect(chatParts("Keys [r1, r2]. Chords [r9]. Done [r2]", resources)).toEqual([
      { text: "Keys" },
      { cite: resource(1) },
      { cite: resource(2) },
      { text: ". Chords. Done" },
      { cite: resource(2) },
    ]);
  });

  it("leaves text without citations as it is", () => {
    expect(chatParts("No sources here.", resources)).toEqual([{ text: "No sources here." }]);
  });
});
