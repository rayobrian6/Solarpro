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
  | 'migration_transaction_mode_review_required';

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
    entry.prev_hash ?? '',
  ].join('|');

  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Fetches the most recent audit log entry's hash for chain continuation.
 * Returns null if no entries exist (first entry in chain).
 */
async function getLatestHash(): Promise<string | null> {
  try {
    const sql = await getDbWithRetry();
    const rows = await sql`
      SELECT entry_hash FROM audit_log
      ORDER BY timestamp DESC
      LIMIT 1
    `;
    return (rows[0] as any)?.entry_hash ?? null;
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
 *   - Chains to the previous entry via SHA-256 hash
 *   - Computes and stores its own hash for future chain verification
 *   - Handles missing audit_log table gracefully (falls back to console)
 *
 * @returns The entry hash on success, null on failure (never throws)
 */
export async function writeAuditLog(
  entry: Omit<AuditLogEntry, 'id' | 'prev_hash' | 'entry_hash' | 'timestamp'>,
  timestamp?: Date,
): Promise<string | null> {
  const ts = timestamp ?? new Date();
  const isoTimestamp = ts.toISOString();

  // Redact sensitive metadata before storage
  const safeMetadata = redactMetadata(entry.metadata ?? {});

  const prevHash = await getLatestHash();

  const fullEntry: Omit<AuditLogEntry, 'id' | 'entry_hash'> = {
    timestamp: isoTimestamp,
    category: entry.category,
    action: entry.action,
    actor_id: entry.actor_id ?? null,
    actor_email: entry.actor_email ?? null,
    actor_role: entry.actor_role ?? null,
    target_type: entry.target_type ?? null,
    target_id: entry.target_id ?? null,
    description: entry.description,
    metadata: safeMetadata,
    ip_address: entry.ip_address ?? null,
    user_agent: entry.user_agent ?? null,
    request_path: entry.request_path ?? null,
    prev_hash: prevHash,
  };

  const entryHash = computeEntryHash(fullEntry);

  try {
    const sql = await getDbWithRetry();
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
        ${entry.description}, ${JSON.stringify(safeMetadata)}::jsonb,
        ${fullEntry.ip_address}, ${fullEntry.user_agent}, ${fullEntry.request_path},
        ${prevHash}, ${entryHash}
      )
    `;
    return entryHash;
  } catch (err: unknown) {
    // Fallback to console logging if DB write fails
    // This ensures audit events are never silently lost
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[AUDIT_LOG_WRITE_ERROR]', msg);
    console.error('[AUDIT_LOG_FALLBACK]', JSON.stringify({
      ...fullEntry,
      entry_hash: entryHash,
    }));
    return null;
  }
}

// ─── Convenience Wrappers ────────────────────────────────────────────────────

interface AuditContext {
  actor_id?: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
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
  });
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
): Promise<ChainVerificationResult> {
  const sql = await getDbWithRetry();

  const sinceClause = since
    ? sql`WHERE timestamp >= ${since.toISOString()}::timestamptz`
    : sql``;

  const rows = await sql`
    SELECT id, timestamp, category, action,
           actor_id, actor_email, actor_role,
           target_type, target_id,
           description, metadata,
           ip_address, user_agent, request_path,
           prev_hash, entry_hash
    FROM audit_log
    ${sinceClause}
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
    const recomputedHash = computeEntryHash({
      timestamp: row.timestamp,
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
  since?: Date;
  until?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Query audit log entries with filtering. Used for compliance reviews,
 * incident investigation, and SOC 2 evidence collection.
 */
export async function queryAuditLog(
  options: AuditLogQueryOptions = {},
): Promise<Array<AuditLogEntry>> {
  const sql = await getDbWithRetry();
  const { category, action, actor_id, target_type, target_id, since, until, limit = 100, offset = 0 } = options;

  const rows = await sql`
    SELECT * FROM audit_log
    WHERE (${category ?? null}::text IS NULL OR category = ${category})
      AND (${action ?? null}::text IS NULL OR action = ${action})
      AND (${actor_id ?? null}::text IS NULL OR actor_id = ${actor_id})
      AND (${target_type ?? null}::text IS NULL OR target_type = ${target_type})
      AND (${target_id ?? null}::text IS NULL OR target_id = ${target_id})
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
    prev_hash: row.prev_hash,
    entry_hash: row.entry_hash,
  }));
}
