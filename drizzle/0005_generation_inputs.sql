CREATE TYPE "public"."generation_level" AS ENUM('rare', 'medium', 'well_done');--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "profile_check_id" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "tier" integer;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "level" "generation_level";--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "extra_facts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "trial_generation_id" text;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_profile_check_id_profile_checks_id_fk" FOREIGN KEY ("profile_check_id") REFERENCES "public"."profile_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_tier" CHECK ("generations"."tier" IS NULL OR "generations"."tier" BETWEEN 1 AND 3);