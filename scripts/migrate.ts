/**
 * Applies migrations to DATABASE_URL (Neon) and seeds the Example course.
 * In dev without DATABASE_URL the app migrates its local PGlite database itself.
 */
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { createCourseModule } from "@/course";
import { MIGRATIONS_FOLDER, schema } from "@/db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

async function main(connectionString: string) {
  const pool = new Pool({ connectionString });
  const db = drizzle({ client: pool, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  await createCourseModule({ db }).ensureExampleCourse();
  await pool.end();
  console.log("Migrated and seeded the Example course.");
}

main(url).catch((error) => {
  console.error(error);
  process.exit(1);
});
