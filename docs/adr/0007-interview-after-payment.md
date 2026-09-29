# Interview after payment

The Interview calls Claude (the safety check and the follow-ups), and Apedia has no free budget: every Claude call must be paid for first. So an Interview now starts only for a signed-in Learner holding an available Course credit, and "Write my course" uses that credit. This reverses ADR 0003's anonymous Interview and the user stories that relied on it (a visitor answering before signing in); the Example course stays open to anyone, with no sign-in, since it calls nobody.

## Consequences

- A visitor who types a subject signs in, then buys a Course unless they hold an available credit, then does the Interview. The subject rides along in the return URLs (`/interview?subject=…`) through sign-in and checkout, so it is typed once. There is no anonymous Interview, cookie or claim at sign-in any more; anonymous rows from before stay in the database, unreachable.
- An Interview reserves one available credit when it starts: the Interview row points at it, and the link is unique, so one credit backs at most one open Interview, even when two tabs start at once. The Learner may leave and come back to it, or let it go to free the credit.
- A redirected subject reserves nothing. "Write my course" marks the Interview's credit used in the same transaction that creates the Course, so every Course uses exactly one credit, and a double submit uses no more.
- A refunded credit stops its open Interview: it can't be answered or written.
- A failed Course creation job is retried from its step (ADR 0004), up to three attempts per step (amended before launch, so a step failed on purpose can't rerun costly calls without end). It fails for good once a step has used its attempts, or when the Learner gives up on it, by deleting a Course whose creation failed before finding any Resources; that gives the credit back to available (or refunded, if its payment was refunded meanwhile), at most twice per credit. This is the same Course that counts toward no daily limit. A Course that found Resources keeps its credit used, even once its attempts are used up: retrying it is cheap, and the Learner can write to the operator.
- At the spend alarm, sales pause means "Buy a Course" is refused. A credit already bought still starts its Interview; only the spend stop refuses Teacher calls.
