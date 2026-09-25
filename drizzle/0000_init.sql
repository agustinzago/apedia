CREATE TYPE "public"."course_status" AS ENUM('active', 'done');--> statement-breakpoint
CREATE TYPE "public"."learning_record_kind" AS ENUM('understanding', 'prior_knowledge', 'misconception', 'mission_change');--> statement-breakpoint
CREATE TABLE "course" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text,
	"is_example" boolean DEFAULT false NOT NULL,
	"subject" text NOT NULL,
	"title" text NOT NULL,
	"language" text NOT NULL,
	"mission_why" text NOT NULL,
	"mission_success" jsonb NOT NULL,
	"mission_constraints" jsonb NOT NULL,
	"mission_out_of_scope" jsonb NOT NULL,
	"sitting_minutes" integer NOT NULL,
	"status" "course_status" DEFAULT 'active' NOT NULL,
	"community_opt_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learner" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "learning_record" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"number" integer NOT NULL,
	"kind" "learning_record_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"lesson_id" text,
	"superseded_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson" (
	"id" text PRIMARY KEY NOT NULL,
	"course_id" text NOT NULL,
	"index" integer NOT NULL,
	"title" text NOT NULL,
	"goal" text NOT NULL,
	"content" jsonb,
	"opened_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"question_index" integer NOT NULL,
	"chosen_option" integer NOT NULL,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course" ADD CONSTRAINT "course_learner_id_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_record" ADD CONSTRAINT "learning_record_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_record" ADD CONSTRAINT "learning_record_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_record" ADD CONSTRAINT "learning_record_superseded_by_id_learning_record_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."learning_record"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson" ADD CONSTRAINT "lesson_course_id_course_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."course"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_lesson_id_lesson_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lesson"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_learner_idx" ON "course" USING btree ("learner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "learning_record_course_number_uq" ON "learning_record" USING btree ("course_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "lesson_course_index_uq" ON "lesson" USING btree ("course_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "quiz_attempt_lesson_question_uq" ON "quiz_attempt" USING btree ("lesson_id","question_index");