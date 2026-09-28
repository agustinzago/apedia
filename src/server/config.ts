import { DEFAULT_MAGIC_LINK_LIMITS, type MagicLinkLimits } from "@/auth";
import { DEFAULT_DAILY_LIMITS, type DailyLimits, type SpendAlarm, type SpendAlert } from "@/course";

/**
 * Cost protection, configured from the environment. Unset values fall back
 * to the MVP spec's: 1 new Course, 10 Lessons and 60 chat questions per
 * Learner per day, and a spend alarm at $20 a day. Magic links are limited
 * to 3 an hour and 10 a UTC day per address, and 20 an hour per IP.
 */

/** Org-wide daily spend, in US dollars, past which the operator is emailed. */
export const DEFAULT_SPEND_ALARM_USD = 20;

type Env = Record<string, string | undefined>;

/** APEDIA_DAILY_NEW_COURSES, APEDIA_DAILY_LESSONS and APEDIA_DAILY_CHAT_MESSAGES. */
export function dailyLimitsFromEnv(env: Env = process.env): DailyLimits {
  return {
    newCourses: count(env, "APEDIA_DAILY_NEW_COURSES", DEFAULT_DAILY_LIMITS.newCourses),
    lessonGenerations: count(env, "APEDIA_DAILY_LESSONS", DEFAULT_DAILY_LIMITS.lessonGenerations),
    chatMessages: count(env, "APEDIA_DAILY_CHAT_MESSAGES", DEFAULT_DAILY_LIMITS.chatMessages),
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
 * The spend alarm: APEDIA_SPEND_ALARM_USD is the threshold, and the alert
 * is emailed through Resend (AUTH_RESEND_KEY, from AUTH_EMAIL_FROM) to
 * APEDIA_OPERATOR_EMAIL. Outside production, or without an operator email,
 * it is written to the server log instead.
 */
export function spendAlarmFromEnv(
  env: Env = process.env,
  { send = fetch, log = console.warn }: { send?: typeof fetch; log?: (message: string) => void } = {},
): SpendAlarm {
  const thresholdUsd = amount(env, "APEDIA_SPEND_ALARM_USD", DEFAULT_SPEND_ALARM_USD);
  const to = env.APEDIA_OPERATOR_EMAIL?.trim();
  const key = env.AUTH_RESEND_KEY;
  const emails = env.NODE_ENV === "production" && Boolean(to && key);
  if (env.NODE_ENV === "production" && !emails) {
    console.error(
      "APEDIA_OPERATOR_EMAIL or AUTH_RESEND_KEY is not set: the spend alarm will only be logged.",
    );
  }

  return {
    thresholdUsd,
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

export function alertEmail({ day, spentUsd, thresholdUsd }: SpendAlert) {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  return {
    subject: `Apedia spend passed ${usd(thresholdUsd)} on ${day}`,
    text: [
      `Claude spend on ${day} (UTC) reached ${usd(spentUsd)}, past the alarm threshold of ${usd(thresholdUsd)}.`,
      "",
      "This is the only alert for today. Each call is in the teacher_call table:",
      `  select operation, count(*), sum(cost_usd) from teacher_call where created_at >= '${day}' group by operation;`,
      "",
      "Per-Learner caps are set by APEDIA_DAILY_NEW_COURSES, APEDIA_DAILY_LESSONS and APEDIA_DAILY_CHAT_MESSAGES; the threshold by APEDIA_SPEND_ALARM_USD.",
    ].join("\n"),
  };
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
