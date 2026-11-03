ALTER TABLE "auth_session" ADD COLUMN "surface" text DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_session" ADD COLUMN "second_factor_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_surface_check" CHECK ("auth_session"."surface" in ('app','vendor'));