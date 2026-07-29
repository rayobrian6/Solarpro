-- 116_engineering_review_records.sql
-- AAC WS-8 / WS-9 — DIGEST-BOUND ENGINEERING-REVIEW RECORDS.
--
-- WHY THIS EXISTS (docs/AAC-SOURCE-PATH-AUDIT.md §2.19 / Path 17):
-- ENGINEERING-REVIEW-PENDING is pushed with NO `if` at all
-- (build.ts:1261-1263), matching `certification.engineeringReviewApproved:
-- false` hardcoded at build.ts:1610. A grep of app/api for
-- `engineeringReviewApproved` / `reviewedDigest` returns zero: there is no
-- table, no API and no UI. The requirement is therefore STRUCTURALLY
-- UNCLEARABLE — and an unclearable requirement is not honesty, it is a missing
-- feature. This migration is that feature.
--
-- WHAT MAKES A REVIEW REAL, and every one of these is enforced by the store +
-- API that read this table, never by the renderer:
--   1. it is bound to an EXACT snapshot digest. Approving "the project" means
--      nothing; approving PDS-xxxxxxxx means the reviewer saw those bytes.
--      Any digest change invalidates coverage — that is the point, and
--      snapshot_digest_invalidations (migration 114) already models it.
--   2. the reviewer holds a LICENSED role (engineer_of_record or
--      approving_engineer, the migration-115 vocabulary) and a licence number +
--      state are recorded. A designer or an internal reviewer can never approve.
--   3. the decision is explicit and the record is APPEND-ONLY: a withdrawal or
--      a re-review supersedes, it never mutates or deletes. `superseded_at` /
--      `superseded_by` follow the migration-114 ledger shape exactly.
--
-- WHAT THIS SCHEMA MAY NEVER BE USED FOR: the engine does not write approvals.
-- The AUTO_DERIVED resolver only READS this table (fail-soft), and the
-- requirement stays PROFESSIONAL_APPROVAL in the resolution-mode matrix. There
-- is no seeded row, no default reviewer, and no path from configuration to an
-- approval.
--
-- Idempotent plain DDL (CREATE TABLE / CREATE INDEX IF NOT EXISTS only). No DO
-- blocks, no ALTER, no data migration — per the System Tools migration runner.

CREATE TABLE IF NOT EXISTS engineering_review_records (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,

  -- ── THE BINDING ──────────────────────────────────────────────────────────
  -- The snapshot the reviewer actually looked at. `snapshot_digest` is the
  -- SHA-256 from lib/permit/snapshot/digest.computeSnapshotDigest;
  -- `snapshot_id` is its PDS-xxxxxxxxxxxx presentation form. Coverage requires
  -- an EXACT digest match — a different digest is a different set.
  snapshot_digest       TEXT NOT NULL,
  snapshot_id           TEXT,
  -- The engine version that produced the reviewed snapshot, so a reader can see
  -- whether an engine change (not just a design change) moved the digest.
  planset_engine_version TEXT,

  -- ── THE LICENSED REVIEWER ────────────────────────────────────────────────
  -- role must be one of the LICENSED migration-115 roles:
  --   engineer_of_record | approving_engineer
  -- The store REFUSES any other value; no unlicensed role may approve.
  reviewer_role         TEXT NOT NULL,
  reviewer_user_id      TEXT,
  reviewer_name         TEXT NOT NULL,
  reviewer_license      TEXT NOT NULL,
  reviewer_license_state TEXT NOT NULL,
  reviewer_license_expires_on DATE,

  -- ── THE DECISION ─────────────────────────────────────────────────────────
  -- approved | rejected | withdrawn
  decision              TEXT NOT NULL,
  decided_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The scope the reviewer accepted responsibility for, in their own words.
  -- Required for an approval so "approved" is never a bare boolean.
  scope_statement       TEXT,
  notes                 TEXT,
  -- Optional pointer to a signed/sealed artifact held elsewhere. Its ABSENCE
  -- never blocks the record and its PRESENCE never substitutes for the seal.
  evidence_ref          TEXT,

  -- ── APPEND-ONLY SUPERSESSION (migration-114 ledger shape) ───────────────
  superseded_at         TIMESTAMPTZ,
  superseded_by         TEXT,

  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The resolver hot path: the ACTIVE approval covering one project + digest.
CREATE INDEX IF NOT EXISTS idx_eng_review_digest
  ON engineering_review_records (project_id, snapshot_digest, decision, superseded_at);
CREATE INDEX IF NOT EXISTS idx_eng_review_project
  ON engineering_review_records (project_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_eng_review_reviewer
  ON engineering_review_records (reviewer_user_id, decided_at DESC);
-- At most ONE active approval per project+digest, so "is this set approved" can
-- never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_eng_review_active_approval
  ON engineering_review_records (project_id, snapshot_digest)
  WHERE decision = 'approved' AND superseded_at IS NULL;
