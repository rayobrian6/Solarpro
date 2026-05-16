-- Migration 028: Tour completion tracking
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_seen_tour BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tour_completed_at TIMESTAMPTZ DEFAULT NULL;
