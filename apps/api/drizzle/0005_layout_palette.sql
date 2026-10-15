CREATE TYPE "public"."layout" AS ENUM('calm', 'cards', 'soft', 'journal', 'bento', 'split', 'playful', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."palette" AS ENUM('emerald', 'rose', 'ocean', 'sand', 'graphite');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "layout" "layout" DEFAULT 'calm' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "palette" "palette" DEFAULT 'emerald' NOT NULL;