import type { CheckoutRequest, Payments, PaymentEvent, VerifiedWebhook, WebhookRequest } from ".";

/**
 * Payments that never touch a provider, for tests. A checkout is recorded
 * and answered with a made-up URL. A webhook is a JSON payment event (or
 * `{ "kind": "other" }`, standing in for an event Apedia ignores), signed by
 * putting the fake's secret in the `fake-signature` header: `webhook()` and
 * `forgedWebhook()` build both kinds.
 *
 * Never used by the app, in any environment: without Polar's keys, the app
 * says buying is not set up yet.
 */
export type FakePayments = Payments & {
  /** Every checkout started, in order. */
  checkouts: CheckoutRequest[];
  /** A webhook as the provider would send it, correctly signed. */
  webhook(event: FakeWebhookEvent): WebhookRequest;
  /** The same, with a signature the fake does not accept. */
  forgedWebhook(event: FakeWebhookEvent): WebhookRequest;
};

/** A payment event (its provider defaults to "fake"), or another kind of event. */
export type FakeWebhookEvent =
  | DistributiveOmit<PaymentEvent, "provider">
  | { kind: "other" };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const SIGNATURE_HEADER = "fake-signature";
const SECRET = "fake-webhook-secret";

export function createFakePayments({
  checkoutUrl = "https://checkout.example/fake",
}: { checkoutUrl?: string } = {}): FakePayments {
  const checkouts: CheckoutRequest[] = [];
  const signed = (event: FakeWebhookEvent, signature: string): WebhookRequest => ({
    body: JSON.stringify(event),
    headers: new Headers({ [SIGNATURE_HEADER]: signature }),
  });

  return {
    checkouts,

    async startCheckout(request) {
      checkouts.push(request);
      return { ok: true, url: `${checkoutUrl}?learner=${encodeURIComponent(request.learnerId)}` };
    },

    async verifyWebhook({ body, headers }): Promise<VerifiedWebhook> {
      if (headers.get(SIGNATURE_HEADER) !== SECRET) return { kind: "rejected", reason: "signature" };
      let event: FakeWebhookEvent;
      try {
        event = JSON.parse(body);
      } catch {
        return { kind: "rejected", reason: "payload" };
      }
      if (event.kind === "other") return { kind: "ignored", reason: "event other" };
      return { provider: "fake", ...event };
    },

    webhook: (event) => signed(event, SECRET),
    forgedWebhook: (event) => signed(event, "forged"),
  };
}
