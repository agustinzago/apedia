# Apedia

A "learn anything" web app that runs the /teach method. Vocabulary: `CONTEXT.md`. Decisions: `docs/adr/`.

## Develop

```sh
npm install
npm run dev        # http://localhost:3000
```

Without `DATABASE_URL`, the app uses a local PGlite database in `.pglite/` (Postgres in WebAssembly — no Docker), migrates it and seeds the Example course on first request. Delete `.pglite/` to start fresh.

## Check

```sh
npm run typecheck
npm run lint
npm test           # runs against in-memory PGlite
```

## Database

- Schema: `src/db/schema.ts`. After changing it, run `npm run db:generate` and commit the new file in `drizzle/`.
- Production (Neon): `DATABASE_URL=… npm run db:migrate` applies migrations and seeds the Example course.

## Layout

- `src/course/`: the `course` module, the one seam the UI calls. `example-course.json` is the Example course fixture; it doubles as test data.
- `src/db/`: Drizzle schema and database client.
- `src/app/`: Next.js routes. They stay thin: call `course`, render.
- `src/app/globals.css`: the notebook design tokens and shared classes.
- `design/`: prototype HTML and the mascot.
