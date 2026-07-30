-- 117_ahj_registry.sql
-- TAC WS-19 — THE CENTRAL SOLARPRO AHJ / ADOPTED-CODE REGISTRY.
--
-- WHY THIS EXISTS: the "AHJ registry" the website serves is the bundled
-- TypeScript table lib/jurisdictions/ahj-national.ts (~4,000 records) — it
-- carries an NEC year but NO IBC/IRC/IFC adoptions, no effective dates, no
-- source URLs and no hashes, so it can never clear CODE-AUTHORITY-INCOMPLETE
-- (its own header says so). The only other source was the external SunSpec /
-- Orange Button registry behind AHJ_REGISTRY_TOKEN, making an external
-- credential the PRIMARY prerequisite for adopted-code authority. This table
-- inverts that: SolarPro's own Neon registry is the FIRST provider consulted;
-- external retrievals and governed operator verifications are RETAINED here
-- (research once → retain centrally → version with evidence → reuse for every
-- project).
--
-- WHAT MAY CLEAR CODE AUTHORITY (unchanged gate semantics — nothing here
-- weakens codeAuthority.ts verified = all-editions + verifiedBy + sourceHash):
--   provenance='retrieved'          — a live external-registry retrieval that
--                                     was admitted (conflict-free) and persisted
--                                     with its payload hash + source URL.
--   provenance='operator-verified'  — a governed operator record citing the
--                                     adoption ordinance/source; verified_by is
--                                     the operator identity, source_url is the
--                                     ordinance/official source.
--   provenance='seeded-unprovenanced' — a copy of the in-code curated/expanded
--                                     row, retained ONLY so the registry
--                                     documents what is known and what is
--                                     missing. It carries no ordinance, no date
--                                     and no hash, and the internal provider
--                                     REFUSES to serve it as adoption authority.
--
-- Idempotent plain DDL (CREATE TABLE / CREATE INDEX IF NOT EXISTS only). No DO
-- blocks, no ALTER, no data migration — per the System Tools migration runner.

CREATE TABLE IF NOT EXISTS ahj_registry (
  id                    TEXT PRIMARY KEY,          -- slug: <state>-<county>-<city|ahj>

  -- ── IDENTITY ─────────────────────────────────────────────────────────────
  state_code            TEXT NOT NULL,
  county                TEXT,
  city                  TEXT,
  ahj_name              TEXT NOT NULL,
  jurisdiction_type     TEXT NOT NULL DEFAULT 'unknown',   -- city|county|state|special_district|unknown
  external_ahj_id       TEXT,                      -- the external registry's AHJID/AHJCode when retrieved

  -- ── ADOPTED CODE EDITIONS (years as text; NULL = genuinely not established;
  --    never inferred from the NEC year or a state default) ─────────────────
  nec_edition           TEXT,
  ibc_edition           TEXT,
  irc_edition           TEXT,
  ifc_edition           TEXT,
  raw_editions          TEXT,                      -- JSON: verbatim source enumerations
  local_amendments      TEXT,                      -- JSON string[]
  effective_date        TEXT,                      -- adoption effective date where known

  -- ── EVIDENCE (the fields the code-authority gate demands) ────────────────
  source_url            TEXT,                      -- retrieval endpoint or ordinance/official source
  source_sha256         TEXT,                      -- hash of the retrieval payload / archived source
  provenance            TEXT NOT NULL DEFAULT 'seeded-unprovenanced',
                        -- 'seeded-unprovenanced' | 'retrieved' | 'operator-verified'
  verified_by           TEXT,                      -- resolver id or operator identity
  verified_at           TIMESTAMPTZ,
  retrieved_at          TIMESTAMPTZ,
  raw_payload           TEXT,                      -- JSON: the full retained record (RegistryCodeAdoption shape)

  -- ── ENRICHMENT TRAIL (research-once bookkeeping; append-only JSON log) ───
  enrichment_attempts   TEXT,                      -- JSON: [{atIso, source, outcome, note}]

  permit_office         TEXT,                      -- JSON: {name, phone, email, url, address}
  engineering_review_requirements TEXT,            -- JSON string[]
  notes                 TEXT,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- resolver hot path: state + county (+city) lookup
CREATE INDEX IF NOT EXISTS idx_ahj_registry_state_county
  ON ahj_registry (state_code, county);
CREATE INDEX IF NOT EXISTS idx_ahj_registry_state_city
  ON ahj_registry (state_code, city);
CREATE INDEX IF NOT EXISTS idx_ahj_registry_provenance
  ON ahj_registry (provenance);
