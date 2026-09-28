import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import type { FinishDraft, FinishLessonInput } from "@/teacher";
import { createFakeTeacher, type FakeTeacher } from "@/teacher/fake";
import finishFixture from "@/teacher/fixtures/finish-music-theory.json";
import lessonFixture from "@/teacher/fixtures/lesson-music-theory.json";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, EXAMPLE_COURSE_ID, type CourseModule } from ".";
import { recordProblem, type Evidence } from "./finish";

const ana = { learnerId: "ana" };

/** Always 0: the shuffle moves every right option to the end, so option 3 is right and 0 is wrong. */
const firstToLast = () => 0;
const RIGHT = 3;
const WRONG = 0;

type FinishReply = (input: FinishLessonInput) => FinishDraft;

/** The fixture Finish with some parts replaced. */
const finishWith =
  (changes: Partial<FinishDraft>): FinishReply =>
  () => ({ ...(finishFixture as FinishDraft), ...changes });

const record = (
  kind: "understanding" | "misconception",
  title: string,
  evidence: string[],
  supersedes: number[] = [],
) => ({ kind, title, body: `${title}, shown by ${evidence.join(" and ")}.`, evidence, supersedes });

describe("course: finishing a Lesson", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;
  let warn: ReturnType<typeof vi.spyOn>;
  /** Replies for the next Finishes, in order; then the fixture. */
  let finishes: FinishReply[];

  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    finishes = [];
    db = await createTestDb();
    teacher = createFakeTeacher({
      writeLesson: lessonFixture,
      finishLesson: (input) => (finishes.shift() ?? finishWith({}))(input),
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

  /** Opens and writes the Lesson, then answers its questions: true is right, false is wrong. */
  const writeAndAnswer = async (index: number, answers: boolean[]) => {
    const opened = await course.openLesson("c1", index, "ana");
    if (opened.ok && opened.generation) await course.runJobStep(opened.generation.jobId);
    for (const [i, right] of answers.entries()) {
      const answered = await course.answerQuestion("c1", index, i, right ? RIGHT : WRONG, "ana");
      if (!answered.ok) throw new Error(`Question ${i + 1} was not answered: ${answered.reason}`);
    }
  };

  /** Presses Finish as Ana and runs its job the way the app does. */
  const finish = async (index: number) => {
    const pressed = await course.finishLesson("c1", index, "ana");
    if (!pressed.ok) throw new Error(`Finish was refused: ${pressed.reason}`);
    await course.runJobStep(pressed.finishing.jobId);
    return pressed.finishing.jobId;
  };

  const finishInputs = () =>
    teacher.calls.flatMap((c) => (c.op === "finishLesson" ? [c.input] : []));

  const readRecords = () =>
    db
      .select()
      .from(schema.learningRecord)
      .where(eq(schema.learningRecord.courseId, "c1"))
      .orderBy(asc(schema.learningRecord.number));

  const readGlossary = async () =>
    (await course.readReferenceSheet("c1", ana))?.glossary.map((t) => t.term);

  describe("pressing Finish", () => {
    it("runs a Finish job, then the Path shows the finished Lesson with its score and the new Up next", async () => {
      await writeAndAnswer(1, [true, false, true]);

      const pressed = await course.finishLesson("c1", 1, "ana");
      expect(pressed).toMatchObject({ ok: true, start: true, finishing: { status: "working" } });
      if (!pressed.ok) throw new Error("Refused.");
      expect((await course.readLesson("c1", 1, ana))?.finishing).toMatchObject({
        jobId: pressed.finishing.jobId,
        status: "working",
      });

      expect(await course.runJobStep(pressed.finishing.jobId)).toBe("stop");

      expect(await course.readFinish("c1", 1, "ana")).toEqual({
        jobId: pressed.finishing.jobId,
        status: "done",
        stalled: false,
        progress: [
          "Weighing what you showed in “Why these chords belong together”.",
          "Writing down what you learned.",
          "Up next: “Chords that share a key”.",
        ],
      });
      const lesson = await course.readLesson("c1", 1, ana);
      expect(lesson?.finishedAt).toBeInstanceOf(Date);
      expect(lesson?.finishing).toBeNull();

      const path = await course.readCoursePath("c1", ana);
      expect(path?.finishedLessons).toEqual([
        {
          index: 1,
          title: "Why these chords belong together",
          goal: "Name the key of a song from its chord chart",
          finishedAt: lesson?.finishedAt,
          score: { correct: 2, total: 3 },
        },
      ]);
      expect(path?.upNext).toEqual({
        index: 2,
        title: "Chords that share a key",
        goal: "Spot which chords in a chart belong to G major",
        minutes: 10,
        started: false,
      });
    });

    it("does not write the next Lesson's content", async () => {
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);

      const [next] = await db.select().from(schema.lesson).where(eq(schema.lesson.index, 2));
      expect(next.content).toBeNull();
      expect(teacher.calls.filter((c) => c.op === "writeLesson")).toHaveLength(1);
      expect(await db.select().from(schema.job).where(eq(schema.job.kind, "lesson_generation"))).toHaveLength(1);
    });

    it("is on only once every question is answered", async () => {
      expect(await course.finishLesson("c1", 1, "ana")).toEqual({ ok: false, reason: "not-written" });
      await writeAndAnswer(1, [true, true]);
      expect(await course.finishLesson("c1", 1, "ana")).toEqual({ ok: false, reason: "unanswered" });
      expect(finishInputs()).toHaveLength(0);
    });

    it("is only for the Course's own Learner, never for the Example course, and only once", async () => {
      await writeAndAnswer(1, [true, true, true]);
      expect(await course.finishLesson("c1", 1, "ben")).toEqual({ ok: false, reason: "not-found" });
      expect(await course.finishLesson(EXAMPLE_COURSE_ID, 3, "ana")).toEqual({
        ok: false,
        reason: "not-found",
      });
      await course.ensureExampleCourse();
      expect(await course.finishLesson(EXAMPLE_COURSE_ID, 3, "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });

      const first = await course.finishLesson("c1", 1, "ana");
      const again = await course.finishLesson("c1", 1, "ana");
      expect(again).toEqual(first);
      if (!first.ok) throw new Error("Refused.");
      await course.runJobStep(first.finishing.jobId);
      expect(await course.finishLesson("c1", 1, "ana")).toEqual({ ok: false, reason: "finished" });
      // Running the job again finishes nothing twice.
      await db.update(schema.job).set({ status: "pending" }).where(eq(schema.job.id, first.finishing.jobId));
      await course.runJobStep(first.finishing.jobId);
      expect(finishInputs()).toHaveLength(1);
      expect(await db.select().from(schema.lesson).where(eq(schema.lesson.courseId, "c1"))).toHaveLength(2);
    });

    it("keeps the Lesson unfinished when the Teacher fails twice, and a retry finishes it", async () => {
      await writeAndAnswer(1, [true, true, true]);
      const broken: FinishReply = () => {
        throw new Error("Overloaded");
      };
      finishes = [broken, broken];
      vi.spyOn(console, "error").mockImplementation(() => {});

      await finish(1);
      expect(await course.readFinish("c1", 1, "ana")).toMatchObject({ status: "failed" });
      expect((await course.readLesson("c1", 1, ana))?.finishedAt).toBeNull();
      expect(await readRecords()).toHaveLength(1);

      const retried = await course.retryFinish("c1", 1, "ana");
      expect(retried).toMatchObject({ ok: true });
      if (!retried.ok) throw new Error("Not retried.");
      await course.runJobStep(retried.jobId);
      expect((await course.readLesson("c1", 1, ana))?.finishedAt).toBeInstanceOf(Date);
      expect(await course.retryFinish("c1", 1, "ana")).toEqual({ ok: false, reason: "nothing-to-retry" });
    });
  });

  it("gives the Teacher the Mission, the Lesson, every quiz attempt by id, the chat, standing records and the Glossary", async () => {
    await writeAndAnswer(1, [true, false, true]);
    await finish(1);
    await writeAndAnswer(2, [true, true, false]);
    await finish(2);

    const input = finishInputs()[1];
    expect(input).toMatchObject({
      subject: "Music theory",
      language: "en",
      mission: { successLooksLike: ["Explain why the chords of a song belong to the same key"], sittingMinutes: 10 },
      lesson: {
        index: 2,
        title: "Chords that share a key",
        goal: "Spot which chords in a chart belong to G major",
        keyIdea: lessonFixture.keyIdea,
        // Terms already in the Glossary are not introduced again.
        newTerms: [],
      },
      chat: [],
      learningRecords: [{ number: 1, kind: "prior_knowledge" }],
      glossary: [{ term: "Home chord" }, { term: "Key" }],
      referenceSections: [{ title: "Keys you already play" }],
      finishedLessons: [
        { title: "Why these chords belong together" },
        { title: "Chords that share a key" },
      ],
    });
    expect(input.quizAttempts.map((a) => [a.id, a.correct, a.review])).toEqual([
      ["L1Q1", true, false],
      ["L1Q2", false, false],
      ["L1Q3", true, false],
      ["L2Q1", true, false],
      ["L2Q2", true, false],
      ["L2Q3", false, true],
    ]);
    expect(input.quizAttempts[1]).toMatchObject({
      question: lessonFixture.quiz[1].question,
      rightOption: lessonFixture.quiz[1].options[0],
      chosenOption: lessonFixture.quiz[1].options[1],
    });
  });

  describe("the evidence rules", () => {
    /** Finishes Lesson 1 with the given answers and no records, then Lesson 2 with these records. */
    const finishTwo = async (
      lesson1: boolean[],
      lesson2: boolean[],
      records: FinishDraft["learningRecords"],
    ) => {
      finishes = [finishWith({ learningRecords: [] }), finishWith({ learningRecords: records })];
      await writeAndAnswer(1, lesson1);
      await finish(1);
      await writeAndAnswer(2, lesson2);
      await finish(2);
      return (await readRecords()).slice(1).map((r) => r.title);
    };

    it("writes nothing from a wrong answer alone: it is only a quiz attempt", async () => {
      finishes = [
        finishWith({
          learningRecords: [
            record("misconception", "Thinks C major has five notes", ["L1Q3"]),
            record("understanding", "Knows keys", ["L1Q3"]),
          ],
        }),
      ];
      await writeAndAnswer(1, [true, true, false]);
      await finish(1);

      expect(await readRecords()).toHaveLength(1);
      expect((await db.select().from(schema.quizAttempt)).filter((a) => !a.correct)).toHaveLength(1);
    });

    it("writes a misconception only once a later correct attempt corrects it", async () => {
      expect(
        await finishTwo(
          [true, false, true],
          [false, true, true],
          [
            record("misconception", "Thought open strings made chords fit", ["L1Q2", "L2Q3"]),
            record("misconception", "Not corrected yet", ["L2Q1"]),
          ],
        ),
      ).toEqual(["Thought open strings made chords fit"]);
    });

    it("does not count a correct attempt before the wrong one as a correction", async () => {
      expect(
        await finishTwo([true, true, true], [true, true, false], [
          record("misconception", "Mixed up keys", ["L1Q3", "L2Q3"]),
        ]),
      ).toEqual([]);
    });

    it("writes an understanding from two correct attempts, one of them in this Lesson", async () => {
      expect(
        await finishTwo([true, true, true], [true, true, true], [
          record("understanding", "Names a key from its home chord", ["L1Q1", "L2Q3"]),
          record("understanding", "One correct answer", ["L2Q1"]),
          record("understanding", "Only old evidence", ["L1Q1", "L1Q2"]),
          record("understanding", "Unknown ids", ["L9Q1", "C1"]),
        ]),
      ).toEqual(["Names a key from its home chord"]);
      expect(warn).toHaveBeenCalledTimes(3);
    });

    it("never counts a chat message while the Lesson has no chat", async () => {
      expect(
        await finishTwo([true, true, true], [true, true, true], [
          record("understanding", "Explained it in the chat", ["C1"]),
        ]),
      ).toEqual([]);
    });

    it("accepts the chat as evidence: an explanation, or a correction", () => {
      const evidence: Evidence = {
        attempts: new Map([["L1Q1", { lessonIndex: 1, correct: false, at: new Date() }]]),
        learnerChat: new Set(["C2"]),
      };
      expect(recordProblem({ kind: "understanding", evidence: ["C2"] }, evidence, 1)).toBeNull();
      expect(recordProblem({ kind: "misconception", evidence: ["L1Q1", "C2"] }, evidence, 1)).toBeNull();
      expect(recordProblem({ kind: "misconception", evidence: ["L1Q1"] }, evidence, 1)).not.toBeNull();
      expect(recordProblem({ kind: "understanding", evidence: ["C1"] }, evidence, 1)).not.toBeNull();
    });
  });

  describe("Learning records", () => {
    it("are numbered per Course after the existing ones, across Finishes, and shown newest first", async () => {
      finishes = [
        finishWith({
          learningRecords: [
            record("misconception", "First", ["L1Q1", "L1Q2"]),
            record("understanding", "Second", ["L1Q2", "L1Q3"]),
          ],
        }),
        finishWith({ learningRecords: [record("understanding", "Third", ["L1Q2", "L2Q3"])] }),
      ];
      await writeAndAnswer(1, [false, true, true]);
      await finish(1);
      await writeAndAnswer(2, [true, true, true]);
      await finish(2);

      const records = await readRecords();
      expect(records.map((r) => [r.number, r.kind, r.title])).toEqual([
        [1, "prior_knowledge", "Plays open chords from chord charts"],
        [2, "misconception", "First"],
        [3, "understanding", "Second"],
        [4, "understanding", "Third"],
      ]);
      const lessons = await db.select().from(schema.lesson).orderBy(asc(schema.lesson.index));
      expect(records.map((r) => r.lessonId)).toEqual([null, lessons[0].id, lessons[0].id, lessons[1].id]);

      const path = await course.readCoursePath("c1", ana);
      expect(path?.learningRecords.map((r) => r.number)).toEqual([4, 3, 2, 1]);
      expect(path?.learningRecords[0]).toMatchObject({
        title: "Third",
        body: "Third, shown by L1Q2 and L2Q3.",
        createdAt: expect.any(Date),
        superseded: false,
      });
    });

    it("can mark earlier records superseded, each once, and stop giving them to the Teacher", async () => {
      finishes = [
        finishWith({
          learningRecords: [
            record("understanding", "Knows three chords share a key", ["L1Q1", "L1Q2"], [1, 7]),
            record("understanding", "Also claims record 1", ["L1Q1", "L1Q3"], [1]),
          ],
        }),
      ];
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);

      const [prior, first, second] = await readRecords();
      expect(prior.supersededById).toBe(first.id);
      expect(second.supersededById).toBeNull();
      expect((await course.readCoursePath("c1", ana))?.learningRecords.map((r) => [r.number, r.superseded])).toEqual([
        [3, false],
        [2, false],
        [1, true],
      ]);

      await writeAndAnswer(2, [true, true, true]);
      await finish(2);
      expect(finishInputs()[1].learningRecords.map((r) => r.number)).toEqual([2, 3]);
    });
  });

  describe("the Glossary", () => {
    it("promotes a new term when its question was answered correctly in its own Lesson", async () => {
      // The fixture ties "Key" to question 3 and "Home chord" to question 1.
      await writeAndAnswer(1, [false, true, true]);
      await finish(1);
      expect(await readGlossary()).toEqual(["Key"]);
      const [key] = await db.select().from(schema.glossaryTerm);
      expect(key.definition).toBe(lessonFixture.newTerms[0].definition);
    });

    it("never promotes a term tied to no question, to the review question, or not in the Lesson", async () => {
      finishes = [
        finishWith({ glossary: [{ term: "Key", question: null }, { term: "Chord", question: 1 }] }),
        finishWith({ glossary: [{ term: "Relative minor", question: 3 }] }),
      ];
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);
      expect(await readGlossary()).toEqual([]);

      await writeAndAnswer(2, [true, true, true]);
      // Lesson 2's third question is the review of Lesson 1.
      const [lesson2] = await db.select().from(schema.lesson).where(eq(schema.lesson.index, 2));
      await db
        .update(schema.lesson)
        .set({
          content: {
            ...(lesson2.content as object),
            newTerms: [{ term: "Relative minor", definition: "The minor key sharing its notes." }],
          },
        })
        .where(eq(schema.lesson.id, lesson2.id));
      await finish(2);
      expect(await readGlossary()).toEqual([]);
    });

    it("normalises casing and never adds a term twice", async () => {
      finishes = [
        finishWith({ glossary: [{ term: "home  chord", question: 1 }, { term: "HOME CHORD", question: 1 }] }),
      ];
      await writeAndAnswer(1, [true, true, true]);
      const [lesson1] = await db.select().from(schema.lesson).where(eq(schema.lesson.index, 1));
      await db
        .update(schema.lesson)
        .set({
          content: {
            ...(lesson1.content as object),
            newTerms: [{ term: "home  chord", definition: "The chord where the music rests." }],
          },
        })
        .where(eq(schema.lesson.id, lesson1.id));
      await db.insert(schema.glossaryTerm).values({ courseId: "c1", term: "key", definition: "Old." });

      await finish(1);
      expect(await readGlossary()).toEqual(["Home chord", "key"]);

      // The same term in another casing is refused by the database too.
      await expect(
        db.insert(schema.glossaryTerm).values({ courseId: "c1", term: "KEY", definition: "Again." }),
      ).rejects.toThrow();
    });
  });

  describe("the Reference sheet", () => {
    it("gets the Key idea, and grows sections from the Finish, rewriting one with the same title", async () => {
      finishes = [
        finishWith({}),
        finishWith({
          referenceSections: [
            { title: "Keys YOU already play", body: "G major and C major." },
            { title: "Home chords", body: "The first and last chord." },
            { title: "A third", body: "Too many for one Finish." },
          ],
        }),
      ];
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);

      let sheet = await course.readReferenceSheet("c1", ana);
      expect(sheet?.keyIdeas.map((k) => k.text)).toEqual([lessonFixture.keyIdea]);
      expect(sheet?.sections).toEqual(finishFixture.referenceSections);

      await writeAndAnswer(2, [true, true, true]);
      await finish(2);
      sheet = await course.readReferenceSheet("c1", ana);
      expect(sheet?.keyIdeas.map((k) => k.lessonIndex)).toEqual([1, 2]);
      expect(sheet?.sections).toEqual([
        { title: "Keys YOU already play", body: "G major and C major." },
        { title: "Home chords", body: "The first and last chord." },
      ]);
    });
  });

  describe("Up next", () => {
    it("follows the goal rules: a broken pick is chosen again with the reason and the new records", async () => {
      finishes = [
        finishWith({
          learningRecords: [record("understanding", "Knows keys", ["L1Q1", "L1Q3"])],
          upNext: { title: "Keys", goal: "Understand the circle of fifths", minutes: 10 },
        }),
      ];
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);

      const picks = teacher.calls.flatMap((c) => (c.op === "pickUpNext" ? [c.input] : []));
      expect(picks).toHaveLength(1);
      expect(picks[0].feedback).toContain('starts with "understand"');
      expect(picks[0].learningRecords.map((r) => [r.number, r.title])).toEqual([
        [1, "Plays open chords from chord charts"],
        [2, "Knows keys"],
      ]);
      expect(picks[0].finishedLessons.map((l) => l.title)).toEqual(["Why these chords belong together"]);
      // The fake's pick keeps the rules.
      expect((await course.readCoursePath("c1", ana))?.upNext).toMatchObject({
        index: 2,
        title: "First steps in Music theory",
      });
    });

    it("never repeats a finished Lesson", async () => {
      finishes = [
        finishWith({
          upNext: { title: "Why these chords belong together", goal: "Name a key", minutes: 10 },
        }),
      ];
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);

      const picks = teacher.calls.flatMap((c) => (c.op === "pickUpNext" ? [c.input] : []));
      expect(picks[0].feedback).toContain("is a finished Lesson");
    });

    it("fails the Finish, finishing nothing, when the pick breaks the rules twice", async () => {
      teacher = createFakeTeacher({
        writeLesson: lessonFixture,
        finishLesson: finishWith({ upNext: { title: "Keys", goal: "Learn keys", minutes: 10 } }),
        pickUpNext: { title: "Keys", goal: "Learn keys", minutes: 10 },
      });
      course = createCourseModule({ db, teacher, fetchUrl: createFakeUrlFetcher(), random: firstToLast });
      vi.spyOn(console, "error").mockImplementation(() => {});
      await writeAndAnswer(1, [true, true, true]);
      await finish(1);

      expect(await course.readFinish("c1", 1, "ana")).toMatchObject({ status: "failed" });
      expect((await course.readCoursePath("c1", ana))?.finishedLessons).toEqual([]);
      expect(await db.select().from(schema.glossaryTerm)).toEqual([]);
    });
  });
});
