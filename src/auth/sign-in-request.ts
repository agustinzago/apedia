import { z } from "zod";

/** What the sign-in form asks for: an email address and the 13+ age gate. */
export type SignInRequest =
  | { ok: true; email: string }
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
  return { ok: true, email: email.data };
}
