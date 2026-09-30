import { createHmac } from "node:crypto";
import { and, count, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import { schema, type Db } from "@/db";

/**
 * Limits on magic-link emails, which keep anyone from spending the Resend
 * quota, flooding a stranger's inbox or hurting the sending domain's
 * reputation (ADR 0003). Each is enforced by counting the links sent in its
 * window, like the daily caps. Being over a limit says nothing about
 * whether the address has an account.
 */

/** How many magic links may be sent. Configuration: see `DEFAULT_MAGIC_LINK_LIMITS`. */
export type MagicLinkLimits = {
  /** To one address in the last hour. */
  perEmailPerHour: number;
  /** To one address in the current UTC day. */
  perEmailPerDay: number;
  /** From one IP in the last hour, whatever the address. */
  perIpPerHour: number;
};

/** The default limits; the app may override them from its environment. */
export const DEFAULT_MAGIC_LINK_LIMITS: MagicLinkLimits = {
  perEmailPerHour: 3,
  perEmailPerDay: 10,
  perIpPerHour: 20,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The requesting IP: the first address in x-forwarded-for, which Vercel
 * sets to the client's. Null without one, as in local development.
 */
export function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

export type MagicLinkLimiter = ReturnType<typeof createMagicLinkLimiter>;

/**
 * `secret` keys the hash of each address (AUTH_SECRET): a plain hash of an
 * email is easy to reverse by guessing, a keyed one is not.
 */
export function createMagicLinkLimiter({
  db,
  limits,
  secret,
  now,
}: {
  db: Db;
  limits: MagicLinkLimits;
  secret: string;
  now: () => Date;
}) {
  const t = schema.magicLinkRequest;

  return {
    /**
     * Records a magic link about to be sent to `email`, unless that would
     * go over a limit. Only a link that may be sent is recorded, so a
     * refused request never holds the window open. Without an IP, only the
     * per-address limits apply.
     */
    async allow({
      email,
      ip,
    }: {
      email: string;
      ip: string | null;
    }): Promise<{ ok: true } | { ok: false; reason: "too-many-links" }> {
      const at = now();
      const hourAgo = new Date(at.getTime() - HOUR_MS);
      const dayStart = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
      const emailHash = createHmac("sha256", secret)
        .update(email.trim().toLowerCase())
        .digest("hex");

      // Requests for the same address or from the same IP take turns, so a
      // burst sent at once can't all count before any of them is recorded.
      // Locked in a fixed order, so two requests never wait on each other.
      const locks = [
        `magic-link:email:${emailHash}`,
        ...(ip === null ? [] : [`magic-link:ip:${ip}`]),
      ].sort();
      const allowed = await db.transaction(async (tx) => {
        for (const key of locks) {
          await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
        }
        const sent = async (...conditions: SQL[]) =>
          (await tx.select({ n: count() }).from(t).where(and(...conditions)))[0]?.n ?? 0;
        const emailHour = await sent(eq(t.emailHash, emailHash), gt(t.createdAt, hourAgo));
        const emailDay = await sent(eq(t.emailHash, emailHash), gte(t.createdAt, dayStart));
        const ipHour = ip === null ? 0 : await sent(eq(t.ip, ip), gt(t.createdAt, hourAgo));
        if (
          emailHour >= limits.perEmailPerHour ||
          emailDay >= limits.perEmailPerDay ||
          ipHour >= limits.perIpPerHour
        ) {
          return false;
        }
        await tx.insert(t).values({ emailHash, ip, createdAt: at });
        return true;
      });
      if (!allowed) return { ok: false, reason: "too-many-links" };
      // No window is longer than a day, so older rows only take up room.
      await db.delete(t).where(lt(t.createdAt, new Date(at.getTime() - DAY_MS)));
      return { ok: true };
    },
  };
}
