# Drizzle instead of Prisma

The PRD suggested Prisma; we use Drizzle ORM with the Neon serverless driver. Drizzle has no generate step or query-engine binary, stays close to SQL, and is lighter in Vercel functions. Auth.js has a Drizzle adapter, so ADR 0003 is unaffected.
