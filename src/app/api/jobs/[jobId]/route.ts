import { after } from "next/server";
import { authSecret } from "@/auth";
import { getCourse } from "@/server/course";
import { receiveJobStart } from "@/server/job-start";
import { requestOrigin, startJobStep } from "@/server/jobs";

// Each step gets a whole invocation (ADR 0004); research search alone may
// take 240 s.
export const maxDuration = 300;

/**
 * Runs the job's next step after answering, then starts the step after it in
 * a fresh invocation. Once a job that picked Up next is done, it starts
 * writing that Lesson the same way, so it is ready before its first open.
 * Only the app itself starts steps: see ./server/job-start.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[jobId]">) {
  const { jobId } = await ctx.params;
  const origin = await requestOrigin();
  return receiveJobStart(request, jobId, {
    secret: authSecret(),
    run: () =>
      after(async () => {
        const course = await getCourse();
        if ((await course.runJobStep(jobId)) === "more") {
          await startJobStep(jobId, origin);
          return;
        }
        const upNext = await course.writeUpNextAfter(jobId);
        if (upNext) await startJobStep(upNext, origin);
      }),
  });
}
