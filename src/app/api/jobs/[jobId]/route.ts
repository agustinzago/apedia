import { after } from "next/server";
import { getCourse } from "@/server/course";
import { requestOrigin, startJobStep } from "@/server/jobs";

// Each step gets a whole invocation (ADR 0004); research search alone may
// take 240 s.
export const maxDuration = 300;

/**
 * Runs the job's next step after answering, then starts the step after it in
 * a fresh invocation. Once a job that picked Up next is done, it starts
 * writing that Lesson the same way, so it is ready before its first open.
 * It needs no sign-in: it only moves on work a Learner has already started,
 * a job runs one step at a time, and a failed job waits for its Learner's
 * retry.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[jobId]">) {
  const { jobId } = await ctx.params;
  const origin = await requestOrigin();
  after(async () => {
    const course = await getCourse();
    if ((await course.runJobStep(jobId)) === "more") {
      await startJobStep(jobId, origin);
      return;
    }
    const upNext = await course.writeUpNextAfter(jobId);
    if (upNext) await startJobStep(upNext, origin);
  });
  return new Response(null, { status: 202 });
}
