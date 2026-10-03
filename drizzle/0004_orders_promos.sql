CREATE TYPE "public"."order_reason" AS ENUM('first_free', 'promo_free');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'free', 'paid', 'refunded', 'voided');--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"tier" integer NOT NULL,
	"list_amount" integer NOT NULL,
	"discount_amount" integer NOT NULL,
	"final_amount" integer NOT NULL,
	"promo_id" text,
	"status" "order_status" NOT NULL,
	"reason" "order_reason",
	"provider" text,
	"owner_token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_tier" CHECK ("orders"."tier" BETWEEN 1 AND 3),
	CONSTRAINT "orders_amounts" CHECK ("orders"."list_amount" >= 0 AND "orders"."discount_amount" >= 0 AND "orders"."discount_amount" <= "orders"."list_amount" AND "orders"."final_amount" = "orders"."list_amount" - "orders"."discount_amount")
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"percent_off" integer NOT NULL,
	"tiers" integer[] NOT NULL,
	"max_redemptions" integer NOT NULL,
	"redeemed" integer DEFAULT 0 NOT NULL,
	"per_device_limit" integer,
	"per_ip_limit" integer,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_not_empty" CHECK (length("promo_codes"."code") > 0),
	CONSTRAINT "promo_codes_percent_off" CHECK ("promo_codes"."percent_off" BETWEEN 1 AND 100),
	CONSTRAINT "promo_codes_max_redemptions" CHECK ("promo_codes"."max_redemptions" > 0),
	CONSTRAINT "promo_codes_redeemed" CHECK ("promo_codes"."redeemed" >= 0),
	CONSTRAINT "promo_codes_limits" CHECK (("promo_codes"."per_device_limit" IS NULL OR "promo_codes"."per_device_limit" > 0) AND ("promo_codes"."per_ip_limit" IS NULL OR "promo_codes"."per_ip_limit" > 0)),
	CONSTRAINT "promo_codes_tiers" CHECK (cardinality("promo_codes"."tiers") > 0 AND "promo_codes"."tiers" <@ ARRAY[1, 2, 3])
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"promo_id" text NOT NULL,
	"order_id" text NOT NULL,
	"owner_token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "promo_redemptions_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_generation_id_idx" ON "orders" USING btree ("generation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_first_free_owner_idx" ON "orders" USING btree ("owner_token_hash") WHERE "orders"."reason" = 'first_free' AND "orders"."status" <> 'voided';--> statement-breakpoint
CREATE INDEX "orders_first_free_ip_idx" ON "orders" USING btree ("ip_hash") WHERE "orders"."reason" = 'first_free' AND "orders"."status" <> 'voided';--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_idx" ON "promo_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promo_redemptions_promo_owner_idx" ON "promo_redemptions" USING btree ("promo_id","owner_token_hash");--> statement-breakpoint
CREATE INDEX "promo_redemptions_promo_ip_idx" ON "promo_redemptions" USING btree ("promo_id","ip_hash");