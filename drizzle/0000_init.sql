CREATE TYPE "public"."artifact_kind" AS ENUM('dossier_2027');--> statement-breakpoint
CREATE TYPE "public"."error_code" AS ENUM('invalid_url', 'profile_not_found', 'profile_private', 'not_enough_data', 'minor_detected', 'rate_limited', 'internal');--> statement-breakpoint
CREATE TYPE "public"."generation_mode" AS ENUM('self', 'friend');--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'scraping', 'analyzing', 'writing', 'drawing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"generation_id" text NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"content" jsonb NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"owner_token_hash" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"shares" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "artifacts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "artifacts_generation_id_unique" UNIQUE("generation_id")
);
--> statement-breakpoint
CREATE TABLE "generations" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "generation_status" DEFAULT 'queued' NOT NULL,
	"error_code" "error_code",
	"ig_username" text NOT NULL,
	"mode" "generation_mode" NOT NULL,
	"kind" "artifact_kind" NOT NULL,
	"owner_token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"step_timings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"artifact_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generations_ip_hash_created_at_idx" ON "generations" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "generations_ig_username_idx" ON "generations" USING btree ("ig_username");