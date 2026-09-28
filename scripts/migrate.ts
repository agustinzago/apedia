/**
 * Applies migrations to DATABASE_URL (Neon) and seeds the Example course.
 * In dev without DATABASE_URL the app migrates its local PGlite database itself.
 *
 * With --on-deploy (run by `npm run build`) it acts only in a Vercel
 * Production build, so every deploy to Production migrates before the new
 * code serves; local builds, previews and the smoke test are left alone.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { ensureExampleCourse } from "@/course";
import { MIGRATIONS_FOLDER, schema } from "@/db";

const url = process.env.DATABASE_URL;
if (process.argv.includes("--on-deploy") && process.env.VERCEL_ENV !== "production") {
  console.log("Not a Vercel Production build: skipping migrations.");
  process.exit(0);
}
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

async function main(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await ensureExampleCourse(db);
  await pool.end();
  console.log("Migrated and seeded the Example course.");
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
