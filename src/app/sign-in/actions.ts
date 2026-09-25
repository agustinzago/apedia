"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { parseSignInRequest } from "@/auth";
import { signIn } from "@/server/auth";

export type SignInState =
  | { status: "idle" }
  | { status: "under-13" }
  | { status: "invalid-email" | "failed"; email: string };

/** Sends a magic link, but only once the Learner has confirmed they are 13 or older. */
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

  try {
    // The link brings the Learner back to the home page once opened.
    await signIn("resend", {
      email: request.email,
      redirectTo: "/",
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
