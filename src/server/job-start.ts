import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Only the app itself may start a job step: each start carries an HMAC of
 * the job id, keyed with AUTH_SECRET. Without it, anyone could POST to
 * /api/jobs/[jobId] over and over and start background invocations.
 */

const HEADER = "x-apedia-job-token";

function tokenFor(jobId: string, secret: string): string {
  return createHmac("sha256", secret).update(`job-start:${jobId}`).digest("hex");
}

/** The headers `startJobStep` sends with a start. */
export function jobStartHeaders(jobId: string, secret: string): Record<string, string> {
  return { [HEADER]: tokenFor(jobId, secret) };
}

/**
 * Answers a start: 202 and `run` for one the app signed, 404 for anything
 * else, as if the route were not there. Without a secret, nothing starts.
 */
export async function receiveJobStart(
  request: Request,
  jobId: string,
  { secret, run }: { secret: string | undefined; run: () => void },
): Promise<Response> {
  const given = Buffer.from(request.headers.get(HEADER) ?? "", "utf8");
  const expected = secret === undefined ? null : Buffer.from(tokenFor(jobId, secret), "utf8");
  if (!expected || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Not found", { status: 404 });
  }
  run();
  return new Response(null, { status: 202 });
}
