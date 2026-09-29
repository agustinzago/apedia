import { and, eq, lt } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { STEP_LIMIT_MS, type Tx } from "./jobs";

/**
 * Holds the Learner's row until the transaction ends, so that one Learner's
 * requests that count something costly (a chat question, an Interview
 * start) and then record it take turns. Without it, requests sent at once
 * would all count before any of them recorded, and all get through. The
 * Learner, not the Course, is locked: the daily caps span all their Courses.
 */
export async function lockLearner(tx: Tx, learnerId: string): Promise<void> {
  await tx
    .select({ id: schema.learner.id })
    .from(schema.learner)
    .where(eq(schema.learner.id, learnerId))
    .for("update");
}

/** Returned instead of doing the work while another request is doing it. */
export const BUSY = { ok: false, reason: "busy" } as const;
export type Busy = typeof BUSY;

/** Whether `withLease` found another request doing the work. */
export function isBusy(result: unknown): result is Busy {
  return result === BUSY;
}

/**
 * Runs `work` unless another request holds `key`, in which case it returns
 * `BUSY` without running it. For work that asks the Teacher before it
 * records anything, such as answering an Interview question: the same
 * request sent twice at once then asks only once. A claim whose holder
 * never let go (its function was cut off) lapses after the longest a
 * function may run.
 */
export async function withLease<T>(db: Db, key: string, work: () => Promise<T>): Promise<T | Busy> {
  const holder = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STEP_LIMIT_MS);
  const [claimed] = await db
    .insert(schema.lease)
    .values({ key, holder, expiresAt })
    .onConflictDoUpdate({
      target: schema.lease.key,
      set: { holder, expiresAt },
      setWhere: lt(schema.lease.expiresAt, now),
    })
    .returning({ key: schema.lease.key });
  if (!claimed) return BUSY;
  try {
    return await work();
  } finally {
    await db
      .delete(schema.lease)
      .where(and(eq(schema.lease.key, key), eq(schema.lease.holder, holder)));
  }
}
