import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { schema, type Db } from "@/db";
import type { PaymentEvent, WebhookRequest } from "@/payments";
import { createFakePayments, type FakePayments } from "@/payments/fake";
import { createFakeTeacher } from "@/teacher/fake";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { createCourseModule, type CourseModule } from ".";

const paid = (paymentId: string, learnerId = "ana") =>
  ({ kind: "paid", paymentId, learnerId, amountCents: 500, currency: "usd" }) as const;
const refunded = (paymentId: string) => ({ kind: "refunded", paymentId }) as const;

describe("course: Course credits from verified payments", () => {
  let db: Db;
  let course: CourseModule;
  let payments: FakePayments;

  /** What the webhook route does: verify through `payments`, then hand the event to `course`. */
  async function deliver(request: WebhookRequest) {
    const verified = await payments.verifyWebhook(request);
    if (verified.kind === "ignored" || verified.kind === "rejected") return verified.kind;
    return course.recordPayment(verified);
  }

  beforeEach(async () => {
    db = await createTestDb();
    payments = createFakePayments();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await db.insert(schema.learner).values([
      { id: "ana", email: "ana@example.com" },
      { id: "ben", email: "ben@example.com" },
    ]);
  });

  it("starts with no credits", async () => {
    expect(await course.readCourseCredits("ana")).toEqual({ available: 0, used: 0, refunded: 0 });
  });

  it("grants one credit for a paid payment, to that Learner only", async () => {
    expect(await deliver(payments.webhook(paid("order-1")))).toBe("granted");

    expect(await course.readCourseCredits("ana")).toEqual({ available: 1, used: 0, refunded: 0 });
    expect(await course.readCourseCredits("ben")).toEqual({ available: 0, used: 0, refunded: 0 });
    const [credit] = await db.select().from(schema.courseCredit);
    expect(credit).toMatchObject({
      learnerId: "ana",
      provider: "fake",
      providerPaymentId: "order-1",
      amountCents: 500,
      currency: "usd",
      status: "available",
      refundedAt: null,
    });
  });

  it("grants nothing more when the same payment is delivered again", async () => {
    await deliver(payments.webhook(paid("order-1")));

    expect(await deliver(payments.webhook(paid("order-1")))).toBe("duplicate");
    expect(await course.readCourseCredits("ana")).toMatchObject({ available: 1 });

    // A second purchase is a second credit.
    expect(await deliver(payments.webhook(paid("order-2")))).toBe("granted");
    expect(await course.readCourseCredits("ana")).toMatchObject({ available: 2 });
  });

  it("takes back an unused credit when its payment is refunded", async () => {
    await deliver(payments.webhook(paid("order-1")));
    await deliver(payments.webhook(paid("order-2")));

    expect(await deliver(payments.webhook(refunded("order-1")))).toBe("refunded");

    expect(await course.readCourseCredits("ana")).toEqual({ available: 1, used: 0, refunded: 1 });
    const [credit] = await db
      .select()
      .from(schema.courseCredit)
      .where(eqPayment("order-1"));
    expect(credit.status).toBe("refunded");
    expect(credit.refundedAt).toBeInstanceOf(Date);

    // A repeated refund changes nothing.
    expect(await deliver(payments.webhook(refunded("order-1")))).toBe("duplicate");
    expect(await course.readCourseCredits("ana")).toEqual({ available: 1, used: 0, refunded: 1 });
  });

  it("records the refund of a credit already used, leaving it used", async () => {
    await deliver(payments.webhook(paid("order-1")));
    // Stand in for "Write my course" using it.
    await db.update(schema.courseCredit).set({ status: "used" });

    expect(await deliver(payments.webhook(refunded("order-1")))).toBe("refunded");

    expect(await course.readCourseCredits("ana")).toEqual({ available: 0, used: 1, refunded: 0 });
    const [credit] = await db.select().from(schema.courseCredit);
    expect(credit.refundedAt).toBeInstanceOf(Date);
  });

  it("records nothing for a forged webhook", async () => {
    expect(await deliver(payments.forgedWebhook(paid("order-1")))).toBe("rejected");

    expect(await course.readCourseCredits("ana")).toMatchObject({ available: 0 });
    expect(await db.select().from(schema.courseCredit)).toEqual([]);
  });

  it("records nothing for events it does not act on", async () => {
    expect(await deliver(payments.webhook({ kind: "other" }))).toBe("ignored");
    expect(await db.select().from(schema.courseCredit)).toEqual([]);
  });

  it("records nothing for a Learner who is not there, such as a deleted account", async () => {
    const event: PaymentEvent = { provider: "fake", ...paid("order-1", "gone") };

    expect(await course.recordPayment(event)).toBe("unknown-learner");
    expect(await db.select().from(schema.courseCredit)).toEqual([]);
  });

  it("records nothing for a refund of a payment it never saw", async () => {
    expect(await deliver(payments.webhook(refunded("order-9")))).toBe("unknown-payment");
    expect(await db.select().from(schema.courseCredit)).toEqual([]);
  });

  it("deletes the Learner's credits with their account", async () => {
    await deliver(payments.webhook(paid("order-1")));
    await deliver(payments.webhook(paid("order-2", "ben")));

    await course.deleteAccount("ana");

    expect(await course.readCourseCredits("ana")).toEqual({ available: 0, used: 0, refunded: 0 });
    expect(await course.readCourseCredits("ben")).toMatchObject({ available: 1 });
    // A late delivery for the deleted account grants nothing.
    expect(await deliver(payments.webhook(paid("order-3")))).toBe("unknown-learner");
  });
});

function eqPayment(paymentId: string) {
  return eq(schema.courseCredit.providerPaymentId, paymentId);
}
