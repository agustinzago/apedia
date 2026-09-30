/**
 * For the operator: gives a stuck job back its "Try again"s and makes it
 * pending at the step where it stopped, for a Learner left with "write to
 * us". The Learner's progress screen starts it again once it notices the job
 * waiting. Leaves a done job alone.
 *
 *   DATABASE_URL=… npx tsx scripts/reset-job.ts <jobId>
 */
import { Pool } from "@neondatabase/serverless";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { schema } from "@/db";
import { withProgress } from "@/course/jobs";

const [jobId] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!jobId || !url) {
  console.error("Usage: DATABASE_URL=… npx tsx scripts/reset-job.ts <jobId>");
  process.exit(1);
}

async function main(connectionString: string, id: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool, schema });
  const [job] = await db
    .update(schema.job)
    .set({
      status: "pending",
      runId: null,
      startedAt: null,
      error: null,
      retries: 0,
      freeRetries: 0,
      updatedAt: new Date(),
      progress: withProgress("Picking up where I left off."),
    })
    .where(and(eq(schema.job.id, id), ne(schema.job.status, "done")))
    .returning({ kind: schema.job.kind, step: schema.job.step, courseId: schema.job.courseId });
  await pool.end();
  if (!job) {
    console.error(`No job ${id}, or it is done.`);
    process.exit(1);
  }
  console.log(`Reset job ${id} (${job.kind}, course ${job.courseId}) to pending at ${job.step}.`);
}

main(url, jobId).catch((error) => {
  console.error(error);
  process.exit(1);
});
