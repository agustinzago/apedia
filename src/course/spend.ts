import { eq, gte, sum } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { TeacherCall } from "@/teacher";
import { utcDay } from "./limits";

/**
 * Org-wide spend: every call the Teacher makes to Claude is recorded, and
 * the day's spend (UTC) is held to two limits, so a bug, a retry loop or a
 * surge of sign-ups can't drain the Anthropic credits. At the first, the
 * alarm, the operator is alerted once and sales pause: no new Interview
 * starts. At the second, the stop, nothing calls the Teacher until the next
 * UTC day; everything already written stays readable.
 */

/** Org-wide daily spend limits, in US dollars. Configuration: see `DEFAULT_SPEND_LIMITS`. */
export type SpendLimits = {
  /** The operator is alerted and sales pause. */
  alarmUsd: number;
  /** Nothing calls the Teacher until the next UTC day. At or above `alarmUsd`. */
  stopUsd: number;
};

/**
 * The alarm the MVP spec sets, and a stop at twice it: room for Courses
 * already bought to keep going after sales pause, while still capping a
 * runaway day. The app may override them from its environment.
 */
export const DEFAULT_SPEND_LIMITS: SpendLimits = { alarmUsd: 20, stopUsd: 40 };

/** Returned instead of doing the work while the day's spend is past a limit. */
export type SpendPaused = {
  ok: false;
  reason: "paused";
  /** When the next UTC day starts and the work may resume. */
  resumesAt: Date;
};

export type SpendAlert = {
  /** The UTC day, as YYYY-MM-DD. */
  day: string;
  /** Spent so far that day, in US dollars. */
  spentUsd: number;
  thresholdUsd: number;
  /** Where the Teacher stops for the day. */
  stopUsd: number;
};

export type SpendAlarm = {
  /** Tells the operator, such as by email. A throw means it was not delivered; it is tried again on a later call. */
  notify: (alert: SpendAlert) => Promise<void>;
};

export type Spend = ReturnType<typeof createSpendOperations>;

export function createSpendOperations({
  db,
  limits,
  alarm,
  now,
}: {
  db: Db;
  limits: SpendLimits;
  alarm: SpendAlarm | null;
  now: () => Date;
}) {
  /** The day's spend so far, in US dollars. */
  async function spentSince(since: Date): Promise<number> {
    const [row] = await db
      .select({ spent: sum(schema.teacherCall.costUsd).mapWith(Number) })
      .from(schema.teacherCall)
      .where(gte(schema.teacherCall.createdAt, since));
    return row?.spent ?? 0;
  }

  async function check(limitUsd: number): Promise<SpendPaused | null> {
    const day = utcDay(now());
    if ((await spentSince(day.start)) < limitUsd) return null;
    return { ok: false, reason: "paused", resumesAt: day.end };
  }

  return {
    /**
     * Records one call to Claude. When it takes the day's spend to the
     * alarm, the operator is alerted, once per day.
     */
    async recordTeacherCall(call: TeacherCall): Promise<void> {
      const at = now();
      await db.insert(schema.teacherCall).values({ ...call, createdAt: at });
      if (!alarm) return;

      const day = utcDay(at);
      const spentUsd = await spentSince(day.start);
      const thresholdUsd = limits.alarmUsd;
      if (spentUsd < thresholdUsd) return;

      // Whoever inserts the day's row sends the alert; everyone else is too late.
      const [claimed] = await db
        .insert(schema.spendAlarm)
        .values({ day: day.key, spentUsd, thresholdUsd })
        .onConflictDoNothing()
        .returning({ day: schema.spendAlarm.day });
      if (!claimed) return;

      try {
        await alarm.notify({ day: day.key, spentUsd, thresholdUsd, stopUsd: limits.stopUsd });
      } catch (error) {
        console.error(`The spend alarm for ${day.key} could not be sent; trying again on the next call.`, error);
        await db.delete(schema.spendAlarm).where(eq(schema.spendAlarm.day, day.key));
      }
    },

    /** Whether a new sale (for now, a new Interview) may start today. Starting one calls the Teacher too. */
    newSale() {
      return check(Math.min(limits.alarmUsd, limits.stopUsd));
    },

    /** Whether the Teacher may be called today. */
    teacherCall() {
      return check(limits.stopUsd);
    },
  };
}
