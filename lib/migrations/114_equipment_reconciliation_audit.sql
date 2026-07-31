-- 114_equipment_reconciliation_audit.sql
-- W4 §7 — Equipment-identity reconciliation authority (operator workflow).
--
-- When a project's equipment records disagree across sources (subsystem panel ID,
-- fleet equipment, design equipment, stored permit equipment, rendered equipment),
-- an operator must explicitly select the winning value and give a reason. That
-- decision is recorded here IMMUTABLY: every conflicting source + value +
-- provenance at reconcile time, the chosen source/value, the PREVIOUS canonical
-- values (preserved), the operator, and the timestamp. No table or timestamp may
-- silently win — a row only exists because an operator chose.
--
-- Each reconciliation also writes rows into snapshot_digest_invalidations so the
-- closer can wire digest-checks: any snapshot digest / engineering approval tied
-- to the pre-reconciliation equipment is marked invalidated and must be rebuilt
-- and re-reviewed before it can be treated as authoritative again.
--
-- NOTE: this migration creates the tables ONLY. It performs NO data migration and
-- seeds NO rows — in particular it does NOT touch the live Braidon project.
-- Reconciliation is operator-initiated exclusively via the API.
--
-- Idempotent plain DDL (no DO blocks) per the System Tools migration runner.

CREATE TABLE IF NOT EXISTS equipment_reconciliation_audit (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,

  -- What was in conflict.
  conflict_field        TEXT NOT NULL,       -- e.g. module_model | inverter_model | racking_assembly
  subsystem_key         TEXT,                -- roof | ground | fence | NULL for project-wide

  -- Full snapshot of every conflicting source at reconcile time (JSON array of
  -- { source, value, provenance }). source ∈ subsystem_panel_id | fleet | design
  -- | stored_permit | rendered. Nothing is discarded.
  conflict_sources      TEXT NOT NULL,

  -- Operator's explicit decision.
  chosen_source         TEXT NOT NULL,       -- which source won
  chosen_value          TEXT NOT NULL,       -- the canonical value going forward (JSON)
  previous_values       TEXT NOT NULL,       -- prior canonical value(s), preserved (JSON)
  reason                TEXT NOT NULL,       -- REQUIRED operator justification

  operator_id           TEXT NOT NULL,
  operator_name         TEXT,
  reconciled_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- status: applied | failed | pending
  status                TEXT NOT NULL DEFAULT 'applied',
  -- Structured record of what was invalidated (mirrors snapshot_digest_invalidations
  -- rows for this reconciliation) so evidence can read it in one place.
  invalidation_record   TEXT,
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_recon_audit_project ON equipment_reconciliation_audit (project_id);
CREATE INDEX IF NOT EXISTS idx_recon_audit_field   ON equipment_reconciliation_audit (project_id, conflict_field);
CREATE INDEX IF NOT EXISTS idx_recon_audit_time    ON equipment_reconciliation_audit (reconciled_at);

-- ── Invalidation ledger (the closer wires digest-checks against this) ──
-- Any snapshot digest / engineering approval bound to pre-reconciliation
-- equipment is recorded here as invalidated. A snapshot whose digest appears here
-- (unless a later approval explicitly re-covers that digest) must NOT be treated
-- as permit-authoritative — it must be rebuilt and re-validated.
CREATE TABLE IF NOT EXISTS snapshot_digest_invalidations (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL,
  digest                TEXT,                -- the invalidated snapshot digest (NULL ⇒ "all current" until rebuild)
  snapshot_id           TEXT,               -- the invalidated snapshot id, when known
  -- scope: snapshot | calculation | engineering_approval
  scope                 TEXT NOT NULL DEFAULT 'snapshot',
  engineering_approval_ref TEXT,            -- approval id invalidated, when scope = engineering_approval
  reason                TEXT NOT NULL,
  invalidated_by        TEXT NOT NULL,       -- equipment_reconciliation_audit.id that caused it
  invalidated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Cleared only when a NEW review/rebuild explicitly re-covers the digest.
  superseded_at         TIMESTAMPTZ,
  superseded_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_digest_inval_project ON snapshot_digest_invalidations (project_id);
CREATE INDEX IF NOT EXISTS idx_digest_inval_digest  ON snapshot_digest_invalidations (digest);
CREATE INDEX IF NOT EXISTS idx_digest_inval_active  ON snapshot_digest_invalidations (project_id, superseded_at);
CREATE INDEX IF NOT EXISTS idx_digest_inval_cause   ON snapshot_digest_invalidations (invalidated_by);
