-- Migration 091: subcontractor support + structured certification vault
--
-- Retention build: turn the crew model into a full team/resource system of
-- record (employees + subcontractors) and give certs a real "home" with expiry
-- tracking (so we can warn before a license lapses — compliance + loss-aversion).
--
-- 1) crew_members gains a member_type ('employee' | 'subcontractor') plus
--    subcontractor-only fields (company, trade). Existing rows default to
--    'employee'. The legacy certifications TEXT[] column is left untouched
--    (quick free-text tags); the new table below is the structured vault.
-- 2) member_certifications: one row per credential, with issuer + issued/expiry
--    dates + an optional uploaded file URL, scoped to the owning user.
--
-- Idempotent, no DO blocks (Admin -> System Tools migration runner).

ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS member_type TEXT NOT NULL DEFAULT 'employee';
ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS company     TEXT;
ALTER TABLE crew_members ADD COLUMN IF NOT EXISTS trade       TEXT;

CREATE TABLE IF NOT EXISTS member_certifications (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID        NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,
  name        TEXT        NOT NULL,
  issuer      TEXT,
  issued_on   DATE,
  expires_on  DATE,
  file_url    TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- All certs for a member
CREATE INDEX IF NOT EXISTS idx_member_certs_member ON member_certifications (member_id);
-- Cross-member expiry scan for the owning user (powers "expiring soon" alerts)
CREATE INDEX IF NOT EXISTS idx_member_certs_user_expiry ON member_certifications (user_id, expires_on);

COMMENT ON COLUMN crew_members.member_type IS 'employee | subcontractor';
COMMENT ON COLUMN crew_members.trade IS 'Subcontractor trade, e.g. electrical, roofing, structural';
COMMENT ON TABLE member_certifications IS
  'Structured certification vault — one row per credential with issuer + issued/expiry dates + optional file.';
