import { and, eq, like, lt, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { JobProgressMessage } from "@/db/schema";
import { withDeadline } from "@/teacher/deadline";
import type { SpendPaused } from "./spend";

/**
 * What every generation job shares (ADR 0004): a runner claims a pending
 * job, runs one step, and moves it on; progress is written to the job row
 * for the screen that polls it.
 */

/** Longer than any step may run (300 s): a running job older than this lost its runner. */
export const STEP_LIMIT_MS = 330_000;
/**
 * A step's calls to Claude must end this long after it is claimed, leaving
 * the rest of its function's 300 s to record what they returned.
 */
export const STEP_DEADLINE_MS = 280_000;
/** A pending job no runner has picked up for this long lost its start signal. */
export const STALLED_AFTER_MS = 15_000;

/** A job as the Learner sees it while it works. */
export type JobView = {
  jobId: string;
  /** "paused": the day's spend reached its stop; a retry resumes it once the day resets. */
  status: "working" | "failed" | "paused" | "done";
  /** Calm progress messages, oldest first. */
  progress: string[];
  /** True when the job is waiting for a runner that never started; start it again. */
  stalled: boolean;
  /** While paused: when the next UTC day starts. Null otherwise. */
  resumesAt: Date | null;
};

/** "Keep going" if another step waits, "stop" when done, failed, or not this runner's to run. */
export type JobStepResult = "more" | "stop";

export type JobRow = typeof schema.job.$inferSelect;
export type JobKind = JobRow["kind"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Another runner holds the job now; this one must stop without writing. */
export class LostJobError extends Error {}

/**
 * A job the spend stop paused is failed at its step like any other, so a
 * retry resumes it; its error is this, followed by when it may resume.
 */
const PAUSED = "Paused by the daily spend stop until ";

/** When a job the spend stop paused may resume; null for any other job. */
function pausedUntil(job: JobRow): Date | null {
  if (job.status !== "failed" || !job.error?.startsWith(PAUSED)) return null;
  return new Date(job.error.slice(PAUSED.length));
}

/** The job as its progress screen shows it. A running job past the step limit counts as failed. */
export function viewOf(job: JobRow): JobView {
  const now = Date.now();
  const cutOff =
    job.status === "running" &&
    job.startedAt !== null &&
    now - job.startedAt.getTime() > STEP_LIMIT_MS;
  const resumesAt = pausedUntil(job);
  return {
    jobId: job.id,
    status:
      job.status === "done"
        ? "done"
        : resumesAt
          ? "paused"
          : job.status === "failed" || cutOff
            ? "failed"
            : "working",
    progress: job.progress.map((p) => p.text),
    stalled: job.status === "pending" && now - job.updatedAt.getTime() > STALLED_AFTER_MS,
    resumesAt,
  };
}

function message(text: string): JobProgressMessage[] {
  return [{ at: new Date().toISOString(), text }];
}

/** Appends to the job's progress in the same statement. */
export function withProgress(text: string) {
  return sql`${schema.job.progress} || ${JSON.stringify(message(text))}::jsonb`;
}

/** One claimed run of one step. Every write is conditioned on still holding the job. */
function runOf(db: Db, job: JobRow, runId: string) {
  const held = and(eq(schema.job.id, job.id), eq(schema.job.runId, runId));

  return {
    async say(text: string) {
      await db
        .update(schema.job)
        .set({ progress: withProgress(text), updatedAt: new Date() })
        .where(held);
    },

    /** Moves the job to its next step (or done), with a closing message. Inside `tx` when given. */
    async advance(
      next: string | null,
      closing: string,
      fields: Partial<typeof schema.job.$inferInsert> = {},
      tx: Tx | Db = db,
    ) {
      const now = new Date();
      const moved = await tx
        .update(schema.job)
        .set({
          ...fields,
          step: next ?? job.step,
          status: next ? "pending" : "done",
          progress: withProgress(closing),
          runId: null,
          startedAt: null,
          // The next step gets its own "Try again"s.
          retries: next ? 0 : job.retries,
          updatedAt: now,
          finishedAt: next ? null : now,
        })
        .where(held)
        .returning({ id: schema.job.id });
      if (moved.length === 0) throw new LostJobError();
    },

    /** Stops the job at its step until the next UTC day, for a retry to resume then. */
    async pause({ resumesAt }: SpendPaused) {
      await db
        .update(schema.job)
        .set({
          status: "failed",
          error: `${PAUSED}${resumesAt.toISOString()}`,
          progress: withProgress("Pausing here until tomorrow."),
          runId: null,
          updatedAt: new Date(),
        })
        .where(held);
    },

    async fail(error: unknown) {
      await db
        .update(schema.job)
        .set({
          status: "failed",
          error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
          runId: null,
          updatedAt: new Date(),
        })
        .where(held);
    },
  };
}

export type JobRun = ReturnType<typeof runOf>;

/** Runs one step of a claimed job; says whether another step waits. */
export type StepRunner = (job: JobRow, run: JobRun) => Promise<JobStepResult>;

/**
 * Runs the next step of a pending job, handing it to the runner for its
 * kind, and reports whether another step waits. A job that is not pending
 * (another runner has it, or it failed or finished) is left alone. A failing
 * step marks the job failed at that step, for a retry to resume. So does the
 * spend stop, which `paused` reports, before the step calls the Teacher.
 */
export async function runJobStep(
  db: Db,
  jobId: string,
  runners: Record<JobKind, StepRunner>,
  paused: () => Promise<SpendPaused | null>,
): Promise<JobStepResult> {
  const runId = crypto.randomUUID();
  const now = new Date();
  const [job] = await db
    .update(schema.job)
    .set({ status: "running", runId, startedAt: now, updatedAt: now })
    .where(and(eq(schema.job.id, jobId), eq(schema.job.status, "pending")))
    .returning();
  if (!job) return "stop";

  const run = runOf(db, job, runId);
  try {
    const stopped = await paused();
    if (stopped) {
      await run.pause(stopped);
      return "stop";
    }
    return await withDeadline(now.getTime() + STEP_DEADLINE_MS, () => runners[job.kind](job, run));
  } catch (error) {
    if (error instanceof LostJobError) return "stop";
    console.error(`Job ${job.id} (${job.kind}) failed at ${job.step}.`, error);
    await run.fail(error);
    return "stop";
  }
}

/**
 * Runs a step gets, its first included, so a step that keeps failing,
 * perhaps on purpose, can't rerun costly calls without end. Resuming a step
 * the spend stop paused uses none.
 */
export const MAX_ATTEMPTS_PER_STEP = 3;

/** "Try again"s a step gets after its first run. */
const MAX_RETRIES_PER_STEP = MAX_ATTEMPTS_PER_STEP - 1;

/** Returned instead of resuming a step that has used its "Try again"s. */
export type RetriesUsedUp = { ok: false; reason: "retries-used-up" };
export const RETRIES_USED_UP: RetriesUsedUp = { ok: false, reason: "retries-used-up" };

/**
 * Makes a failed job, or one whose runner was cut off, pending again at the
 * step where it stopped, unless that step has used its "Try again"s. Any
 * other job is left as it is.
 */
export async function resumeJob(
  db: Db,
  jobId: string,
  text: string,
): Promise<"resumed" | RetriesUsedUp> {
  const cutOffBefore = new Date(Date.now() - STEP_LIMIT_MS);
  const stopped = or(
    eq(schema.job.status, "failed"),
    and(eq(schema.job.status, "running"), lt(schema.job.startedAt, cutOffBefore)),
  );
  const paused = and(eq(schema.job.status, "failed"), like(schema.job.error, `${PAUSED}%`));
  const [resumed] = await db
    .update(schema.job)
    .set({
      status: "pending",
      runId: null,
      startedAt: null,
      error: null,
      retries: sql`case when ${paused} then ${schema.job.retries} else ${schema.job.retries} + 1 end`,
      updatedAt: new Date(),
      progress: withProgress(text),
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        or(paused, and(stopped, lt(schema.job.retries, MAX_RETRIES_PER_STEP))),
      ),
    )
    .returning({ id: schema.job.id });
  if (resumed) return "resumed";

  const [usedUp] = await db
    .select({ id: schema.job.id })
    .from(schema.job)
    .where(and(eq(schema.job.id, jobId), stopped));
  // Pending, running or done: nothing to reset; starting it again is harmless.
  return usedUp ? RETRIES_USED_UP : "resumed";
}
