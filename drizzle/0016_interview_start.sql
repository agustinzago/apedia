CREATE TABLE "interview_start" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "interview_start" ADD CONSTRAINT "interview_start_learner_id_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "interview_start_learner_idx" ON "interview_start" USING btree ("learner_id","created_at");