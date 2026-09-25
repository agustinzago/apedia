CREATE TYPE "public"."interview_stage" AS ENUM('why', 'know', 'success', 'sitting', 'complete', 'redirected');--> statement-breakpoint
CREATE TABLE "interview" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text,
	"subject" text NOT NULL,
	"language" text NOT NULL,
	"stage" "interview_stage" NOT NULL,
	"why" text,
	"know" text,
	"success" text,
	"sitting_minutes" integer,
	"follow_up_asked" boolean DEFAULT false NOT NULL,
	"awaiting_follow_up" boolean DEFAULT false NOT NULL,
	"messages" jsonb NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "interview_id" text;--> statement-breakpoint
ALTER TABLE "interview" ADD CONSTRAINT "interview_learner_id_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_learner_idx" ON "interview" USING btree ("learner_id");--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_interview_id_interview_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interview"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_interview_id_unique" UNIQUE("interview_id");