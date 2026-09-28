ALTER TYPE "public"."job_kind" ADD VALUE 'lesson_generation';--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "lesson_id" text;--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_lesson_uq" ON "job" USING btree ("lesson_id");