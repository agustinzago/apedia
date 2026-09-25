import { z } from "zod";

/** What the sign-in form asks for: an email address and the 13+ age gate. */
export type SignInRequest =
  | { ok: true; email: string; next: string }
  | { ok: false; reason: "under-13" | "invalid-email" };

const Email = z.string().trim().toLowerCase().pipe(z.email());

/**
 * Reads the sign-in form. The age gate is checked first: without the
 * "I'm 13 or older" box ticked no magic link is sent, whatever the email.
 */
export function parseSignInRequest(form: FormData): SignInRequest {
  if (form.get("over13") !== "on") return { ok: false, reason: "under-13" };
  const email = Email.safeParse(form.get("email"));
  if (!email.success) return { ok: false, reason: "invalid-email" };
  return { ok: true, email: email.data, next: safeNext(form.get("next")) };
}

/**
 * Where to go once signed in: a path on this site, such as "/interview".
 * Anything else, including another site, falls back to the home page.
 */
export function safeNext(value: unknown): string {
  if (typeof value !== "string") return "/";
  const onThisSite = /^\/(?![/\\])/.test(value) && !/[\x00-\x1f]/.test(value);
  return onThisSite ? value : "/";
}
