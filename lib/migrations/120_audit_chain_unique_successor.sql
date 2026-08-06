-- 120_audit_chain_unique_successor.sql
-- AUDIT BOOTSTRAP CHAIN CLOSURE — one parent, one child.
--
-- WHY THIS EXISTS
-- ─────────────────────────────────────────────────────────────────────────────
-- The audit chain is appended by read-head-then-insert. The writer now performs
-- a compare-and-swap on the head it read, which defeats the common interleaving:
-- a writer whose head moved inserts zero rows, re-reads, and rebuilds.
--
-- That is not sufficient on its own. Under READ COMMITTED two statements that
-- overlap can both observe the same head before either commits, and both CAS
-- predicates pass. The narrow window remains, and a tamper-evident chain cannot
-- be claimed closed while a sibling fork is possible.
--
-- This index closes it at the storage layer: within a chain partition, a given
-- `prev_hash` may be claimed by exactly ONE row. The second writer's INSERT
-- raises 23505, the writer treats it as "another append won", re-reads the head
-- and retries. A fork stops being unlikely and becomes impossible.
--
-- WHY PARTIAL (`WHERE prev_hash IS NOT NULL`)
-- A chain ROOT legitimately has `prev_hash = NULL`, and PostgreSQL does not
-- consider two NULLs equal in a unique index anyway. Being explicit documents
-- the intent and — importantly — leaves the five historical bootstrap roots
-- (ids 58, 59, 60, 61, 62) untouched and legal. This migration does not repair
-- them; they are preserved as evidence of the defect.
--
-- WHY `actor_organization_id` IS PART OF THE KEY
-- ADR-013 partitions the chain per organization, with a separate platform chain
-- for NULL org. Two different partitions may each descend from a hash without
-- conflicting, so the uniqueness is per-partition. NULLS NOT DISTINCT makes the
-- platform partition (org IS NULL) enforce uniqueness rather than exempting
-- itself — which is where every migration-governance event lives today.
--
-- PREREQUISITE: migration 107. This index names `actor_organization_id`, so 107
-- must be applied first. The targeted deployment gate enforces that ordering.
--
-- Idempotent, additive, index-only. No row is written, read, altered or deleted.

CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_log_chain_successor
  ON audit_log (actor_organization_id, prev_hash)
  NULLS NOT DISTINCT
  WHERE prev_hash IS NOT NULL;

COMMENT ON INDEX uq_audit_log_chain_successor IS
  'Tamper-evident chain closure: within an ADR-013 partition a given prev_hash '
  'may be claimed by exactly one successor, so concurrent appends cannot fork. '
  'Partial on prev_hash IS NOT NULL because a chain root has no predecessor; the '
  'historical bootstrap roots 58-62 remain legal and unmodified.';
