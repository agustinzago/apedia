CREATE TABLE "glossary_term" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"lesson_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reference_section" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "glossary_term" ADD CONSTRAINT "glossary_term_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glossary_term" ADD CONSTRAINT "glossary_term_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reference_section" ADD CONSTRAINT "reference_section_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_term_course_term_uq" ON "glossary_term" USING btree ("course_id","term");--> statement-breakpoint
CREATE UNIQUE INDEX "reference_section_course_position_uq" ON "reference_section" USING btree ("course_id","position");