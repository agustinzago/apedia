/**
 * What a Course credit buys, and when it is refunded. `lessons` and
 * `chatQuestions` are every Course's allowance, enforced by ./allowance; the
 * home page, the Pricing, Terms and Refund policy pages and the "Buy a
 * Course" button quote these numbers, and read them from here. They have no
 * environment override, so what is sold and what is enforced can't drift
 * apart. The price Learners are charged is the Polar product's: keep it at
 * `priceUsd`.
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
