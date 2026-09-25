import { MIGRATIONS_FOLDER, schema, type Db } from ".";

const globalForDb = globalThis as unknown as { apediaDb?: Promise<Db> };

/**
 * The app's database. Uses Neon when DATABASE_URL is set; otherwise a local
 * PGlite database in `.pglite/`, migrated on first use.
 */
export function getDb(): Promise<Db> {
  globalForDb.apediaDb ??= connect();
  return globalForDb.apediaDb;
}

async function connect(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    return drizzle({ client: new Pool({ connectionString: url }), schema });
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const db = drizzle({
    client: new PGlite(process.env.PGLITE_DIR ?? ".pglite"),
    schema,
  });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}
