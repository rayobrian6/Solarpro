-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 107: Audit Log Organization Context (T-08, ADR-013)
-- Phase 1B.1 Workstream 5 — Tenant-Aware Audit Context
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Threat Model T-08 (HIGH/HIGH): Audit log lacks org context — compliance gap.
-- The audit_log table (migration 100) has actor_id, actor_email, actor_role,
-- target_type, target_id but no actor_organization_id or
-- resource_owner_organization_id. For SOC 2 CC7.2 and ISO 27001 A.12.4
-- compliance, per-organization audit queries are essential.
--
-- ADR-013 (Option B — RECOMMENDED): Add org columns and partition the hash
-- chain per org. Each event's prev_hash links to the previous event's
-- entry_hash FOR THE SAME actor_organization_id. Platform-level events
-- (actor_organization_id IS NULL) form a separate "platform" chain.
--
-- This migration is additive: existing rows receive NULL for both new columns.
-- Existing hash chain integrity is preserved for entries written before this
-- migration — the hash computation in lib/auditLog.ts includes the new columns
-- as empty strings when null, which is consistent for all NEW entries. Legacy
-- entries (pre-107) were hashed without these fields; re-verification of legacy
-- chains is a separate operational concern documented in the threat model.
--
-- ─────────────────────────────────────────────────────────────────────────────

-- Add org context columns (nullable for platform-level events)
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_organization_id UUID;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS resource_owner_organization_id UUID;

-- Indexes for per-org audit queries (tenant-scoped compliance reports)
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_org
  ON audit_log (actor_organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource_org
  ON audit_log (resource_owner_organization_id);

COMMENT ON COLUMN audit_log.actor_organization_id IS
  'Organization context of the actor at time of event. NULL for platform-level events. Per-org hash chain partition key (ADR-013).';
COMMENT ON COLUMN audit_log.resource_owner_organization_id IS
  'Organization that owns the affected resource. NULL for platform-level resources. Used for tenant-scoped audit queries (ADR-013, T-08).';
