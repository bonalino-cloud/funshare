CREATE TABLE "dossier_runs" (
	"snapshot_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"status" text NOT NULL,
	"error_code" "error_code",
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dossier_runs_snapshot_id_prompt_version_pk" PRIMARY KEY("snapshot_id","prompt_version"),
	CONSTRAINT "dossier_runs_status" CHECK ("dossier_runs"."status" IN ('running', 'refused'))
);
--> statement-breakpoint
ALTER TABLE "dossier_runs" ADD CONSTRAINT "dossier_runs_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE cascade ON UPDATE no action;