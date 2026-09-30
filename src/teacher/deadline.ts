import { AsyncLocalStorage } from "node:async_hooks";

/**
 * When the work under way must be done by, such as a job step that must fit
 * its function's 300 s. Calls to Claude made inside it get only the time
 * left, so a slow or retried call can't run the step past its limit.
 */
const deadlines = new AsyncLocalStorage<number>();

/** Runs `work` with a deadline of `at` (ms since the epoch) for the calls it makes. */
export function withDeadline<T>(at: number, work: () => Promise<T>): Promise<T> {
  return deadlines.run(at, work);
}

/** The milliseconds left before the current deadline, or null outside one. */
export function timeLeft(now: number = Date.now()): number | null {
  const at = deadlines.getStore();
  return at === undefined ? null : at - now;
}
