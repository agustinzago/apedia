# Apedia

A "learn anything" web app that runs the /teach method. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`.

## Develop

```sh
npm install
npm run dev        # http://localhost:3000
```

Without `DATABASE_URL`, the app uses a local PGlite database in `.pglite/` (Postgres in WebAssembly — no Docker), migrates it and seeds the Example course on first request. Delete `.pglite/` to start fresh.

Sign-in needs no setup locally: the magic link is printed to the `npm run dev` console instead of being emailed. Open it in the same browser to sign in.

## Check

```sh
npm run typecheck
npm run lint
npm test           # runs against in-memory PGlite
```

## Database

- Schema: `src/db/schema.ts`. After changing it, run `npm run db:generate` and commit the new file in `drizzle/`.
- Production (Neon): `DATABASE_URL=… npm run db:migrate` applies migrations and seeds the Example course.

## Sign-in

Magic-link sign-in with Auth.js and Resend (ADR 0003). Learners and sessions live in Postgres through the Drizzle adapter. In production set:

- `AUTH_SECRET`: `npx auth secret` generates one.
- `AUTH_RESEND_KEY`: a Resend API key.
- `AUTH_EMAIL_FROM`: the sender on a domain verified in Resend, e.g. `Apedia <sign-in@example.com>`.

Outside production the link is always printed to the console and never emailed.

## Layout

- `src/course/`: the `course` module, the one seam the UI calls. `example-course.json` is the Example course fixture; it doubles as test data.
- `src/auth/`: Auth.js settings, the magic-link provider and the age gate.
- `src/db/`: Drizzle schema and database client.
- `src/app/`: Next.js routes. They stay thin: call `course`, render.
- `src/app/globals.css`: the notebook design tokens and shared classes.
- `design/`: prototype HTML and the mascot.
