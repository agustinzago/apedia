CREATE TYPE "public"."resource_kind" AS ENUM('book', 'docs', 'course', 'article', 'site');--> statement-breakpoint
CREATE TABLE "resource" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"ref" text NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"title" text NOT NULL,
	"author" text NOT NULL,
	"url" text NOT NULL,
	"why" text NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resource" ADD CONSTRAINT "resource_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "resource_course_ref_uq" ON "resource" USING btree ("course_id","ref");