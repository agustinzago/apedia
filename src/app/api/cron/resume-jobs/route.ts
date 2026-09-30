import { getCourse } from "@/server/course";
import { requestOrigin, startJobStep } from "@/server/jobs";

/**
 * Vercel Cron (vercel.json, daily: the Hobby plan allows no more): resumes jobs that stopped through no fault of
 * their own, such as a step whose function was killed at 300 s, so a
 * Learner who paid is not left waiting on a job nothing will pick up again.
 * Vercel sends CRON_SECRET as a bearer token; without it, nothing runs.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Not found", { status: 404 });
  }
  const [course, origin] = await Promise.all([getCourse(), requestOrigin()]);
  const resumed = await course.resumeStuckJobs();
  await Promise.all(resumed.map((jobId) => startJobStep(jobId, origin)));
  return Response.json({ resumed: resumed.length });
}
