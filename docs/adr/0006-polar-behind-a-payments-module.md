# Polar as merchant of record, behind a `payments` module

Learners buy Course credits through Polar, which is the merchant of record: it sells to the Learner and takes care of sales tax, receipts and refunds. Dodo Payments is the fallback if Polar stops suiting us, so switching has to stay cheap. Only `src/payments` talks to Polar (an ESLint rule keeps its SDK out of every other module), and it hands `course` provider-neutral "paid" and "refunded" events. Moving to Dodo means rewriting that module and nothing else.

## Consequences

- Only a verified webhook grants a Course credit. The page the Learner returns to after paying grants nothing, so a crafted redirect can't mint credits. The webhook is idempotent on the provider's payment id, because providers deliver more than once.
- Only a full refund takes a credit back, and only while it is unused. A used credit keeps its status, and the refund is recorded on it.
- The price Apedia shows (`COURSE_CREDIT.priceUsd`) and the price Polar charges (the product's) are set in two places, and must match.
