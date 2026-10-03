CREATE TYPE "public"."profile_check_status" AS ENUM('checking', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "profile_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"ig_username" text NOT NULL,
	"status" "profile_check_status" DEFAULT 'checking' NOT NULL,
	"error_code" "error_code",
	"hint" text,
	"snapshot_id" text,
	"profile" jsonb,
	"owner_token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile_checks" ADD CONSTRAINT "profile_checks_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_checks_ig_username_checked_at_idx" ON "profile_checks" USING btree ("ig_username","checked_at");