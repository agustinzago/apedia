# Auth.js magic-link sign-in, sent through Resend

Learners sign in with an email magic link using Auth.js (NextAuth v5), with emails sent through Resend and sessions stored in our Neon Postgres. We picked this over Clerk (hosted, per-user pricing, vendor lock-in) and Better Auth (newer) to keep user data in our own database and reuse the team's existing Resend experience. The Interview runs anonymously; sign-in (with a self-declared 13+ age gate) is required before any paid generation starts.
