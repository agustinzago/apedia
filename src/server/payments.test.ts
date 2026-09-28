import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCourseModule, type CourseModule } from "@/course";
import { schema, type Db } from "@/db";
import type { WebhookRequest } from "@/payments";
import { createFakePayments, type FakePayments } from "@/payments/fake";
import { createFakeTeacher } from "@/teacher/fake";
import { createTestDb } from "@/test/db";
import { createFakeUrlFetcher } from "@/url-fetcher/fake";
import { receivePaymentWebhook } from "./payments";

const paid = (paymentId: string, learnerId = "ana") =>
  ({ kind: "paid", paymentId, learnerId, amountCents: 500, currency: "usd" }) as const;

describe("server: the payment webhook", () => {
  let db: Db;
  let course: CourseModule;
  let payments: FakePayments;

  const post = ({ body, headers }: WebhookRequest) =>
    receivePaymentWebhook(
      new Request("http://localhost/api/payments/webhook", { method: "POST", body, headers }),
      { payments, course },
    );

  beforeEach(async () => {
    db = await createTestDb();
    payments = createFakePayments();
    course = createCourseModule({
      db,
      teacher: createFakeTeacher(),
      fetchUrl: createFakeUrlFetcher(),
    });
    await db.insert(schema.learner).values({ id: "ana", email: "ana@example.com" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("grants one credit however many times a payment is delivered", async () => {
    expect((await post(payments.webhook(paid("order-1")))).status).toBe(202);
    expect((await post(payments.webhook(paid("order-1")))).status).toBe(202);

    expect(await course.readCourseCredits("ana")).toMatchObject({ available: 1 });
  });

  it("refuses a bad signature with 403 and records nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await post(payments.forgedWebhook(paid("order-1")))).status).toBe(403);

    expect(await db.select().from(schema.courseCredit)).toEqual([]);
  });

  it("acknowledges events it ignores, so they are not sent again", async () => {
    expect((await post(payments.webhook({ kind: "other" }))).status).toBe(202);
  });

  it("acknowledges and logs a payment for an account that is gone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await post(payments.webhook(paid("order-1", "gone")))).status).toBe(202);

    expect(await db.select().from(schema.courseCredit)).toEqual([]);
    expect(warn.mock.calls[0][0]).toContain("unknown-learner");
  });
});
