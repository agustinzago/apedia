/**
 * What the wizard checks about each production value: its shape (offline)
 * and, where the service allows it, whether it actually works (online).
 * Shape checks return a problem to show the person, or undefined when fine.
 */
import { randomBytes } from "node:crypto";

export type Fetch = typeof fetch;

/** The outcome of an online check. "unchecked" means the service could not tell us. */
export type Check =
  | { status: "ok" }
  | { status: "failed"; problem: string }
  | { status: "unchecked"; reason: string };

export function databaseUrlProblem(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That is not a URL. Copy the connection string from the Neon dashboard (Connect).";
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return "A Postgres connection string starts with postgresql://.";
  }
  if (!url.hostname || !url.username || !url.password) {
    return "The connection string needs a user, a password and a host.";
  }
  return undefined;
}

export function anthropicKeyProblem(value: string): string | undefined {
  return value.startsWith("sk-ant-")
    ? undefined
    : "An Anthropic API key starts with sk-ant-. Create one at console.anthropic.com.";
}

export function resendKeyProblem(value: string): string | undefined {
  return value.startsWith("re_")
    ? undefined
    : "A Resend API key starts with re_. Create one at resend.com/api-keys.";
}

/** The sender, as Auth.js takes it: `Name <address>` or a bare address. */
export function parseFromAddress(value: string): { domain: string } | { problem: string } {
  const match =
    /^[^<>]*<\s*[^<>\s@]+@([^<>\s@]+)\s*>$/.exec(value) ?? /^[^<>\s@]+@([^<>\s@]+)$/.exec(value);
  if (!match) return { problem: "Use an address like Apedia <sign-in@your-domain.com>." };
  const domain = match[1].toLowerCase();
  if (domain === "resend.dev") {
    return { problem: "resend.dev only delivers to your own inbox. Use your verified domain." };
  }
  return { domain };
}

/** The site's origin (`https://host`), or a problem. Auth.js builds magic links from it. */
export function parseSiteUrl(value: string): { origin: string } | { problem: string } {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { problem: "That is not a URL. Use the address Learners will open, e.g. https://apedia.app." };
  }
  if (url.protocol !== "https:") return { problem: "The live site must use https://." };
  if (url.pathname !== "/" || url.search || url.hash) {
    return { problem: "Use just the address, without a path: https://host." };
  }
  return { origin: url.origin };
}

/** 32 random bytes, base64, as Auth.js recommends for AUTH_SECRET. */
export function generateAuthSecret(): string {
  return randomBytes(32).toString("base64");
}

/** Shows enough of a secret to recognise it, never the whole thing. */
export function mask(value: string): string {
  if (value.length <= 12) return "•".repeat(value.length);
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export async function checkAnthropicKey(key: string, fetchFn: Fetch = fetch): Promise<Check> {
  const response = await fetchFn("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (response.ok) return { status: "ok" };
  if (response.status === 401) return { status: "failed", problem: "Anthropic rejected this key." };
  return { status: "unchecked", reason: `Anthropic answered ${response.status}.` };
}

/** Whether the sender's domain is verified in the Resend account that owns the key. */
export async function checkResendDomain(
  key: string,
  domain: string,
  fetchFn: Fetch = fetch,
): Promise<Check> {
  const response = await fetchFn("https://api.resend.com/domains", {
    headers: { authorization: `Bearer ${key}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    name?: string;
    data?: { name: string; status: string }[];
  };
  if (body.name === "restricted_api_key") {
    return {
      status: "unchecked",
      reason: `This key can only send email, so it cannot list domains. Check ${domain} shows "Verified" at resend.com/domains.`,
    };
  }
  if (response.status === 401 || response.status === 403) {
    return { status: "failed", problem: "Resend rejected this key." };
  }
  if (!response.ok || !body.data) {
    return { status: "unchecked", reason: `Resend answered ${response.status}.` };
  }
  const found = body.data.find((d) => d.name.toLowerCase() === domain);
  if (!found) {
    return {
      status: "failed",
      problem: `${domain} is not in this Resend account. Add it at resend.com/domains and set the DNS records it shows.`,
    };
  }
  if (found.status !== "verified") {
    return {
      status: "failed",
      problem: `${domain} is "${found.status}" in Resend, not verified yet. DNS can take a while; press Verify at resend.com/domains.`,
    };
  }
  return { status: "ok" };
}

/** Whether the deployed site answers Auth.js and offers the magic-link provider. */
export async function checkLiveSignIn(origin: string, fetchFn: Fetch = fetch): Promise<Check> {
  let response: Response;
  try {
    response = await fetchFn(`${origin}/api/auth/providers`);
  } catch (error) {
    return { status: "failed", problem: `Could not reach ${origin}: ${(error as Error).message}` };
  }
  if (!response.ok) {
    return {
      status: "failed",
      problem: `${origin}/api/auth/providers answered ${response.status}. Check the deployment's function logs in Vercel.`,
    };
  }
  const providers = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!("resend" in providers)) {
    return { status: "failed", problem: "The site answered, but offers no magic-link sign-in." };
  }
  return { status: "ok" };
}
