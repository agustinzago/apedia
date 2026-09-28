"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { clientIp, parseSignInRequest } from "@/auth";
import { getMagicLinkLimiter, signIn } from "@/server/auth";

export type SignInState =
  | { status: "idle" }
  | { status: "under-13" }
  | { status: "invalid-email" | "too-many-links" | "failed"; email: string };

/**
 * Sends a magic link, but only once the Learner has confirmed they are 13
 * or older, and not past the limits on links per address and per IP.
 */
export async function requestMagicLink(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const request = parseSignInRequest(form);
  const typed = String(form.get("email") ?? "");
  if (!request.ok) {
    return request.reason === "under-13"
      ? { status: "under-13" }
      : { status: "invalid-email", email: typed };
  }

  const limiter = await getMagicLinkLimiter();
  const allowed = await limiter.allow({ email: request.email, ip: clientIp(await headers()) });
  if (!allowed.ok) return { status: "too-many-links", email: typed };

  try {
    // The link brings the Learner back where they came from, such as their
    // Interview, or else to the home page.
    await signIn("resend", {
      email: request.email,
      redirectTo: request.next,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      console.error(error);
      return { status: "failed", email: typed };
    }
    throw error;
  }
  redirect("/sign-in/check-email");
}
