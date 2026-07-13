// lib/mfaEnrollment.ts
//
// Canonical MFA-enrollment DB lookup — the SINGLE source of truth for "is this
// account enrolled in MFA" and "what is its encrypted TOTP secret", reading the
// exact same columns the Settings Security page uses:
//   users.mfa_enabled  + users.mfa_secret_encrypted
// (written by app/api/auth/mfa/setup, read by app/api/auth/me and
//  app/api/auth/mfa/verify).
//
// This is NOT frozen MFA logic — it performs no crypto and defines no
// enrollment/verification policy. It is only the account lookup, centralized so
// that migration readiness and the migration fresh-TOTP gate resolve enrollment
// from the SAME account record as the rest of the product. The crypto
// (encrypt/decrypt/generate/verify TOTP) remains entirely in the frozen
// lib/mfa.ts and is untouched.
//
// Historical bug this fixes: migration readiness + verifyFreshTotp read a
// non-canonical `admin_users.totp_secret_encrypted` table that no migration
// creates (test-only fiction). In production that table does not exist, so the
// lookup threw / returned nothing and MFA read as "not enrolled" even for an
// account whose Security page shows MFA Active.

import { neon } from '@neondatabase/serverless';

function getRawSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set — cannot resolve MFA enrollment.');
  return neon(url);
}

export interface MfaEnrollment {
  /** Enrolled per the canonical signal: mfa_enabled = true AND a secret exists. */
  enrolled: boolean;
  /** The AES-256-GCM encrypted TOTP secret (never decrypted here). */
  secretEncrypted: string | null;
}

/**
 * Resolve an account's MFA enrollment from the canonical `users` record.
 * Returns { enrolled:false, secretEncrypted:null } when the row is missing or
 * unenrolled. Throws only on a genuine DB error (callers decide fail-closed).
 */
export async function getMfaEnrollment(userId: string): Promise<MfaEnrollment> {
  const sql = getRawSql();
  const rows = (await sql`
    SELECT mfa_enabled, mfa_secret_encrypted
    FROM users WHERE id = ${userId} LIMIT 1
  `) as Array<{ mfa_enabled: boolean | null; mfa_secret_encrypted: string | null }>;
  const row = rows[0];
  return {
    enrolled: row?.mfa_enabled === true && !!row?.mfa_secret_encrypted,
    secretEncrypted: row?.mfa_secret_encrypted ?? null,
  };
}

/**
 * Boolean enrollment signal for a user. Read-only; returns false on any error
 * (fail-closed) and for a null/absent id.
 */
export async function isMfaEnrolled(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await getMfaEnrollment(userId)).enrolled;
  } catch {
    return false;
  }
}
