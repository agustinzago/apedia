ALTER TYPE "public"."job_kind" ADD VALUE 'finish';--> statement-breakpoint
DROP INDEX "job_lesson_uq";--> statement-breakpoint
DROP INDEX "glossary_term_course_term_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "job_lesson_kind_uq" ON "job" USING btree ("lesson_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "glossary_term_course_term_uq" ON "glossary_term" USING btree ("course_id",lower("term"));