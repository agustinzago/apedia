import NextAuth from "next-auth";
import { cache } from "react";
import { createAuthConfig } from "@/auth";
import type { Viewer } from "@/course";
import { getDb } from "@/db/client";

export const { handlers, auth, signIn, signOut } = NextAuth(async () =>
  createAuthConfig({ db: await getDb() }),
);

/** Who is asking in this request: the signed-in Learner, or a visitor. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const session = await auth();
  return { learnerId: session?.user?.id ?? null };
});
