# Apedia

A "learn anything" web app that runs the /teach method. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`.

## Develop

```sh
npm install
npm run dev        # http://localhost:3000
```

Without `DATABASE_URL`, the app uses a local PGlite database in `.pglite/` (Postgres in WebAssembly — no Docker), migrates it and seeds the Example course on first request. Delete `.pglite/` to start fresh.

Sign-in needs no setup locally: the magic link is printed to the `npm run dev` console instead of being emailed. Open it in the same browser to sign in.

The Teacher needs no setup either: without `ANTHROPIC_API_KEY` a stand-in Teacher echoes the Interview questions and builds the Mission from your answers. Put `ANTHROPIC_API_KEY=…` in `.env.local` to talk to Claude.

An Interview needs a Course credit (ADR 0007), and only a payment webhook grants one, so trying the Interview locally needs the Polar sandbox (see Payments). The Example course needs nothing.

## Check

```sh
npm run typecheck
npm run lint
npm test           # runs against in-memory PGlite
npm run test:e2e   # Playwright smoke test through the Example course
```

The smoke test builds the app and serves it on port 3100 with a fresh in-memory database. First time on a machine, run `npx playwright install chromium`.

## Database

- Schema: `src/db/schema.ts`. After changing it, run `npm run db:generate` and commit the new file in `drizzle/`.
- Production (Neon): migrations are applied by the Production build on Vercel; `DATABASE_URL=… npm run db:migrate` applies them by hand and seeds the Example course.

## Sign-in

Magic-link sign-in with Auth.js and Resend (ADR 0003). Learners and sessions live in Postgres through the Drizzle adapter. In production set:

- `AUTH_SECRET`: 32 random bytes, base64: `openssl rand -base64 32`. (Not `npx auth secret`: the `auth` package on npm is now Better Auth's CLI.)
- `AUTH_RESEND_KEY`: a Resend API key.
- `AUTH_EMAIL_FROM`: the sender on a domain verified in Resend, e.g. `Apedia <sign-in@example.com>`.

Outside production the link is always printed to the console and never emailed.

Magic links are limited to 3 an hour and 10 a UTC day per address, and 20 an hour per IP (the first address in Vercel's `x-forwarded-for`; without one, as locally, only the per-address limits apply). Each link sent is recorded in the `magic_link_request` table with an HMAC of the address keyed with `AUTH_SECRET`, never the address itself, and rows older than a day are pruned. Over a limit, the form asks the Learner to check their inbox or try again in an hour, without saying whether the address has an account. `APEDIA_MAGIC_LINKS_PER_EMAIL_PER_HOUR`, `APEDIA_MAGIC_LINKS_PER_EMAIL_PER_DAY` and `APEDIA_MAGIC_LINKS_PER_IP_PER_HOUR` override the defaults in `src/auth/magic-link-limits.ts`.

## Teacher

Every Claude call lives in `src/teacher/` (an ESLint rule keeps the SDK out of every other module). In production set `ANTHROPIC_API_KEY`; it is only read on the server. `APEDIA_FAKE_TEACHER=1` forces the stand-in Teacher, as the e2e smoke test does. Alongside the stand-in Teacher, Resource URLs are not fetched (its Resources are made up).

## Cost protection

Per Learner per day (UTC), `course` allows 1 new Course, 10 Lesson generations and 60 chat questions, counting the Learner's rows for the day. A Course whose research failed counts only if it produced Resources. Hitting a limit shows a friendly message saying when it resets. The limits are configuration: `APEDIA_DAILY_NEW_COURSES`, `APEDIA_DAILY_LESSONS` and `APEDIA_DAILY_CHAT_MESSAGES` override the defaults in `src/course/limits.ts`.

A Learner may also start 5 Interviews a day (`APEDIA_DAILY_INTERVIEWS`). Each start is recorded in the `interview_start` table before the Teacher is called, and discarding the Interview leaves that row, so letting an Interview go frees its Course credit but gives no start back. Past the limit, `course` refuses the start before calling the Teacher or reserving a credit, and the Interview page says when it resets. Answering or coming back to an Interview already started is not starting.

Every call the Teacher makes to Claude is recorded in the `teacher_call` table: operation, model, input and output tokens, web searches and cost at list prices (`src/teacher/pricing.ts`). The first time a day's org-wide spend reaches `APEDIA_SPEND_ALARM_USD` (default $20), the operator is emailed once through Resend at `APEDIA_OPERATOR_EMAIL`; outside production the alert is printed to the console. Calls made by the stand-in Teacher are not recorded.

Spend limits act, in two tiers, until the next midnight UTC. At the alarm, sales pause: "Buy a Course" doesn't open the checkout and says Apedia is taking a breather today. Course credits already bought are paid for, so they still start Interviews (ADR 0007); Interviews under way, "Write my course" and Courses already started carry on. At `APEDIA_SPEND_STOP_USD` (default twice the alarm, so $40, and never below it), `course` refuses everything that would call the Teacher: new Interviews, Interview answers, new Courses, Lesson writing, Finish, chat and Mission changes that re-pick Up next, each with a calm message saying when the Teacher is back. Everything already written stays readable. A job step due to run past the stop pauses at that step instead; "Pick up where it stopped" resumes it from there once the day resets. The defaults are in `src/course/spend.ts`.

## Payments

Learners buy a Course credit for US$5 through Polar, the merchant of record (ADR 0006). Everything that talks to Polar lives in `src/payments/` (an ESLint rule keeps its SDK out of every other module), behind two operations: start a checkout, and verify a webhook into a "paid" or "refunded" event. `course` records Course credits from those events in the `course_credit` table and reads them back with `readCourseCredits`.

1. "Buy a Course · $5" (home and account pages, signed in) starts a Polar checkout for the Course credit product, with the Learner's id as checkout metadata and their email prefilled, and sends them there.
2. Polar calls `POST /api/payments/webhook`. The route checks the signature (Standard Webhooks, through the Polar SDK) and hands the event to `course`: `order.paid` grants one Course credit, once per order however often it is delivered; `order.refunded` for a full refund marks an unused credit refunded, so it can no longer start a Course (a used one stays used, with the refund recorded). A partial refund changes nothing. A bad signature gets 403; other events, other products, and orders for an account that no longer exists are acknowledged and ignored.
3. Polar sends the Learner to `/purchase/thanks?next=…`, which grants nothing: only the webhook does. Until the credit has arrived (usually within seconds) the page says the payment is being confirmed and checks again every few seconds; then it leads on to `next`, such as the Interview on the subject they typed.

Deleting an account deletes its Course credits; the payments stay with Polar. While a day's spend is past the alarm, "Buy a Course" says Apedia is taking a breather instead of opening the checkout.

### Course credits and the Interview

The Interview calls Claude, so it runs only for a signed-in Learner with an available Course credit (ADR 0007), and `course` refuses it otherwise:

1. The subject form on the home page goes to `/interview?subject=…`. A visitor is sent to sign in, and a Learner with no credit free to buy a Course; the subject rides along in the `next` and checkout return URLs (cut to 120 characters, and only ever shown as text), so it is typed once.
2. The first answer starts the Interview, which reserves the Learner's oldest available credit that backs no other Interview: `interview.course_credit_id`, unique, so one credit backs at most one open Interview, even from two tabs at once. A subject the safety check redirects reserves nothing. The Learner may leave and come back (`/interview?id=…`, linked from the home page), or let an open Interview go to use its credit for another subject.
3. "Write my course" marks that credit `used` in the transaction that creates the Course, only while it is still `available`, so every Course uses exactly one credit. A credit refunded while its Interview is open stops the Interview.
4. A Course whose creation failed before finding any Resources (the kind that counts toward no daily limit) can be retried, keeping its credit, or deleted, which gives the credit back: `available` again, or `refunded` if its payment was refunded meanwhile. Any other Course keeps its credit `used`.

Set, server-side only:

- `POLAR_ACCESS_TOKEN`: an organization access token (Settings → Developers) with the `checkouts:read` and `checkouts:write` scopes.
- `POLAR_PRODUCT_ID`: the Course credit product, a one-time product priced at US$5. Its price is what Learners are charged; the "$5" Apedia shows comes from `COURSE_CREDIT.priceUsd` in `src/course/course-credit.ts`. Keep the two the same.
- `POLAR_WEBHOOK_SECRET`: the webhook endpoint's secret. Register `https://<your site>/api/payments/webhook` under Settings → Webhooks, format Raw, subscribed to `order.paid` and `order.refunded` (API version 2026-04, the one `src/payments/polar.ts` reads, if Polar asks).
- `POLAR_SERVER`: `sandbox` (the default) or `production`. The sandbox (sandbox.polar.sh) takes test cards and moves no money; it has its own organization, product, token and webhook. Use it in development and on preview deployments (set the sandbox values in Vercel's Preview environment), and `production` only in Production.

Without the three keys nothing can be bought: "Buy a Course" says buying isn't set up yet, the webhook rejects every request, and in production the server logs an error. Tests use the fake in `src/payments/fake.ts`; the app never does.

To try it locally, put sandbox values in `.env.local`, expose `npm run dev` with a tunnel (such as `ngrok http 3000`), register `<tunnel>/api/payments/webhook` in the sandbox, and pay with Stripe's test card 4242 4242 4242 4242.

## Small print

`/privacy`, `/terms`, `/refunds` and `/credits`, linked from the footer on every page, live in the `(small-print)` route group. They name the operator and a contact address from `APEDIA_OPERATOR_NAME` and `APEDIA_CONTACT_EMAIL`, both public (Polar requires them). Unset, the pages show an obvious placeholder, and in production the server logs an error. The contact address does not fall back to `APEDIA_OPERATOR_EMAIL`, which is the spend alarm's private inbox; set both to the same address if you like. The price of a Course credit, what it buys and the refund window are in `src/course/course-credit.ts`. The wording is plain language, not legal advice: have it reviewed before launch.

## Success metrics

`SELECT * FROM success_metrics;` returns one row with the four success metrics, derived from the timestamps the app already writes: the share of Interviews that reach a finished Lesson 1, the share of Learners who open Lesson 2 within 7 days of finishing Lesson 1, the median Lesson time (finished minus opened) against the sitting length, and the share of cited Resources whose latest URL check found them broken. Each metric's definition is in `drizzle/0012_success_metrics.sql`. Nothing re-checks Resource URLs yet, so the broken share stays 0 until something writes `check_outcome = 'broken'`.

## Go live

Apedia runs on Vercel with Neon Postgres (ADR 0001) and sends magic links through Resend (ADR 0003). To provision it:

```sh
npm run wizard
```

The wizard walks through Neon, Anthropic, Resend, the operator's name and contact address, the spend alarm, the Auth.js secret, the site URL and Polar, checking each value against its service as you enter it. It migrates Neon, links the Vercel project, sets every variable in Vercel's Production environment, deploys, and checks that the live site offers sign-in. Values are recorded in `.env.wizard` (gitignored; Next.js never loads it, so local builds and the smoke test keep using PGlite). Re-run it to pick up where you left off or to change a value.

Production variables: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `AUTH_SECRET`, `AUTH_URL` (the site's origin, set for Production only so preview deployments build links from their own URL), `APEDIA_OPERATOR_NAME`, `APEDIA_CONTACT_EMAIL`, `APEDIA_OPERATOR_EMAIL`, `APEDIA_SPEND_ALARM_USD`, `APEDIA_SPEND_STOP_USD`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRODUCT_ID` and `POLAR_SERVER` (`production`). Every push to `master` deploys to Production, and the Production build applies pending migrations to Neon (and seeds the Example course) before `next build`, so a deploy never runs ahead of its schema. Preview and local builds skip that step. `DATABASE_URL=… npm run db:migrate` still applies them by hand.

## Layout

- `src/course/`: the `course` module, the one seam the UI calls. `example-course.json` is the Example course fixture; it doubles as test data. `interview.ts` holds the Interview, backed by a Course credit from its start to "Write my course", which uses the credit and writes the Course. `course-creation.ts` is the Course creation job that follows (ADR 0004): research search, research structure with the URL rules (`url-rules.ts`), then Up next, one step per call, tracked on a `job` row. `limits.ts` holds the per-Learner daily caps; `course-credit.ts` what a Course credit buys; `credits.ts` records Course credits from payment events, counts them and gives one back when a failed Course is given up; `spend.ts` records the Teacher's calls, raises the spend alarm and holds the day's spend to its limits.
- `src/teacher/`: the `teacher` module, which owns every Claude call and prompt, with zod-validated outputs, and reports each call's tokens and cost (`pricing.ts`). `fake.ts` is the stand-in tests use, fed with the JSON in `fixtures/`.
- `src/payments/`: the `payments` module, the only code that talks to Polar (`polar.ts`): it starts checkouts and verifies webhooks into provider-neutral payment events. `fake.ts` is the stand-in tests use.
- `src/url-fetcher/`: the network half of the Resource URL check (one GET, 5 s timeout), with a fake for tests.
- `src/auth/`: Auth.js settings, the magic-link provider and its limits, and the age gate.
- `src/db/`: Drizzle schema and database client.
- `src/app/`: Next.js routes. They stay thin: call `course`, render. The Interview is `/interview`: `?subject=` starts one and `?id=` comes back to one; sign-in and checkout return there with the subject. `POST /api/jobs/[jobId]` runs a job's next step after responding, then starts the step after it in a fresh invocation; the Path tab polls the job while a Course is prepared. The Course page tabs live in the `(tabs)` route group; the Lesson page (`lessons/[index]`) sits outside it, without the tab bar.
- `src/app/globals.css`: the notebook design tokens and shared classes.
- `e2e/`: the Playwright smoke test.
- `scripts/`: `migrate.ts` (Neon migrations) and `wizard.ts` (go live), with the wizard's checks in `wizard/`.
- `design/`: prototype HTML and the mascot.
