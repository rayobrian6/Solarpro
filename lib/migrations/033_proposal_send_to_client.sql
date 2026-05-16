-- Migration 033: Proposal send-to-client columns
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_to_email TEXT DEFAULT NULL;
