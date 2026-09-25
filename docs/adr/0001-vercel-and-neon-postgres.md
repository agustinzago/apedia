# Host on Vercel with Neon Postgres

Apedia runs as a Next.js app on Vercel with a managed Neon Postgres database. We picked it for speed of shipping over AWS (the team's home turf). SQLite was ruled out because Vercel's filesystem is ephemeral. The known constraint is function duration: generation steps (especially research with web search) must fit within Vercel's function time limit (300s on Fluid compute) or be split into steps.
