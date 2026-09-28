CREATE TYPE "public"."proposal_kind" AS ENUM('mission_change', 'done');--> statement-breakpoint
CREATE TYPE "public"."proposal_source" AS ENUM('finish', 'chat');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('open', 'confirmed', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TABLE "proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"kind" "proposal_kind" NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"source" "proposal_source" NOT NULL,
	"lesson_id" text,
	"reason" text NOT NULL,
	"mission" jsonb,
	"evidence" jsonb,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal" ADD CONSTRAINT "proposal_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposal_course_idx" ON "proposal" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_course_kind_open_uq" ON "proposal" USING btree ("course_id","kind") WHERE "proposal"."status" = 'open';