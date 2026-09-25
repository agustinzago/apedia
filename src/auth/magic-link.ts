import type { EmailConfig } from "next-auth/providers";
import Resend from "next-auth/providers/resend";

type Delivery = "email" | "console";

/**
 * The magic-link provider. In production the link is emailed through Resend
 * (AUTH_RESEND_KEY); anywhere else it is printed to the server console, so
 * no Resend account is needed locally.
 */
export function createMagicLinkProvider({
  delivery = process.env.NODE_ENV === "production" ? "email" : "console",
  from = process.env.AUTH_EMAIL_FROM ?? "Apedia <onboarding@resend.dev>",
  log = console.info,
}: { delivery?: Delivery; from?: string; log?: (message: string) => void } = {}): EmailConfig {
  const resend = Resend({ from });
  if (delivery === "email") return resend;
  return {
    ...resend,
    async sendVerificationRequest({ identifier, url }) {
      log(`\n🔗 Apedia magic link for ${identifier}:\n${url}\n`);
    },
  };
}
