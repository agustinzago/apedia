import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * `npm run build` runs `tsx scripts/migrate.ts --on-deploy`. DATABASE_URL is
 * never set here, so a build that would migrate stops at "DATABASE_URL is
 * not set." and no database is touched.
 */
function buildMigration(env: Record<string, string>) {
  const result = spawnSync("node_modules/.bin/tsx", ["scripts/migrate.ts", "--on-deploy"], {
    env: { NODE_ENV: "production", PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    encoding: "utf8",
  });
  const migrates = result.stderr.includes("DATABASE_URL is not set.");
  const skips = result.status === 0 && result.stdout.includes("skipping migrations");
  expect(migrates !== skips, `${result.stdout}${result.stderr}`).toBe(true);
  return migrates ? "migrates" : "skips";
}

describe("scripts: migrations on deploy", () => {
  it("migrates on a Preview build of the staging branch", () => {
    expect(buildMigration({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging" })).toBe(
      "migrates",
    );
  });

  it("migrates on a Production build, whatever the branch", () => {
    expect(buildMigration({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "master" })).toBe(
      "migrates",
    );
  });

  it("skips every other build, so no other preview touches a database", () => {
    expect(buildMigration({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature" })).toBe("skips");
    expect(buildMigration({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "staging-2" })).toBe("skips");
    expect(buildMigration({ VERCEL_ENV: "preview" })).toBe("skips");
    expect(buildMigration({ VERCEL_ENV: "development", VERCEL_GIT_COMMIT_REF: "staging" })).toBe("skips");
    expect(buildMigration({ VERCEL_GIT_COMMIT_REF: "staging" })).toBe("skips");
    expect(buildMigration({})).toBe("skips");
  });
});
