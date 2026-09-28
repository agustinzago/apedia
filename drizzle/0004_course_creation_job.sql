CREATE TYPE "public"."job_kind" AS ENUM('course_creation');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'running', 'failed', 'done');--> statement-breakpoint
CREATE TYPE "public"."resource_check_outcome" AS ENUM('ok', 'blocked');--> statement-breakpoint
CREATE TABLE "community" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"name" text NOT NULL,
	"where" text NOT NULL,
	"url" text,
	"why" text NOT NULL,
	"offline" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gap" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"kind" "job_kind" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"step" text NOT NULL,
	"progress" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_output" jsonb,
	"error" text,
	"run_id" text,
	"started_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lesson" ADD COLUMN "minutes" integer;--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "check_outcome" "resource_check_outcome";--> statement-breakpoint
ALTER TABLE "resource" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community" ADD CONSTRAINT "community_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gap" ADD CONSTRAINT "gap_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_course_idx" ON "community" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "gap_course_idx" ON "gap" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "job_course_idx" ON "job" USING btree ("course_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_course_creation_uq" ON "job" USING btree ("course_id") WHERE "job"."kind" = 'course_creation';