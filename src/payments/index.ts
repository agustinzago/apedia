/**
 * The `payments` module is the only code that talks to the payment provider
 * (Polar, the merchant of record). It does two things: start a hosted
 * checkout for a Learner, and verify a webhook into a provider-neutral
 * payment event. What a payment grants is `course`'s business; tests swap
 * in the fake from `@/payments/fake`. Moving to another provider means
 * rewriting this module, nothing else.
 */

/** A payment the provider confirmed, or took back. */
export type PaymentEvent =
  | {
      kind: "paid";
      /** Who took the payment, such as "polar". */
      provider: string;
      /** The payment's id at the provider; the same payment always has the same id. */
      paymentId: string;
      /** The Learner who started the checkout. */
      learnerId: string;
      /** Paid for the Course, after discounts and before sales tax, in the currency's smallest unit. */
      amountCents: number;
      /** ISO 4217, lowercase: "usd". */
      currency: string;
    }
  | {
      /** The whole payment was refunded, or voided. A partial refund is not one. */
      kind: "refunded";
      provider: string;
      paymentId: string;
    };

/** What a webhook turned out to be. */
export type VerifiedWebhook =
  | PaymentEvent
  /** Genuinely from the provider, but nothing Apedia acts on: acknowledge it so it is not sent again. */
  | { kind: "ignored"; reason: string }
  /** Not from the provider (a bad or missing signature), or a signed body that makes no sense. */
  | { kind: "rejected"; reason: "signature" | "payload" };

/** A webhook request exactly as it arrived: the raw body, before any parsing. */
export type WebhookRequest = { body: string; headers: Headers };

export type CheckoutRequest = {
  learnerId: string;
  /** Prefills the checkout form; the Learner may change it there. */
  email: string;
  /** Where the provider sends the Learner after paying. */
  successUrl: string;
  /** Where the checkout's back button goes. */
  returnUrl: string;
};

export type CheckoutStart =
  | { ok: true; url: string }
  /** No provider keys in this environment, so nothing can be bought. */
  | { ok: false; reason: "not-configured" };

export type Payments = {
  /** Starts a hosted checkout for one Course credit. Throws when the provider fails. */
  startCheckout(request: CheckoutRequest): Promise<CheckoutStart>;
  /** Checks the webhook's signature and reads the payment event it carries. */
  verifyWebhook(request: WebhookRequest): Promise<VerifiedWebhook>;
};

/** Payments without a provider: nothing can be bought and no webhook is trusted. */
export function createUnconfiguredPayments(): Payments {
  return {
    async startCheckout() {
      return { ok: false, reason: "not-configured" };
    },
    async verifyWebhook() {
      return { kind: "rejected", reason: "signature" };
    },
  };
}

export { createPolarPayments, type PolarSettings } from "./polar";
