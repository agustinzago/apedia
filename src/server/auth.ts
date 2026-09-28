import NextAuth from "next-auth";
import { cache } from "react";
import { authSecret, createAuthConfig, createMagicLinkLimiter, type MagicLinkLimiter } from "@/auth";
import type { Viewer } from "@/course";
import { getDb } from "@/db/client";
import { magicLinkLimitsFromEnv } from "./config";

export const { handlers, auth, signIn, signOut } = NextAuth(async () =>
  createAuthConfig({ db: await getDb() }),
);

/** Who is asking in this request: the signed-in Learner, or a visitor. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const session = await auth();
  return { learnerId: session?.user?.id ?? null };
});

/** The limits on magic-link emails, keyed with the same secret as Auth.js. */
export async function getMagicLinkLimiter(): Promise<MagicLinkLimiter> {
  const secret = authSecret();
  if (!secret) throw new Error("AUTH_SECRET is not set.");
  return createMagicLinkLimiter({
    db: await getDb(),
    limits: magicLinkLimitsFromEnv(),
    secret,
    now: () => new Date(),
  });
}
