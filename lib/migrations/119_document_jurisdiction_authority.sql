-- 119_document_jurisdiction_authority.sql
-- D4 — A DOCUMENT'S JURISDICTION IS AN IDENTITY, NOT A SENTENCE.
--
-- manufacturer_document_registry (migration 113) records the governing
-- jurisdiction as `jurisdiction_boundary`, a free-text display string. Two
-- problems followed from that.
--
-- 1. IDENTITY BY PROSE. Applicability was decided by comparing that string to
--    another string. "Madison County Building & Zoning" and "Madison County
--    Building and Zoning" are the same authority and different text. A
--    jurisdiction check that can be defeated by an ampersand is not a check.
--
-- 2. THE WRONG VALUE WAS WRITTEN. `structuralResolvers` stamped the boundary
--    from the authority bundle's `projectJurisdiction`, which is derived from
--    the POSTED project record by an AUTO_DERIVED resolver that runs first. For
--    the live Braidon project that is the MAILING city — "City of Granite City
--    Building & Zoning" — while the legal AHJ is Madison County,
--    unincorporated. All four live rows carry the mailing value.
--
-- This migration adds the STABLE identity alongside the display name:
-- `jurisdiction_authority_id`, holding the ahj_registry / curated-table record
-- id (e.g. 'il-madison-county'). The text column stays, and stays authoritative
-- for DISPLAY — it is not deprecated and not dropped, because a reviewer reads
-- a name, not an id.
--
-- NO BACKFILL. The four existing rows are NOT rewritten here. Their stored
-- jurisdiction is wrong, and correcting it is a governed data act with its own
-- before/after capture — not a silent side effect of a schema change. They keep
-- `jurisdiction_authority_id` NULL, which the resolver reads as "identity
-- unknown, fall back to normalised-name comparison", i.e. exactly the behaviour
-- they have today. Nothing regresses and nothing is quietly repaired.
--
-- Idempotent plain DDL (no DO blocks) per the governed migration runner.

ALTER TABLE manufacturer_document_registry
  ADD COLUMN IF NOT EXISTS jurisdiction_authority_id TEXT;

COMMENT ON COLUMN manufacturer_document_registry.jurisdiction_authority_id IS
  'STABLE legal-AHJ identity (ahj_registry record id, e.g. il-madison-county). '
  'THE key for jurisdiction applicability. jurisdiction_boundary remains the '
  'display name. NULL on rows written before migration 119 — those fall back to '
  'normalised-name comparison, which is fail-closed.';

-- Applicability lookups are per-equipment + per-jurisdiction; this index serves
-- the resolver's candidate query without changing any existing plan.
CREATE INDEX IF NOT EXISTS idx_mdr_jurisdiction_authority
  ON manufacturer_document_registry (jurisdiction_authority_id)
  WHERE jurisdiction_authority_id IS NOT NULL;
