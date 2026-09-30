import { headers } from "next/headers";

/**
 * Job steps run one per function invocation (ADR 0004): starting a step is a
 * POST to /api/jobs/[jobId] on this same deployment, which answers at once
 * and runs the step after responding, then starts the next.
 */

/**
 * Where to reach this deployment: the site's origin (AUTH_URL, set in
 * Production), otherwise the origin the current request came in on.
 */
export async function requestOrigin(): Promise<string> {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Asks for the job's next step to run in its own invocation; waits only for
 * the request to be accepted. A failure is logged, not thrown: the progress
 * screen notices a job left waiting and starts it again. On a protected
 * Preview, such as staging, the request carries Vercel's Protection Bypass
 * for Automation secret, or Deployment Protection would turn it away.
 */
export async function startJobStep(jobId: string, origin: string): Promise<void> {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  try {
    const response = await fetch(`${origin}/api/jobs/${encodeURIComponent(jobId)}`, {
      method: "POST",
      cache: "no-store",
      headers: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
    });
    if (!response.ok) {
      console.error(`Starting job ${jobId} answered ${response.status}.`);
    }
  } catch (error) {
    console.error(`Could not start job ${jobId}.`, error);
  }
}
