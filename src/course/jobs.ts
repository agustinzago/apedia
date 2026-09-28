import { and, eq, lt, or, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { JobProgressMessage } from "@/db/schema";

/**
 * What every generation job shares (ADR 0004): a runner claims a pending
 * job, runs one step, and moves it on; progress is written to the job row
 * for the screen that polls it.
 */

/** Longer than any step may run (300 s): a running job older than this lost its runner. */
export const STEP_LIMIT_MS = 330_000;
/** A pending job no runner has picked up for this long lost its start signal. */
export const STALLED_AFTER_MS = 15_000;

/** A job as the Learner sees it while it works. */
export type JobView = {
  jobId: string;
  status: "working" | "failed" | "done";
  /** Calm progress messages, oldest first. */
  progress: string[];
  /** True when the job is waiting for a runner that never started; start it again. */
  stalled: boolean;
};

/** "Keep going" if another step waits, "stop" when done, failed, or not this runner's to run. */
export type JobStepResult = "more" | "stop";

export type JobRow = typeof schema.job.$inferSelect;
export type JobKind = JobRow["kind"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Another runner holds the job now; this one must stop without writing. */
export class LostJobError extends Error {}

/** The job as its progress screen shows it. A running job past the step limit counts as failed. */
export function viewOf(job: JobRow): JobView {
  const now = Date.now();
  const cutOff =
    job.status === "running" &&
    job.startedAt !== null &&
    now - job.startedAt.getTime() > STEP_LIMIT_MS;
  return {
    jobId: job.id,
    status:
      job.status === "done" ? "done" : job.status === "failed" || cutOff ? "failed" : "working",
    progress: job.progress.map((p) => p.text),
    stalled: job.status === "pending" && now - job.updatedAt.getTime() > STALLED_AFTER_MS,
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
          updatedAt: now,
          finishedAt: next ? null : now,
        })
        .where(held)
        .returning({ id: schema.job.id });
      if (moved.length === 0) throw new LostJobError();
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
 * step marks the job failed at that step, for a retry to resume.
 */
export async function runJobStep(
  db: Db,
  jobId: string,
  runners: Record<JobKind, StepRunner>,
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
    return await runners[job.kind](job, run);
  } catch (error) {
    if (error instanceof LostJobError) return "stop";
    console.error(`Job ${job.id} (${job.kind}) failed at ${job.step}.`, error);
    await run.fail(error);
    return "stop";
  }
}

/**
 * Makes a failed job, or one whose runner was cut off, pending again at the
 * step where it stopped. Any other job is left as it is.
 */
export async function resumeJob(db: Db, jobId: string, text: string): Promise<void> {
  const cutOffBefore = new Date(Date.now() - STEP_LIMIT_MS);
  await db
    .update(schema.job)
    .set({
      status: "pending",
      runId: null,
      startedAt: null,
      error: null,
      updatedAt: new Date(),
      progress: withProgress(text),
    })
    .where(
      and(
        eq(schema.job.id, jobId),
        or(
          eq(schema.job.status, "failed"),
          and(eq(schema.job.status, "running"), lt(schema.job.startedAt, cutOffBefore)),
        ),
      ),
    );
}
