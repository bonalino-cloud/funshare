ALTER TYPE "public"."error_code" ADD VALUE 'invalid_request' BEFORE 'internal';--> statement-breakpoint
ALTER TYPE "public"."error_code" ADD VALUE 'tier_unavailable' BEFORE 'internal';