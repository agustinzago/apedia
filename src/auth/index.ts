import type { NextAuthConfig } from "next-auth";
import type { Db } from "@/db";
import { createAuthAdapter } from "./adapter";
import { createMagicLinkProvider } from "./magic-link";

export {
  clientIp,
  createMagicLinkLimiter,
  DEFAULT_MAGIC_LINK_LIMITS,
  type MagicLinkLimiter,
  type MagicLinkLimits,
} from "./magic-link-limits";
export { parseSignInRequest, safeNext, type SignInRequest } from "./sign-in-request";

/** Only for local development, so `npm run dev` works without an AUTH_SECRET. */
const DEV_SECRET = "apedia-development-secret-not-for-production";

/** AUTH_SECRET; outside production, a fixed stand-in when it is unset. */
export function authSecret(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.AUTH_SECRET ?? (env.NODE_ENV === "production" ? undefined : DEV_SECRET);
}

/** Auth.js settings: magic-link sign-in, with Learners and sessions in our Postgres. */
export function createAuthConfig({ db }: { db: Db }): NextAuthConfig {
  return {
    adapter: createAuthAdapter(db),
    providers: [createMagicLinkProvider()],
    session: { strategy: "database" },
    secret: authSecret(),
    pages: {
      signIn: "/sign-in",
      verifyRequest: "/sign-in/check-email",
      error: "/sign-in",
    },
    callbacks: {
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
    },
  };
}
