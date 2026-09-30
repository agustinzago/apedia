import { DEFAULT_MAGIC_LINK_LIMITS, type MagicLinkLimits } from "@/auth";
import {
  DEFAULT_DAILY_LIMITS,
  DEFAULT_SPEND_LIMITS,
  type DailyLimits,
  type SpendAlarm,
  type SpendAlert,
  type SpendLimits,
} from "@/course";
import type { PolarSettings } from "@/payments";

/**
 * Configuration from the environment. Cost protection: unset values fall
 * back to the defaults: an abuse guard of 40 Lessons and 200 chat questions
 * per Learner per day, and a spend alarm at $20 a day, which pauses sales,
 * with the Teacher stopping at twice the alarm. A Course's own allowance is
 * not configured here: it is what its credit buys, `COURSE_CREDIT`, which
 * the Terms quote. Magic links are limited to 3 an hour and 10 a UTC day per
 * address, and 20 an hour per IP. And the operator, whom the Privacy, Terms
 * and Refund policy pages name, and Polar, which sells Course credits.
 */

type Env = Record<string, string | undefined>;

/**
 * APEDIA_DAILY_LESSONS and APEDIA_DAILY_CHAT_MESSAGES.
 * APEDIA_DAILY_INTERVIEWS: Interview starts (default 5).
 */
export function dailyLimitsFromEnv(env: Env = process.env): DailyLimits {
  return {
    lessonGenerations: count(env, "APEDIA_DAILY_LESSONS", DEFAULT_DAILY_LIMITS.lessonGenerations),
    chatMessages: count(env, "APEDIA_DAILY_CHAT_MESSAGES", DEFAULT_DAILY_LIMITS.chatMessages),
    interviews: count(env, "APEDIA_DAILY_INTERVIEWS", DEFAULT_DAILY_LIMITS.interviews),
  };
}

/** APEDIA_MAGIC_LINKS_PER_EMAIL_PER_HOUR, APEDIA_MAGIC_LINKS_PER_EMAIL_PER_DAY and APEDIA_MAGIC_LINKS_PER_IP_PER_HOUR. */
export function magicLinkLimitsFromEnv(env: Env = process.env): MagicLinkLimits {
  const fallback = DEFAULT_MAGIC_LINK_LIMITS;
  return {
    perEmailPerHour: count(env, "APEDIA_MAGIC_LINKS_PER_EMAIL_PER_HOUR", fallback.perEmailPerHour),
    perEmailPerDay: count(env, "APEDIA_MAGIC_LINKS_PER_EMAIL_PER_DAY", fallback.perEmailPerDay),
    perIpPerHour: count(env, "APEDIA_MAGIC_LINKS_PER_IP_PER_HOUR", fallback.perIpPerHour),
  };
}

/**
 * APEDIA_SPEND_ALARM_USD, where sales pause and the operator is alerted, and
 * APEDIA_SPEND_STOP_USD, where the Teacher stops for the day. Unset, the stop
 * is twice the alarm; it is never below it.
 */
export function spendLimitsFromEnv(env: Env = process.env): SpendLimits {
  const alarmUsd = amount(env, "APEDIA_SPEND_ALARM_USD", DEFAULT_SPEND_LIMITS.alarmUsd);
  const stopUsd = amount(env, "APEDIA_SPEND_STOP_USD", 2 * alarmUsd);
  if (stopUsd >= alarmUsd) return { alarmUsd, stopUsd };
  console.warn(
    `APEDIA_SPEND_STOP_USD must be at or above APEDIA_SPEND_ALARM_USD; using ${alarmUsd}.`,
  );
  return { alarmUsd, stopUsd: alarmUsd };
}

/**
 * The spend alarm: the alert is emailed through Resend (AUTH_RESEND_KEY,
 * from AUTH_EMAIL_FROM) to APEDIA_OPERATOR_EMAIL. Outside production, or
 * without an operator email, it is written to the server log instead.
 */
export function spendAlarmFromEnv(
  env: Env = process.env,
  { send = fetch, log = console.warn }: { send?: typeof fetch; log?: (message: string) => void } = {},
): SpendAlarm {
  const to = env.APEDIA_OPERATOR_EMAIL?.trim();
  const key = env.AUTH_RESEND_KEY;
  const emails = env.NODE_ENV === "production" && Boolean(to && key);
  if (env.NODE_ENV === "production" && !emails) {
    console.error(
      "APEDIA_OPERATOR_EMAIL or AUTH_RESEND_KEY is not set: the spend alarm will only be logged.",
    );
  }

  return {
    async notify(alert) {
      const { subject, text } = alertEmail(alert);
      if (!emails) {
        log(`\n💸 ${subject}\n${text}\n`);
        return;
      }
      const response = await send("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.AUTH_EMAIL_FROM ?? "Apedia <onboarding@resend.dev>",
          to: [to],
          subject,
          text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Resend answered ${response.status}: ${await response.text()}`);
      }
    },
  };
}

export function alertEmail({ day, spentUsd, thresholdUsd, stopUsd }: SpendAlert) {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return {
    subject: `Apedia spend passed ${usd(thresholdUsd)} on ${day}`,
    text: [
      `Claude spend on ${day} (UTC) reached ${usd(spentUsd)}, past the alarm threshold of ${usd(thresholdUsd)}.`,
      `Sales of Course credits are paused until midnight UTC. Credits already bought and Courses already started keep going until spend reaches ${usd(stopUsd)}, when the Teacher stops for the rest of the day.`,
      "",
      "This is the only alert for today. Each call is in the teacher_call table:",
      `  select operation, count(*), sum(cost_usd) from teacher_call where created_at >= '${day}' group by operation;`,
      "",
      "Per-Learner caps are set by APEDIA_DAILY_LESSONS, APEDIA_DAILY_CHAT_MESSAGES and APEDIA_DAILY_INTERVIEWS; the threshold by APEDIA_SPEND_ALARM_USD; the stop by APEDIA_SPEND_STOP_USD.",
    ].join("\n"),
  };
}

/** Who runs Apedia, as the public pages name them. */
export type Operator = { name: string; contactEmail: string };

/** Shown while APEDIA_OPERATOR_NAME or APEDIA_CONTACT_EMAIL is unset, so the gap is plain to see. */
export const OPERATOR_PLACEHOLDER: Operator = {
  name: "[APEDIA_OPERATOR_NAME is not set]",
  contactEmail: "contact-email-not-set@example.invalid",
};

/**
 * APEDIA_OPERATOR_NAME and APEDIA_CONTACT_EMAIL: the name and address the
 * Privacy, Terms and Refund policy pages publish, which Polar requires. The
 * contact does not fall back to APEDIA_OPERATOR_EMAIL: that address was
 * given for private alerts, and publishing it is the operator's choice.
 */
export function operatorFromEnv(env: Env = process.env): Operator {
  const name = env.APEDIA_OPERATOR_NAME?.trim();
  const contactEmail = env.APEDIA_CONTACT_EMAIL?.trim();
  if (env.NODE_ENV === "production" && !(name && contactEmail)) {
    console.error(
      "APEDIA_OPERATOR_NAME or APEDIA_CONTACT_EMAIL is not set: the Privacy, Terms and Refund policy pages show a placeholder.",
    );
  }
  return {
    name: name || OPERATOR_PLACEHOLDER.name,
    contactEmail: contactEmail || OPERATOR_PLACEHOLDER.contactEmail,
  };
}

/**
 * Polar, which sells Course credits: POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET
 * and POLAR_PRODUCT_ID, all server-side only, and POLAR_SERVER, "sandbox"
 * (the default, for development and previews) or "production". Null while
 * any of the three is unset: buying is not set up, and in production the
 * server logs an error. Null too on Vercel's Production (VERCEL_ENV) unless
 * POLAR_SERVER is "production": the sandbox's test cards would buy real
 * Course credits.
 */
export function polarFromEnv(env: Env = process.env): Omit<PolarSettings, "baseUrl"> | null {
  const accessToken = env.POLAR_ACCESS_TOKEN?.trim();
  const webhookSecret = env.POLAR_WEBHOOK_SECRET?.trim();
  const productId = env.POLAR_PRODUCT_ID?.trim();
  if (!(accessToken && webhookSecret && productId)) {
    if (env.NODE_ENV === "production") {
      console.error(
        "POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET or POLAR_PRODUCT_ID is not set: Learners can't buy a Course.",
      );
    }
    return null;
  }

  const raw = env.POLAR_SERVER?.trim() || "sandbox";
  if (env.VERCEL_ENV === "production" && raw !== "production") {
    console.error(
      `POLAR_SERVER is ${raw}, not production: Learners can't buy a Course, lest the sandbox's test cards buy real credits.`,
    );
    return null;
  }
  const server = raw === "production" ? "production" : "sandbox";
  if (raw !== server) console.warn(`POLAR_SERVER must be sandbox or production; using sandbox.`);
  return { accessToken, webhookSecret, productId, server };
}

function count(env: Env, name: string, fallback: number): number {
  const value = parse(env, name, fallback);
  if (Number.isInteger(value) && value >= 0) return value;
  console.warn(`${name} must be a whole number of 0 or more; using ${fallback}.`);
  return fallback;
}

function amount(env: Env, name: string, fallback: number): number {
  const value = parse(env, name, fallback);
  if (Number.isFinite(value) && value > 0) return value;
  console.warn(`${name} must be an amount above 0; using ${fallback}.`);
  return fallback;
}

function parse(env: Env, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  return raw ? Number(raw) : fallback;
}
