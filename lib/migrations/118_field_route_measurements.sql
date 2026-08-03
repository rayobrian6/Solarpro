-- 118_field_route_measurements.sql
-- WS-5 — FIELD ROUTE MEASUREMENTS: the producer that 'field-verified' never had.
--
-- WHY THIS EXISTS
-- ──────────────────────────────────────────────────────────────────────────────
-- WS-5 part 1 (commit 9402824a) taught the snapshot model to SAY
-- `field-verified`. Nothing could ever MAKE it say so: a repo-wide scan for a
-- field-measurement table, API, capability or operator surface returned zero.
-- `closesFieldVerification` therefore answered a question no production path
-- could reach, and ROUTE-LENGTH-ESTIMATE was structurally unclosable — which is
-- not honesty, it is a missing feature (the same finding migration 116 was
-- written to answer for ENGINEERING-REVIEW-PENDING).
--
-- WHAT MAKES A MEASUREMENT REAL, and every one of these is enforced by the
-- service that reads this table, never by a renderer and never by an API route:
--
--   1. RECORDING IS NOT VERIFICATION. A row is born REPORTED_UNVERIFIED. There
--      is no path — not a privileged recorder, not an API field, not a default
--      — from `INSERT` to VERIFIED. Verification is a SECOND, separately
--      authorised, separately audited transition, and the CHECK constraints
--      below make a verified row without a verifier, a verification time and a
--      verification MODE impossible at the storage layer.
--
--   2. THE VERIFICATION MODE IS RECORDED AT VERIFICATION TIME, never inferred
--      afterwards. INDEPENDENT_REVIEW means a second person;
--      AUTHORIZED_SELF_VERIFICATION means the tenant holds an explicit policy
--      permitting the recorder to verify their own work and the policy was
--      evaluated. Reconstructing "was this self-verified?" later by comparing
--      two user ids is a guess about intent; this column is the decision.
--
--   3. HISTORY IS NEVER OVERWRITTEN. A correction SUPERSEDES: the new row
--      points back with supersedes_measurement_id, the old row forward with
--      superseded_by_measurement_id, and the old VALUE survives. A rejection
--      keeps the rejected number and the reason. Accepted evidence is never
--      hard-deleted — the DELETE that would remove it is not in this schema and
--      is not in the service.
--
--   4. EVERY TRANSITION IS AUDITED IN THE SAME TRANSACTION. That is what the
--      second table is for. The compliance audit_log (migration 100) is
--      best-effort by design — it swallows its own write failure and falls back
--      to a console line — so it cannot be the durable record of a domain state
--      change. field_route_measurement_events is written by the SAME
--      sql.transaction() as the state transition it describes, so an audited
--      transition and an unaudited one cannot both exist.
--
-- WHAT THIS SCHEMA MAY NEVER BE USED FOR: the permit engine does not write here.
-- The canonical route-length resolver only READS (fail-closed: unreadable ⇒ no
-- field authority ⇒ the CAD source stands and the requirement stays open). There
-- is no seeded row, no default measurement, and no path from configuration to a
-- verified length.
--
-- RELATIONS THAT CANNOT BE FOREIGN KEYS, and why
-- ──────────────────────────────────────────────────────────────────────────────
--   • route_segment_id — a route segment is a SNAPSHOT/DOMAIN record
--     (RouteSegmentRecord.segmentId, e.g. 'BRANCH_RUN', 'FEEDER_RUN'), derived
--     each build from the design by lib/permit/snapshot/build.ts. It has no
--     relational row and no stable surrogate key, so there is nothing to
--     reference. Integrity is enforced in the service instead: a measurement is
--     refused unless the named segment EXISTS in the project's current
--     canonical snapshot AND its route authority applies (utility-owned
--     EXCLUDED runs are refused). That check is a domain read, not a constraint,
--     and it is tested as such.
--   • tenant_id — the canonical tenant key. SolarPro projects carry no
--     organization column (projects.user_id is the only owner pointer, and
--     users.org_id / organization_members carry the org). The tenant of a
--     project is therefore DERIVED: 'org:<uuid>' when the owner belongs to an
--     organization, 'user:<uuid>' for a solo owner. A TEXT key can express both;
--     a UUID FK can express only the first. tenant_organization_id carries the
--     REAL foreign key for the org case so the relational half is still
--     enforced, and is NULL for the solo-owner case.
--   • evidence_attachment_ids — stored as a TEXT[] of site_survey_files ids
--     rather than a join table. Each id is validated against the SAME
--     tenant/project at record and at verification time (an attachment that
--     later becomes unreadable stops satisfying the evidence policy — it does
--     not keep a verification alive silently). A join table would add a second
--     place for that authority to live without adding an enforcement the
--     service does not already perform.
--
-- Idempotent plain DDL (CREATE TABLE / CREATE INDEX IF NOT EXISTS only). No DO
-- blocks, no ALTER, no data migration, no seeded rows — per the System Tools
-- migration runner and the static gate in lib/migrations/targetedRegistryDeployment.ts
-- (which forbids DROP/DELETE/TRUNCATE/ALTER/UPDATE/INSERT tokens outright; that
-- is why the foreign keys below carry no ON-DELETE action clause).

CREATE TABLE IF NOT EXISTS field_route_measurements (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ── TENANCY + SCOPE ──────────────────────────────────────────────────────
  -- The canonical tenant key ('org:<uuid>' | 'user:<uuid>'). Every read is
  -- scoped by this AND by project_id; a cross-tenant read returns no rows
  -- rather than an error, and the service treats "no rows" as "no authority".
  tenant_id                 TEXT NOT NULL,
  -- The relational half of the tenant, when the tenant IS an organization.
  tenant_organization_id    UUID REFERENCES organizations(id),
  project_id                UUID NOT NULL REFERENCES projects(id),
  -- The canonical RouteSegmentRecord.segmentId this measurement is OF.
  route_segment_id          TEXT NOT NULL,

  -- ── THE MEASUREMENT ──────────────────────────────────────────────────────
  measured_length_ft        DOUBLE PRECISION NOT NULL,
  -- TAPE | LASER | MEASURING_WHEEL | AS_BUILT_DRAWING | OTHER
  measurement_method        TEXT NOT NULL,
  -- WHO measured, in the field. Server-stamped from the authenticated session;
  -- a client may not name another person as the measurer.
  measured_by_user_id       UUID NOT NULL REFERENCES users(id),
  -- WHEN the tape was on the run (operator-supplied, validated not-in-future).
  measured_at               TIMESTAMPTZ NOT NULL,
  -- WHEN the platform recorded it (system-generated; never client-supplied).
  recorded_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  evidence_attachment_ids   TEXT[] NOT NULL DEFAULT '{}',
  notes                     TEXT,

  -- ── STATE ────────────────────────────────────────────────────────────────
  -- REPORTED_UNVERIFIED | VERIFIED | REJECTED | SUPERSEDED
  verification_state        TEXT NOT NULL DEFAULT 'REPORTED_UNVERIFIED',
  -- INDEPENDENT_REVIEW | AUTHORIZED_SELF_VERIFICATION | SYSTEM_MIGRATED
  verification_mode         TEXT,

  verified_by_user_id       UUID REFERENCES users(id),
  verified_at               TIMESTAMPTZ,
  verification_notes        TEXT,
  -- The documented authorised exception, when verification proceeded without an
  -- evidence attachment. NULL is the normal case; a non-null value is a written
  -- reason a reviewer can be held to, not a checkbox.
  evidence_exception_reason TEXT,

  rejected_by_user_id       UUID REFERENCES users(id),
  rejected_at               TIMESTAMPTZ,
  rejection_reason          TEXT,

  -- ── SUPERSESSION (append-only; the migration-114/115/116 ledger shape) ────
  supersedes_measurement_id     UUID,
  superseded_by_measurement_id  UUID,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- ── IMPOSSIBLE STATES, REFUSED AT THE STORAGE LAYER ──────────────────────
  -- A length that is not a positive finite number is not a measurement. The
  -- upper bound is a sanity rail, not the engineering policy: the service
  -- applies the tighter, documented per-project bound and explains it.
  CONSTRAINT ck_frm_length_positive
    CHECK (measured_length_ft > 0 AND measured_length_ft <= 10000),
  CONSTRAINT ck_frm_method
    CHECK (measurement_method IN ('TAPE','LASER','MEASURING_WHEEL','AS_BUILT_DRAWING','OTHER')),
  CONSTRAINT ck_frm_state
    CHECK (verification_state IN ('REPORTED_UNVERIFIED','VERIFIED','REJECTED','SUPERSEDED')),
  CONSTRAINT ck_frm_mode
    CHECK (verification_mode IS NULL
        OR verification_mode IN ('INDEPENDENT_REVIEW','AUTHORIZED_SELF_VERIFICATION','SYSTEM_MIGRATED')),
  -- VERIFIED requires a verifier, a time AND a recorded mode. This is the
  -- constraint that makes "operator entry silently became authority" a storage
  -- error rather than a review finding.
  CONSTRAINT ck_frm_verified_complete
    CHECK (verification_state <> 'VERIFIED'
        OR (verified_by_user_id IS NOT NULL AND verified_at IS NOT NULL AND verification_mode IS NOT NULL)),
  -- REJECTED requires a rejector, a time AND a written reason.
  CONSTRAINT ck_frm_rejected_complete
    CHECK (verification_state <> 'REJECTED'
        OR (rejected_by_user_id IS NOT NULL AND rejected_at IS NOT NULL
            AND rejection_reason IS NOT NULL AND length(btrim(rejection_reason)) > 0)),
  -- SUPERSEDED requires the pointer to what replaced it.
  CONSTRAINT ck_frm_superseded_complete
    CHECK (verification_state <> 'SUPERSEDED' OR superseded_by_measurement_id IS NOT NULL),
  -- An unverified report carries no verification or rejection facts at all.
  CONSTRAINT ck_frm_unverified_clean
    CHECK (verification_state <> 'REPORTED_UNVERIFIED'
        OR (verified_by_user_id IS NULL AND verified_at IS NULL AND verification_mode IS NULL
            AND rejected_by_user_id IS NULL AND rejected_at IS NULL))
);

-- The tenant-scoped project listing (every read starts here).
CREATE INDEX IF NOT EXISTS idx_frm_tenant_project
  ON field_route_measurements (tenant_id, project_id, recorded_at DESC);
-- The per-route history (the operator panel + the audit view).
CREATE INDEX IF NOT EXISTS idx_frm_project_segment
  ON field_route_measurements (project_id, route_segment_id, recorded_at DESC);
-- The resolver hot path: the ACTIVE candidates for one segment.
CREATE INDEX IF NOT EXISTS idx_frm_segment_state
  ON field_route_measurements (route_segment_id, verification_state);
-- The release-resolver roll-up: every segment's state in one project.
CREATE INDEX IF NOT EXISTS idx_frm_project_state
  ON field_route_measurements (project_id, verification_state);
-- Supersession chain walks (history rendering + reopening checks).
CREATE INDEX IF NOT EXISTS idx_frm_supersedes
  ON field_route_measurements (supersedes_measurement_id);

-- ══════════════════════════════════════════════════════════════════════════
-- THE DURABLE, ATOMIC DOMAIN AUDIT
-- ──────────────────────────────────────────────────────────────────────────
-- Written by the SAME transaction as the state transition it records. The
-- compliance audit_log (migration 100) is mirrored to on a best-effort basis
-- and is explicitly NOT the record of authority: it catches its own write
-- failure and logs to console. A domain transition that committed without its
-- event row is not possible here, because the two INSERTs are one transaction.
--
-- Attachment CONTENT is never stored here. `evidence_attachment_ids` in the
-- detail payload holds IDs only.
-- ══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS field_route_measurement_events (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  tenant_id              TEXT NOT NULL,
  tenant_organization_id UUID REFERENCES organizations(id),
  project_id             UUID NOT NULL REFERENCES projects(id),
  route_segment_id       TEXT NOT NULL,
  measurement_id         UUID NOT NULL,

  -- ROUTE_MEASUREMENT_RECORDED | ROUTE_MEASUREMENT_VERIFIED
  -- ROUTE_MEASUREMENT_REJECTED | ROUTE_MEASUREMENT_SUPERSEDED
  event_type             TEXT NOT NULL,
  actor_user_id          UUID REFERENCES users(id),
  previous_state         TEXT,
  new_state              TEXT NOT NULL,

  -- Snapshot / calculation linkage where one applies at event time.
  snapshot_id            TEXT,
  snapshot_digest        TEXT,
  calculation_record_id  TEXT,

  -- IDs and scalars only — never attachment bytes, never file contents.
  detail                 JSONB NOT NULL DEFAULT '{}',

  occurred_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_frme_type
    CHECK (event_type IN ('ROUTE_MEASUREMENT_RECORDED','ROUTE_MEASUREMENT_VERIFIED',
                          'ROUTE_MEASUREMENT_REJECTED','ROUTE_MEASUREMENT_SUPERSEDED'))
);

CREATE INDEX IF NOT EXISTS idx_frme_measurement
  ON field_route_measurement_events (measurement_id, occurred_at ASC);
CREATE INDEX IF NOT EXISTS idx_frme_project_segment
  ON field_route_measurement_events (project_id, route_segment_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_frme_tenant
  ON field_route_measurement_events (tenant_id, occurred_at DESC);
