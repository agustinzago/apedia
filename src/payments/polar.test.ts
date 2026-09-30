import { createHmac, randomBytes } from "node:crypto";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPolarPayments, type PolarSettings } from ".";

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;
const PRODUCT = "prod-course-credit";

/** Signs a body the way Polar does (Standard Webhooks: HMAC-SHA256 over id.timestamp.body). */
function signed(
  payload: unknown,
  { secret = SECRET, at = new Date() }: { secret?: string; at?: Date } = {},
) {
  const body = JSON.stringify(payload);
  const id = `msg_${randomBytes(8).toString("hex")}`;
  const timestamp = String(Math.floor(at.getTime() / 1000));
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return {
    body,
    headers: new Headers({
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${signature}`,
    }),
  };
}

/** The parts of an order Apedia reads; Polar sends many more. */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    status: "paid",
    product_id: PRODUCT,
    subtotal_amount: 500,
    net_amount: 500,
    tax_amount: 100,
    total_amount: 600,
    refunded_amount: 0,
    currency: "usd",
    metadata: { learner_id: "ana" },
    ...overrides,
  };
}

const event = (type: string, data: unknown) => ({
  type,
  timestamp: new Date().toISOString(),
  api_version: "2026-04",
  data,
});

describe("payments: Polar", () => {
  let server: Server;
  const seen: { method?: string; url?: string; headers: IncomingHttpHeaders; body: unknown }[] = [];
  let settings: PolarSettings;

  beforeAll(async () => {
    server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        seen.push({
          method: request.method,
          url: request.url,
          headers: request.headers,
          body: JSON.parse(text || "null"),
        });
        response
          .writeHead(201, { "Content-Type": "application/json" })
          .end(JSON.stringify({ id: "checkout-1", url: "https://sandbox.polar.sh/checkout/abc" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    settings = {
      accessToken: "polar_oat_test",
      webhookSecret: SECRET,
      productId: PRODUCT,
      server: "sandbox",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    };
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("starts a checkout for the Course credit product, with the Learner's id as metadata", async () => {
    const start = await createPolarPayments(settings).startCheckout({
      learnerId: "ana",
      email: "ana@example.com",
      successUrl: "https://apedia.app/purchase/thanks",
      returnUrl: "https://apedia.app/",
    });

    expect(start).toEqual({ ok: true, url: "https://sandbox.polar.sh/checkout/abc" });
    const request = seen.at(-1)!;
    expect(request.method).toBe("POST");
    expect(request.url).toMatch(/^\/v1\/checkouts\/?$/);
    expect(request.headers.authorization).toBe("Bearer polar_oat_test");
    expect(request.body).toEqual({
      products: [PRODUCT],
      metadata: { learner_id: "ana" },
      customer_email: "ana@example.com",
      success_url: "https://apedia.app/purchase/thanks",
      return_url: "https://apedia.app/",
      // A leaked or mistaken code must not make a Course credit free.
      allow_discount_codes: false,
    });
  });

  it("reads a paid order as a payment for the Learner in its metadata", async () => {
    const payments = createPolarPayments(settings);

    expect(await payments.verifyWebhook(signed(event("order.paid", order())))).toEqual({
      kind: "paid",
      provider: "polar",
      paymentId: "order-1",
      learnerId: "ana",
      amountCents: 500,
      currency: "usd",
    });
  });

  it("reads a full refund, and ignores a partial one", async () => {
    const payments = createPolarPayments(settings);
    const full = order({ status: "refunded", refunded_amount: 500 });
    const partial = order({ status: "partially_refunded", refunded_amount: 200 });

    expect(await payments.verifyWebhook(signed(event("order.refunded", full)))).toEqual({
      kind: "refunded",
      provider: "polar",
      paymentId: "order-1",
    });
    expect(await payments.verifyWebhook(signed(event("order.refunded", partial)))).toMatchObject({
      kind: "ignored",
    });
  });

  it("reads a voided order, as after a lost chargeback, as taking the payment back", async () => {
    const payments = createPolarPayments(settings);

    expect(await payments.verifyWebhook(signed(event("order.updated", order({ status: "void" }))))).toEqual({
      kind: "refunded",
      provider: "polar",
      paymentId: "order-1",
    });
    expect(await payments.verifyWebhook(signed(event("order.updated", order())))).toMatchObject({
      kind: "ignored",
    });
  });

  it("ignores other events, other products and orders from outside Apedia", async () => {
    const payments = createPolarPayments(settings);
    const ignored = { kind: "ignored" };

    expect(await payments.verifyWebhook(signed(event("order.created", order())))).toMatchObject(ignored);
    expect(
      await payments.verifyWebhook(signed(event("order.paid", order({ product_id: "prod-other" })))),
    ).toMatchObject(ignored);
    expect(
      await payments.verifyWebhook(signed(event("order.paid", order({ metadata: {} })))),
    ).toMatchObject(ignored);
    // Signed, but a type this SDK version does not know.
    expect(await payments.verifyWebhook(signed(event("order.teleported", order())))).toMatchObject(
      ignored,
    );
  });

  it("rejects a bad, missing or stale signature", async () => {
    const payments = createPolarPayments(settings);
    const rejected = { kind: "rejected", reason: "signature" };
    const paid = event("order.paid", order());

    const otherSecret = `whsec_${randomBytes(24).toString("base64")}`;
    expect(await payments.verifyWebhook(signed(paid, { secret: otherSecret }))).toEqual(rejected);

    const tampered = signed(paid);
    tampered.body = tampered.body.replace('"ana"', '"eve"');
    expect(await payments.verifyWebhook(tampered)).toEqual(rejected);

    expect(
      await payments.verifyWebhook({ body: JSON.stringify(paid), headers: new Headers() }),
    ).toEqual(rejected);

    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(await payments.verifyWebhook(signed(paid, { at: hourAgo }))).toEqual(rejected);
  });
});
