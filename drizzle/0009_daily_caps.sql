CREATE TABLE "spend_alarm" (
	"day" date PRIMARY KEY NOT NULL,
	"spent_usd" double precision NOT NULL,
	"threshold_usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_call" (
	"id" text PRIMARY KEY NOT NULL,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"web_searches" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "teacher_call_created_at_idx" ON "teacher_call" USING btree ("created_at");