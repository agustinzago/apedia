/**
 * What a Course credit buys, and when it is refunded. Payments and the
 * per-Course allowances are not built yet; the Terms and Refund policy
 * pages quote these numbers, and both should read them from here.
 */
export const COURSE_CREDIT = {
  /** The price of one credit, in US dollars. */
  priceUsd: 5,
  /** The Lessons one Course may have written. */
  lessons: 20,
  /** The questions the Learner may ask the Teacher across the Course's Lessons. */
  chatQuestions: 200,
  /** Days after purchase in which a credit whose Course was never written is refunded on request. */
  refundDays: 14,
} as const;
