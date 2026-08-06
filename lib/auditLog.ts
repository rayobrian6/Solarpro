/**
 * lib/auditLog.ts — Centralized Tamper-Evident Audit Logging
 *
 * SOC 2 (CC7.2) and ISO 27001 (A.12.4) require comprehensive audit logging
 * of security-relevant events. This module provides:
 *
 *   1. Structured audit events with required fields (who, what, when, where)
 *   2. Hash-chained entries for tamper evidence (each entry includes the SHA-256
 *      hash of the previous entry, creating a blockchain-style integrity chain)
 *   3. Persistent storage in PostgreSQL (audit_log table)
 *   4. Query utilities for compliance review and incident investigation
 *
 * Chain integrity can be verified by calling verifyChain(), which recomputes
 * all hashes and flags any broken links — evidence of tampering or corruption.
 *
 * ⚠️ IMPORTANT: This module must never log Tier 1 (Restricted) data such as
 * passwords, API keys, or tokens. Use redactValue() for sensitive fields.
 */

import { getDbWithRetry } from '@/lib/db-ready';
import crypto from 'crypto';

// ─── Audit Event Types ──────────────────────────────────────────────────────

export type AuditCategory =
  | 'auth'          // Authentication events (login, logout, MFA, failures)
  | 'access'        // Access control changes (role changes, permission grants)
  | 'data'          // Data access and modifications (CRUD on sensitive records)
  | 'config'        // System configuration changes (env vars, settings)
  | 'security'      // Security events (rate limit, blocked requests, suspicious activity)
  | 'admin'         // Admin actions (impersonation, bulk operations, overrides)
  | 'billing'       // Billing and payment events (Stripe webhooks, subscription changes)
  | 'compliance'    // Compliance events (data export, deletion requests, consent changes)
  | 'migration';    // Database migration governance events (Phase 1A.1)

export type AuditAction =
  // Auth
  | 'login_success'
  | 'login_failure'
  | 'logout'
  | 'token_refresh'
  | 'password_change'
  | 'password_reset_request'
  | 'password_reset_complete'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'mfa_setup_initiated'
  | 'mfa_challenge_issued'
  | 'mfa_challenge_success'
  | 'mfa_challenge_failure'
  | 'mfa_failure'
  | 'mfa_recovery_code_used'
  | 'mfa_recovery_code_failed'
  | 'mfa_enrollment_required'
  | 'account_locked'
  | 'account_unlocked'
  // Access
  | 'role_change'
  | 'permission_grant'
  | 'permission_revoke'
  | 'access_review_completed'
  // Data
  | 'data_read'
  | 'data_create'
  | 'data_update'
  | 'data_delete'
  | 'data_export'
  | 'data_import'
  | 'bulk_data_operation'
  // Config
  | 'config_change'
  | 'env_var_update'
  | 'feature_flag_toggle'
  // Security
  | 'rate_limit_exceeded'
  | 'suspicious_activity_detected'
  | 'csrf_validation_failure'
  | 'webhook_signature_failure'
  | 'sql_injection_attempt'
  | 'xss_attempt'
  // Admin
  | 'admin_impersonate_start'
  | 'admin_impersonate_end'
  | 'admin_override'
  | 'break_glass_access'
  // Billing
  | 'subscription_created'
  | 'subscription_updated'
  | 'subscription_canceled'
  | 'payment_processed'
  | 'payment_failed'
  | 'refund_issued'
  // Compliance
  | 'consent_given'
  | 'consent_revoked'
  | 'data_deletion_request'
  | 'data_deletion_completed'
  | 'data_export_request'
  | 'data_export_completed'
  | 'retention_policy_enforced'
  // Migration governance (Phase 1A.1)
  | 'migration_bootstrap_started'
  | 'migration_bootstrap_completed'
  | 'migration_bootstrap_failed'
  | 'migration_run_started'
  | 'migration_run_completed'
  | 'migration_run_failed'
  | 'migration_applied'
  | 'migration_failed'
  | 'migration_skipped'
  | 'migration_started'
  | 'migration_conflict_detected'
  | 'migration_checksum_mismatch'
  | 'migration_lock_denied'
  | 'migration_lock_acquired'
  | 'migration_legacy_invoked'
  | 'migration_baseline_started'
  | 'migration_baseline_completed'
  | 'migration_baseline_failed'
  | 'migration_governance_state_change'
  | 'migration_governance_execution_denied'
  | 'migration_mfa_denied'
  | 'migration_mfa_replay_detected'
  | 'migration_transaction_mode_review_required'
  | 'migration_execution_blocked_non_transactional'
  // Organization authority events (Phase 1B.1 — tenant-aware audit context)
  | 'organization_created'
  | 'organization_updated'
  | 'organization_archived'
  | 'organization_suspended'
  | 'organization_reactivated'
  | 'organization_membership_invited'
  | 'organization_membership_added'
  | 'organization_membership_removed'
  | 'organization_membership_suspended'
  | 'organization_membership_reactivated'
  | 'organization_membership_role_changed'
  | 'organization_authz_decision';

export interface AuditLogEntry {
  id?: string;
  timestamp: string;          // ISO 8601
  category: AuditCategory;
  action: AuditAction;
  actor_id: string | null;    // User ID (null for system actions)
  actor_email: string | null;
  actor_role: string | null;
  target_type: string | null; // What was affected (e.g., 'user', 'project', 'invoice')
  target_id: string | null;   // ID of the affected resource
  description: string;        // Human-readable summary
  metadata: Record<string, unknown>; // Additional context (never Tier 1 data)
  ip_address: string | null;
  user_agent: string | null;
  request_path: string | null;
  // ── Tenant-aware audit context (ADR-013, T-08) ──
  actor_organization_id: string | null;           // Org context of actor (per-org chain key)
  resource_owner_organization_id: string | null;  // Org that owns affected resource
  prev_hash: string | null;   // SHA-256 of previous entry (tamper chain)
  entry_hash: string | null;  // SHA-256 of this entry (computed on insert)
}

// ─── Sensitive Field Redaction ──────────────────────────────────────────────

const SENSITIVE_FIELDS = [
  'password', 'token', 'secret', 'key', 'authorization', 'cookie',
  'credit_card', 'card_number', 'cvv', 'ssn', 'api_key', 'private_key',
  'access_token', 'refresh_token', 'session_id',
];

/**
 * Redacts sensitive values in a metadata object. Mutates nothing — returns a
 * new object with sensitive fields replaced by '[REDACTED]'.
 */
export function redactMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_FIELDS.some(s => k.toLowerCase().includes(s))) {
      safe[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 200) {
      // Truncate very long values to prevent log bloat
      safe[k] = v.substring(0, 200) + '...[truncated]';
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

// ─── Hash Chain Computation ──────────────────────────────────────────────────

/**
 * Computes the SHA-256 hash of an audit log entry for chain integrity.
 * The hash is computed over a deterministic concatenation of all fields
 * except entry_hash itself (which doesn't exist yet at computation time).
 */
function computeEntryHash(entry: Omit<AuditLogEntry, 'id' | 'entry_hash'>): string {
  const hashInput = [
    entry.timestamp,
    entry.category,
    entry.action,
    entry.actor_id ?? '',
    entry.actor_email ?? '',
    entry.actor_role ?? '',
    entry.target_type ?? '',
    entry.target_id ?? '',
    entry.description,
    JSON.stringify(entry.metadata),
    entry.ip_address ?? '',
    entry.user_agent ?? '',
    entry.request_path ?? '',
    entry.actor_organization_id ?? '',
    entry.resource_owner_organization_id ?? '',
    entry.prev_hash ?? '',
  ].join('|');

  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Fetches the most recent audit log entry's hash for chain continuation.
 * Per-org hash chain partitioning (ADR-013): when orgId is provided, only
 * the latest entry for that org is returned. When orgId is null/undefined,
 * the latest platform-level entry (actor_organization_id IS NULL) is returned.
 * Returns null if no entries exist (first entry in chain).
 */
async function getLatestHash(orgId?: string | null): Promise<string | null> {
  try {
    const sql = await getDbWithRetry();
    if (orgId) {
      const rows = await sql`
        SELECT entry_hash FROM audit_log
        WHERE actor_organization_id = ${orgId}::uuid
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      return (rows[0] as any)?.entry_hash ?? null;
    } else {
      // Platform-level chain (actor_organization_id IS NULL)
      const rows = await sql`
        SELECT entry_hash FROM audit_log
        WHERE actor_organization_id IS NULL
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      return (rows[0] as any)?.entry_hash ?? null;
    }
  } catch {
    // If audit_log table doesn't exist yet, return null (chain starts fresh)
    return null;
  }
}

// ─── Primary Write Function ─────────────────────────────────────────────────

/**
 * Write an audit log entry to the database with hash-chain integrity.
 *
 * This is the primary function for recording security-relevant events.
 * It automatically:
 *   - Redacts sensitive metadata fields
 *   - Chains to the previous entry via SHA-256 hash (per-org partition, ADR-013)
 *   - Computes and stores its own hash for future chain verification
 *   - Handles missing audit_log table gracefully (falls back to console)
 *
 * Per-org hash chain (ADR-013): actor_organization_id partitions the chain.
 * Each event's prev_hash links to the previous entry with the SAME
 * actor_organization_id. Platform-level events (orgId null) form a separate chain.
 *
 * @returns The entry hash on success, null on failure (never throws)
 */
// ═══════════════════════════════════════════════════════════════════════════
// THE ORG-COLUMN CAPABILITY PROBE
//
// THE OUTAGE THIS ENDS. Commit d479cbda (2026-07-12) added
// `actor_organization_id` / `resource_owner_organization_id` to the INSERT
// below, with migration 107 to create them. 107 was never applied — the ledger
// jumps 108 → 119, because 107 sits in the ~27-migration historical baseline the
// global execution gate refuses and it was never brought through the targeted
// path either. From that commit onward every call inserted 17 columns into a
// 16-column table, PostgreSQL answered `column "actor_organization_id" does not
// exist`, the catch below swallowed it, and the event was gone.
//
// It went unnoticed for weeks because the two halves ran in different places:
// production (master) still runs the pre-d479cbda writer and its auth events
// kept landing, while the dev deployment's migration events — 113 in July, 119
// in August — silently vanished. Both migrations reported
// AUDIT_PERSISTENCE_FAILED and neither said why.
//
// THE RULE THIS ENFORCES: an audit event is DURABLE first. Losing the event
// entirely is strictly worse for SOC 2 CC7.2 / ISO 27001 A.12.4 than recording
// it without org partitioning — one is a missing control, the other is a
// narrower query surface. So when the columns are absent the entry is still
// written, the org ids are preserved INSIDE metadata so nothing is lost, and the
// degradation is reported loudly and on the record rather than inferred.
//
// This is a SAFETY NET, not a substitute for applying 107. `auditLogOrgContextStatus`
// exposes the degraded state so an operator surface can say so out loud.
let _orgColumnsPresent: boolean | null = null;
let _orgColumnProbeError: string | null = null;

/** Reset the cached probe — for tests, and after a migration lands. */
export function resetAuditLogSchemaProbe(): void {
  _orgColumnsPresent = null;
  _orgColumnProbeError = null;
}

/** Whether the per-org chain columns exist. Probed once per instance. */
async function auditLogHasOrgColumns(sql: SqlExecutorLike): Promise<boolean> {
  if (_orgColumnsPresent !== null) return _orgColumnsPresent;
  try {
    const rows = await sql`
      SELECT count(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'audit_log'
        AND column_name IN ('actor_organization_id', 'resource_owner_organization_id')
    `;
    const n = Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
    _orgColumnsPresent = n === 2;
    if (!_orgColumnsPresent) {
      console.error('[AUDIT_LOG_SCHEMA_DEGRADED]', JSON.stringify({
        detail: `audit_log is missing the ADR-013 org-context column(s) (found ${n} of 2). `
          + 'Migration 107 (107_audit_log_org_context.sql) has NOT been applied. Audit entries are '
          + 'still being written, WITHOUT per-org hash-chain partitioning; the org ids are preserved '
          + 'in metadata.orgContext. Apply migration 107 to restore ADR-013 partitioning.',
      }));
    }
    return _orgColumnsPresent;
  } catch (err: unknown) {
    // Fail toward the LEGACY shape: it is the one that works on both schemas, so
    // an unreadable catalog degrades to a durable write rather than to no write.
    _orgColumnProbeError = err instanceof Error ? err.message : String(err);
    _orgColumnsPresent = false;
    console.error('[AUDIT_LOG_SCHEMA_PROBE_FAILED]', _orgColumnProbeError);
    return false;
  }
}

/** The org-context state, for an operator surface / health check. */
export function auditLogOrgContextStatus(): {
  probed: boolean; orgColumnsPresent: boolean | null; probeError: string | null;
} {
  return { probed: _orgColumnsPresent !== null, orgColumnsPresent: _orgColumnsPresent, probeError: _orgColumnProbeError };
}

/** The minimal shape of the tagged-template executor this module needs. */
type SqlExecutorLike = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

/** What a write attempt actually did. `entryHash` is non-null iff it persisted. */
export interface AuditWriteResult {
  entryHash: string | null;
  persisted: boolean;
  /** WHY it did not persist. Null on success. */
  error: string | null;
  /** true ⇔ written without ADR-013 org partitioning (migration 107 absent). */
  orgContextDegraded: boolean;
}

/**
 * Write an audit entry, returning the full outcome.
 *
 * `writeAuditLog` keeps its `string | null` contract for its many callers;
 * this is the same work with the REASON preserved. Two weeks of failed migration
 * audits reported `AUDIT_PERSISTENCE_FAILED` with no cause attached, because the
 * reason was discarded at this boundary.
 */
export async function writeAuditLogDetailed(
  entry: Omit<AuditLogEntry, 'id' | 'prev_hash' | 'entry_hash' | 'timestamp'>,
  timestamp?: Date,
): Promise<AuditWriteResult> {
  const ts = timestamp ?? new Date();
  const isoTimestamp = ts.toISOString();
  const orgId = entry.actor_organization_id ?? null;
  const resourceOrgId = entry.resource_owner_organization_id ?? null;

  // EVERYTHING that can throw is inside the try. `redactMetadata` walks caller
  // data and `computeEntryHash` JSON.stringifies it — both sat OUTSIDE it, so a
  // circular or non-serialisable metadata value threw straight past the fallback
  // that exists to guarantee an event is never silently lost.
  let fullEntry: Omit<AuditLogEntry, 'id' | 'entry_hash'> | null = null;
  let entryHash: string | null = null;
  let degraded = false;
  try {
    const safeMetadata = redactMetadata(entry.metadata ?? {});
    const sql = await getDbWithRetry();
    const hasOrgColumns = await auditLogHasOrgColumns(sql as unknown as SqlExecutorLike);
    degraded = !hasOrgColumns;

    // Per-org hash chain partitioning (ADR-013). With no org columns there is
    // one platform chain; `getLatestHash` already fails soft to null.
    const prevHash = await getLatestHash(hasOrgColumns ? orgId : null);

    // Nothing is lost in degraded mode: the org ids travel in metadata, so the
    // entry can be re-partitioned once 107 lands.
    const storedMetadata = degraded && (orgId || resourceOrgId)
      ? { ...safeMetadata, orgContext: { actor_organization_id: orgId, resource_owner_organization_id: resourceOrgId, degraded: true } }
      : safeMetadata;

    fullEntry = {
      timestamp: isoTimestamp,
      category: entry.category,
      action: entry.action,
      actor_id: entry.actor_id ?? null,
      actor_email: entry.actor_email ?? null,
      actor_role: entry.actor_role ?? null,
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      description: entry.description,
      metadata: storedMetadata,
      ip_address: entry.ip_address ?? null,
      user_agent: entry.user_agent ?? null,
      request_path: entry.request_path ?? null,
      actor_organization_id: orgId,
      resource_owner_organization_id: resourceOrgId,
      prev_hash: prevHash,
    };
    // The hash covers the org ids in BOTH modes, so the chain value for a given
    // event does not change when 107 is applied.
    entryHash = computeEntryHash(fullEntry);
    const metaJson = JSON.stringify(storedMetadata);

    if (hasOrgColumns) {
      await sql`
        INSERT INTO audit_log (
          timestamp, category, action,
          actor_id, actor_email, actor_role,
          target_type, target_id,
          description, metadata,
          ip_address, user_agent, request_path,
          actor_organization_id, resource_owner_organization_id,
          prev_hash, entry_hash
        ) VALUES (
          ${isoTimestamp}::timestamptz, ${entry.category}::text, ${entry.action}::text,
          ${fullEntry.actor_id}, ${fullEntry.actor_email}, ${fullEntry.actor_role},
          ${fullEntry.target_type}, ${fullEntry.target_id},
          ${entry.description}, ${metaJson}::jsonb,
          ${fullEntry.ip_address}, ${fullEntry.user_agent}, ${fullEntry.request_path},
          ${orgId}::uuid, ${resourceOrgId}::uuid,
          ${prevHash}, ${entryHash}
        )
      `;
    } else {
      await sql`
        INSERT INTO audit_log (
          timestamp, category, action,
          actor_id, actor_email, actor_role,
          target_type, target_id,
          description, metadata,
          ip_address, user_agent, request_path,
          prev_hash, entry_hash
        ) VALUES (
          ${isoTimestamp}::timestamptz, ${entry.category}::text, ${entry.action}::text,
          ${fullEntry.actor_id}, ${fullEntry.actor_email}, ${fullEntry.actor_role},
          ${fullEntry.target_type}, ${fullEntry.target_id},
          ${entry.description}, ${metaJson}::jsonb,
          ${fullEntry.ip_address}, ${fullEntry.user_agent}, ${fullEntry.request_path},
          ${prevHash}, ${entryHash}
        )
      `;
    }
    return { entryHash, persisted: true, error: null, orgContextDegraded: degraded };
  } catch (err: unknown) {
    // The console fallback is the last line of defence and must never itself
    // throw — a circular metadata value would take the fallback down with it.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AUDIT_LOG_WRITE_ERROR]', msg);
    try {
      console.error('[AUDIT_LOG_FALLBACK]', JSON.stringify({ ...(fullEntry ?? entry), entry_hash: entryHash }));
    } catch {
      console.error('[AUDIT_LOG_FALLBACK_UNSERIALISABLE]',
        `category=${entry.category} action=${entry.action} target=${entry.target_type}:${entry.target_id} `
        + `actor=${entry.actor_id ?? 'none'} at=${isoTimestamp} — metadata could not be serialised`);
    }
    return { entryHash: null, persisted: false, error: msg, orgContextDegraded: degraded };
  }
}

/**
 * Write an audit entry. Returns the entry hash, or null when it did not persist
 * (the reason is logged, and available structurally via `writeAuditLogDetailed`).
 */
export async function writeAuditLog(
  entry: Omit<AuditLogEntry, 'id' | 'prev_hash' | 'entry_hash' | 'timestamp'>,
  timestamp?: Date,
): Promise<string | null> {
  return (await writeAuditLogDetailed(entry, timestamp)).entryHash;
}

// ─── Convenience Wrappers ────────────────────────────────────────────────────

interface AuditContext {
  actor_id?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  // Tenant-aware context (ADR-013, T-08)
  actor_organization_id?: string | null;
  resource_owner_organization_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  request_path?: string | null;
}

/**
 * Log an authentication event.
 */
export async function auditAuth(
  action: AuditAction,
  description: string,
  ctx: AuditContext,
  meta?: Record<string, unknown>,
): Promise<string | null> {
  return writeAuditLog({
    category: 'auth',
    action,
    description,
    actor_id: ctx.actor_id ?? null,
    actor_email: ctx.actor_email ?? null,
    actor_role: ctx.actor_role ?? null,
    target_type: 'user',
    target_id: ctx.actor_id ?? null,
    metadata: meta ?? {},
    ip_address: ctx.ip_address ?? null,
    user_agent: ctx.user_agent ?? null,
    request_path: ctx.request_path ?? null,
    actor_organization_id: ctx.actor_organization_id ?? null,
    resource_owner_organization_id: ctx.resource_owner_organization_id ?? null,
  });
}

/**
 * Log a data access or modification event.
 */
export async function auditData(
  action: AuditAction,
  targetType: string,
  targetId: string,
  description: string,
  ctx: AuditContext,
  meta?: Record<string, unknown>,
): Promise<string | null> {
  return writeAuditLog({
    category: 'data',
    action,
    description,
    actor_id: ctx.actor_id ?? null,
    actor_email: ctx.actor_email ?? null,
    actor_role: ctx.actor_role ?? null,
    target_type: targetType,
    target_id: targetId,
    metadata: meta ?? {},
    ip_address: ctx.ip_address ?? null,
    user_agent: ctx.user_agent ?? null,
    request_path: ctx.request_path ?? null,
    actor_organization_id: ctx.actor_organization_id ?? null,
    resource_owner_organization_id: ctx.resource_owner_organization_id ?? null,
  });
}

/**
 * Log an admin action.
 */
export async function auditAdmin(
  action: AuditAction,
  description: string,
  ctx: AuditContext,
  targetType?: string | null,
  targetId?: string | null,
  meta?: Record<string, unknown>,
): Promise<string | null> {
  return writeAuditLog({
    category: 'admin',
    action,
    description,
    actor_id: ctx.actor_id ?? null,
    actor_email: ctx.actor_email ?? null,
    actor_role: ctx.actor_role ?? null,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    metadata: meta ?? {},
    ip_address: ctx.ip_address ?? null,
    user_agent: ctx.user_agent ?? null,
    request_path: ctx.request_path ?? null,
    actor_organization_id: ctx.actor_organization_id ?? null,
    resource_owner_organization_id: ctx.resource_owner_organization_id ?? null,
  });
}

/**
 * Log a security event (rate limit, suspicious activity, etc.).
 */
export async function auditSecurity(
  action: AuditAction,
  description: string,
  ctx: Partial<AuditContext>,
  meta?: Record<string, unknown>,
): Promise<string | null> {
  return writeAuditLog({
    category: 'security',
    action,
    description,
    actor_id: ctx.actor_id ?? null,
    actor_email: ctx.actor_email ?? null,
    actor_role: ctx.actor_role ?? null,
    target_type: null,
    target_id: null,
    metadata: meta ?? {},
    ip_address: ctx.ip_address ?? null,
    user_agent: ctx.user_agent ?? null,
    request_path: ctx.request_path ?? null,
    actor_organization_id: ctx.actor_organization_id ?? null,
    resource_owner_organization_id: ctx.resource_owner_organization_id ?? null,
  });
}

/**
 * Log a compliance event (data export, deletion, consent).
 */
export async function auditCompliance(
  action: AuditAction,
  description: string,
  ctx: AuditContext,
  targetType: string,
  targetId: string,
  meta?: Record<string, unknown>,
): Promise<string | null> {
  return writeAuditLog({
    category: 'compliance',
    action,
    description,
    actor_id: ctx.actor_id ?? null,
    actor_email: ctx.actor_email ?? null,
    actor_role: ctx.actor_role ?? null,
    target_type: targetType,
    target_id: targetId,
    metadata: meta ?? {},
    ip_address: ctx.ip_address ?? null,
    user_agent: ctx.user_agent ?? null,
    request_path: ctx.request_path ?? null,
    actor_organization_id: ctx.actor_organization_id ?? null,
    resource_owner_organization_id: ctx.resource_owner_organization_id ?? null,
  });
}

// ── Organization Authority Audit (Phase 1B.1, ADR-013, T-08, T-12) ───────

export interface OrgAuditContext {
  actor_id: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_organization_id: string | null;
  resource_owner_organization_id: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  request_path?: string | null;
}

/**
 * Fail-closed audit for organization authority mutations.
 *
 * Unlike the fire-and-forget convenience wrappers, this function THROWS
 * if the audit log write fails. This is required for authority mutations
 * (member removal, role change, org archive/suspend) where the audit trail
 * is mandatory — silently losing the audit record would be a compliance
 * violation (T-12, T-08).
 *
 * The caller should wrap the mutation AND this call in a transaction, or
 * call this AFTER a successful mutation and roll back if it throws.
 * In practice, the route handlers call this after the service-layer mutation
 * succeeds; if the audit fails, the route returns a 500 error (the mutation
 * is already committed, but the audit failure is surfaced and logged).
 *
 * @returns The entry hash (non-null on success)
 * @throws Error if the audit log write fails
 */
export async function auditOrgAuthorityEvent(
  action: AuditAction,
  description: string,
  ctx: OrgAuditContext,
  targetType: string | null,
  targetId: string | null,
  meta?: Record<string, unknown>,
): Promise<string> {
  const entryHash = await writeAuditLog({
    category: 'admin',
    action,
    description,
    actor_id: ctx.actor_id,
    actor_email: ctx.actor_email,
    actor_role: ctx.actor_role,
    target_type: targetType,
    target_id: targetId,
    metadata: meta ?? {},
    ip_address: ctx.ip_address ?? null,
    user_agent: ctx.user_agent ?? null,
    request_path: ctx.request_path ?? null,
    actor_organization_id: ctx.actor_organization_id,
    resource_owner_organization_id: ctx.resource_owner_organization_id,
  });

  if (entryHash === null) {
    // Fail-closed: the audit write failed (writeAuditLog fell back to console).
    // For authority mutations, we must not silently swallow this.
    throw new Error(
      `AUDIT_WRITE_FAILED: Failed to persist audit log entry for action '${action}'. ` +
      `Authority mutation audit trail is mandatory (ADR-013, T-08, T-12).`
    );
  }

  return entryHash;
}

// ─── Chain Verification ─────────────────────────────────────────────────────

export interface ChainVerificationResult {
  valid: boolean;
  totalEntries: number;
  brokenLinks: Array<{
    entry_id: string;
    timestamp: string;
    expected_prev_hash: string;
    actual_prev_hash: string;
  }>;
  tamperedEntries: Array<{
    entry_id: string;
    timestamp: string;
    expected_hash: string;
    actual_hash: string;
  }>;
}

/**
 * Verify the integrity of the audit log hash chain.
 * Recomputes all hashes and checks:
 *   1. Each entry's prev_hash matches the previous entry's entry_hash
 *   2. Each entry's entry_hash matches the recomputed hash
 *
 * Any mismatch indicates tampering or corruption.
 *
 * ⚠️ This is an expensive operation on large tables — use sparingly
 *    (e.g., quarterly compliance review, post-incident investigation).
 */
export async function verifyAuditChain(
  since?: Date,
  orgId?: string | null,
): Promise<ChainVerificationResult> {
  const sql = await getDbWithRetry();

  // Per-org chain partition (ADR-013): when orgId is provided, verify only
  // that org's chain. When orgId is null, verify the platform-level chain.
  // When orgId is undefined, verify all chains (backward-compatible behavior).
  // Per-org chain partition (ADR-013): when orgId is provided, verify only
  // that org's chain. When orgId is null, verify the platform-level chain.
  // When orgId is undefined, verify all chains (backward-compatible behavior).
  //
  // We use the static-SQL pattern (same as queryAuditLog) with
  // (${value ?? null}::type IS NULL OR ...) predicates instead of dynamic
  // WHERE fragments. This avoids composable SQL fragment issues with the
  // Neon mock/test driver while remaining production-safe.

  const sinceIso = since ? since.toISOString() : null;
  // orgFilterParam: when orgId is undefined (verify all), use null so the
  // org predicate is always true. When orgId is null (platform chain), we
  // need WHERE actor_organization_id IS NULL — handled via a separate boolean
  // predicate below. When orgId is a string, filter by that org.
  const orgFilterParam = orgId === undefined ? null : orgId;
  const platformOnly = orgId === null; // true only when explicitly null

  const rows = await sql`
    SELECT id, timestamp, category, action,
           actor_id, actor_email, actor_role,
           target_type, target_id,
           description, metadata,
           ip_address, user_agent, request_path,
           actor_organization_id, resource_owner_organization_id,
           prev_hash, entry_hash
    FROM audit_log
    WHERE (${orgFilterParam ?? null}::uuid IS NULL OR actor_organization_id = ${orgFilterParam ?? null}::uuid)
      AND (${platformOnly} = false OR actor_organization_id IS NULL)
      AND (${sinceIso ?? null}::timestamptz IS NULL OR timestamp >= ${sinceIso ?? null}::timestamptz)
    ORDER BY timestamp ASC
  ` as any[];

  const result: ChainVerificationResult = {
    valid: true,
    totalEntries: rows.length,
    brokenLinks: [],
    tamperedEntries: [],
  };

  if (rows.length === 0) return result;

  // First entry should have prev_hash = null (or the last hash before 'since')
  if (since && rows[0].prev_hash !== null) {
    // When verifying a slice, the first entry's prev_hash can be non-null
    // (it chains to an entry before the 'since' date). This is acceptable.
  } else if (!since && rows[0].prev_hash !== null) {
    result.valid = false;
    result.brokenLinks.push({
      entry_id: String(rows[0].id),
      timestamp: rows[0].timestamp,
      expected_prev_hash: 'null',
      actual_prev_hash: rows[0].prev_hash,
    });
  }

  let prevEntryHash: string | null = rows[0].prev_hash;

  for (const row of rows) {
    // Check prev_hash chain linkage
    if (row.prev_hash !== prevEntryHash) {
      result.valid = false;
      result.brokenLinks.push({
        entry_id: String(row.id),
        timestamp: row.timestamp,
        expected_prev_hash: prevEntryHash ?? 'null',
        actual_prev_hash: row.prev_hash,
      });
    }

    // Verify entry_hash by recomputing
    // Normalize timestamp: pg driver returns timestamptz as JS Date objects,
    // but writeAuditLog computed the hash using the ISO string representation.
    // We must match the exact format used at write time to avoid false tamper alerts.
    const rowTimestamp = row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : String(row.timestamp);
    const recomputedHash = computeEntryHash({
      timestamp: rowTimestamp,
      category: row.category,
      action: row.action,
      actor_id: row.actor_id,
      actor_email: row.actor_email,
      actor_role: row.actor_role,
      target_type: row.target_type,
      target_id: row.target_id,
      description: row.description,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {},
      ip_address: row.ip_address,
      user_agent: row.user_agent,
      request_path: row.request_path,
      actor_organization_id: row.actor_organization_id ?? null,
      resource_owner_organization_id: row.resource_owner_organization_id ?? null,
      prev_hash: row.prev_hash,
    });

    if (row.entry_hash !== recomputedHash) {
      result.valid = false;
      result.tamperedEntries.push({
        entry_id: String(row.id),
        timestamp: row.timestamp,
        expected_hash: recomputedHash,
        actual_hash: row.entry_hash,
      });
    }

    prevEntryHash = row.entry_hash;
  }

  return result;
}

// ─── Query Utilities ─────────────────────────────────────────────────────────

export interface AuditLogQueryOptions {
  category?: AuditCategory;
  action?: AuditAction;
  actor_id?: string;
  target_type?: string;
  target_id?: string;
  actor_organization_id?: string;          // Filter by actor's org (ADR-013)
  resource_owner_organization_id?: string; // Filter by resource-owning org
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Query audit log entries with filtering. Used for compliance reviews,
 * incident investigation, and SOC 2 evidence collection.
 *
 * Supports tenant-scoped queries via actor_organization_id and
 * resource_owner_organization_id filters (ADR-013, T-08).
 */
export async function queryAuditLog(
  options: AuditLogQueryOptions = {},
): Promise<Array<AuditLogEntry>> {
  const sql = await getDbWithRetry();
  const {
    category, action, actor_id, target_type, target_id,
    actor_organization_id, resource_owner_organization_id,
    since, until, limit = 100, offset = 0,
  } = options;

  const rows = await sql`
    SELECT id, timestamp, category, action,
           actor_id, actor_email, actor_role,
           target_type, target_id,
           description, metadata,
           ip_address, user_agent, request_path,
           actor_organization_id, resource_owner_organization_id,
           prev_hash, entry_hash
    FROM audit_log
    WHERE (${category ?? null}::text IS NULL OR category = ${category})
      AND (${action ?? null}::text IS NULL OR action = ${action})
      AND (${actor_id ?? null}::text IS NULL OR actor_id = ${actor_id})
      AND (${target_type ?? null}::text IS NULL OR target_type = ${target_type})
      AND (${target_id ?? null}::text IS NULL OR target_id = ${target_id})
      AND (${actor_organization_id ?? null}::uuid IS NULL OR actor_organization_id = ${actor_organization_id}::uuid)
      AND (${resource_owner_organization_id ?? null}::uuid IS NULL OR resource_owner_organization_id = ${resource_owner_organization_id}::uuid)
      AND (${since ?? null}::timestamptz IS NULL OR timestamp >= ${since?.toISOString()}::timestamptz)
      AND (${until ?? null}::timestamptz IS NULL OR timestamp <= ${until?.toISOString()}::timestamptz)
    ORDER BY timestamp DESC
    LIMIT ${limit} OFFSET ${offset}
  ` as any[];

  return rows.map(row => ({
    id: String(row.id),
    timestamp: row.timestamp,
    category: row.category as AuditCategory,
    action: row.action as AuditAction,
    actor_id: row.actor_id,
    actor_email: row.actor_email,
    actor_role: row.actor_role,
    target_type: row.target_type,
    target_id: row.target_id,
    description: row.description,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata ?? {},
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    request_path: row.request_path,
    actor_organization_id: row.actor_organization_id ?? null,
    resource_owner_organization_id: row.resource_owner_organization_id ?? null,
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
  }));
}
