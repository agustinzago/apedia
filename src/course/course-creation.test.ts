import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createFakeTeacher, type FakeTeacher, type FakeTeacherReplies } from "@/teacher/fake";
import missionMusicTheory from "@/teacher/fixtures/mission-music-theory.json";
import researchSearch from "@/teacher/fixtures/research-search-music-theory.json";
import researchStructure from "@/teacher/fixtures/research-structure-music-theory.json";
import upNext from "@/teacher/fixtures/up-next-music-theory.json";
import { buyCourse } from "@/test/credits";
import { createTestDb } from "@/test/db";
import type { UrlCheck } from "@/url-fetcher";
import { createFakeUrlFetcher, type FakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, type CourseModule } from ".";

describe("course: the Course creation job, from research to Up next", () => {
  let db: Db;
  let teacher: FakeTeacher;
  let fetchUrl: FakeUrlFetcher;
  let course: CourseModule;

  const setUp = async (
    replies: FakeTeacherReplies = {},
    outcomes: Record<string, number | UrlCheck> = {},
  ) => {
    db = await createTestDb();
    teacher = createFakeTeacher({
      writeMission: missionMusicTheory,
      researchSearch,
      researchStructure,
      pickUpNext: upNext,
      ...replies,
    });
    fetchUrl = createFakeUrlFetcher(outcomes);
    course = createCourseModule({ db, teacher, fetchUrl });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  };

  /** Buy a Course → Interview → "Write my course", as Ana. */
  const writeCourse = async () => {
    await buyCourse(course, "ana");
    const started = await course.startInterview(
      {
        subject: "Music theory",
        why: "To understand the songs I already play on guitar",
      },
      "ana",
    );
    if ("reason" in started) throw new Error(`The Interview was refused: ${started.reason}.`);
    await course.answerInterview(started.id, "I can strum G, C, D, Em and Am from chord charts", "ana");
    await course.answerInterview(started.id, "Work out the chords of a song myself", "ana");
    await course.chooseSittingLength(started.id, 10, "ana");
    const written = await course.writeCourse(started.id, "ana");
    if (!written.ok || !written.jobId) throw new Error("The Course was not written.");
    return { courseId: written.courseId, jobId: written.jobId };
  };

  /** Runs steps the way the app does, one invocation each, until the job stops. */
  const runToEnd = async (jobId: string) => {
    for (let i = 0; i < 10; i++) {
      if ((await course.runJobStep(jobId)) === "stop") return;
    }
    throw new Error("The job never stopped.");
  };

  const readJob = async (jobId: string) => {
    const [job] = await db.select().from(schema.job).where(eq(schema.job.id, jobId));
    return job;
  };

  /** In Resource number order: r1, r2, … r10. */
  const resourcesOf = async (courseId: string) =>
    (await db.select().from(schema.resource).where(eq(schema.resource.courseId, courseId))).sort(
      (a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)),
    );

  const calls = (op: FakeTeacher["calls"][number]["op"]) =>
    teacher.calls.filter((c) => c.op === op);

  /** A structure reply with the given Resources, all of whose URLs were "searched". */
  const researchWith = (
    resources: { kind: string; url: string; title?: string }[],
    { searched = resources.map((r) => r.url) }: { searched?: string[] } = {},
  ): FakeTeacherReplies => ({
    researchSearch: {
      text: "Candidates.",
      results: searched.map((url) => ({ url, title: url })),
    },
    researchStructure: {
      resources: resources.map((r, i) => ({
        kind: r.kind,
        title: r.title ?? `Resource ${i + 1}`,
        author: "Someone",
        url: r.url,
        why: "It fits.",
        language: "en",
      })),
      communities: researchStructure.communities,
      gaps: [],
    },
  });

  beforeEach(async () => {
    await setUp();
  });

  it("queues the job when the Course is written, and writing again returns the same job", async () => {
    const { courseId, jobId } = await writeCourse();

    expect(await readJob(jobId)).toMatchObject({
      courseId,
      kind: "course_creation",
      status: "pending",
      step: "search",
      progress: [],
      searchOutput: null,
      error: null,
    });
    const interviewId = (await db.select().from(schema.interview))[0].id;
    expect(await course.writeCourse(interviewId, "ana")).toEqual({ ok: true, courseId, jobId });
    expect(calls("researchSearch")).toHaveLength(0);
  });

  it("searches, structures and checks Resources, picks Up next, and ends on the Path with Up next shown", async () => {
    const { courseId, jobId } = await writeCourse();

    // Step 1: search. Its raw output is saved on the job row.
    expect(await course.runJobStep(jobId)).toBe("more");
    expect(await readJob(jobId)).toMatchObject({
      status: "pending",
      step: "structure",
      searchOutput: researchSearch,
    });
    const midway = await course.readCoursePath(courseId, { learnerId: "ana" });
    expect(midway).toMatchObject({ preparing: true, upNext: null });
    expect(midway?.creation).toMatchObject({
      jobId,
      status: "working",
      stalled: false,
      progress: [
        "Looking for trustworthy books, courses and sites on Music theory.",
        "Found 7 pages worth a closer look.",
      ],
    });

    // Step 2: structure and the URL check.
    expect(await course.runJobStep(jobId)).toBe("more");
    // Step 3: Up next.
    expect(await course.runJobStep(jobId)).toBe("stop");

    const resources = await resourcesOf(courseId);
    expect(resources.map((r) => [r.ref, r.kind, r.title, r.checkOutcome])).toEqual([
      ["r1", "site", "musictheory.net — Lessons", "ok"],
      ["r2", "book", "Open Music Theory", "ok"],
      ["r3", "book", "Music Theory for Guitarists", "ok"],
      ["r4", "course", "Fundamentals of Music Theory", "ok"],
      ["r5", "course", "Practical Music Theory", "ok"],
    ]);
    expect(resources[0]).toMatchObject({
      author: "Ricci Adams",
      url: "https://www.musictheory.net/lessons",
      why: "Short, free interactive lessons on steps, scales and chords.",
      language: "en",
      verifiedAt: expect.any(Date),
    });
    // The store link and the URL no search returned were never fetched.
    expect(fetchUrl.calls).toHaveLength(5);
    expect(fetchUrl.calls).not.toContain("https://www.amazon.com/dp/0793574009");

    const communities = await db
      .select()
      .from(schema.community)
      .where(eq(schema.community.courseId, courseId));
    expect(communities.map((c) => [c.name, c.url, c.offline])).toEqual([
      ["r/musictheory", "https://www.reddit.com/r/musictheory/", false],
      ["Open mic and jam nights", null, true],
    ]);
    expect(communities[1].where).toMatch(/near you/);
    const gaps = await db.select().from(schema.gap).where(eq(schema.gap.courseId, courseId));
    expect(gaps.map((g) => g.description)).toEqual([
      "Hearing a song's key by ear, without the chord chart",
    ]);

    const path = await course.readCoursePath(courseId, { learnerId: "ana" });
    expect(path).toMatchObject({
      preparing: false,
      creation: null,
      finishedLessons: [],
      upNext: {
        index: 1,
        title: "Why these chords belong together",
        goal: "Name the key of a song from its chord chart",
        minutes: 10,
        started: false,
      },
    });
    expect(await course.readCourseCreation(courseId, "ana")).toEqual({
      jobId,
      status: "done",
      stalled: false,
      resumesAt: null,
      progress: [
        "Looking for trustworthy books, courses and sites on Music theory.",
        "Found 7 pages worth a closer look.",
        "Reading what I found and choosing the best of it.",
        "Checking that every link works.",
        "Kept 5 Resources and 2 Communities.",
        "Choosing your first Lesson.",
        "Your first Lesson is ready: “Why these chords belong together”.",
      ],
    });
    expect(await readJob(jobId)).toMatchObject({ status: "done", error: null });
    expect(calls("researchSearch")).toHaveLength(1);
    expect(calls("researchStructure")).toHaveLength(1);
  });

  it("picks Up next from the Mission and the Learning records", async () => {
    const { jobId } = await writeCourse();
    await runToEnd(jobId);

    const [pick] = calls("pickUpNext");
    expect(pick.input).toMatchObject({
      subject: "Music theory",
      language: "en",
      mission: {
        successLooksLike: missionMusicTheory.successLooksLike,
        sittingMinutes: 10,
      },
      learningRecords: [
        { number: 1, kind: "prior_knowledge", title: "Plays open chords from chord charts" },
      ],
      finishedLessons: [],
      feedback: null,
    });
    expect(pick.input).toMatchObject({
      resources: expect.arrayContaining([
        expect.objectContaining({ kind: "site", title: "musictheory.net — Lessons" }),
      ]),
    });
  });

  it("gives research the Mission and structure the saved search output", async () => {
    const { jobId } = await writeCourse();
    await runToEnd(jobId);

    const [search] = calls("researchSearch");
    expect(search.input).toMatchObject({
      subject: "Music theory",
      language: "en",
      mission: {
        why: missionMusicTheory.why,
        constraints: ["10 minutes per sitting", "Learns on guitar only; no piano at home"],
      },
    });
    expect(calls("researchStructure")[0].input).toMatchObject({ findings: researchSearch });
  });

  describe("a structure failure", () => {
    it("is retried at once without searching again", async () => {
      let attempts = 0;
      await setUp({
        researchStructure: () => {
          if (++attempts === 1) throw new Error("Output did not match the schema");
          return researchStructure;
        },
      });
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({ status: "done" });
      expect(await resourcesOf(courseId)).toHaveLength(5);
      expect(calls("researchSearch")).toHaveLength(1);
      expect(calls("researchStructure")).toHaveLength(2);
    });

    it("that happens twice stops the job at structure; retrying resumes there, keeping the search", async () => {
      let attempts = 0;
      await setUp({
        researchStructure: () => {
          if (++attempts <= 2) throw new Error("Output did not match the schema");
          return researchStructure;
        },
      });
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({
        status: "failed",
        step: "structure",
        searchOutput: researchSearch,
        error: "Error: Output did not match the schema",
      });
      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({ status: "failed" });
      expect(await course.readCoursePath(courseId, { learnerId: "ana" })).toMatchObject({
        preparing: true,
        creation: { status: "failed" },
      });
      expect(await resourcesOf(courseId)).toEqual([]);

      expect(await course.retryCourseCreation(courseId, "ana")).toEqual({ ok: true, jobId });
      expect(await readJob(jobId)).toMatchObject({ status: "pending", step: "structure", error: null });
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({ status: "done" });
      expect(await resourcesOf(courseId)).toHaveLength(5);
      expect(calls("researchSearch")).toHaveLength(1);
      expect(calls("researchStructure")).toHaveLength(3);
      const creation = await course.readCourseCreation(courseId, "ana");
      expect(creation?.progress).toContain("Picking up where I left off.");
      expect(creation?.status).toBe("done");
    });
  });

  it("retries a failed search from the search", async () => {
    let attempts = 0;
    await setUp({
      researchSearch: () => {
        if (++attempts === 1) throw new Error("Overloaded");
        return researchSearch;
      },
    });
    const { courseId, jobId } = await writeCourse();
    await runToEnd(jobId);
    expect(await readJob(jobId)).toMatchObject({ status: "failed", step: "search" });

    await course.retryCourseCreation(courseId, "ana");
    await runToEnd(jobId);

    expect(await readJob(jobId)).toMatchObject({ status: "done" });
    expect(calls("researchSearch")).toHaveLength(2);
  });

  it("fails the search step when the search found nothing", async () => {
    await setUp({ researchSearch: { text: "Nothing.", results: [] } });
    const { jobId } = await writeCourse();
    await runToEnd(jobId);

    expect(await readJob(jobId)).toMatchObject({ status: "failed", step: "search" });
    expect(calls("researchStructure")).toHaveLength(0);
  });

  describe("the URL rules", () => {
    const kept = "https://kept.example.org/guide";

    const checkOne = async (outcome: number | UrlCheck) => {
      const url = "https://checked.example.org/page";
      await setUp(
        researchWith([
          { kind: "site", url: kept, title: "Kept" },
          { kind: "docs", url, title: "Checked" },
        ]),
        { [url]: outcome },
      );
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);
      const resources = await resourcesOf(courseId);
      return resources.find((r) => r.title === "Checked") ?? null;
    };

    it.each([200, 204, 301, 399])("keeps a Resource that answers %i", async (status) => {
      expect(await checkOne(status)).toMatchObject({ checkOutcome: "ok" });
    });

    it.each([403, 429])("keeps a Resource that answers %i, marked blocked", async (status) => {
      expect(await checkOne(status)).toMatchObject({ checkOutcome: "blocked" });
    });

    it.each([404, 410, 500, 502, 503])("drops a Resource that answers %i", async (status) => {
      expect(await checkOne(status)).toBeNull();
    });

    it.each([{ kind: "dns" }, { kind: "timeout" }, { kind: "network" }] as UrlCheck[])(
      "drops a Resource whose fetch fails: $kind",
      async (outcome) => {
        expect(await checkOne(outcome)).toBeNull();
      },
    );

    it("drops a Resource whose URL no search returned, without fetching it", async () => {
      const invented = "https://invented.example.org/book";
      await setUp(
        researchWith(
          [
            { kind: "site", url: kept },
            { kind: "site", url: invented },
          ],
          { searched: [kept] },
        ),
      );
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect((await resourcesOf(courseId)).map((r) => r.url)).toEqual([kept]);
      expect(fetchUrl.calls).toEqual([kept]);
    });

    it("matches search results regardless of www, trailing slash or fragment", async () => {
      await setUp(
        researchWith([{ kind: "site", url: "https://example.org/guide/#start" }], {
          searched: ["http://www.example.org/guide"],
        }),
      );
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect(await resourcesOf(courseId)).toHaveLength(1);
    });

    it("drops URLs that are not public web addresses", async () => {
      const unsafe = ["http://localhost:3000/admin", "http://169.254.169.254/latest", "ftp://example.org/book"];
      await setUp(
        researchWith([{ kind: "site", url: kept }, ...unsafe.map((url) => ({ kind: "site", url }))]),
      );
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect((await resourcesOf(courseId)).map((r) => r.url)).toEqual([kept]);
      expect(fetchUrl.calls).toEqual([kept]);
    });

    it("keeps books only on openlibrary.org or a publisher's site, never a store or Goodreads", async () => {
      const books = {
        openLibrary: "https://openlibrary.org/works/OL3301425W",
        publisher: "https://global.oup.com/academic/product/music-theory-9780190",
        amazon: "https://www.amazon.com/dp/0793574009",
        amazonSpain: "https://www.amazon.es/dp/0793574009",
        goodreads: "https://www.goodreads.com/book/show/123",
        bookshop: "https://bookshop.org/p/books/music-theory/123",
        apple: "https://books.apple.com/us/book/music-theory/id123",
      };
      await setUp(
        researchWith(
          Object.entries(books).map(([title, url]) => ({ kind: "book", url, title })),
        ),
      );
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect((await resourcesOf(courseId)).map((r) => r.title)).toEqual(["openLibrary", "publisher"]);
      expect(fetchUrl.calls).toEqual([books.openLibrary, books.publisher]);
    });

    it("lets any kind but a book link to a store-like site", async () => {
      const url = "https://www.goodreads.com/genres/music";
      await setUp(researchWith([{ kind: "site", url }]));
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect(await resourcesOf(courseId)).toHaveLength(1);
    });

    it("keeps at most 10 Resources and 3 Communities", async () => {
      const urls = Array.from({ length: 12 }, (_, i) => `https://example.org/r${i + 1}`);
      const replies = researchWith(urls.map((url) => ({ kind: "site", url })));
      const community = researchStructure.communities[0];
      await setUp({
        ...replies,
        researchStructure: {
          ...(replies.researchStructure as object),
          communities: [community, community, community, community],
        },
      });
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect((await resourcesOf(courseId)).map((r) => r.url)).toEqual(urls.slice(0, 10));
      const communities = await db.select().from(schema.community);
      expect(communities).toHaveLength(3);
    });

    it("fails the structure step when no Resource survives", async () => {
      const url = "https://gone.example.org/";
      await setUp(researchWith([{ kind: "site", url }]), { [url]: 404 });
      const { jobId } = await writeCourse();
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({
        status: "failed",
        step: "structure",
        error: "Error: No Resource passed the URL check.",
      });
    });
  });

  describe("Up next", () => {
    it.each([
      ["a goal that starts with understand", { goal: "Understand how keys work" }],
      ["a goal that starts with learn", { goal: "Learn the notes of the C major scale" }],
      ["a goal that starts with aprender", { goal: "Aprender las notas de la escala" }],
      ["a goal that starts with comprender", { goal: "¿Comprender por qué suenan bien?" }],
      ["a title over six words", { title: "The one where we find out about keys" }],
      ["more minutes than one sitting", { minutes: 25 }],
    ])("rejects %s and asks again, saying why", async (_, broken) => {
      let attempts = 0;
      await setUp({
        pickUpNext: () => (++attempts === 1 ? { ...upNext, ...broken } : upNext),
      });
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      const picks = calls("pickUpNext");
      expect(picks).toHaveLength(2);
      expect(picks[1].input).toMatchObject({ feedback: expect.any(String) });
      const path = await course.readCoursePath(courseId, { learnerId: "ana" });
      expect(path?.upNext).toMatchObject({ title: upNext.title, goal: upNext.goal });
    });

    it("that breaks the rules twice stops the job at Up next; retrying picks again without researching", async () => {
      let attempts = 0;
      await setUp({
        pickUpNext: () =>
          ++attempts <= 2 ? { ...upNext, goal: "Understand keys" } : upNext,
      });
      const { courseId, jobId } = await writeCourse();
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({ status: "failed", step: "up_next" });
      expect(await course.readCoursePath(courseId, { learnerId: "ana" })).toMatchObject({
        upNext: null,
        preparing: true,
      });

      await course.retryCourseCreation(courseId, "ana");
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({ status: "done" });
      expect(calls("researchSearch")).toHaveLength(1);
      expect(calls("researchStructure")).toHaveLength(1);
      expect(calls("pickUpNext")).toHaveLength(3);
      expect((await course.readCoursePath(courseId, { learnerId: "ana" }))?.upNext).toMatchObject({
        index: 1,
        title: upNext.title,
      });
    });
  });

  describe("running the job", () => {
    it("leaves a job alone that is not pending", async () => {
      const { jobId } = await writeCourse();
      await runToEnd(jobId);
      const before = teacher.calls.length;

      expect(await course.runJobStep(jobId)).toBe("stop");
      expect(teacher.calls).toHaveLength(before);
    });

    it("runs a step once when two runners race for it", async () => {
      const { jobId } = await writeCourse();

      const results = await Promise.all([course.runJobStep(jobId), course.runJobStep(jobId)]);

      expect(results.sort()).toEqual(["more", "stop"]);
      expect(calls("researchSearch")).toHaveLength(1);
    });

    it("treats a step cut off by the platform as failed, and resumes it on retry", async () => {
      const { courseId, jobId } = await writeCourse();
      await course.runJobStep(jobId);
      // A runner claimed the structure step ten minutes ago and never returned.
      await db
        .update(schema.job)
        .set({ status: "running", runId: "gone", startedAt: new Date(Date.now() - 600_000) })
        .where(eq(schema.job.id, jobId));

      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({ status: "failed" });
      expect(await course.runJobStep(jobId)).toBe("stop");

      await course.retryCourseCreation(courseId, "ana");
      await runToEnd(jobId);

      expect(await readJob(jobId)).toMatchObject({ status: "done" });
      expect(calls("researchSearch")).toHaveLength(1);
    });

    it("does not reset a step that is still running", async () => {
      const { courseId, jobId } = await writeCourse();
      await db
        .update(schema.job)
        .set({ status: "running", runId: "busy", startedAt: new Date() })
        .where(eq(schema.job.id, jobId));

      expect(await course.retryCourseCreation(courseId, "ana")).toEqual({ ok: true, jobId });
      expect(await readJob(jobId)).toMatchObject({ status: "running", runId: "busy" });
      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({ status: "working" });
    });

    it("reports a pending job that nobody started as stalled", async () => {
      const { courseId, jobId } = await writeCourse();
      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({ stalled: false });

      await db
        .update(schema.job)
        .set({ updatedAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.job.id, jobId));

      expect(await course.readCourseCreation(courseId, "ana")).toMatchObject({
        status: "working",
        stalled: true,
      });
    });

    it("starts a job for a Course written before jobs existed", async () => {
      const { courseId, jobId } = await writeCourse();
      await db.delete(schema.job).where(eq(schema.job.id, jobId));
      expect(await course.readCourseCreation(courseId, "ana")).toBeNull();

      const retried = await course.retryCourseCreation(courseId, "ana");
      expect(retried.ok).toBe(true);
      await runToEnd(retried.ok ? retried.jobId : "");

      expect((await course.readCoursePath(courseId, { learnerId: "ana" }))?.upNext).not.toBeNull();
    });
  });

  it("shows and retries a Course's creation only for its Learner", async () => {
    const { courseId } = await writeCourse();

    expect(await course.readCourseCreation(courseId, "ben")).toBeNull();
    expect(await course.readCourseCreation(courseId, null)).toBeNull();
    expect(await course.retryCourseCreation(courseId, "ben")).toEqual({
      ok: false,
      reason: "not-yours",
    });
    expect(await course.retryCourseCreation("no-such-course", "ana")).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("deletes the job, Resources, Communities and Gaps with the Course", async () => {
    const { courseId, jobId } = await writeCourse();
    await runToEnd(jobId);

    await db.delete(schema.course).where(eq(schema.course.id, courseId));

    expect(await db.select().from(schema.job)).toEqual([]);
    expect(await db.select().from(schema.community)).toEqual([]);
    expect(await db.select().from(schema.gap)).toEqual([]);
    expect(await resourcesOf(courseId)).toEqual([]);
  });
});
