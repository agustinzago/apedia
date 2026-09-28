import { getCourse } from "@/server/course";
import { getPayments, receivePaymentWebhook } from "@/server/payments";

/**
 * Polar's webhook (registered in Polar for order.paid and order.refunded).
 * It only verifies the signature through `payments` and hands the event to
 * `course`, which records the Course credit.
 */
export async function POST(request: Request) {
  return receivePaymentWebhook(request, { payments: getPayments(), course: await getCourse() });
}
