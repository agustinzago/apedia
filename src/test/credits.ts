import type { CourseModule } from "@/course";
import { createFakePayments } from "@/payments/fake";

const payments = createFakePayments();
let orders = 0;

/**
 * Buys one Course credit for the Learner the way the app does: the fake
 * provider's signed webhook, verified by `payments`, recorded by `course`.
 * Returns the payment id, for a refund.
 */
export async function buyCourse(course: CourseModule, learnerId: string): Promise<string> {
  const paymentId = `order-${++orders}`;
  const verified = await payments.verifyWebhook(
    payments.webhook({ kind: "paid", paymentId, learnerId, amountCents: 500, currency: "usd" }),
  );
  if (verified.kind !== "paid") throw new Error(`Not paid: ${JSON.stringify(verified)}`);
  const recorded = await course.recordPayment(verified);
  if (recorded !== "granted") throw new Error(`No credit granted: ${recorded}`);
  return paymentId;
}

/** A full refund of the payment, delivered the same way. */
export async function refundCourse(course: CourseModule, paymentId: string): Promise<void> {
  const verified = await payments.verifyWebhook(payments.webhook({ kind: "refunded", paymentId }));
  if (verified.kind !== "refunded") throw new Error(`Not refunded: ${JSON.stringify(verified)}`);
  await course.recordPayment(verified);
}
