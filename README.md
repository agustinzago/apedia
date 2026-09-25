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
- Production (Neon): `DATABASE_URL=… npm run db:migrate` applies migrations and seeds the Example course.

## Sign-in

Magic-link sign-in with Auth.js and Resend (ADR 0003). Learners and sessions live in Postgres through the Drizzle adapter. In production set:

- `AUTH_SECRET`: `npx auth secret` generates one.
- `AUTH_RESEND_KEY`: a Resend API key.
- `AUTH_EMAIL_FROM`: the sender on a domain verified in Resend, e.g. `Apedia <sign-in@example.com>`.

Outside production the link is always printed to the console and never emailed.

## Teacher

Every Claude call lives in `src/teacher/` (an ESLint rule keeps the SDK out of every other module). In production set `ANTHROPIC_API_KEY`; it is only read on the server. `APEDIA_FAKE_TEACHER=1` forces the stand-in Teacher, as the e2e smoke test does.

## Layout

- `src/course/`: the `course` module, the one seam the UI calls. `example-course.json` is the Example course fixture; it doubles as test data. `interview.ts` holds the Interview: anonymous until "Write my course", when the Learner claims it and the Course is written.
- `src/teacher/`: the `teacher` module, which owns every Claude call and prompt, with zod-validated outputs. `fake.ts` is the stand-in tests use, fed with the JSON in `fixtures/`.
- `src/auth/`: Auth.js settings, the magic-link provider and the age gate.
- `src/db/`: Drizzle schema and database client.
- `src/app/`: Next.js routes. They stay thin: call `course`, render. The Interview is `/interview`; the browser keeps its id in a cookie so the answers survive sign-in. The Course page tabs live in the `(tabs)` route group; the Lesson page (`lessons/[index]`) sits outside it, without the tab bar.
- `src/app/globals.css`: the notebook design tokens and shared classes.
- `e2e/`: the Playwright smoke test.
- `design/`: prototype HTML and the mascot.
