import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { ensureExampleCourse } from "@/course";
import { schema, type Db } from "@/db";
import { createTestDb } from "@/test/db";

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** `days` days before the moment the test runs; the view measures against now(). */
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const minutesBefore = (at: Date, minutes: number) => new Date(at.getTime() - minutes * MINUTE_MS);

type SuccessMetrics = {
  interviews_started: number;
  interviews_reaching_lesson_1: number;
  interview_to_lesson_1_share: number | null;
  learners_in_return_cohort: number;
  learners_returned_within_7_days: number;
  seven_day_return_share: number | null;
  lessons_timed: number;
  median_lesson_minutes: number | null;
  median_sitting_minutes: number | null;
  median_lesson_to_sitting_ratio: number | null;
  cited_resources: number;
  cited_resources_broken: number;
  broken_resource_share: number | null;
};

async function readMetrics(db: Db): Promise<SuccessMetrics> {
  const result = await db.execute(sql`select * from success_metrics`);
  const rows = (result as unknown as { rows: Record<string, unknown>[] }).rows;
  expect(rows).toHaveLength(1);
  // Counts come back as bigint strings or numbers depending on the driver.
  return Object.fromEntries(
    Object.entries(rows[0]).map(([key, value]) => [key, value === null ? null : Number(value)]),
  ) as SuccessMetrics;
}

/** Lesson content as stored, trimmed to what the view reads: citations and Read next. */
const content = (citations: string[][], readNext: string) => ({
  sections: citations.map((c, i) => ({ heading: `Section ${i + 1}`, body: "…", citations: c })),
  readNext,
});

describe("success_metrics view", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("reports nothing on an empty database", async () => {
    expect(await readMetrics(db)).toEqual({
      interviews_started: 0,
      interviews_reaching_lesson_1: 0,
      interview_to_lesson_1_share: null,
      learners_in_return_cohort: 0,
      learners_returned_within_7_days: 0,
      seven_day_return_share: null,
      lessons_timed: 0,
      median_lesson_minutes: null,
      median_sitting_minutes: null,
      median_lesson_to_sitting_ratio: null,
      cited_resources: 0,
      cited_resources_broken: 0,
      broken_resource_share: null,
    });
  });

  it("derives each metric from the seeded rows, leaving out the Example course", async () => {
    // The Example course has finished Lessons and cited Resources of its own;
    // none of them may count.
    await ensureExampleCourse(db);

    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
      { id: "cy", email: "cy@example.com" },
    ]);

    const interview = (id: string, learnerId: string | null) => ({
      id,
      learnerId,
      subject: "Chess",
      language: "en",
      stage: "complete" as const,
      messages: [],
    });
    await db.insert(schema.interview).values([
      interview("i-ana", "ana"),
      interview("i-ben", "ben"),
      interview("i-cy", "cy"),
      // Anonymous, from before ADR 0007, abandoned: started, never reaches a Lesson.
      interview("i-anon", null),
    ]);

    const course = (id: string, learnerId: string, interviewId: string | null, sittingMinutes: number) => ({
      id,
      learnerId,
      interviewId,
      subject: "Chess",
      title: "Chess",
      language: "en",
      missionWhy: "To play on Sundays.",
      missionSuccess: ["Win a game"],
      missionConstraints: [],
      missionOutOfScope: [],
      sittingMinutes,
    });
    await db.insert(schema.course).values([
      course("a", "ana", "i-ana", 10),
      // Ana's second Course, with no Interview of its own.
      course("a2", "ana", null, 10),
      course("b", "ben", "i-ben", 20),
      course("c", "cy", "i-cy", 5),
    ]);

    const aFinished = daysAgo(20);
    const a2Finished = daysAgo(15);
    const bFinished = daysAgo(10);
    const cFinished = daysAgo(2);
    const lesson = (
      id: string,
      courseId: string,
      index: number,
      times: { openedAt?: Date; finishedAt?: Date } = {},
      body: object | null = null,
    ) => ({ id, courseId, index, title: id, goal: "Play a move", content: body, ...times });
    await db.insert(schema.lesson).values([
      // Lesson 1 took 12 minutes of a 10-minute sitting; Lesson 2 opened two days later.
      lesson(
        "a-1",
        "a",
        1,
        { openedAt: minutesBefore(aFinished, 12), finishedAt: aFinished },
        content([["r1"], ["r1", "r2"]], "r4"),
      ),
      lesson("a-2", "a", 2, { openedAt: daysAgo(18) }),
      // 8 minutes of 10; Lesson 2 never opened.
      lesson("a2-1", "a2", 1, { openedAt: minutesBefore(a2Finished, 8), finishedAt: a2Finished }),
      lesson("a2-2", "a2", 2),
      // 30 minutes of 20; Lesson 2 opened 8 days later, too late to count.
      lesson(
        "b-1",
        "b",
        1,
        { openedAt: minutesBefore(bFinished, 30), finishedAt: bFinished },
        content([["r1"], ["r1", "r2"]], "r1"),
      ),
      lesson("b-2", "b", 2, { openedAt: daysAgo(2) }),
      // 5 minutes of 5; its 7-day window is not over yet.
      lesson("c-1", "c", 1, { openedAt: minutesBefore(cFinished, 5), finishedAt: cFinished }),
      lesson("c-2", "c", 2, { openedAt: daysAgo(1) }),
    ]);

    const resource = (
      courseId: string,
      ref: string,
      checkOutcome: "ok" | "blocked" | "broken" | null,
    ) => ({
      courseId,
      ref,
      kind: "article" as const,
      title: ref,
      author: "Someone",
      url: `https://example.com/${courseId}/${ref}`,
      why: "It explains it.",
      language: "en",
      checkOutcome,
      verifiedAt: checkOutcome === null ? null : new Date(),
    });
    await db.insert(schema.resource).values([
      resource("a", "r1", "ok"),
      resource("a", "r2", "broken"),
      // Not cited by any Lesson.
      resource("a", "r3", "broken"),
      // Cited as Read next only.
      resource("a", "r4", "blocked"),
      // Cited three times, counted once.
      resource("b", "r1", "ok"),
      // Never checked, so not counted.
      resource("b", "r2", null),
    ]);

    const metrics = await readMetrics(db);

    // 3 of 4 Interviews reach a finished Lesson 1.
    expect(metrics.interviews_started).toBe(4);
    expect(metrics.interviews_reaching_lesson_1).toBe(3);
    expect(metrics.interview_to_lesson_1_share).toBeCloseTo(0.75);

    // Ana and Ben finished a Lesson 1 over 7 days ago (Cy is too recent);
    // only Ana opened Lesson 2 within 7 days.
    expect(metrics.learners_in_return_cohort).toBe(2);
    expect(metrics.learners_returned_within_7_days).toBe(1);
    expect(metrics.seven_day_return_share).toBeCloseTo(0.5);

    // Lesson times 12, 8, 30, 5; sittings 10, 10, 20, 5; ratios 1.2, 0.8, 1.5, 1.
    expect(metrics.lessons_timed).toBe(4);
    expect(metrics.median_lesson_minutes).toBeCloseTo(10);
    expect(metrics.median_sitting_minutes).toBeCloseTo(10);
    expect(metrics.median_lesson_to_sitting_ratio).toBeCloseTo(1.1);

    // Cited and checked: a/r1, a/r2, a/r4, b/r1; a/r2 is broken.
    expect(metrics.cited_resources).toBe(4);
    expect(metrics.cited_resources_broken).toBe(1);
    expect(metrics.broken_resource_share).toBeCloseTo(0.25);
  });
});
