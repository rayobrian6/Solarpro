-- 113_manufacturer_document_registry.sql
-- W4 §8 — Canonical, VERSIONED manufacturer/authority document registry.
--
-- Every manufacturer datasheet, PE letter, evaluation report, listing, utility
-- requirement, and AHJ code-adoption document is archived here with a SHA-256 of
-- the exact archived file, its applicability boundary, superseded/current status,
-- extracted engineering claims (structured JSON), and a reviewer/verification
-- state. Engineering values may cite ONLY a row that is verification_state
-- 'verified' AND status 'current' AND whose applicability covers the exact
-- selected equipment + installation condition (enforced by the resolver in
-- lib/documents/registry.ts + lib/documents/rackingClearance.ts).
--
-- This is the store consulted by lib/permit/snapshot/rackingAssembly.ts to clear
-- (or refuse to clear) the RACKING-CAPACITY-SOURCE-NOT-ARCHIVED and
-- RACKING-CAPACITY-APPLICABILITY-GAP blockers (W4 §9). A generic Roof Tech
-- brochure / flashing report — missing the structural capacity claim or any
-- §9 applicability field — will NOT satisfy the resolver, so the blockers stay.
--
-- Idempotent plain DDL (no DO blocks) per the System Tools migration runner.

CREATE TABLE IF NOT EXISTS manufacturer_document_registry (
  id                        TEXT PRIMARY KEY,

  -- ── §8 document class (covers ALL required classes) ──
  -- module_datasheet | inverter_datasheet | microinverter_datasheet |
  -- combiner_documentation | racking_installation_manual | structural_pe_letter |
  -- evaluation_report | ul_listing | utility_requirements | ahj_code_adoption
  document_class            TEXT NOT NULL,

  -- ── Issuer + equipment applicability ──
  manufacturer_or_issuer    TEXT NOT NULL,
  equipment_id              TEXT,            -- joins equipment-db / mounting-hardware-db id
  equipment_model_applicability TEXT,        -- exact model string(s) the doc covers

  -- ── Document identity / revision ──
  title                     TEXT NOT NULL,
  revision                  TEXT,            -- revision label
  document_date             TEXT,            -- publication / effective date (ISO or label)

  -- ── Archived file identity + integrity ──
  archived_file_identity    TEXT,            -- storage key / path / filename of the archived file
  archived_in_repo          BOOLEAN NOT NULL DEFAULT FALSE,
  sha256                    TEXT,            -- SHA-256 of the exact archived file bytes (NULL until archived)

  -- ── Source + applicability boundary ──
  source                    TEXT,            -- URL / origin of record
  jurisdiction_boundary     TEXT,            -- jurisdiction / code edition / applicability boundary
  applicability_notes       TEXT,

  -- ── Supersession lifecycle ──
  -- status: current | superseded | draft | withdrawn
  status                    TEXT NOT NULL DEFAULT 'draft',
  supersedes_id             TEXT,            -- prior version this row replaces
  superseded_by_id          TEXT,            -- newer version that replaces this row

  -- ── Extracted engineering claims (structured) ──
  -- JSON text: capacity values, load basis, adjustment factors, and — for
  -- structural/racking docs — the full §9 applicability field set (exact model,
  -- fastener model+count, substrate, rafter/deck condition, embedment,
  -- rail/L-foot assembly, load basis, adjustment factors, jurisdiction).
  extracted_claims          TEXT,

  -- ── Reviewer / verification state ──
  -- verification_state: unverified | in_review | verified | rejected
  verification_state        TEXT NOT NULL DEFAULT 'unverified',
  reviewer                  TEXT,            -- assigned reviewer
  verified_by               TEXT,            -- operator/user id who verified
  verified_at               TIMESTAMPTZ,
  verification_notes        TEXT,

  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mfr_doc_registry_class      ON manufacturer_document_registry (document_class);
CREATE INDEX IF NOT EXISTS idx_mfr_doc_registry_equipment  ON manufacturer_document_registry (equipment_id);
CREATE INDEX IF NOT EXISTS idx_mfr_doc_registry_status     ON manufacturer_document_registry (status);
CREATE INDEX IF NOT EXISTS idx_mfr_doc_registry_verif      ON manufacturer_document_registry (verification_state);
-- Resolver hot path: verified + current documents for an equipment model.
CREATE INDEX IF NOT EXISTS idx_mfr_doc_registry_resolver   ON manufacturer_document_registry (document_class, equipment_id, status, verification_state);
-- SHA-256 lookups (dedup / integrity), only where archived.
CREATE INDEX IF NOT EXISTS idx_mfr_doc_registry_sha256     ON manufacturer_document_registry (sha256);
