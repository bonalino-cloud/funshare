ALTER TYPE "public"."artifact_kind" ADD VALUE 'roast_v1';--> statement-breakpoint
ALTER TYPE "public"."error_code" ADD VALUE 'free_used' BEFORE 'internal';--> statement-breakpoint
ALTER TYPE "public"."error_code" ADD VALUE 'promo_invalid' BEFORE 'internal';--> statement-breakpoint
ALTER TYPE "public"."error_code" ADD VALUE 'payment_required' BEFORE 'internal';--> statement-breakpoint
CREATE TABLE "profile_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"ig_username" text NOT NULL,
	"data" jsonb NOT NULL,
	"raw_blob_key" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DEFAULT 'queued'::text;--> statement-breakpoint
DROP TYPE "public"."generation_status";--> statement-breakpoint
CREATE TYPE "public"."generation_status" AS ENUM('queued', 'writing', 'awaiting_selection', 'drawing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DEFAULT 'queued'::"public"."generation_status";--> statement-breakpoint
ALTER TABLE "generations" ALTER COLUMN "status" SET DATA TYPE "public"."generation_status" USING "status"::"public"."generation_status";--> statement-breakpoint
CREATE INDEX "profile_snapshots_ig_username_fetched_at_idx" ON "profile_snapshots" USING btree ("ig_username","fetched_at");