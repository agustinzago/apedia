CREATE TYPE "public"."course_credit_status" AS ENUM('available', 'used', 'refunded');--> statement-breakpoint
CREATE TABLE "course_credit" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"status" "course_credit_status" DEFAULT 'available' NOT NULL,
	"refunded_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "course_credit" ADD CONSTRAINT "course_credit_learner_id_learner_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "course_credit_learner_idx" ON "course_credit" USING btree ("learner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_credit_payment_uq" ON "course_credit" USING btree ("provider","provider_payment_id");