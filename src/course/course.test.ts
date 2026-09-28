import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import { createFakeTeacher } from "@/teacher/fake";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createTestDb } from "@/test/db";
import { createCourseModule, EXAMPLE_COURSE_ID, type CourseModule } from ".";

const visitor = { learnerId: null };

describe("course: reading the Example course's Path", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await course.ensureExampleCourse();
  });

  it("shows the Mission to a visitor", async () => {
    const path = await course.readCoursePath(EXAMPLE_COURSE_ID, visitor);

    expect(path).toMatchObject({
      id: EXAMPLE_COURSE_ID,
      subject: "Music theory",
      isExample: true,
      status: "active",
      mission: {
        why: expect.stringContaining("guitar"),
        sittingMinutes: 10,
      },
    });
    expect(path?.mission.success.length).toBeGreaterThan(0);
    expect(path?.mission.constraints).toContain("10 minutes per sitting");
    expect(path?.mission.outOfScope).toContain("Reading staff notation");
  });

  it("lists finished Lessons in order with quiz scores, then Up next", async () => {
    const path = await course.readCoursePath(EXAMPLE_COURSE_ID, visitor);

    expect(
      path?.finishedLessons.map((l) => [l.index, l.title, l.score]),
    ).toEqual([
      [1, "Notes and the musical alphabet", { correct: 3, total: 3 }],
      [2, "Tones and semitones", { correct: 2, total: 3 }],
    ]);
    expect(path?.upNext).toEqual({
      index: 3,
      title: "The major scale",
      goal: "Build a major scale from any note on one string",
      minutes: null,
      started: true,
    });
  });

  it("lists Learning records newest first", async () => {
    const path = await course.readCoursePath(EXAMPLE_COURSE_ID, visitor);

    expect(path?.learningRecords.map((r) => [r.number, r.kind])).toEqual([
      [2, "understanding"],
      [1, "prior_knowledge"],
    ]);
  });

  it("seeds the Example course only once", async () => {
    await course.ensureExampleCourse();

    expect(await db.$count(schema.course)).toBe(1);
    expect(await db.$count(schema.lesson)).toBe(3);
  });

  it("returns null for a Course that does not exist", async () => {
    expect(await course.readCoursePath("no-such-course", visitor)).toBeNull();
  });

  it("does not show a Learner's Course to anyone else", async () => {
    await db.insert(schema.learner).values([
      { id: "owner", email: "owner@example.com" },
      { id: "other", email: "other@example.com" },
    ]);
    await db.insert(schema.course).values({
      id: "private",
      learnerId: "owner",
      subject: "Chess",
      title: "Chess for weekend games",
      language: "en",
      missionWhy: "Beat my brother",
      missionSuccess: ["Win a game against my brother"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes: 10,
    });

    expect(await course.readCoursePath("private", visitor)).toBeNull();
    expect(
      await course.readCoursePath("private", { learnerId: "other" }),
    ).toBeNull();
    expect(
      await course.readCoursePath("private", { learnerId: "owner" }),
    ).toMatchObject({ id: "private", finishedLessons: [], upNext: null });
  });
});

describe("course: reading an Example course Lesson", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await course.ensureExampleCourse();
  });

  it("returns the Lesson's content in Column order to a visitor", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 3, visitor);

    expect(lesson).toMatchObject({
      course: { id: EXAMPLE_COURSE_ID, isExample: true },
      index: 3,
      title: "The major scale",
      finishedAt: null,
      answers: [],
    });
    expect(lesson?.content?.hook).toMatch(/scale/);
    expect(lesson?.content?.sections.map((s) => s.heading)).toEqual([
      "One pattern of steps",
      "Starting somewhere else",
    ]);
    expect(lesson?.content?.keyIdea).toBe(
      "Every major scale follows the same steps: T T S T T T S.",
    );
    expect(lesson?.content?.practice.steps).toHaveLength(4);
    expect(lesson?.content?.quiz).toHaveLength(3);
    expect(lesson?.content?.quiz.map((q) => q.review)).toEqual([
      false,
      false,
      true,
    ]);
    expect(lesson?.content?.newTerms.map((t) => t.term)).toEqual([
      "Scale",
      "Major scale",
    ]);
  });

  it("resolves citations and Read next to numbered Resources with URLs", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 3, visitor);

    expect(
      lesson?.content?.sections.map((s) =>
        s.citations.map((c) => [c.number, c.url]),
      ),
    ).toEqual([
      [
        [1, "https://www.musictheory.net/lessons"],
        [2, "https://viva.pressbooks.pub/openmusictheory/"],
      ],
      [
        [1, "https://www.musictheory.net/lessons"],
        [3, "https://www.justinguitar.com/"],
      ],
    ]);
    expect(lesson?.content?.readNext).toMatchObject({
      number: 1,
      title: "musictheory.net — Lessons",
      url: "https://www.musictheory.net/lessons",
    });
  });

  it("never exposes internal Resource ids", async () => {
    for (const index of [1, 2, 3]) {
      const lesson = await course.readLesson(EXAMPLE_COURSE_ID, index, visitor);
      expect(JSON.stringify(lesson)).not.toMatch(/"r\d+"|\br\d+\b/);
    }
  });

  it("returns the recorded answers of a finished Lesson", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 2, visitor);

    expect(lesson?.finishedAt).toEqual(new Date("2026-09-03T19:15:00Z"));
    expect(lesson?.answers).toEqual([
      { questionIndex: 0, chosenOption: 2 },
      { questionIndex: 1, chosenOption: 0 },
      { questionIndex: 2, chosenOption: 3 },
    ]);
  });

  it("estimates the sitting from reading and practice time", async () => {
    const lesson = await course.readLesson(EXAMPLE_COURSE_ID, 3, visitor);

    // 258 words at 200 a minute, plus 7 minutes of practice, rounded up.
    expect(lesson?.content?.minutes).toBe(9);
  });

  it("returns null for a Lesson that does not exist", async () => {
    expect(await course.readLesson(EXAMPLE_COURSE_ID, 99, visitor)).toBeNull();
    expect(await course.readLesson("no-such-course", 1, visitor)).toBeNull();
  });

  it("seeds Resources into an Example course seeded before they existed", async () => {
    await db.delete(schema.resource);

    await course.ensureExampleCourse();

    expect(await db.$count(schema.resource)).toBe(5);
    expect(await db.$count(schema.lesson)).toBe(3);
  });
});

describe("course: listing a Learner's Courses", () => {
  let db: Db;
  let course: CourseModule;

  const aCourse = (id: string, learnerId: string, createdAt: string) => ({
    id,
    learnerId,
    subject: id,
    title: `${id} course`,
    language: "en",
    missionWhy: "Because",
    missionSuccess: ["It works"],
    missionConstraints: [],
    missionOutOfScope: [],
    sittingMinutes: 10,
    createdAt: new Date(createdAt),
  });

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await course.ensureExampleCourse();
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  });

  it("is empty for a new Learner, even though the Example course exists", async () => {
    expect(await course.listCourses("ana")).toEqual([]);
  });

  it("returns only that Learner's Courses, newest first", async () => {
    await db.insert(schema.course).values([
      aCourse("chess", "ana", "2026-01-01T00:00:00Z"),
      aCourse("spanish", "ana", "2026-02-01T00:00:00Z"),
      aCourse("drawing", "ben", "2026-03-01T00:00:00Z"),
    ]);

    expect((await course.listCourses("ana")).map((c) => c.id)).toEqual([
      "spanish",
      "chess",
    ]);
    expect(await course.listCourses("ben")).toEqual([
      {
        id: "drawing",
        subject: "drawing",
        title: "drawing course",
        status: "active",
        createdAt: new Date("2026-03-01T00:00:00Z"),
      },
    ]);
    expect(await course.listCourses("nobody")).toEqual([]);
  });
});

describe("course: the Resources and Communities tabs", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await course.ensureExampleCourse();
    await db.insert(schema.learner).values([
      { id: "owner", email: "owner@example.com" },
      { id: "other", email: "other@example.com" },
    ]);
    await db.insert(schema.course).values({
      id: "chess",
      learnerId: "owner",
      subject: "Chess",
      title: "Chess for weekend games",
      language: "en",
      missionWhy: "Beat my brother",
      missionSuccess: ["Win a game against my brother"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes: 10,
    });
    await db.insert(schema.resource).values([
      {
        courseId: "chess",
        ref: "r10",
        kind: "site",
        title: "Lichess practice",
        author: "Lichess",
        url: "https://lichess.org/practice",
        why: "Free drills for each tactic.",
        language: "en",
      },
      {
        courseId: "chess",
        ref: "r2",
        kind: "book",
        title: "Chess Fundamentals",
        author: "José Raúl Capablanca",
        url: "https://openlibrary.org/works/OL1234W",
        why: "The classic first book.",
        language: "en",
      },
    ]);
    await db.insert(schema.community).values([
      {
        courseId: "chess",
        name: "Your local chess club",
        where: "Libraries and cafés near you",
        url: null,
        why: "Play slow games face to face.",
        offline: true,
      },
      {
        courseId: "chess",
        name: "r/chessbeginners",
        where: "Reddit, online",
        url: "https://www.reddit.com/r/chessbeginners/",
        why: "Post a game and ask where it went wrong.",
        offline: false,
      },
    ]);
  });

  it("lists the Example course's Resources in number order, with their real URLs, to a visitor", async () => {
    const tab = await course.readResources(EXAMPLE_COURSE_ID, visitor);

    expect(tab?.resources.map((r) => r.number)).toEqual([1, 2, 3, 4, 5]);
    expect(tab?.resources[0]).toEqual({
      number: 1,
      kind: "site",
      title: "musictheory.net — Lessons",
      author: "Ricci Adams",
      url: "https://www.musictheory.net/lessons",
      why: expect.stringContaining("interactive lessons"),
    });
    expect(tab?.gaps).toEqual([expect.stringContaining("ear training")]);
  });

  it("numbers a Learner's Resources by their number, not as text", async () => {
    const tab = await course.readResources("chess", { learnerId: "owner" });

    expect(tab?.resources.map((r) => [r.number, r.title])).toEqual([
      [2, "Chess Fundamentals"],
      [10, "Lichess practice"],
    ]);
    expect(tab?.gaps).toEqual([]);
  });

  it("lists the Example course's Communities, online first and offline marked, without an opt-out", async () => {
    const tab = await course.readCommunities(EXAMPLE_COURSE_ID, visitor);

    expect(tab?.communities.map((c) => [c.name, c.offline])).toEqual([
      ["JustinGuitar Community", false],
      ["r/musictheory", false],
      ["A local acoustic jam or open-mic night", true],
    ]);
    expect(tab?.communities[2].url).toBeNull();
    expect(tab).toMatchObject({ optedOut: false, canOptOut: false });
  });

  it("lists a Learner's Communities with the opt-out available", async () => {
    const tab = await course.readCommunities("chess", { learnerId: "owner" });

    expect(tab).toEqual({
      communities: [
        {
          name: "r/chessbeginners",
          where: "Reddit, online",
          url: "https://www.reddit.com/r/chessbeginners/",
          why: "Post a game and ask where it went wrong.",
          offline: false,
        },
        {
          name: "Your local chess club",
          where: "Libraries and cafés near you",
          url: null,
          why: "Play slow games face to face.",
          offline: true,
        },
      ],
      optedOut: false,
      canOptOut: true,
    });
  });

  it("shows a Learner's Resources and Communities to nobody else", async () => {
    for (const viewer of [visitor, { learnerId: "other" }]) {
      expect(await course.readResources("chess", viewer)).toBeNull();
      expect(await course.readCommunities("chess", viewer)).toBeNull();
    }
    expect(await course.readResources("no-such-course", visitor)).toBeNull();
    expect(await course.readCommunities("no-such-course", visitor)).toBeNull();
  });

  it("keeps \"Not for me\" per Course, and can turn Communities back on", async () => {
    expect(await course.setCommunityOptOut("chess", "owner", true)).toEqual({ ok: true });
    expect(await course.readCommunities("chess", { learnerId: "owner" })).toMatchObject({
      optedOut: true,
    });

    // Opting out of one Course leaves the others alone.
    await db.insert(schema.course).values({
      id: "spanish",
      learnerId: "owner",
      subject: "Spanish",
      title: "Spanish for a trip",
      language: "en",
      missionWhy: "Order food in Madrid",
      missionSuccess: ["Order a meal in Spanish"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes: 10,
    });
    expect(await course.readCommunities("spanish", { learnerId: "owner" })).toMatchObject({
      optedOut: false,
    });

    expect(await course.setCommunityOptOut("chess", "owner", false)).toEqual({ ok: true });
    expect(await course.readCommunities("chess", { learnerId: "owner" })).toMatchObject({
      optedOut: false,
    });
  });

  it("lets only the Course's own Learner change \"Not for me\"", async () => {
    expect(await course.setCommunityOptOut("chess", "other", true)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await course.setCommunityOptOut("no-such-course", "owner", true)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await course.readCommunities("chess", { learnerId: "owner" })).toMatchObject({
      optedOut: false,
    });
  });

  it("never changes the Example course's opt-out", async () => {
    expect(await course.setCommunityOptOut(EXAMPLE_COURSE_ID, "owner", true)).toEqual({
      ok: false,
      reason: "read-only",
    });
    expect(await course.readCommunities(EXAMPLE_COURSE_ID, visitor)).toMatchObject({
      optedOut: false,
    });
  });

  it("seeds the Example course's Communities and Gaps once, including into one seeded before they existed", async () => {
    const exampleCount = async () => [
      await db.$count(schema.community, eq(schema.community.courseId, EXAMPLE_COURSE_ID)),
      await db.$count(schema.gap, eq(schema.gap.courseId, EXAMPLE_COURSE_ID)),
    ];
    expect(await exampleCount()).toEqual([3, 1]);

    await course.ensureExampleCourse();
    expect(await exampleCount()).toEqual([3, 1]);

    await db.delete(schema.community).where(eq(schema.community.courseId, EXAMPLE_COURSE_ID));
    await db.delete(schema.gap).where(eq(schema.gap.courseId, EXAMPLE_COURSE_ID));
    await course.ensureExampleCourse();
    expect(await exampleCount()).toEqual([3, 1]);
  });
});

describe("course: reading a Reference sheet", () => {
  let db: Db;
  let course: CourseModule;

  beforeEach(async () => {
    db = await createTestDb();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await course.ensureExampleCourse();
  });

  it("shows the Example course's Glossary alphabetically to a visitor", async () => {
    const sheet = await course.readReferenceSheet(EXAMPLE_COURSE_ID, visitor);

    expect(sheet?.course).toEqual({
      id: EXAMPLE_COURSE_ID,
      subject: "Music theory",
      title: "Music theory for the guitar you already play",
      isExample: true,
    });
    expect(sheet?.glossary).toEqual([
      { term: "Octave", definition: "The same note name, twelve notes higher." },
      {
        term: "Semitone",
        definition:
          "The distance from one note to the very next one: one fret on a guitar.",
      },
      {
        term: "Sharp",
        definition: "A sign (♯) that raises a note to the next note up.",
      },
      {
        term: "Tone",
        definition: "Two semitones: two frets on a guitar. Also called a whole step.",
      },
    ]);
  });

  it("numbers the Key ideas of finished Lessons in Lesson order", async () => {
    const sheet = await course.readReferenceSheet(EXAMPLE_COURSE_ID, visitor);

    // Lesson 3 is started but not finished, so its Key idea is not here yet.
    expect(sheet?.keyIdeas).toEqual([
      {
        number: 1,
        lessonIndex: 1,
        lessonTitle: "Notes and the musical alphabet",
        text: "There are twelve notes. The letters repeat every octave, and B–C and E–F have no note between them.",
      },
      {
        number: 2,
        lessonIndex: 2,
        lessonTitle: "Tones and semitones",
        text: "A semitone is one fret; a tone is two frets.",
      },
    ]);
  });

  it("lists the topic-specific sections in sheet order", async () => {
    const sheet = await course.readReferenceSheet(EXAMPLE_COURSE_ID, visitor);

    expect(sheet?.sections.map((s) => s.title)).toEqual([
      "The twelve notes",
      "Distances on one string",
    ]);
    expect(sheet?.sections[1].body).toBe(
      "1 fret = 1 semitone · 2 frets = 1 tone · 12 frets = 1 octave.",
    );
  });

  it("is empty for a Course with no finished Lessons", async () => {
    await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
    await db.insert(schema.course).values({
      id: "chess",
      learnerId: "ana",
      subject: "Chess",
      title: "Chess for weekend games",
      language: "en",
      missionWhy: "Beat my brother",
      missionSuccess: ["Win a game against my brother"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes: 10,
    });

    expect(
      await course.readReferenceSheet("chess", { learnerId: "ana" }),
    ).toMatchObject({ glossary: [], keyIdeas: [], sections: [] });
  });

  it("does not show a Learner's Reference sheet to anyone else", async () => {
    await db.insert(schema.learner).values([
      { id: "owner", email: "owner@example.com" },
      { id: "other", email: "other@example.com" },
    ]);
    await db.insert(schema.course).values({
      id: "private",
      learnerId: "owner",
      subject: "Chess",
      title: "Chess for weekend games",
      language: "en",
      missionWhy: "Beat my brother",
      missionSuccess: ["Win a game against my brother"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes: 10,
    });

    expect(await course.readReferenceSheet("private", visitor)).toBeNull();
    expect(
      await course.readReferenceSheet("private", { learnerId: "other" }),
    ).toBeNull();
    expect(await course.readReferenceSheet("no-such-course", visitor)).toBeNull();
  });

  it("seeds the Reference sheet into an Example course seeded before it existed", async () => {
    await db.delete(schema.glossaryTerm);
    await db.delete(schema.referenceSection);

    await course.ensureExampleCourse();
    await course.ensureExampleCourse();

    expect(await db.$count(schema.glossaryTerm)).toBe(4);
    expect(await db.$count(schema.referenceSection)).toBe(2);
    expect(await db.$count(schema.lesson)).toBe(3);
  });
});
