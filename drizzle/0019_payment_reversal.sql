CREATE TABLE "payment_reversal" (
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_reversal_provider_provider_payment_id_pk" PRIMARY KEY("provider","provider_payment_id")
);
