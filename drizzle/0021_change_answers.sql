ALTER TABLE "interview" ADD COLUMN "before_last_answer" jsonb;--> statement-breakpoint
ALTER TABLE "interview" ADD COLUMN "answers_changed" integer DEFAULT 0 NOT NULL;