CREATE TABLE "magic_link_request" (
	"id" text PRIMARY KEY NOT NULL,
	"email_hash" text NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "magic_link_request_email_idx" ON "magic_link_request" USING btree ("email_hash","created_at");--> statement-breakpoint
CREATE INDEX "magic_link_request_ip_idx" ON "magic_link_request" USING btree ("ip","created_at");