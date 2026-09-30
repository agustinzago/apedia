import { createPolar, webhooks } from "@polar-sh/sdk/2026-04";
import type { Payments, VerifiedWebhook } from ".";

/**
 * Payments through Polar, the merchant of record. A Course credit is one
 * one-time product; buying it produces an order, and the order's id is the
 * payment id. The Learner's id travels as checkout metadata, which Polar
 * copies onto the order.
 *
 * API version 2026-04, the oldest the SDK offers and so certainly live;
 * the fields read here are the same in every version the SDK ships.
 */

export type PolarSettings = {
  /** An organization access token, able to create checkouts. */
  accessToken: string;
  /** The webhook endpoint's signing secret (whsec_…). */
  webhookSecret: string;
  /** The one-time product a Course credit is sold as. */
  productId: string;
  /** Polar's sandbox (test cards, no money) or production. Their tokens are separate. */
  server: "sandbox" | "production";
  /** Overrides the API's address, for tests. */
  baseUrl?: string;
};

/** The checkout and order metadata key holding the Learner's id. */
export const LEARNER_ID_KEY = "learner_id";

const PROVIDER = "polar";

export function createPolarPayments(settings: PolarSettings): Payments {
  const polar = createPolar({
    accessToken: settings.accessToken,
    environment: settings.server,
    baseUrl: settings.baseUrl,
    timeout: 10,
  });

  return {
    async startCheckout({ learnerId, email, successUrl, returnUrl }) {
      const checkout = await polar.checkouts.create({
        products: [settings.productId],
        metadata: { [LEARNER_ID_KEY]: learnerId },
        customer_email: email,
        success_url: successUrl,
        return_url: returnUrl,
        // A leaked or mistaken discount code must not make a Course credit free.
        allow_discount_codes: false,
      });
      return { ok: true, url: checkout.url };
    },

    async verifyWebhook({ body, headers }): Promise<VerifiedWebhook> {
      let payload: webhooks.WebhookPayload;
      try {
        payload = await webhooks.validateEvent(
          body,
          {
            "webhook-id": headers.get("webhook-id") ?? "",
            "webhook-timestamp": headers.get("webhook-timestamp") ?? "",
            "webhook-signature": headers.get("webhook-signature") ?? "",
          },
          settings.webhookSecret,
        );
      } catch (error) {
        if (error instanceof webhooks.PolarWebhookVerificationError) {
          return { kind: "rejected", reason: "signature" };
        }
        // Signed, but an event type this SDK version does not know.
        if (error instanceof webhooks.PolarWebhookUnknownTypeError) {
          return { kind: "ignored", reason: `event ${error.eventType}` };
        }
        if (error instanceof webhooks.PolarWebhookError) {
          return { kind: "rejected", reason: "payload" };
        }
        throw error;
      }

      if (
        payload.type !== "order.paid" &&
        payload.type !== "order.refunded" &&
        payload.type !== "order.updated"
      ) {
        return { kind: "ignored", reason: `event ${payload.type}` };
      }
      const order = payload.data;
      if (order.product_id !== settings.productId) {
        return { kind: "ignored", reason: `${payload.type} for product ${order.product_id}` };
      }

      if (payload.type === "order.updated") {
        // Polar sends no dispute webhook. A chargeback it heads off arrives
        // as a refund; one that voids the order arrives as this update, and
        // takes the payment back like a full refund.
        if (order.status !== "void") {
          return { kind: "ignored", reason: `order ${order.id} updated to ${order.status}` };
        }
        return { kind: "refunded", provider: PROVIDER, paymentId: order.id };
      }

      if (payload.type === "order.refunded") {
        // order.refunded is sent for partial refunds too. Only a full refund
        // takes the Course credit back: a partial one (a goodwill gesture, an
        // adjustment) leaves the Learner having paid for their Course.
        if (order.status !== "refunded") {
          return { kind: "ignored", reason: `partial refund of order ${order.id}` };
        }
        return { kind: "refunded", provider: PROVIDER, paymentId: order.id };
      }

      const learnerId = order.metadata?.[LEARNER_ID_KEY];
      if (typeof learnerId !== "string" || learnerId === "") {
        // Bought some other way than Apedia's Buy button: no Learner to credit.
        return { kind: "ignored", reason: `order ${order.id} carries no ${LEARNER_ID_KEY}` };
      }
      return {
        kind: "paid",
        provider: PROVIDER,
        paymentId: order.id,
        learnerId,
        amountCents: order.net_amount,
        currency: order.currency.toLowerCase(),
      };
    },
  };
}
