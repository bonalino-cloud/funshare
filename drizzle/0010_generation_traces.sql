CREATE TABLE "generation_traces" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"step" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_traces" ADD CONSTRAINT "generation_traces_generation_id_generations_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_traces_generation_step_idx" ON "generation_traces" USING btree ("generation_id","step");--> statement-breakpoint
CREATE INDEX "generation_traces_created_idx" ON "generation_traces" USING btree ("created_at");