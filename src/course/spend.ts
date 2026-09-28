import { eq, gte, sum } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { TeacherCall } from "@/teacher";
import { utcDay } from "./limits";

/**
 * Org-wide spend: every call the Teacher makes to Claude is recorded, and
 * the operator is alerted once per UTC day when the day's spend crosses a
 * threshold, so a surge of sign-ups can't surprise them.
 */

export type SpendAlert = {
  /** The UTC day, as YYYY-MM-DD. */
  day: string;
  /** Spent so far that day, in US dollars. */
  spentUsd: number;
  thresholdUsd: number;
};

export type SpendAlarm = {
  /** Org-wide daily spend, in US dollars, at which to alert the operator. */
  thresholdUsd: number;
  /** Tells the operator, such as by email. A throw means it was not delivered; it is tried again on a later call. */
  notify: (alert: SpendAlert) => Promise<void>;
};

export function createSpendOperations({
  db,
  alarm,
  now,
}: {
  db: Db;
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

  return {
    /**
     * Records one call to Claude. When it takes the day's spend to the
     * alarm threshold, the operator is alerted, once per day.
     */
    async recordTeacherCall(call: TeacherCall): Promise<void> {
      const at = now();
      await db.insert(schema.teacherCall).values({ ...call, createdAt: at });
      if (!alarm) return;

      const day = utcDay(at);
      const spentUsd = await spentSince(day.start);
      if (spentUsd < alarm.thresholdUsd) return;

      // Whoever inserts the day's row sends the alert; everyone else is too late.
      const [claimed] = await db
        .insert(schema.spendAlarm)
        .values({ day: day.key, spentUsd, thresholdUsd: alarm.thresholdUsd })
        .onConflictDoNothing()
        .returning({ day: schema.spendAlarm.day });
      if (!claimed) return;

      try {
        await alarm.notify({ day: day.key, spentUsd, thresholdUsd: alarm.thresholdUsd });
      } catch (error) {
        console.error(`The spend alarm for ${day.key} could not be sent; trying again on the next call.`, error);
        await db.delete(schema.spendAlarm).where(eq(schema.spendAlarm.day, day.key));
      }
    },
  };
}
