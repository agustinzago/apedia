# Setting up staging

A checklist for the steps only the operator can take: the Vercel, Neon, Polar, Resend and Anthropic dashboards and their secrets. The README's "Staging" section says what staging is. Do the steps in order.

Throughout, `<staging>` is the staging branch's URL on Vercel, `https://<project>-git-staging-<team>.vercel.app`. It stays the same between deploys. You'll see it under **Domains** on the staging deployment's page once it has built (step 4).

## 1. Check Vercel before the branch exists

Once this PR is merged, every build of the `staging` branch migrates whatever `DATABASE_URL` it gets.

- [ ] Vercel → Project → Settings → Environment Variables: `DATABASE_URL` and `AUTH_URL` are set for **Production** only. Neither may be set for Preview (all branches). If one is, remove it from Preview. Otherwise a `DATABASE_URL` there would let staging migrate that database, and an `AUTH_URL` there would send staging's magic links to Production.
- [ ] Settings → Environment Variables → **Automatically expose System Environment Variables** is on (the default). The build reads `VERCEL_ENV` and `VERCEL_GIT_COMMIT_REF` from it.
- [ ] Settings → Git → **Production Branch** is `master`. Staging must stay a Preview.

## 2. Collect the values

- [ ] **Neon.** In the Apedia project, go to Branches → Create branch. Name it `staging`, with the production branch as parent and **current data**. Copy its pooled connection string. This is `DATABASE_URL`.
  - The branch copies Production's rows. Before launch that is only the Example courses. Once real Learners exist, create a separate Neon project `apedia-staging` instead (empty; the first staging build migrates and seeds it). Either way, the result must never be Production's own connection string.
  - Don't use a "schema only" branch. It copies the tables but not the rows of Drizzle's migration journal, so the first build would try to create every table again and fail.
- [ ] **Anthropic.** console.anthropic.com → API keys. Create a key named `apedia-staging`. Ideally put it in its own workspace with a monthly spend limit, so staging's cost shows up on its own and has a ceiling. This is `ANTHROPIC_API_KEY`.
- [ ] **Resend.** resend.com → API Keys. Create `apedia-staging` with **Sending access** only. This is `AUTH_RESEND_KEY`. For `AUTH_EMAIL_FROM`, use the same verified-domain sender as Production (e.g. `Apedia <sign-in@your-domain>`). Or leave it unset: the default `onboarding@resend.dev` sender only delivers to your Resend account's own address, which is enough to sign in yourself.
- [ ] **Auth.js secret.** Run `openssl rand -base64 32`. This is `AUTH_SECRET`. Use a new one, never Production's.

## 3. Create the staging branch

After this PR is merged:

```sh
git fetch origin && git push origin origin/master:refs/heads/staging
```

Vercel builds it as a Preview. The first build fails at "DATABASE_URL is not set." That is expected: no variables are scoped to the branch yet, and it fails before touching anything.

## 4. Set the variables for the staging branch only

Vercel → Settings → Environment Variables → Add. For each variable, tick **Preview** only, and under **Preview branch** type `staging`. A variable scoped to the branch overrides a Preview-wide one of the same name.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Neon staging connection string (step 2) |
| `ANTHROPIC_API_KEY` | staging Anthropic key (step 2) |
| `AUTH_SECRET` | new secret (step 2) |
| `AUTH_RESEND_KEY` | staging Resend key (step 2) |
| `AUTH_EMAIL_FROM` | sender (step 2), or leave unset |
| `APEDIA_OPERATOR_NAME`, `APEDIA_CONTACT_EMAIL` | same as Production |
| `APEDIA_OPERATOR_EMAIL` | your address (staging's spend alarm goes there) |
| `APEDIA_DAILY_INTERVIEWS` | e.g. `50` (default 5) |
| `APEDIA_DAILY_LESSONS` | e.g. `200` (default 40) |
| `APEDIA_DAILY_CHAT_MESSAGES` | e.g. `1000` (default 400) |
| `APEDIA_SPEND_ALARM_USD` | e.g. `50` (default 20) |
| `APEDIA_SPEND_STOP_USD` | e.g. `100` (default twice the alarm) |
| `APEDIA_MAGIC_LINKS_PER_EMAIL_PER_HOUR` | optional, e.g. `20` (default 3), if you sign in a lot |

Leave `AUTH_URL` and `APEDIA_FAKE_TEACHER` unset. Without `AUTH_URL`, Auth.js builds magic links from the host you signed in on, so they lead back to `<staging>`. The four Polar variables come in step 6.

The spend limits are real money: the real Teacher runs on staging. The per-Course allowance (20 Lessons, 200 questions) has no override. To go past it, buy another credit with the test card.

- [ ] Deployments → the failed `staging` build → **Redeploy**. It now migrates the Neon branch and seeds the Example courses ("Migrated and seeded the Example course." in the build log). Note `<staging>` from the deployment's Domains.

## 5. Let Polar and the Teacher's job steps through Deployment Protection

Vercel Authentication protects Previews, so on `<staging>` it turns away two kinds of request that don't come from your logged-in browser: Polar's webhook, and the job-step requests the app makes to itself while writing a Course or a Lesson. Protection Bypass for Automation covers both, and it's available on every plan:

- [ ] Settings → Deployment Protection → **Protection Bypass for Automation** → create a secret (name it e.g. `staging`) and copy it. Vercel gives it to every deployment built afterwards as `VERCEL_AUTOMATION_BYPASS_SECRET`, and the app sends it with its job-step requests. You don't set anything else.
- [ ] Redeploy `staging` so the build picks the secret up.

The secret opens every deployment of the project, not only staging. Keep it out of chats and screenshots. Regenerating it breaks deployments built before, and the Polar webhook URL in step 6, until you redeploy and update that URL. Don't switch off Vercel Authentication for Previews instead: that would make every preview public.

## 6. Polar sandbox

At sandbox.polar.sh, which is separate from Polar's live dashboard, with its own organizations, products and webhooks:

- [ ] Create an organization (e.g. `Apedia staging`).
- [ ] Products → New: "Course credit", **one-time**, US$5. Copy its id. This is `POLAR_PRODUCT_ID`.
- [ ] Settings → Developers → New token, with scopes `checkouts:read` and `checkouts:write`. This is `POLAR_ACCESS_TOKEN`.
- [ ] Settings → Webhooks → Add endpoint:
  - URL: `<staging>/api/payments/webhook?x-vercel-protection-bypass=<secret from step 5>`
  - Format: **Raw**; events `order.paid` and `order.refunded`; API version 2026-04 if asked.
  - Copy its secret. This is `POLAR_WEBHOOK_SECRET`.

  Polar can't add headers to a webhook, so the bypass rides in the query string, the way Vercel documents for third-party webhooks. Polar's signature covers the body and its `webhook-*` headers, not the URL, and the app ignores the query string.
- [ ] In Vercel (Preview, branch `staging`), set `POLAR_ACCESS_TOKEN`, `POLAR_PRODUCT_ID`, `POLAR_WEBHOOK_SECRET`, and `POLAR_SERVER` = `sandbox`. Redeploy `staging`.

## 7. Walk through it

In the browser where you're logged in to Vercel (Vercel Authentication lets you in):

- [ ] Open `<staging>` → Buy a Course → sign in with your address. The email arrives through Resend, and its link starts with `<staging>`. Open it in the same browser.
- [ ] Pay with 4242 4242 4242 4242, any future expiry, any CVC. The thanks page turns into "Start a Course" within seconds. If it doesn't, look at sandbox.polar.sh → Webhooks → the delivery: a 401 means the bypass secret in the URL is wrong or stale, and a 403 means `POLAR_WEBHOOK_SECRET` is wrong.
- [ ] Interview → Write my course. The Path tab fills in. If it stalls at a step, the job-step requests are being turned away: check that step 5's secret exists and that `staging` was redeployed after it.
- [ ] Open Lesson 1, finish it, ask the chat a question.

## Afterwards

- Update staging to what's on `master`: `git fetch origin && git push origin origin/master:staging`.
- Try a PR branch on staging before merging: `git push -f origin <branch>:staging`. Its migrations stay in the staging database. If they don't land on `master` as they are, reset the database before pushing `master` back to staging: Neon → Branches → staging → Reset from parent, or recreate the separate project.
