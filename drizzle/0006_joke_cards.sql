CREATE TYPE "public"."joke_heat" AS ENUM('mild', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."joke_mechanism" AS ENUM('hyperbole', 'reversal', 'faux_compliment', 'false_expectation', 'list_escalation', 'role_swap', 'meta', 'understatement', 'template');--> statement-breakpoint
CREATE TYPE "public"."joke_slot" AS ENUM('habit', 'object', 'place', 'number', 'time');--> statement-breakpoint
CREATE TYPE "public"."joke_topic" AS ENUM('behavior', 'content', 'lifestyle', 'body', 'health', 'family', 'sex', 'meta');--> statement-breakpoint
CREATE TABLE "joke_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"section" integer NOT NULL,
	"text" text NOT NULL,
	"text_hash" text NOT NULL,
	"mechanism" "joke_mechanism" NOT NULL,
	"skeleton" text NOT NULL,
	"slots" "joke_slot"[] DEFAULT '{}'::joke_slot[] NOT NULL,
	"heat" "joke_heat" NOT NULL,
	"topic" "joke_topic" NOT NULL,
	"redline" boolean NOT NULL,
	"well_done_only" boolean NOT NULL,
	"nsfw" boolean NOT NULL,
	"transferable" boolean NOT NULL,
	"approved" boolean DEFAULT false NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"label_version" text NOT NULL,
	"label_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "joke_cards_redline_topic" CHECK ("joke_cards"."topic" NOT IN ('health', 'family') OR "joke_cards"."redline"),
	CONSTRAINT "joke_cards_well_done_only_topic" CHECK ("joke_cards"."topic" NOT IN ('body', 'sex') OR "joke_cards"."well_done_only")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "joke_cards_source_idx" ON "joke_cards" USING btree ("source");--> statement-breakpoint
CREATE INDEX "joke_cards_text_hash_idx" ON "joke_cards" USING btree ("text_hash");