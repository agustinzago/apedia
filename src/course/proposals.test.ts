import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import type {
  ChatAnswer,
  FinishDraft,
  FinishLessonInput,
  MissionChangeDraft,
  PickUpNextInput,
  UpNextDraft,
} from "@/teacher";
import { createFakeTeacher, type FakeTeacher } from "@/teacher/fake";
import chatFixture from "@/teacher/fixtures/chat-music-theory.json";
import finishFixture from "@/teacher/fixtures/finish-music-theory.json";
import lessonFixture from "@/teacher/fixtures/lesson-music-theory.json";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, EXAMPLE_COURSE_ID, type CourseModule, type ProposalView } from ".";

const ana = { learnerId: "ana" };

/** Always 0: the shuffle moves every right option to the end, so option 3 is right. */
const firstToLast = () => 0;
const RIGHT = 3;

type FinishReply = (input: FinishLessonInput) => FinishDraft;
type ChatReply = () => ChatAnswer;
type PickReply = (input: PickUpNextInput) => UpNextDraft;

/** The fixture Finish with some parts replaced. */
const finishWith =
  (changes: Partial<FinishDraft> | ((input: FinishLessonInput) => Partial<FinishDraft>)): FinishReply =>
  (input) => ({
    ...(finishFixture as FinishDraft),
    ...(typeof changes === "function" ? changes(input) : changes),
  });

const songwriting: MissionChangeDraft = {
  reason: "You keep asking how to write your own songs, not how to read other people’s.",
  why: "Write my own songs on the guitar.",
  successLooksLike: ["Write a four-chord song in one key"],
  constraints: ["10 minutes per sitting"],
  outOfScope: ["Reading sheet music"],
  recordTitle: "Mission now: writing songs",
  recordBody: "Said in Lesson 1 they now want to write songs rather than work out other people’s.",
};

const firstSong: UpNextDraft = {
  title: "Your first four-chord song",
  goal: "Write a four-chord progression in G major",
  minutes: 10,
};

const understanding = (title: string, evidence: string[]) => ({
  kind: "understanding" as const,
  title,
  body: `${title}, in their own words.`,
  evidence,
  supersedes: [],
});

describe("course: Mission change and Done", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;
  /** Replies for the next Finishes, in order; then the fixture. */
  let finishes: FinishReply[];
  /** Replies for the next chat questions, in order; then the fixture. */
  let answers: ChatReply[];
  /** Replies for the next Up next picks, in order; then `firstSong`. */
  let picks: PickReply[];

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    finishes = [];
    answers = [];
    picks = [];
    db = await createTestDb();
    teacher = createFakeTeacher({
      writeLesson: lessonFixture,
      finishLesson: (input) => (finishes.shift() ?? finishWith({}))(input),
      askTeacher: () => (answers.shift() ?? (() => chatFixture as ChatAnswer))(),
      pickUpNext: (input) => (picks.shift() ?? (() => firstSong))(input),
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
      missionSuccess: [
        "Name the key of a song from its chords",
        "Explain why the chords of a song belong to the same key",
      ],
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
    await db.insert(schema.learningRecord).values({
      courseId: "c1",
      number: 1,
      kind: "prior_knowledge",
      title: "Plays open chords from chord charts",
      body: "Said in the Interview they can strum G, C, D, Em and Am.",
    });
    await db.insert(schema.lesson).values({
      courseId: "c1",
      index: 1,
      title: "Why these chords belong together",
      goal: "Name the key of a song from its chord chart",
      minutes: 10,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Opens and writes the Lesson as Ana. */
  const write = async (index: number) => {
    const opened = await course.openLesson("c1", index, "ana");
    if (opened.ok && opened.generation) await course.runJobStep(opened.generation.jobId);
  };

  /** Writes the Lesson and answers every question right. */
  const writeAndAnswer = async (index: number) => {
    await write(index);
    for (const i of [0, 1, 2]) {
      const answered = await course.answerQuestion("c1", index, i, RIGHT, "ana");
      if (!answered.ok) throw new Error(`Question ${i + 1} was not answered: ${answered.reason}`);
    }
  };

  /** Presses Finish as Ana and runs its job the way the app does. */
  const finish = async (index: number) => {
    const pressed = await course.finishLesson("c1", index, "ana");
    if (!pressed.ok) throw new Error(`Finish was refused: ${pressed.reason}`);
    await course.runJobStep(pressed.finishing.jobId);
  };

  const path = async () => (await course.readCoursePath("c1", ana))!;

  const openProposal = async <K extends ProposalView["kind"]>(kind: K) => {
    const found = (await path()).proposals.find((p) => p.kind === kind);
    if (!found) throw new Error(`No open ${kind} proposal.`);
    return found as Extract<ProposalView, { kind: K }>;
  };

  const readRecords = () =>
    db
      .select()
      .from(schema.learningRecord)
      .where(eq(schema.learningRecord.courseId, "c1"))
      .orderBy(asc(schema.learningRecord.number));

  const picksMade = () => teacher.calls.flatMap((c) => (c.op === "pickUpNext" ? [c.input] : []));
  const finishInputs = () => teacher.calls.flatMap((c) => (c.op === "finishLesson" ? [c.input] : []));

  describe("a Mission change proposed at Finish", () => {
    beforeEach(async () => {
      await writeAndAnswer(1);
      finishes = [finishWith({ missionChange: songwriting })];
      await finish(1);
    });

    it("waits for the Learner: the Path shows it, and nothing changes yet", async () => {
      const shown = await path();
      expect(shown.proposals).toEqual([
        {
          id: expect.any(String),
          kind: "mission_change",
          reason: songwriting.reason,
          mission: {
            why: "Write my own songs on the guitar.",
            success: ["Write a four-chord song in one key"],
            constraints: ["10 minutes per sitting"],
            outOfScope: ["Reading sheet music"],
          },
        },
      ]);
      expect(shown.mission.why).toBe("Understand the songs I already play on guitar.");
      expect(shown.upNext?.title).toBe("Chords that share a key");
      expect((await readRecords()).map((r) => r.kind)).toEqual(["prior_knowledge"]);
    });

    it("once confirmed, updates the Mission, writes a mission-change record and re-picks the unwritten Up next", async () => {
      const proposal = await openProposal("mission_change");

      expect(await course.confirmProposal("c1", proposal.id, "ana")).toEqual({ ok: true });

      const shown = await path();
      expect(shown.mission).toEqual({
        why: "Write my own songs on the guitar.",
        success: ["Write a four-chord song in one key"],
        constraints: ["10 minutes per sitting"],
        sittingMinutes: 10,
        outOfScope: ["Reading sheet music"],
      });
      expect(shown.learningRecords[0]).toMatchObject({
        number: 2,
        kind: "mission_change",
        title: "Mission now: writing songs",
        body: songwriting.recordBody,
      });
      expect(shown.upNext).toMatchObject({ index: 2, ...firstSong, started: false });
      expect(shown.proposals).toEqual([]);

      // The pick follows the new Mission, and knows about the change.
      const [picked] = picksMade();
      expect(picked.mission.successLooksLike).toEqual(["Write a four-chord song in one key"]);
      expect(picked.learningRecords.at(-1)).toMatchObject({ number: 2, kind: "mission_change" });
      expect(picked.finishedLessons.map((l) => l.title)).toEqual(["Why these chords belong together"]);

      // Decided once.
      expect(await course.confirmProposal("c1", proposal.id, "ana")).toEqual({
        ok: false,
        reason: "decided",
      });
      expect(await course.declineProposal("c1", proposal.id, "ana")).toEqual({
        ok: false,
        reason: "decided",
      });
    });

    it("re-picks Up next once when confirmed from several tabs at once", async () => {
      const proposal = await openProposal("mission_change");

      const confirmed = await Promise.all(
        [1, 2, 3].map(() => course.confirmProposal("c1", proposal.id, "ana")),
      );

      expect(confirmed.filter((c) => c.ok)).toHaveLength(1);
      expect(confirmed.filter((c) => !c.ok)).toEqual([
        { ok: false, reason: "busy" },
        { ok: false, reason: "busy" },
      ]);
      expect(picksMade()).toHaveLength(1);
      expect((await readRecords()).filter((r) => r.kind === "mission_change")).toHaveLength(1);
    });

    it("and the next Lesson and Finish work from the new Mission", async () => {
      await course.confirmProposal("c1", (await openProposal("mission_change")).id, "ana");

      await writeAndAnswer(2);
      const written = teacher.calls.flatMap((c) => (c.op === "writeLesson" ? [c.input] : []));
      expect(written[1].lesson.title).toBe(firstSong.title);
      expect(written[1].mission.why).toBe("Write my own songs on the guitar.");

      await finish(2);
      expect(finishInputs()[1].mission.successLooksLike).toEqual(["Write a four-chord song in one key"]);
    });

    it("once declined, changes nothing, and the Teacher is told at the next Finish", async () => {
      const proposal = await openProposal("mission_change");

      expect(await course.declineProposal("c1", proposal.id, "ana")).toEqual({ ok: true });

      const shown = await path();
      expect(shown.proposals).toEqual([]);
      expect(shown.mission.why).toBe("Understand the songs I already play on guitar.");
      expect(shown.upNext?.title).toBe("Chords that share a key");
      expect((await readRecords()).map((r) => r.kind)).toEqual(["prior_knowledge"]);
      expect(picksMade()).toHaveLength(0);

      await writeAndAnswer(2);
      await finish(2);
      expect(finishInputs()[1].proposals).toEqual([
        { kind: "mission_change", status: "declined", reason: songwriting.reason },
      ]);
      expect(await course.confirmProposal("c1", proposal.id, "ana")).toEqual({
        ok: false,
        reason: "decided",
      });
    });

    it("leaves an Up next that is already written as it is", async () => {
      await write(2);

      await course.confirmProposal("c1", (await openProposal("mission_change")).id, "ana");

      expect((await path()).upNext?.title).toBe("Chords that share a key");
      expect(picksMade()).toHaveLength(0);
      expect((await path()).mission.why).toBe("Write my own songs on the guitar.");
    });

    it("changes nothing when Up next cannot be re-picked; confirming again works", async () => {
      const broken: PickReply = () => {
        throw new Error("Overloaded");
      };
      picks = [broken, broken];
      const proposal = await openProposal("mission_change");

      expect(await course.confirmProposal("c1", proposal.id, "ana")).toEqual({
        ok: false,
        reason: "unavailable",
      });
      expect((await path()).mission.why).toBe("Understand the songs I already play on guitar.");
      expect((await path()).proposals).toHaveLength(1);
      expect(await readRecords()).toHaveLength(1);

      expect(await course.confirmProposal("c1", proposal.id, "ana")).toEqual({ ok: true });
      expect((await path()).upNext?.title).toBe(firstSong.title);
    });

    it("is the Course's own Learner's to decide", async () => {
      const proposal = await openProposal("mission_change");

      expect(await course.confirmProposal("c1", proposal.id, "ben")).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await course.declineProposal("c1", proposal.id, "ben")).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await course.confirmProposal(EXAMPLE_COURSE_ID, proposal.id, "ana")).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await course.readCoursePath("c1", { learnerId: "ben" })).toBeNull();
      expect((await path()).proposals).toHaveLength(1);
    });
  });

  it("drops a proposed Mission change that is the current Mission or has no success items", async () => {
    await writeAndAnswer(1);
    finishes = [
      finishWith({
        missionChange: {
          ...songwriting,
          why: "Understand the songs I already play on guitar.",
          successLooksLike: [
            "Name the key of a song from its chords",
            "explain why the chords of a song belong to the same key ",
          ],
          outOfScope: [],
        },
      }),
    ];
    await finish(1);
    await writeAndAnswer(2);
    finishes = [finishWith({ missionChange: { ...songwriting, successLooksLike: [" "] } })];
    await finish(2);

    expect((await path()).proposals).toEqual([]);
  });

  describe("a Mission change proposed in the chat", () => {
    beforeEach(async () => {
      await write(1);
      answers = [
        () => ({
          answer: "Then let’s aim at writing songs. I’ve suggested an updated Mission below.",
          community: null,
          missionChange: songwriting,
        }),
      ];
    });

    it("comes with the answer and shows on the Lesson and the Path until decided", async () => {
      const asked = await course.askTeacher("c1", 1, "Honestly I’d rather write my own songs.", "ana");

      expect(asked).toMatchObject({
        ok: true,
        proposal: { kind: "mission_change", reason: songwriting.reason },
      });
      const lesson = await course.readLesson("c1", 1, ana);
      expect(lesson?.proposals).toMatchObject([{ kind: "mission_change" }]);
      expect((await path()).proposals).toMatchObject([{ kind: "mission_change" }]);
      expect((await path()).mission.why).toBe("Understand the songs I already play on guitar.");

      // The Teacher is told it is open.
      await course.askTeacher("c1", 1, "What next?", "ana");
      const second = teacher.calls.filter((c) => c.op === "askTeacher")[1];
      expect(second.op === "askTeacher" && second.input.proposals).toEqual([
        { kind: "mission_change", status: "open", reason: songwriting.reason },
      ]);
    });

    it("once confirmed, updates the Mission and records it against the Lesson; the written Lesson stays", async () => {
      const asked = await course.askTeacher("c1", 1, "Honestly I’d rather write my own songs.", "ana");
      if (!asked.ok || !asked.proposal) throw new Error("No proposal.");

      expect(await course.confirmProposal("c1", asked.proposal.id, "ana")).toEqual({ ok: true });

      expect((await path()).mission.success).toEqual(["Write a four-chord song in one key"]);
      const [lesson1] = await db.select().from(schema.lesson).where(eq(schema.lesson.index, 1));
      expect((await readRecords()).at(-1)).toMatchObject({
        number: 2,
        kind: "mission_change",
        lessonId: lesson1.id,
      });
      expect((await path()).upNext).toMatchObject({ index: 1, title: "Why these chords belong together" });
      expect((await course.readLesson("c1", 1, ana))?.proposals).toEqual([]);
      expect(picksMade()).toHaveLength(0);
    });

    it("replaces an earlier one still open", async () => {
      await course.askTeacher("c1", 1, "I’d rather write songs.", "ana");
      answers = [
        () => ({
          answer: "Then let’s aim at accompanying singers.",
          community: null,
          missionChange: { ...songwriting, why: "Accompany my friends when they sing." },
        }),
      ];
      await course.askTeacher("c1", 1, "Actually, I want to accompany singers.", "ana");

      expect((await path()).proposals).toMatchObject([
        { kind: "mission_change", mission: { why: "Accompany my friends when they sing." } },
      ]);
    });
  });

  describe("Done", () => {
    /**
     * Lesson 1 with a chat, finished by a Finish that writes an understanding
     * record per success item (numbered 2 and 3) and suggests Done on them.
     */
    const finishWithDone = async (evidence: (next: number) => FinishDraft["done"]) => {
      await writeAndAnswer(1);
      await course.askTeacher("c1", 1, "So the key is where the song feels at home?", "ana");
      finishes = [
        finishWith((input) => ({
          learningRecords: [
            understanding("Names a song's key", ["C1"]),
            understanding("Explains why chords share a key", ["C1"]),
          ],
          done: evidence(input.nextRecordNumber),
        })),
      ];
      await finish(1);
    };

    const allItems = (next: number) => ({
      reason: "You can name a song’s key and say why its chords belong to it.",
      evidence: [
        { successItem: 1, records: [next] },
        { successItem: 2, records: [next + 1] },
      ],
    });

    it("is suggested when every success item has a standing record, and waits for the Learner", async () => {
      await finishWithDone(allItems);

      expect(finishInputs()[0].nextRecordNumber).toBe(2);
      const shown = await path();
      expect(shown.proposals).toEqual([
        {
          id: expect.any(String),
          kind: "done",
          reason: "You can name a song’s key and say why its chords belong to it.",
          evidence: [
            {
              successItem: "Name the key of a song from its chords",
              records: [{ number: 2, title: "Names a song's key" }],
            },
            {
              successItem: "Explain why the chords of a song belong to the same key",
              records: [{ number: 3, title: "Explains why chords share a key" }],
            },
          ],
        },
      ]);
      expect(shown.status).toBe("active");
      expect(shown.upNext?.index).toBe(2);
    });

    it("is not suggested while a success item has no record, or only prior knowledge", async () => {
      await finishWithDone((next) => ({
        reason: "Done?",
        evidence: [
          { successItem: 1, records: [next] },
          { successItem: 2, records: [1] },
        ],
      }));

      expect((await path()).proposals).toEqual([]);
    });

    it("cites the numbers records get once a dropped one is left out", async () => {
      await writeAndAnswer(1);
      await course.askTeacher("c1", 1, "So the key is where the song feels at home?", "ana");
      finishes = [
        finishWith((input) => ({
          learningRecords: [
            // No evidence: dropped, so the next two become 2 and 3.
            understanding("Knows everything", []),
            understanding("Names a song's key", ["C1"]),
            understanding("Explains why chords share a key", ["C1"]),
          ],
          done: {
            reason: "Done.",
            evidence: [
              { successItem: 1, records: [input.nextRecordNumber + 1] },
              { successItem: 2, records: [input.nextRecordNumber + 2] },
            ],
          },
        })),
      ];
      await finish(1);

      const done = await openProposal("done");
      expect(done.evidence.map((e) => e.records)).toEqual([
        [{ number: 2, title: "Names a song's key" }],
        [{ number: 3, title: "Explains why chords share a key" }],
      ]);
    });

    it("once confirmed, marks the Course Done on home and the Path, keeps it readable, and writes no new Lessons", async () => {
      await finishWithDone(allItems);
      const proposal = await openProposal("done");

      expect(await course.confirmProposal("c1", proposal.id, "ana")).toEqual({ ok: true });

      const [listed] = await course.listCourses("ana");
      expect(listed).toMatchObject({ id: "c1", status: "done", doneAt: expect.any(Date) });
      const shown = await path();
      expect(shown).toMatchObject({ status: "done", doneAt: expect.any(Date), upNext: null, proposals: [] });
      expect(shown.finishedLessons).toHaveLength(1);

      const lesson = await course.readLesson("c1", 1, ana);
      expect(lesson?.content?.keyIdea).toBe(lessonFixture.keyIdea);
      expect(lesson?.course.done).toBe(true);
      expect((await course.readReferenceSheet("c1", ana))?.keyIdeas).toHaveLength(1);

      // The Up next chosen at Finish is never written.
      expect(await course.openLesson("c1", 2, "ana")).toEqual({ ok: false, reason: "done" });
      expect(await course.retryLessonGeneration("c1", 2, "ana")).toEqual({ ok: false, reason: "done" });
      expect(teacher.calls.filter((c) => c.op === "writeLesson")).toHaveLength(1);
      expect(await db.select().from(schema.job).where(eq(schema.job.kind, "lesson_generation"))).toHaveLength(1);
    });

    it("once confirmed, closes a written Lesson to answers, questions and Finish", async () => {
      await finishWithDone(allItems);
      await write(2);

      await course.confirmProposal("c1", (await openProposal("done")).id, "ana");

      expect(await course.openLesson("c1", 2, "ana")).toMatchObject({ ok: true, generation: null });
      expect((await course.readLesson("c1", 2, ana))?.content).not.toBeNull();
      expect(await course.answerQuestion("c1", 2, 0, RIGHT, "ana")).toEqual({ ok: false, reason: "done" });
      expect(await course.askTeacher("c1", 2, "Why?", "ana")).toEqual({ ok: false, reason: "done" });
      expect(await course.finishLesson("c1", 2, "ana")).toEqual({ ok: false, reason: "done" });
    });

    it("stops a Lesson being written when the Course is Done meanwhile", async () => {
      await finishWithDone(allItems);
      const opened = await course.openLesson("c1", 2, "ana");
      if (!opened.ok || !opened.generation) throw new Error("Not opened.");

      await course.confirmProposal("c1", (await openProposal("done")).id, "ana");
      await course.runJobStep(opened.generation.jobId);

      expect((await course.readLesson("c1", 2, ana))?.content).toBeNull();
      expect(teacher.calls.filter((c) => c.op === "writeLesson")).toHaveLength(1);
    });

    it("once declined, leaves the Course active with its Up next", async () => {
      await finishWithDone(allItems);
      const proposal = await openProposal("done");

      expect(await course.declineProposal("c1", proposal.id, "ana")).toEqual({ ok: true });

      const shown = await path();
      expect(shown).toMatchObject({ status: "active", doneAt: null, proposals: [] });
      expect(shown.upNext?.index).toBe(2);
      await writeAndAnswer(2);
      expect(finishInputs()).toHaveLength(1);
      await finish(2);
      expect(finishInputs()[1].proposals).toEqual([
        { kind: "done", status: "declined", reason: proposal.reason },
      ]);
    });

    it("and a Mission change proposed together: confirming one withdraws the other", async () => {
      await writeAndAnswer(1);
      await course.askTeacher("c1", 1, "So the key is where the song feels at home?", "ana");
      finishes = [
        finishWith((input) => ({
          learningRecords: [
            understanding("Names a song's key", ["C1"]),
            understanding("Explains why chords share a key", ["C1"]),
          ],
          done: allItems(input.nextRecordNumber),
          missionChange: songwriting,
        })),
      ];
      await finish(1);
      const change = await openProposal("mission_change");
      const done = await openProposal("done");

      expect(await course.confirmProposal("c1", change.id, "ana")).toEqual({ ok: true });

      expect((await path()).proposals).toEqual([]);
      expect(await course.confirmProposal("c1", done.id, "ana")).toEqual({
        ok: false,
        reason: "decided",
      });
      expect((await path()).status).toBe("active");
    });
  });
});
