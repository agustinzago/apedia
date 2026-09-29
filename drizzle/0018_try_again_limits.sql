ALTER TABLE "course_credit" ADD COLUMN "given_back" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;