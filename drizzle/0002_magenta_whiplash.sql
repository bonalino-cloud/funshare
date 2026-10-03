CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"snapshot_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "personas_snapshot_id_prompt_version_idx" ON "personas" USING btree ("snapshot_id","prompt_version");