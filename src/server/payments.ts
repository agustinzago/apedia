import type { CourseModule } from "@/course";
import { createPolarPayments, createUnconfiguredPayments, type Payments } from "@/payments";
import { polarFromEnv } from "./config";

const globalForPayments = globalThis as unknown as { apediaPayments?: Payments };

/**
 * The app's payments: Polar when its keys are set (see `polarFromEnv`),
 * otherwise nothing can be bought and every webhook is rejected. The fake
 * is for tests only, never the app.
 */
export function getPayments(): Payments {
  globalForPayments.apediaPayments ??= (() => {
    const polar = polarFromEnv();
    return polar ? createPolarPayments(polar) : createUnconfiguredPayments();
  })();
  return globalForPayments.apediaPayments;
}

/**
 * The payment webhook: verify it through `payments`, hand the event to
 * `course`, answer. A bad signature is refused with 403. An event Apedia
 * does not act on, or one it cannot place (a deleted account, a refund of a
 * payment it never saw), is acknowledged, so the provider stops sending it.
 * A failure to record answers 500, so the provider delivers it again.
 */
export async function receivePaymentWebhook(
  request: Request,
  { payments, course }: { payments: Payments; course: Pick<CourseModule, "recordPayment"> },
): Promise<Response> {
  const verified = await payments.verifyWebhook({
    body: await request.text(),
    headers: request.headers,
  });

  if (verified.kind === "rejected") {
    console.warn(`Payment webhook rejected: bad ${verified.reason}.`);
    return verified.reason === "signature"
      ? new Response("Invalid signature", { status: 403 })
      : new Response("Invalid payload", { status: 400 });
  }
  if (verified.kind === "ignored") return new Response(null, { status: 202 });

  const outcome = await course.recordPayment(verified);
  if (outcome === "unknown-learner" || outcome === "unknown-payment") {
    console.warn(
      `Payment webhook: ${verified.kind} ${verified.provider} payment ${verified.paymentId} recorded nothing (${outcome}).`,
    );
  }
  return new Response(null, { status: 202 });
}
