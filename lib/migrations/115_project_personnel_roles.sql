-- 115_project_personnel_roles.sql
-- AAC WS-6 — Personnel roles of record (designer / preparer / reviewer /
-- engineer of record / approving engineer).
--
-- WHY THIS EXISTS (docs/AAC-SOURCE-PATH-AUDIT.md §2.18 / Path 16): the planset
-- asks the operator for the designer on every single project, and there is
-- NOWHERE to store the answer. A repo-wide scan of every migration for
-- designer / prepared_by / engineer_of_record / eor_ returns zero matches;
-- app/engineering/page.tsx keeps `designer` as a transient client form field.
-- Asking per project for a fact the platform should already know is exactly the
-- violation the automation mandate names ("never ask the user for information
-- the platform knows").
--
-- THE ROLE SEPARATION IS THE POINT. One ambiguous "designer / engineer of
-- record" field is what lets a configured drafter be presented as a licensed
-- engineer. These are five DISTINCT roles with distinct authority:
--   designer            — authored the design (no licence implied)
--   preparer            — assembled the submittal package
--   reviewer            — internal (non-licensed) review
--   engineer_of_record  — the licensed engineer of record        (licence REQUIRED)
--   approving_engineer  — signs / seals / releases the set       (licence REQUIRED)
-- A configured DESIGNER clears the designer requirement ONLY. Nothing in this
-- schema, and nothing that reads it, may fabricate an EOR, a licence, a
-- signature, a seal or a digest-bound approval: those come from the
-- professional-release path, not from configuration.
--
-- TWO TABLES:
--   personnel_roles                — the configured roster (org- or user-scoped),
--                                    with at most one default per scope+role.
--   project_personnel_assignments  — per-project overrides, append-only with a
--                                    supersession pointer (the same
--                                    superseded_at/superseded_by shape migration
--                                    114 uses for the invalidation ledger).
--
-- Idempotent plain DDL (CREATE TABLE / CREATE INDEX IF NOT EXISTS only). No DO
-- blocks, no ALTER, no data migration, no seeded rows, no default vendor name —
-- per the System Tools migration runner and the standing rule that the vendor
-- name is never a designer default (route.ts:1181-1198, a teardown P1 fix).

CREATE TABLE IF NOT EXISTS personnel_roles (
  id                    TEXT PRIMARY KEY,

  -- Scope: an org roster when org_id is set, otherwise the owning user's own
  -- roster. Exactly one of the two is expected; the resolver prefers org.
  org_id                TEXT,
  user_id               TEXT,

  -- role: designer | preparer | reviewer | engineer_of_record | approving_engineer
  role                  TEXT NOT NULL,

  person_name           TEXT NOT NULL,
  person_title          TEXT,
  email                 TEXT,
  phone                 TEXT,

  -- Licence identity. Meaningful ONLY for engineer_of_record /
  -- approving_engineer. A designer row carrying a licence number does NOT make
  -- that person an engineer of record — the ROLE is the authority, never the
  -- presence of a licence string.
  license_number        TEXT,
  license_state         TEXT,
  license_expires_on    DATE,

  -- The row the resolver picks for this scope+role when no project override
  -- exists. Enforced to at most one per (scope, role) by a partial unique index
  -- below, so "the configured designer" is never ambiguous.
  is_default            BOOLEAN NOT NULL DEFAULT false,
  active                BOOLEAN NOT NULL DEFAULT true,

  notes                 TEXT,
  created_by            TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personnel_roles_org   ON personnel_roles (org_id, role, active);
CREATE INDEX IF NOT EXISTS idx_personnel_roles_user  ON personnel_roles (user_id, role, active);
-- The resolver hot path: one default per scope+role.
CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_default_org
  ON personnel_roles (org_id, role) WHERE is_default AND active AND org_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_default_user
  ON personnel_roles (user_id, role) WHERE is_default AND active AND org_id IS NULL AND user_id IS NOT NULL;

-- ── Per-project overrides (append-only, audited, supersession-tracked) ──
-- A project-specific authorized override SUPERSEDES the configured default
-- (WS-6). The prior assignment is never mutated or removed: it is marked
-- superseded, exactly like snapshot_digest_invalidations rows, so the history of
-- who was named on which revision survives.
CREATE TABLE IF NOT EXISTS project_personnel_assignments (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,

  -- Same five-value vocabulary as personnel_roles.role.
  role                  TEXT NOT NULL,

  -- The roster row this assignment points at, when it came from the roster.
  personnel_id          TEXT,
  -- The name as of assignment time (denormalised so the audit trail survives a
  -- later roster edit).
  person_name           TEXT NOT NULL,
  person_title          TEXT,
  license_number        TEXT,
  license_state         TEXT,

  -- WHO assigned it and WHY (no silent per-project override).
  assigned_by           TEXT NOT NULL,
  reason                TEXT,
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  superseded_at         TIMESTAMPTZ,
  superseded_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_personnel_project ON project_personnel_assignments (project_id, role);
CREATE INDEX IF NOT EXISTS idx_project_personnel_active  ON project_personnel_assignments (project_id, role, superseded_at);
CREATE INDEX IF NOT EXISTS idx_project_personnel_roster  ON project_personnel_assignments (personnel_id);
