import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schema, type Db } from "@/db";
import type { LessonDraft, QuestionDraft } from "@/teacher";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import lessonFixture from "@/teacher/fixtures/lesson-music-theory.json";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, DEFAULT_DAILY_LIMITS, EXAMPLE_COURSE_ID, type CourseModule } from ".";

const lesson = lessonFixture as LessonDraft;
const ana = { learnerId: "ana" };

/** Always 0: the shuffle moves option i to position (i + 3) % 4, so the first option lands last. */
const firstToLast = () => 0;

describe("course: writing the Up next Lesson and answering its quiz", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let course: CourseModule;
  let warn: ReturnType<typeof vi.spyOn>;

  const setUp = async (replies: FakeTeacherReplies = {}, { language = "en" } = {}) => {
    db = await createTestDb();
    teacher = createFakeTeacher({ writeLesson: lessonFixture, ...replies });
    course = createCourseModule({
      db,
      teacher,
      fetchUrl: createFakeUrlFetcher(),
      random: firstToLast,
    });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
    await db.insert(schema.course).values({
      id: "c1",
      learnerId: "ana",
      subject: "Music theory",
      title: "Music theory for the guitar you already play",
      language,
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
      id: "l1",
      courseId: "c1",
      index: 1,
      title: "Why these chords belong together",
      goal: "Name the key of a song from its chord chart",
      minutes: 10,
    });
  };

  /** Opens the Lesson as Ana and runs its job the way the app does. */
  const openAndWrite = async (index = 1) => {
    const opened = await course.openLesson("c1", index, "ana");
    if (!opened.ok || !opened.generation) throw new Error("The Lesson did not start writing.");
    await course.runJobStep(opened.generation.jobId);
    return opened.generation.jobId;
  };

  const readJob = async (jobId: string) => {
    const [job] = await db.select().from(schema.job).where(eq(schema.job.id, jobId));
    return job;
  };

  /** The inputs of every call to one Teacher operation, in order. */
  const calls = <Op extends FakeTeacher["calls"][number]["op"]>(op: Op) =>
    teacher.calls.flatMap((c) =>
      c.op === op ? [c.input as Extract<FakeTeacher["calls"][number], { op: Op }>["input"]] : [],
    );

  /** The fixture Lesson with some parts replaced. */
  const lessonWith = (changes: Partial<LessonDraft>): LessonDraft => ({ ...lesson, ...changes });

  /** Replies with `broken` first, then with the fixture once given feedback. */
  const brokenThenFixed = (broken: LessonDraft): FakeTeacherReplies => ({
    writeLesson: (input) => (input.feedback === null ? broken : lesson),
  });

  const withQuestion = (index: number, question: Partial<QuestionDraft>): LessonDraft =>
    lessonWith({
      quiz: lesson.quiz.map((q, i) => (i === index ? { ...q, ...question } : q)),
    });

  beforeEach(async () => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await setUp();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("the first open", () => {
    it("starts a Lesson generation job and shows its progress until the Lesson is written", async () => {
      const opened = await course.openLesson("c1", 1, "ana");
      expect(opened).toMatchObject({
        ok: true,
        start: true,
        generation: { status: "working", progress: [], stalled: false },
      });
      if (!opened.ok || !opened.generation) throw new Error("No job.");
      const jobId = opened.generation.jobId;
      expect(await readJob(jobId)).toMatchObject({
        kind: "lesson_generation",
        lessonId: "l1",
        step: "write",
        status: "pending",
      });

      const before = await course.readLesson("c1", 1, ana);
      expect(before).toMatchObject({ content: null, generation: { jobId, status: "working" } });
      expect((await course.readCoursePath("c1", ana))?.upNext?.started).toBe(true);

      expect(await course.runJobStep(jobId)).toBe("stop");

      expect(await course.readLessonGeneration("c1", 1, "ana")).toEqual({
        jobId,
        status: "done",
        stalled: false,
        resumesAt: null,
        progress: [
          "Writing “Why these chords belong together”.",
          "Checking the quiz.",
          "Your Lesson is ready.",
        ],
      });
      const after = await course.readLesson("c1", 1, ana);
      expect(after?.content).toMatchObject({
        hook: lesson.hook,
        keyIdea: lesson.keyIdea,
        practice: lesson.practice,
        readNext: { number: 1, url: "https://example.org/r1" },
        newTerms: lesson.newTerms,
      });
      expect(after?.content?.sections.map((s) => s.citations.map((c) => c.number))).toEqual([
        [1, 2],
        [3],
      ]);
      expect(after?.generation).toBeNull();
    });

    it("gives the Teacher the Mission, Up next, Resources, Glossary, earlier Key ideas and Learning records", async () => {
      await openAndWrite();

      expect(calls("writeLesson")).toHaveLength(1);
      expect(calls("writeLesson")[0]).toEqual({
        subject: "Music theory",
        language: "en",
        mission: {
          why: "Understand the songs I already play on guitar.",
          successLooksLike: ["Explain why the chords of a song belong to the same key"],
          constraints: ["10 minutes per sitting"],
          outOfScope: [],
          sittingMinutes: 10,
        },
        lesson: {
          index: 1,
          title: "Why these chords belong together",
          goal: "Name the key of a song from its chord chart",
        },
        resources: ["r1", "r2", "r3"].map((id) => ({
          id,
          kind: "site",
          title: `Resource ${id.slice(1)}`,
          author: "Someone",
          why: "It fits.",
        })),
        glossary: [],
        keyIdeas: [],
        learningRecords: [
          {
            number: 1,
            kind: "prior_knowledge",
            title: "Plays open chords from chord charts",
            body: "Said in the Interview they can strum G, C, D, Em and Am.",
          },
        ],
        feedback: null,
      });
    });

    it("writes the Lesson in the Interview's language", async () => {
      await setUp({}, { language: "es" });
      await openAndWrite();

      expect(calls("writeLesson")[0].language).toBe("es");
    });

    it("is only for the Course's own Learner, and never for the Example course", async () => {
      expect(await course.openLesson("c1", 1, "ben")).toEqual({ ok: false, reason: "not-found" });
      expect(await course.openLesson("c1", 9, "ana")).toEqual({ ok: false, reason: "not-found" });
      await course.ensureExampleCourse();
      expect(await course.openLesson(EXAMPLE_COURSE_ID, 3, "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });
      expect(await course.readLessonGeneration("c1", 1, "ben")).toBeNull();
      expect(await db.$count(schema.job)).toBe(0);
    });
  });

  describe("caching", () => {
    it("loads the written Lesson on later opens, without writing it again", async () => {
      const jobId = await openAndWrite();
      const written = await course.readLesson("c1", 1, ana);
      const [{ openedAt }] = await db.select().from(schema.lesson);

      expect(await course.openLesson("c1", 1, "ana")).toEqual({
        ok: true,
        generation: null,
        start: false,
      });
      expect(await course.runJobStep(jobId)).toBe("stop");

      expect(calls("writeLesson")).toHaveLength(1);
      expect(await course.readLesson("c1", 1, ana)).toEqual(written);
      const [row] = await db.select().from(schema.lesson);
      expect(row.openedAt).toEqual(openedAt);
      expect(row.openedAt).not.toBeNull();
    });

    it("never rewrites a written Lesson, even if its job is run again", async () => {
      const jobId = await openAndWrite();
      const written = await course.readLesson("c1", 1, ana);
      await db.update(schema.job).set({ status: "pending" }).where(eq(schema.job.id, jobId));

      expect(await course.runJobStep(jobId)).toBe("stop");

      expect(calls("writeLesson")).toHaveLength(1);
      expect(await course.readLesson("c1", 1, ana)).toEqual(written);
      expect(await course.retryLessonGeneration("c1", 1, "ana")).toEqual({
        ok: false,
        reason: "nothing-to-retry",
      });
    });

    it("keeps one job however many times the Lesson is opened before it is written", async () => {
      const first = await course.openLesson("c1", 1, "ana");
      const second = await course.openLesson("c1", 1, "ana");

      expect(second).toEqual(first);
      expect(await db.$count(schema.job)).toBe(1);
    });
  });

  describe("semantic checks", () => {
    const expectRetriedWith = async (feedback: RegExp) => {
      await openAndWrite();
      const inputs = calls("writeLesson");
      expect(inputs).toHaveLength(2);
      expect(inputs[1].feedback).toMatch(feedback);
      expect((await course.readLesson("c1", 1, ana))?.content?.keyIdea).toBe(lesson.keyIdea);
    };

    it("retries once when a citation is not one of the Course's Resources", async () => {
      await setUp(
        brokenThenFixed(
          lessonWith({
            sections: [lesson.sections[0], { ...lesson.sections[1], citations: ["r9"] }],
          }),
        ),
      );
      await expectRetriedWith(/"r9" is not a Resource of this Course; .*r1, r2, r3/);
    });

    it("retries once when Read next is not one of the Course's Resources", async () => {
      await setUp(brokenThenFixed(lessonWith({ readNext: "r7" })));
      await expectRetriedWith(/"r7" is not a Resource of this Course/);
    });

    it("retries once when a section cites nothing", async () => {
      await setUp(
        brokenThenFixed(
          lessonWith({ sections: [lesson.sections[0], { ...lesson.sections[1], citations: [] }] }),
        ),
      );
      await expectRetriedWith(/Section 2 cites no Resource/);
    });

    it("retries once when reading plus practice does not fit the sitting", async () => {
      await setUp(brokenThenFixed(lessonWith({ practiceMinutes: 9 })));
      await expectRetriedWith(/practice 9; together they must fit one 10-minute sitting/);
    });

    it("retries once when a Resource id appears in the prose", async () => {
      await setUp(
        brokenThenFixed(
          lessonWith({ hook: "As r2 explains, keys matter.", keyIdea: "See [r1] for more." }),
        ),
      );
      await expectRetriedWith(/Resource ids appear in the hook, the Key idea;/);
    });

    it("retries once when the counts are wrong", async () => {
      await setUp(
        brokenThenFixed(
          lessonWith({
            sections: [lesson.sections[0]],
            quiz: lesson.quiz.slice(0, 2),
            practice: { ...lesson.practice, steps: lesson.practice.steps.slice(0, 2) },
          }),
        ),
      );
      await expectRetriedWith(/There are 1 sections.*2 steps.*2 questions/);
    });

    it("retries once when a question has the wrong number of options", async () => {
      await setUp(brokenThenFixed(withQuestion(1, { options: ["Yes", "No", "Maybe"] })));
      await expectRetriedWith(/Question 2 has 3 options; give exactly 4/);
    });

    it("retries once when the Teacher's call fails", async () => {
      let failed = false;
      await setUp({
        writeLesson: () => {
          if (!failed) {
            failed = true;
            throw new Error("Output did not match the schema");
          }
          return lessonFixture;
        },
      });
      await openAndWrite();

      expect(calls("writeLesson")).toHaveLength(2);
      expect((await course.readLesson("c1", 1, ana))?.content).not.toBeNull();
    });

    it("fails the job after a second broken draft, with a friendly retry that writes it", async () => {
      let broken = true;
      await setUp({ writeLesson: () => (broken ? lessonWith({ readNext: "r7" }) : lessonFixture) });
      const jobId = await openAndWrite();

      expect(calls("writeLesson")).toHaveLength(2);
      expect(await readJob(jobId)).toMatchObject({
        status: "failed",
        error: expect.stringContaining("The Lesson broke its rules twice"),
      });
      expect(await course.readLessonGeneration("c1", 1, "ana")).toMatchObject({
        status: "failed",
      });
      expect((await course.readLesson("c1", 1, ana))?.content).toBeNull();

      broken = false;
      expect(await course.retryLessonGeneration("c1", 1, "ben")).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await course.retryLessonGeneration("c1", 1, "ana")).toEqual({ ok: true, jobId });
      expect(await course.runJobStep(jobId)).toBe("stop");

      expect((await readJob(jobId)).status).toBe("done");
      expect((await course.readLesson("c1", 1, ana))?.content?.keyIdea).toBe(lesson.keyIdea);
    });
  });

  describe("the quiz rule", () => {
    it("ships questions that keep it without rewriting any", async () => {
      await openAndWrite();

      expect(calls("rewriteQuestion")).toHaveLength(0);
      expect(warn).not.toHaveBeenCalled();
    });

    it("rewrites alone, once, a question whose options differ in word count", async () => {
      const unequal = { options: ["C major", "G", "The key of D major", "E minor"] };
      await setUp({
        writeLesson: withQuestion(0, unequal),
        rewriteQuestion: {
          ...lesson.quiz[0],
          question: "Rewritten: which key?",
        },
      });
      await openAndWrite();

      expect(calls("rewriteQuestion")).toHaveLength(1);
      expect(calls("rewriteQuestion")[0]).toMatchObject({
        language: "en",
        lesson: { title: "Why these chords belong together", keyIdea: lesson.keyIdea },
        question: { ...lesson.quiz[0], ...unequal },
        problem: expect.stringMatching(/2, 1, 5, 2 words; give every option exactly the same/),
      });
      const quiz = (await course.readLesson("c1", 1, ana))?.content?.quiz;
      expect(quiz?.map((q) => q.question)).toEqual([
        "Rewritten: which key?",
        lesson.quiz[1].question,
        lesson.quiz[2].question,
      ]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("rewrites a question whose option lengths differ by more than 30%", async () => {
      await setUp({
        writeLesson: withQuestion(2, { options: ["Seven", "Five", "Eight", "Twelve-hundred"] }),
      });
      await openAndWrite();

      expect(calls("rewriteQuestion")).toHaveLength(1);
      expect(calls("rewriteQuestion")[0].problem).toMatch(
        /4 to 14 characters long; keep their lengths within 30%/,
      );
    });

    it("ships a question that still breaks it after the rewrite, and logs it", async () => {
      const unequal = { options: ["C major", "G", "The key of D major", "E minor"] };
      await setUp({
        writeLesson: withQuestion(0, unequal),
        rewriteQuestion: { ...lesson.quiz[0], ...unequal, question: "Still unequal?" },
      });
      await openAndWrite();

      expect(calls("rewriteQuestion")).toHaveLength(1);
      const quiz = (await course.readLesson("c1", 1, ana))?.content?.quiz;
      expect(quiz?.[0].question).toBe("Still unequal?");
      expect(new Set(quiz?.[0].options)).toEqual(new Set(unequal.options));
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/question 1 still breaks the quiz rule; shipping it/),
      );
    });

    it("keeps the original when the rewrite is malformed, and logs it", async () => {
      const unequal = { options: ["C major", "G", "The key of D major", "E minor"] };
      await setUp({
        writeLesson: withQuestion(0, unequal),
        rewriteQuestion: { ...lesson.quiz[0], options: ["One", "Two"] },
      });
      await openAndWrite();

      const quiz = (await course.readLesson("c1", 1, ana))?.content?.quiz;
      expect(quiz?.[0].question).toBe(lesson.quiz[0].question);
      expect(new Set(quiz?.[0].options)).toEqual(new Set(unequal.options));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Keeping the original/));
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/still breaks the quiz rule/));
    });
  });

  describe("shuffling and review", () => {
    it("shuffles every question's options in code, and the stored answer follows the shuffle", async () => {
      await openAndWrite();

      const [row] = await db.select().from(schema.lesson);
      const stored = (row.content as { quiz: { options: string[]; answer: number }[] }).quiz;
      stored.forEach((q, i) => {
        const original = lesson.quiz[i];
        expect(q.options).toEqual([...original.options.slice(1), original.options[0]]);
        expect(q.options[q.answer]).toBe(original.options[original.answer]);
      });
    });

    it("has no review question in the first Lesson", async () => {
      await openAndWrite();

      const quiz = (await course.readLesson("c1", 1, ana))?.content?.quiz;
      expect(quiz?.map((q) => q.review)).toEqual([false, false, false]);
    });

    it("from the second Lesson on, gives the Teacher the earlier Key ideas and tags the last question review", async () => {
      await openAndWrite();
      await db.update(schema.lesson).set({ finishedAt: new Date() }).where(eq(schema.lesson.id, "l1"));
      await db.insert(schema.glossaryTerm).values({
        courseId: "c1",
        term: "Key",
        definition: "The family of seven notes a song is built from.",
        lessonId: "l1",
      });
      await db.insert(schema.lesson).values({
        id: "l2",
        courseId: "c1",
        index: 2,
        title: "Building the major scale",
        goal: "Play the G major scale on one string",
      });

      await openAndWrite(2);

      const input = calls("writeLesson")[1];
      expect(input.lesson).toEqual({
        index: 2,
        title: "Building the major scale",
        goal: "Play the G major scale on one string",
      });
      expect(input.keyIdeas).toEqual([
        { lessonIndex: 1, lessonTitle: "Why these chords belong together", text: lesson.keyIdea },
      ]);
      expect(input.glossary).toEqual([
        { term: "Key", definition: "The family of seven notes a song is built from." },
      ]);
      const content = (await course.readLesson("c1", 2, ana))?.content;
      expect(content?.quiz.map((q) => q.review)).toEqual([false, false, true]);
      // "Key" is already in the Glossary, so it is not new here.
      expect(content?.newTerms.map((t) => t.term)).toEqual(["Home chord"]);
    });
  });

  describe("quiz attempts", () => {
    beforeEach(async () => {
      await openAndWrite();
    });

    /** The stored position of the fixture's right answer to question `i`. */
    const rightOption = async (i: number) =>
      (await course.readLesson("c1", 1, ana))!.content!.quiz[i].answer;

    it("stores a pick with whether it was right and when, and locks the question", async () => {
      const right = await rightOption(0);
      const wrong = (right + 1) % 4;

      const first = await course.answerQuestion("c1", 1, 0, wrong, "ana");
      expect(first).toEqual({
        ok: true,
        attempt: { questionIndex: 0, chosenOption: wrong, correct: false, at: expect.any(Date) },
        allAnswered: false,
      });

      // Locked: a second pick returns the first.
      expect(await course.answerQuestion("c1", 1, 0, right, "ana")).toMatchObject({
        ok: true,
        attempt: { chosenOption: wrong, correct: false },
      });
      expect(await db.$count(schema.quizAttempt)).toBe(1);
      expect((await course.readLesson("c1", 1, ana))?.answers).toEqual([
        { questionIndex: 0, chosenOption: wrong },
      ]);
    });

    it("turns Finish on once every question has an answer", async () => {
      for (const i of [0, 1]) {
        expect(await course.answerQuestion("c1", 1, i, await rightOption(i), "ana")).toMatchObject({
          ok: true,
          attempt: { correct: true },
          allAnswered: false,
        });
      }
      expect(await course.answerQuestion("c1", 1, 2, await rightOption(2), "ana")).toMatchObject({
        ok: true,
        allAnswered: true,
      });
      expect((await course.readLesson("c1", 1, ana))?.answers).toHaveLength(3);
    });

    it("rejects picks that are not the Learner's to make", async () => {
      expect(await course.answerQuestion("c1", 1, 0, 0, "ben")).toEqual({
        ok: false,
        reason: "not-found",
      });
      expect(await course.answerQuestion("c1", 1, 3, 0, "ana")).toEqual({
        ok: false,
        reason: "invalid",
      });
      expect(await course.answerQuestion("c1", 1, 0, 4, "ana")).toEqual({
        ok: false,
        reason: "invalid",
      });
      await db.update(schema.lesson).set({ finishedAt: new Date() }).where(eq(schema.lesson.id, "l1"));
      expect(await course.answerQuestion("c1", 1, 0, 0, "ana")).toEqual({
        ok: false,
        reason: "finished",
      });
      await course.ensureExampleCourse();
      expect(await course.answerQuestion(EXAMPLE_COURSE_ID, 3, 0, 0, "ana")).toEqual({
        ok: false,
        reason: "read-only",
      });
      expect(await db.$count(schema.quizAttempt, eq(schema.quizAttempt.lessonId, "l1"))).toBe(0);
    });

    it("rejects picks in a Lesson that is not written yet", async () => {
      await db.insert(schema.lesson).values({
        courseId: "c1",
        index: 2,
        title: "Next",
        goal: "Play the next thing",
      });
      expect(await course.answerQuestion("c1", 2, 0, 0, "ana")).toEqual({
        ok: false,
        reason: "not-written",
      });
    });
  });

  describe("writing Up next ahead of its first open", () => {
    it("writes the Lesson in the background, so the first open finds it ready", async () => {
      const jobId = await course.writeUpNextAhead("c1", "ana");
      expect(jobId).not.toBeNull();
      expect(await readJob(jobId!)).toMatchObject({ kind: "lesson_generation", lessonId: "l1" });
      expect(await course.runJobStep(jobId!)).toBe("stop");

      // Written, but not opened: the Path doesn't call it started.
      const path = await course.readCoursePath("c1", ana);
      expect(path?.upNext).toMatchObject({ index: 1, started: false, ready: true });

      expect(await course.openLesson("c1", 1, "ana")).toEqual({
        ok: true,
        generation: null,
        start: false,
      });
      expect((await course.readLesson("c1", 1, ana))?.content?.keyIdea).toBe(lesson.keyIdea);
      expect(calls("writeLesson")).toHaveLength(1);
    });

    it("lets a first open during the writing follow the same job", async () => {
      const jobId = await course.writeUpNextAhead("c1", "ana");
      const opened = await course.openLesson("c1", 1, "ana");
      expect(opened).toMatchObject({ ok: true, generation: { jobId, status: "working" }, start: true });
      expect(await course.writeUpNextAhead("c1", "ana")).toBeNull();
    });

    it("counts against the Course's allowance like an open", async () => {
      await course.writeUpNextAhead("c1", "ana");
      const path = await course.readCoursePath("c1", ana);
      expect(path?.lessonAllowance).toEqual({ lessons: 20, written: 1 });
    });

    it("waits while a Mission change waits for the Learner, since it may re-pick Up next", async () => {
      await db.insert(schema.proposal).values({
        courseId: "c1",
        kind: "mission_change",
        source: "finish",
        reason: "You said you want to write songs now.",
      });
      expect(await course.writeUpNextAhead("c1", "ana")).toBeNull();

      await db.update(schema.proposal).set({ status: "declined", decidedAt: new Date() });
      expect(await course.writeUpNextAhead("c1", "ana")).not.toBeNull();
    });

    it("writes nothing for another Learner, a Done Course or the Example course", async () => {
      expect(await course.writeUpNextAhead("c1", "ben")).toBeNull();
      await course.ensureExampleCourse();
      expect(await course.writeUpNextAhead(EXAMPLE_COURSE_ID, "ana")).toBeNull();
      await db.update(schema.course).set({ status: "done" }).where(eq(schema.course.id, "c1"));
      expect(await course.writeUpNextAhead("c1", "ana")).toBeNull();
      expect(await db.$count(schema.job)).toBe(0);
    });

    it("leaves the Lesson for its first open when today's Lessons are used up", async () => {
      course = createCourseModule({
        db,
        teacher,
        fetchUrl: createFakeUrlFetcher(),
        random: firstToLast,
        limits: { ...DEFAULT_DAILY_LIMITS, lessonGenerations: 0 },
      });
      expect(await course.writeUpNextAhead("c1", "ana")).toBeNull();
      expect(await course.openLesson("c1", 1, "ana")).toMatchObject({
        ok: false,
        reason: "daily-limit",
      });
    });

    it("starts once the job that picked Up next is done, and only then", async () => {
      const [creation] = await db
        .insert(schema.job)
        .values({ courseId: "c1", kind: "course_creation", step: "up_next", status: "running" })
        .returning();
      expect(await course.writeUpNextAfter(creation.id)).toBeNull();

      await db.update(schema.job).set({ status: "done" }).where(eq(schema.job.id, creation.id));
      const jobId = await course.writeUpNextAfter(creation.id);
      expect(jobId).not.toBeNull();
      // A Lesson generation job starts no other.
      expect(await course.writeUpNextAfter(jobId!)).toBeNull();
      expect(await course.writeUpNextAfter("no-such-job")).toBeNull();
    });
  });
});
