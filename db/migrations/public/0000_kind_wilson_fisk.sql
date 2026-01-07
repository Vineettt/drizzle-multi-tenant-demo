CREATE TABLE "schema_tracker" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "schema_tracker_name_unique" UNIQUE("name")
);
