CREATE TABLE "dummy_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"value" text,
	"description" text,
	"created_at" timestamp DEFAULT now()
);
