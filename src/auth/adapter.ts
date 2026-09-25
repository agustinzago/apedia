import { DrizzleAdapter } from "@auth/drizzle-adapter";
import type { Adapter } from "next-auth/adapters";
import { schema, type Db } from "@/db";

/** Auth.js storage in our Postgres: Learners, sessions and magic-link tokens. */
export function createAuthAdapter(db: Db): Adapter {
  return DrizzleAdapter(db, {
    usersTable: schema.learner,
    accountsTable: schema.account,
    sessionsTable: schema.session,
    verificationTokensTable: schema.verificationToken,
  });
}
