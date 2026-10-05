CREATE TABLE "punch_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"punch_id" text NOT NULL,
	"position" integer NOT NULL,
	"emoji" text NOT NULL,
	"text" text NOT NULL,
	"from_trial" boolean DEFAULT false NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"trace" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "punch_candidates_text_len" CHECK (char_length("punch_candidates"."text") BETWEEN 1 AND 140)
);
--> statement-breakpoint
ALTER TABLE "punch_candidates" ADD CONSTRAINT "punch_candidates_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "punch_candidates_generation_punch_idx" ON "punch_candidates" USING btree ("generation_id","punch_id");