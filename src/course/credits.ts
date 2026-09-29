import { and, count, eq, isNull, lt, sql } from "drizzle-orm";
import { schema, type Db } from "@/db";
import type { PaymentEvent } from "@/payments";
import { creationFailedEmpty } from "./course-creation";
import type { Tx } from "./jobs";

/**
 * Course credits: what buying a Course gives the Learner. Only a verified
 * payment event, delivered by the provider's webhook, records one; the page
 * the Learner returns to after paying grants nothing. Every event may arrive
 * more than once, so recording is idempotent on the provider's payment id.
 * An available credit backs one open Interview, and "Write my course" uses
 * it (./interview, ADR 0007).
 */

export type CourseCreditStatus = (typeof schema.courseCreditStatus.enumValues)[number];

/** A Learner's Course credits, counted by status. */
export type CourseCredits = Record<CourseCreditStatus, number>;

export type RecordPaymentResult =
  /** A new Course credit. */
  | "granted"
  /** The credit is refunded: an unused one can no longer back an Interview. */
  | "refunded"
  /** Already recorded: a repeated delivery. */
  | "duplicate"
  /** No such Learner, say a deleted account: nothing recorded. */
  | "unknown-learner"
  /** A refund for a payment with no Course credit: nothing recorded. */
  | "unknown-payment";

/**
 * Times one credit comes back from Courses given up on. Each such Course ran
 * research, so a Learner who makes it fail on purpose can't research
 * without end on one purchase. A Learner stuck past it can write to the operator.
 */
export const MAX_GIVE_BACKS = 2;

export function createCreditOperations({ db, now }: { db: Db; now: () => Date }) {
  return {
    /**
     * Records a verified payment event. Paid grants one Course credit per
     * payment. A full refund marks an unused credit refunded; a credit
     * already used keeps its status, with the refund's time recorded.
     */
    async recordPayment(event: PaymentEvent): Promise<RecordPaymentResult> {
      const at = now();
      const payment = and(
        eq(schema.courseCredit.provider, event.provider),
        eq(schema.courseCredit.providerPaymentId, event.paymentId),
      );

      if (event.kind === "paid") {
        const [learner] = await db
          .select({ id: schema.learner.id })
          .from(schema.learner)
          .where(eq(schema.learner.id, event.learnerId));
        if (!learner) return "unknown-learner";

        const [granted] = await db
          .insert(schema.courseCredit)
          .values({
            learnerId: event.learnerId,
            provider: event.provider,
            providerPaymentId: event.paymentId,
            amountCents: event.amountCents,
            currency: event.currency,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoNothing({
            target: [schema.courseCredit.provider, schema.courseCredit.providerPaymentId],
          })
          .returning({ id: schema.courseCredit.id });
        return granted ? "granted" : "duplicate";
      }

      const status = schema.courseCredit.status;
      const [refunded] = await db
        .update(schema.courseCredit)
        .set({
          refundedAt: at,
          updatedAt: at,
          // A used credit already started its Course; it stays "used".
          status: sql`case when ${status} = 'available' then 'refunded'::course_credit_status else ${status} end`,
        })
        .where(and(payment, isNull(schema.courseCredit.refundedAt)))
        .returning({ id: schema.courseCredit.id });
      if (refunded) return "refunded";

      const [known] = await db
        .select({ id: schema.courseCredit.id })
        .from(schema.courseCredit)
        .where(payment);
      return known ? "duplicate" : "unknown-payment";
    },

    /**
     * The Course credit that deleting the Course gives back, or null. A
     * Course whose creation failed before finding any Resources produced
     * nothing: giving it up (deleting it) returns its credit, to start
     * another Interview or be refunded, up to `MAX_GIVE_BACKS` times. Any
     * other Course keeps its credit used. Inside `tx` when given.
     */
    async creditGivenBackBy(courseId: string, tx: Tx | Db = db): Promise<string | null> {
      const [row] = await tx
        .select({ id: schema.courseCredit.id })
        .from(schema.course)
        .innerJoin(schema.interview, eq(schema.interview.id, schema.course.interviewId))
        .innerJoin(
          schema.courseCredit,
          and(
            eq(schema.courseCredit.id, schema.interview.courseCreditId),
            eq(schema.courseCredit.status, "used"),
          ),
        )
        .where(
          and(
            eq(schema.course.id, courseId),
            creationFailedEmpty(db, schema.course.id),
            lt(schema.courseCredit.givenBack, MAX_GIVE_BACKS),
          ),
        );
      return row?.id ?? null;
    },

    /**
     * Makes a used credit available again, or refunded if its payment was
     * refunded while it was used. Inside `tx` when given.
     */
    async giveBack(creditId: string, tx: Tx | Db = db): Promise<void> {
      const at = now();
      await tx
        .update(schema.courseCredit)
        .set({
          status: sql`case when ${schema.courseCredit.refundedAt} is null then 'available'::course_credit_status else 'refunded'::course_credit_status end`,
          givenBack: sql`${schema.courseCredit.givenBack} + 1`,
          updatedAt: at,
        })
        .where(and(eq(schema.courseCredit.id, creditId), eq(schema.courseCredit.status, "used")));
    },

    /** The Learner's Course credits by status. `available` ones can back an Interview. */
    async readCourseCredits(learnerId: string): Promise<CourseCredits> {
      const rows = await db
        .select({ status: schema.courseCredit.status, credits: count() })
        .from(schema.courseCredit)
        .where(eq(schema.courseCredit.learnerId, learnerId))
        .groupBy(schema.courseCredit.status);
      const credits: CourseCredits = { available: 0, used: 0, refunded: 0 };
      for (const row of rows) credits[row.status] = row.credits;
      return credits;
    },
  };
}
