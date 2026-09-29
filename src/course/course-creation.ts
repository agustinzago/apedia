import { and, asc, eq, exists, not, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type {
  MissionInput,
  ResearchDraft,
  SearchFindings,
  Teacher,
  UpNextDraft,
} from "@/teacher";
import type { UrlFetcher } from "@/url-fetcher";
import {
  resumeJob,
  type RetriesUsedUp,
  viewOf,
  type JobRow,
  type JobRun,
  type JobStepResult,
  type JobView,
} from "./jobs";
import type { Spend, SpendPaused } from "./spend";
import { bookUrlProblem, publicUrl, urlKey, verdictFor } from "./url-rules";

/**
 * The Course creation job (ADR 0004): research in two steps, search then
 * structure (with the URL check), then pick Up next. Each call to
 * `runCourseCreationStep` runs exactly one step, so the app can give every
 * step its own function invocation.
 */

export type CourseCreationStep = "search" | "structure" | "up_next";

export const MAX_RESOURCES = 10;
export const MAX_COMMUNITIES = 3;
const MAX_TITLE_WORDS = 6;

/** What the Learner sees while their Course is being written. */
export type CourseCreationView = JobView;

export type RetryCourseCreationResult =
  | { ok: true; jobId: string }
  | { ok: false; reason: "not-found" | "not-yours" | "nothing-to-retry" }
  /** The step that failed has had all its attempts. */
  | RetriesUsedUp
  /** The Teacher is paused for the day; the job stays where it stopped. */
  | SpendPaused;

type CourseRow = typeof schema.course.$inferSelect;

/**
 * Whether the Course's creation job stopped, failed or paused, before
 * research found any Resources: it cost a research run but produced
 * nothing. Giving such a Course up (deleting it) returns its Course
 * credit (ADR 0007). `courseId` is the
 * course id column of the outer query, or a value.
 */
export function creationFailedEmpty(db: Db, courseId: AnyColumn | SQL): SQL {
  return and(
    exists(
      db
        .select({ one: sql`1` })
        .from(schema.job)
        .where(
          and(
            eq(schema.job.courseId, courseId),
            eq(schema.job.kind, "course_creation"),
            eq(schema.job.status, "failed"),
          ),
        ),
    ),
    not(
      exists(
        db
          .select({ one: sql`1` })
          .from(schema.resource)
          .where(eq(schema.resource.courseId, courseId)),
      ),
    ),
  )!;
}

/** Starts the Course creation job for a new Course. Returns its id. */
export async function insertCourseCreationJob(
  db: Pick<Db, "insert">,
  courseId: string,
): Promise<string> {
  const [job] = await db
    .insert(schema.job)
    .values({ courseId, kind: "course_creation", step: "search" satisfies CourseCreationStep })
    .returning({ id: schema.job.id });
  return job.id;
}

async function findCreationJob(db: Db, courseId: string): Promise<JobRow | null> {
  const [job] = await db
    .select()
    .from(schema.job)
    .where(and(eq(schema.job.courseId, courseId), eq(schema.job.kind, "course_creation")));
  return job ?? null;
}

/** The Course's creation job as the Learner sees it, or null if it has none. */
export async function readCreationView(
  db: Db,
  courseId: string,
): Promise<CourseCreationView | null> {
  const job = await findCreationJob(db, courseId);
  return job ? viewOf(job) : null;
}

export function missionOf(course: CourseRow): MissionInput {
  return {
    why: course.missionWhy,
    successLooksLike: course.missionSuccess,
    constraints: course.missionConstraints,
    outOfScope: course.missionOutOfScope,
    sittingMinutes: course.sittingMinutes,
  };
}

export function createCourseCreationOperations({
  db,
  teacher,
  fetchUrl,
  spend,
}: {
  db: Db;
  teacher: Teacher;
  fetchUrl: UrlFetcher;
  spend: Spend;
}) {
  type Run = JobRun;

  async function search(run: Run, course: CourseRow) {
    await run.say(`Looking for trustworthy books, courses and sites on ${course.subject}.`);
    const findings = await teacher.researchSearch({
      subject: course.subject,
      language: course.language,
      mission: missionOf(course),
    });
    const found = findings.results.length;
    if (found === 0) throw new Error("The web search returned no results.");
    await run.advance(
      "structure",
      `Found ${found} ${found === 1 ? "page" : "pages"} worth a closer look.`,
      { searchOutput: findings },
    );
  }

  async function structure(run: Run, course: CourseRow, job: JobRow) {
    const findings = job.searchOutput;
    if (!findings) throw new Error("The search output is missing.");
    await run.say("Reading what I found and choosing the best of it.");

    const input = {
      subject: course.subject,
      language: course.language,
      mission: missionOf(course),
      findings,
    };
    let draft: ResearchDraft;
    try {
      draft = await teacher.researchStructure(input);
    } catch (error) {
      // A structured call that fails usually succeeds the second time, and
      // costs seconds; the search is not repeated.
      console.warn("Research structure failed; trying once more.", error);
      draft = await teacher.researchStructure(input);
    }

    await run.say("Checking that every link works.");
    const resources = await checkResources(draft.resources, findings);
    if (resources.length === 0) throw new Error("No Resource passed the URL check.");
    const communities = draft.communities.slice(0, MAX_COMMUNITIES).map((c) => ({
      name: c.name.trim(),
      where: c.where.trim(),
      url: c.url === null ? null : (publicUrl(c.url)?.href ?? null),
      why: c.why.trim(),
      offline: c.offline,
    }));
    const gaps = draft.gaps.map((g) => g.description.trim()).filter(Boolean);

    await db.transaction(async (tx) => {
      await run.advance(
        "up_next",
        `Kept ${resources.length} ${resources.length === 1 ? "Resource" : "Resources"} and ${communities.length} ${communities.length === 1 ? "Community" : "Communities"}.`,
        {},
        tx,
      );
      // A retried step replaces what an earlier run of it wrote.
      await tx.delete(schema.resource).where(eq(schema.resource.courseId, course.id));
      await tx.delete(schema.community).where(eq(schema.community.courseId, course.id));
      await tx.delete(schema.gap).where(eq(schema.gap.courseId, course.id));
      await tx.insert(schema.resource).values(
        resources.map((r, i) => ({ ...r, courseId: course.id, ref: `r${i + 1}` })),
      );
      if (communities.length > 0) {
        await tx
          .insert(schema.community)
          .values(communities.map((c) => ({ ...c, courseId: course.id })));
      }
      if (gaps.length > 0) {
        await tx
          .insert(schema.gap)
          .values(gaps.map((description) => ({ courseId: course.id, description })));
      }
    });
  }

  /**
   * The URL rules: a Resource's URL must be a public web address that
   * appeared in the search results; a book's must not be a store or
   * Goodreads; then the fetch decides. Keeps the Teacher's order.
   */
  async function checkResources(candidates: ResearchDraft["resources"], findings: SearchFindings) {
    const searched = new Set(
      findings.results.flatMap((r) => {
        const url = publicUrl(r.url);
        return url ? [urlKey(url)] : [];
      }),
    );
    const seen = new Set<string>();
    const eligible = candidates.flatMap((resource) => {
      const url = publicUrl(resource.url);
      if (!url) return [];
      const key = urlKey(url);
      if (!searched.has(key) || seen.has(key)) return [];
      if (resource.kind === "book" && bookUrlProblem(url)) return [];
      seen.add(key);
      return [{ resource, url }];
    });

    const checked = await Promise.all(
      eligible.map(async ({ resource, url }) => ({
        resource,
        url,
        verdict: verdictFor(await fetchUrl(url.href)),
        verifiedAt: new Date(),
      })),
    );
    return checked
      .flatMap(({ resource, url, verdict, verifiedAt }) =>
        verdict.keep
          ? [
              {
                kind: resource.kind,
                title: resource.title.trim(),
                author: resource.author.trim(),
                url: url.href,
                why: resource.why.trim(),
                language: resource.language.trim() || "en",
                checkOutcome: verdict.outcome,
                verifiedAt,
              },
            ]
          : [],
      )
      .slice(0, MAX_RESOURCES);
  }

  async function upNext(run: Run, course: CourseRow) {
    await run.say("Choosing your first Lesson.");
    const [records, resources] = await Promise.all([
      db
        .select()
        .from(schema.learningRecord)
        .where(eq(schema.learningRecord.courseId, course.id))
        .orderBy(asc(schema.learningRecord.number)),
      db.select().from(schema.resource).where(eq(schema.resource.courseId, course.id)),
    ]);
    // In the Teacher's order: r1, r2, … r10.
    resources.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));

    let feedback: string | null = null;
    let chosen: UpNextDraft | null = null;
    for (let attempt = 0; attempt < 2 && !chosen; attempt++) {
      const draft = await teacher.pickUpNext({
        subject: course.subject,
        language: course.language,
        mission: missionOf(course),
        learningRecords: records.map((r) => ({
          number: r.number,
          kind: r.kind,
          title: r.title,
          body: r.body,
        })),
        finishedLessons: [],
        resources: resources.map((r) => ({ kind: r.kind, title: r.title, why: r.why })),
        feedback,
      });
      feedback = upNextProblem(draft, course.sittingMinutes);
      if (feedback === null) chosen = draft;
    }
    if (!chosen) throw new Error(`Up next broke its rules twice: ${feedback}`);
    const lesson = chosen;

    await db.transaction(async (tx) => {
      await run.advance(null, `Your first Lesson is ready: “${lesson.title.trim()}”.`, {}, tx);
      await tx
        .insert(schema.lesson)
        .values({
          courseId: course.id,
          index: 1,
          title: lesson.title.trim(),
          goal: lesson.goal.trim(),
          minutes: lesson.minutes,
        })
        .onConflictDoNothing();
    });
  }

  return {
    /** Runs one claimed step of a Course creation job; see `runJobStep` in ./jobs. */
    async runCourseCreationStep(job: JobRow, run: JobRun): Promise<JobStepResult> {
      const [course] = await db
        .select()
        .from(schema.course)
        .where(eq(schema.course.id, job.courseId));
      const step = job.step as CourseCreationStep;
      if (step === "search") await search(run, course);
      else if (step === "structure") await structure(run, course, job);
      else if (step === "up_next") await upNext(run, course);
      else throw new Error(`Unknown step: ${job.step}`);
      return step === "up_next" ? "stop" : "more";
    },

    /** The creation job of the viewer's Course, for its progress screen. Null if not found, not theirs, or it has none. */
    async readCourseCreation(
      courseId: string,
      learnerId: string | null,
    ): Promise<CourseCreationView | null> {
      if (learnerId === null) return null;
      const [course] = await db
        .select({ id: schema.course.id })
        .from(schema.course)
        .where(and(eq(schema.course.id, courseId), eq(schema.course.learnerId, learnerId)));
      if (!course) return null;
      return readCreationView(db, course.id);
    },

    /**
     * "Try again" after a failure: the job resumes from the step that
     * failed, keeping what earlier steps found. A job whose runner was cut
     * off counts as failed. A Course that never had a job (written before
     * jobs existed) gets one. A job the spend stop paused resumes the same
     * way, once the day resets.
     */
    async retryCourseCreation(
      courseId: string,
      learnerId: string,
    ): Promise<RetryCourseCreationResult> {
      const [course] = await db
        .select()
        .from(schema.course)
        .where(eq(schema.course.id, courseId));
      if (!course || course.isExample) return { ok: false, reason: "not-found" };
      if (course.learnerId !== learnerId) return { ok: false, reason: "not-yours" };

      const job = await findCreationJob(db, course.id);
      const [lesson] = await db
        .select({ id: schema.lesson.id })
        .from(schema.lesson)
        .where(eq(schema.lesson.courseId, course.id))
        .limit(1);
      if (!job && lesson) return { ok: false, reason: "nothing-to-retry" };
      const paused = await spend.teacherCall();
      if (paused) return paused;

      if (!job) {
        await db
          .insert(schema.job)
          .values({ courseId: course.id, kind: "course_creation", step: "search" })
          .onConflictDoNothing();
        const created = await findCreationJob(db, course.id);
        return { ok: true, jobId: created!.id };
      }

      const resumed = await resumeJob(db, job.id, "Picking up where I left off.");
      if (resumed !== "resumed") return resumed;
      return { ok: true, jobId: job.id };
    },
  };
}

/** Why an Up next breaks the rules, or null if it keeps them. */
export function upNextProblem(draft: UpNextDraft, sittingMinutes: number): string | null {
  const titleWords = draft.title.trim().split(/\s+/).filter(Boolean).length;
  if (titleWords === 0) return "The title is empty.";
  if (titleWords > MAX_TITLE_WORDS) {
    return `The title has ${titleWords} words; use at most ${MAX_TITLE_WORDS}.`;
  }
  const firstWord = draft.goal.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (!firstWord) return "The goal is empty.";
  if (UNOBSERVABLE_VERBS.has(firstWord)) {
    return `The goal starts with "${firstWord}", which cannot be observed; start with a verb for something the Learner does.`;
  }
  if (draft.minutes < 1 || draft.minutes > sittingMinutes) {
    return `The Lesson takes ${draft.minutes} minutes; it must fit one ${sittingMinutes}-minute sitting.`;
  }
  return null;
}

/** Verbs a goal may not start with: nobody can watch someone "understand". */
const UNOBSERVABLE_VERBS = new Set([
  // English
  "understand",
  "understands",
  "understanding",
  "learn",
  "learns",
  "learning",
  "know",
  "knows",
  "grasp",
  "appreciate",
  "comprehend",
  // Spanish
  "comprender",
  "comprende",
  "comprenda",
  "aprender",
  "aprende",
  "aprenda",
  "entender",
  "entiende",
  "entienda",
  "saber",
  "conocer",
  // Portuguese
  "compreender",
  "conhecer",
  // French
  "comprendre",
  "apprendre",
  "savoir",
  "connaître",
  // German
  "verstehen",
  "lernen",
  "wissen",
  // Italian
  "capire",
  "imparare",
  "sapere",
  "conoscere",
]);
