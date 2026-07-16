# Phase 1B.1 — Tenant-Aware Audit Context

**Document type:** Workstream documentation (Workstream 5)
**Phase:** 1B.1 — Organization Authority Boundary and Lifecycle Correction
**Date:** 2026-07-12
**Commit covered:** `385138a6`
**Migration:** 107 (`lib/migrations/107_audit_log_org_context.sql`)
**Implementer:** SuperNinja autonomous agent
**Status:** Complete — org context columns added, per-org hash chains implemented, 24 tests passing

---

## 1. Executive Summary

The audit log is the system's tamper-evident record of security-relevant events. Phase 1B added audit logging for organization authority events but omitted two critical pieces: organization context on the audit log rows themselves, and a per-organization hash chain partition. Without organization context, audit log entries could not be filtered or attributed to a specific tenant. Without per-org hash chains, a compromised tenant could tamper with their own audit entries without affecting the global chain — or worse, a platform-level actor could tamper with tenant entries without detection.

Phase 1B.1 corrects this by adding `actor_organization_id` and `resource_owner_organization_id` columns to the `audit_log` table (migration 107), implementing per-organization hash chain partitioning (ADR-013 Option B), adding the `auditOrgAuthorityEvent()` function for structured authority-event auditing, and routing authorization decisions through `logAuthzDecision()` which produces consistent audit entries for both allowed and denied decisions.

---

## 2. Defect 4 — Audit Log Lacks Organization Context

### 2.1 The Defect

The `audit_log` table created by earlier migrations contained no organization context columns. Every audit entry recorded the actor's identity, action, and target, but not which organization the actor was operating in or which organization owned the target resource. Threat model T-08 (audit log lacks org context) flagged this as HIGH/HIGH severity.

### 2.2 The Correction

Migration 107 (`lib/migrations/107_audit_log_org_context.sql`) adds two columns:

```sql
ALTER TABLE audit_log ADD COLUMN actor_organization_id UUID;
ALTER TABLE audit_log ADD COLUMN resource_owner_organization_id UUID;
```

Two indexes enable efficient tenant-scoped audit queries:

```sql
CREATE INDEX idx_audit_log_actor_org ON audit_log (actor_organization_id, timestamp DESC);
CREATE INDEX idx_audit_log_resource_org ON audit_log (resource_owner_organization_id, timestamp DESC);
```

The `writeAuditLog()` function in `lib/auditLog.ts` was updated to include these columns in its INSERT statement, with `::uuid` casts for type safety. When organization context is not available (e.g., platform-level events), the columns are NULL, and the event is attributed to the "platform" chain.

---

## 3. Per-Organization Hash Chain Partitioning (ADR-013 Option B)

### 3.1 The Design

ADR-013 specifies two options for adding organization context to the hash chain. Phase 1B.1 implements Option B (recommended): each event's `prev_hash` links to the previous event's `entry_hash` **for the same `actor_organization_id`**. Platform-level events (NULL `actor_organization_id`) form a separate "platform" chain.

This design provides tenant isolation of the audit chain: each organization's audit entries form a linked list that can be verified independently. A tamper attempt in one organization's chain does not affect other organizations' chains, and the platform chain is separate from all tenant chains.

### 3.2 Implementation

The `writeAuditLog()` function resolves the previous hash by querying for the most recent entry with the same `actor_organization_id`:

```sql
SELECT entry_hash FROM audit_log
WHERE actor_organization_id IS NOT DISTINCT FROM ${actorOrgId}::uuid
ORDER BY id DESC LIMIT 1
```

The `IS NOT DISTINCT FROM` operator correctly handles the NULL case (platform chain) — `NULL IS NOT DISTINCT FROM NULL` returns true, while `NULL = NULL` returns NULL (false). This ensures platform-level events link to each other, not to tenant events.

The `computeEntryHash()` function incorporates all fields including `actor_organization_id` and `resource_owner_organization_id` into the SHA-256 hash input, ensuring any tampering with the org context is detectable.

### 3.3 Chain Verification

The `verifyAuditChain()` function accepts an optional `orgId` parameter. When provided, it verifies only the chain for that organization. When omitted, it verifies all chains (platform + all tenants). The verification process:

1. Queries audit_log entries ordered by `id` (insertion order)
2. For each entry, recomputes `entry_hash` from the row's fields
3. Compares the recomputed hash with the stored hash (detects field tampering)
4. Verifies `prev_hash` matches the previous entry's `entry_hash` for the same `actor_organization_id` (detects chain tampering)
5. Reports any breaks with the specific entry that failed

**Critical implementation detail:** The `writeAuditLog()` function computes the entry hash using `timestamp.toISOString()` (a string), but when `verifyAuditChain()` reads rows back from the database, `timestamp` is a JS `Date` object. The `computeEntryHash()` function uses `entry.timestamp` directly in the hash input, so the Date's `.toString()` produces a different string than the ISO string used at write time, causing false tamper alerts. The fix converts the timestamp before hashing: `row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp)`.

---

## 4. Authority Event Auditing

### 4.1 `auditOrgAuthorityEvent()`

A new function `auditOrgAuthorityEvent()` provides structured auditing for organization authority decisions. It accepts the actor's identity, the organization context, the action being authorized, the decision (allowed/denied), and the reason. It calls `writeAuditLog()` with the appropriate `actor_organization_id` and `resource_owner_organization_id`, ensuring every authority decision is recorded in the audit log with full tenant context.

### 4.2 `logAuthzDecision()`

The `logAuthzDecision()` function routes authorization decisions to the audit log. For allowed decisions, it records a `authz.allowed` event. For denied decisions, it records an `authz.denied` event with the deny reason. Both events include the organization context, making the audit trail complete for security analysis and compliance reporting.

### 4.3 Fail-Closed Audit

The `auditOrgAuthorityEvent()` function is fail-closed: if the audit log write fails (e.g., the table is missing columns, the database is unreachable), the function throws rather than silently dropping the audit entry. This ensures that security-relevant events are never lost — if the audit system is unavailable, the authority system fails closed rather than proceeding without an audit trail.

---

## 5. Migration Audit Context

The migration governance system's audit events (in `lib/migrations/ledger.ts`) were updated to include org context. The `persistMigrationAuditEvent()` function calls `writeAuditLog()` with `actor_organization_id: null` and `resource_owner_organization_id: null`, since migration operations are platform-level events that belong to the platform chain, not to any specific tenant. This ensures migration audit entries are correctly partitioned in the per-org hash chain system.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `lib/migrations/107_audit_log_org_context.sql` | New migration: add `actor_organization_id`, `resource_owner_organization_id` columns and indexes to `audit_log` |
| `lib/auditLog.ts` | Add org context columns to `writeAuditLog()` INSERT; implement per-org hash chain partitioning; add `auditOrgAuthorityEvent()`; add `logAuthzDecision()`; fix `verifyAuditChain()` Date-to-ISO conversion |
| `lib/migrations/ledger.ts` | Add `actor_organization_id: null, resource_owner_organization_id: null` to `persistMigrationAuditEvent()` → `writeAuditLog()` call |
| `tests/phase1b1-audit-context.test.ts` | 24 adversarial tests |
| `tests/phase1a3-route-handler-e2e.test.ts` | Updated DDL to include org context columns on audit_log |
| `tests/phase1a3-edge-cases.test.ts` | Updated DDL to include org context columns on audit_log |

---

## 7. Test Evidence

### 7.1 Audit Context Tests (`tests/phase1b1-audit-context.test.ts`)

24 tests covering org context, hash chains, and authority event auditing:

- `writeAuditLog()` records `actor_organization_id` when provided
- `writeAuditLog()` records `resource_owner_organization_id` when provided
- `writeAuditLog()` records NULL org context for platform-level events
- Per-org hash chain: entries with same `actor_organization_id` are linked
- Platform chain: entries with NULL `actor_organization_id` are linked
- Tenant chain does not link to platform chain (and vice versa)
- `verifyAuditChain()` with `orgId` verifies only that org's chain
- `verifyAuditChain()` without `orgId` verifies all chains
- `verifyAuditChain()` detects field tampering (recomputed hash mismatch)
- `verifyAuditChain()` detects chain tampering (broken `prev_hash` link)
- `verifyAuditChain()` correctly handles Date-to-ISO timestamp conversion
- `auditOrgAuthorityEvent()` records allowed decisions with org context
- `auditOrgAuthorityEvent()` records denied decisions with org context
- `auditOrgAuthorityEvent()` is fail-closed (throws on audit write failure)
- `logAuthzDecision()` records `authz.allowed` events
- `logAuthzDecision()` records `authz.denied` events with reason
- Both `logAuthzDecision()` event types include org context
- Indexes `idx_audit_log_actor_org` and `idx_audit_log_resource_org` exist
- `actor_organization_id` column is UUID type
- `resource_owner_organization_id` column is UUID type
- Audit entries are queryable by `actor_organization_id`
- Audit entries are queryable by `resource_owner_organization_id`
- Platform-level audit entries have NULL org context
- Migration audit events have NULL org context (platform chain)

---

## 8. ADR-013 Compliance Summary

| ADR-013 Requirement | Implementation |
|---------------------|----------------|
| Each event's `prev_hash` links to previous event's `entry_hash` for the same org | `writeAuditLog()` queries for last entry with matching `actor_organization_id` |
| Platform-level events (NULL) form a separate chain | `IS NOT DISTINCT FROM` handles NULL comparison correctly |
| Chain verification accepts optional `org_id` parameter | `verifyAuditChain(orgId?)` — filters by org when provided |
| `actor_organization_id` column on `audit_log` | Migration 107, UUID type |
| `resource_owner_organization_id` column on `audit_log` | Migration 107, UUID type |
| Indexes for org-scoped audit queries | `idx_audit_log_actor_org`, `idx_audit_log_resource_org` |
| Hash incorporates org context fields | `computeEntryHash()` includes both org ID fields in SHA-256 input |
