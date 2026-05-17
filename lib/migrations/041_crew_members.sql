-- Migration 041: crew_members table
--
-- Adds individual crew member records to the crews system.
-- Previously, crews only stored a team name + color (e.g. "Team Alpha").
-- This migration allows individual people within a crew to be recorded
-- with their name, role, contact info, certifications, and lead status.
--
-- Relationship:
--   crew_members.crew_id → crews.id (ON DELETE CASCADE)
--   crew_members.user_id = same user_id as the parent crew (ownership)
--
-- Roles (soft enum — free text allowed, known values in lib/crews.ts):
--   lead_installer, installer, apprentice, electrician,
--   project_manager, inspector, laborer, other
--
-- certifications is a TEXT[] array — stores values like:
--   'NABCEP PV Installation Professional', 'OSHA 10', 'OSHA 30', etc.

CREATE TABLE IF NOT EXISTS crew_members (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_id          UUID        NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL,
  name             TEXT        NOT NULL,
  role             TEXT        NOT NULL DEFAULT 'installer',
  phone            TEXT,
  email            TEXT,
  certifications   TEXT[],
  is_lead          BOOLEAN     NOT NULL DEFAULT FALSE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup of all members for a given crew
CREATE INDEX IF NOT EXISTS idx_crew_members_crew
  ON crew_members (crew_id);

-- Fast lookup of all members owned by a user (cross-crew queries)
CREATE INDEX IF NOT EXISTS idx_crew_members_user
  ON crew_members (user_id);

COMMENT ON TABLE crew_members IS
  'Individual members of a crew — name, role, phone, email, certifications, lead flag.';
