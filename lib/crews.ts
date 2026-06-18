/**
 * lib/crews.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Type definitions and pure validation helpers for the Crew + CrewMember
 * domain.  Database I/O is intentionally NOT in this file — it lives in the
 * API routes so tests can run without a real database connection.
 *
 * DB schema (established by Migration 041):
 *
 *   crews (id, user_id, name, color, created_at)
 *
 *   crew_members (
 *     id, crew_id, user_id, name, role,
 *     phone, email, certifications TEXT[],
 *     is_lead BOOLEAN, notes,
 *     created_at, updated_at
 *   )
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** All recognised member roles in the crews domain. */
export const CREW_MEMBER_ROLES = [
  'lead_installer',
  'installer',
  'apprentice',
  'electrician',
  'project_manager',
  'inspector',
  'laborer',
  'other',
] as const;

export type CrewMemberRole = typeof CREW_MEMBER_ROLES[number];

/** Known solar/electrical certifications relevant to installation crews. */
export const KNOWN_CERTIFICATIONS = [
  'NABCEP PV Installation Professional',
  'NABCEP PV Technical Sales',
  'NABCEP PV Associate',
  'OSHA 10',
  'OSHA 30',
  'OSHA 10 Construction',
  'OSHA 30 Construction',
  'Journeyman Electrician',
  'Master Electrician',
  'Electrician Apprentice',
  'First Aid/CPR',
  'Fall Protection',
  'Aerial Work Platform',
  'Forklift',
  'Confined Space Entry',
  'Arc Flash Safety',
  'EV Charging Installation',
  'Battery Storage Systems',
] as const;

/** Member types — an employee (your W2 crew) or a subcontractor (hired per trade). */
export const MEMBER_TYPES = ['employee', 'subcontractor'] as const;
export type MemberType = typeof MEMBER_TYPES[number];

/** Known subcontractor trades (soft enum — free text allowed). */
export const SUBCONTRACTOR_TRADES = [
  'electrical',
  'roofing',
  'structural',
  'hvac',
  'general',
  'crane',
  'other',
] as const;

/** Hard limits to guard against abnormally large inputs. */
export const CREW_LIMITS = {
  MAX_COMPANY_LEN: 160,
  MAX_TRADE_LEN: 60,
  MAX_ISSUER_LEN: 160,
  MAX_NAME_LEN: 120,
  MAX_ROLE_LEN: 80,
  MAX_PHONE_LEN: 30,
  MAX_EMAIL_LEN: 254,
  MAX_NOTES_LEN: 2000,
  MAX_CERT_LEN: 120,
  MAX_CERTS_PER_MEMBER: 20,
  MAX_MEMBERS_PER_CREW: 50,
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single crew (team) row from the `crews` table. */
export interface Crew {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

/** A single row from the `crew_members` table. */
export interface CrewMember {
  id: string;
  crew_id: string;
  user_id: string;
  name: string;
  role: CrewMemberRole | string;
  member_type: MemberType | string;     // 'employee' | 'subcontractor'
  company: string | null;               // subcontractor company name
  trade: string | null;                 // subcontractor trade (electrical, roofing, ...)
  phone: string | null;
  email: string | null;
  certifications: string[] | null;      // legacy free-text tags (kept); structured vault = MemberCertification[]
  is_lead: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A single credential from the member_certifications vault. */
export interface MemberCertification {
  id: string;
  member_id: string;
  user_id: string;
  name: string;
  issuer: string | null;
  issued_on: string | null;   // ISO date (YYYY-MM-DD)
  expires_on: string | null;  // ISO date (YYYY-MM-DD)
  file_url: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Body for POST /api/crew-members/:id/certifications. */
export interface CreateCertificationBody {
  name: string;
  issuer?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  file_url?: string | null;
  notes?: string | null;
}

/** Expiry status for a cert — drives the badge color + the "expiring soon" alert. */
export type CertExpiryStatus = 'valid' | 'expiring_soon' | 'expired' | 'no_expiry';

/** A crew with its members list embedded (used by GET /api/crews/:id). */
export interface CrewWithMembers extends Crew {
  members: CrewMember[];
}

/** Shape expected in a POST /api/crews/:id/members request body. */
export interface CreateCrewMemberBody {
  name: string;
  role?: string;
  member_type?: string;
  company?: string | null;
  trade?: string | null;
  phone?: string | null;
  email?: string | null;
  certifications?: string[] | null;
  is_lead?: boolean;
  notes?: string | null;
}

/** Shape accepted by PATCH /api/crew-members/:memberId request body. */
export interface UpdateCrewMemberBody {
  name?: string;
  role?: string;
  member_type?: string;
  company?: string | null;
  trade?: string | null;
  phone?: string | null;
  email?: string | null;
  certifications?: string[] | null;
  is_lead?: boolean;
  notes?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when `role` is one of the canonical CREW_MEMBER_ROLES.
 * Free-text roles are accepted in the API, but callers can use this to warn
 * or surface a suggestion.
 */
export function isKnownRole(role: string): role is CrewMemberRole {
  return (CREW_MEMBER_ROLES as readonly string[]).includes(role);
}

/**
 * Validates and normalises a phone string.
 * - Strips all whitespace
 * - Rejects strings longer than CREW_LIMITS.MAX_PHONE_LEN
 * - Returns { ok: true, value } or { ok: false, error }
 */
export function normalisePhone(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const stripped = raw.replace(/\s+/g, '');
  if (stripped.length > CREW_LIMITS.MAX_PHONE_LEN) {
    return { ok: false, error: `phone too long (max ${CREW_LIMITS.MAX_PHONE_LEN} chars)` };
  }
  return { ok: true, value: stripped };
}

/** Basic email format check — RFC-5321 simplified. */
export function isValidEmail(email: string): boolean {
  if (email.length > CREW_LIMITS.MAX_EMAIL_LEN) return false;
  // Must contain exactly one @ with non-empty local and domain parts
  const atIdx = email.indexOf('@');
  if (atIdx <= 0) return false;
  const domain = email.slice(atIdx + 1);
  if (!domain || !domain.includes('.')) return false;
  return true;
}

/**
 * Validates the full CreateCrewMemberBody payload.
 * Returns `null` on success or a human-readable error string on failure.
 */
export function validateCreateMember(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';
  const b = body as Record<string, unknown>;

  // name — required, non-empty, length-capped
  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) {
    return 'name is required.';
  }
  if (b.name.trim().length > CREW_LIMITS.MAX_NAME_LEN) {
    return `name too long (max ${CREW_LIMITS.MAX_NAME_LEN} chars).`;
  }

  // role — optional, but length-capped when present
  if (b.role !== undefined) {
    if (typeof b.role !== 'string') return 'role must be a string.';
    if (b.role.trim().length > CREW_LIMITS.MAX_ROLE_LEN) {
      return `role too long (max ${CREW_LIMITS.MAX_ROLE_LEN} chars).`;
    }
  }

  // phone — optional, validated when present
  if (b.phone !== undefined && b.phone !== null) {
    if (typeof b.phone !== 'string') return 'phone must be a string or null.';
    const res = normalisePhone(b.phone);
    if (!res.ok) return (res as { ok: false; error: string }).error;
  }

  // email — optional, validated when present
  if (b.email !== undefined && b.email !== null) {
    if (typeof b.email !== 'string') return 'email must be a string or null.';
    if (!isValidEmail(b.email)) return 'email format is invalid.';
  }

  // certifications — optional array of strings
  if (b.certifications !== undefined && b.certifications !== null) {
    if (!Array.isArray(b.certifications)) return 'certifications must be an array or null.';
    if (b.certifications.length > CREW_LIMITS.MAX_CERTS_PER_MEMBER) {
      return `too many certifications (max ${CREW_LIMITS.MAX_CERTS_PER_MEMBER}).`;
    }
    for (const cert of b.certifications) {
      if (typeof cert !== 'string') return 'each certification must be a string.';
      if (cert.trim().length === 0) return 'certification entries cannot be blank.';
      if (cert.trim().length > CREW_LIMITS.MAX_CERT_LEN) {
        return `certification entry too long (max ${CREW_LIMITS.MAX_CERT_LEN} chars).`;
      }
    }
  }

  // member_type — optional, must be a known type when present
  if (b.member_type !== undefined && b.member_type !== null) {
    if (typeof b.member_type !== 'string') return 'member_type must be a string.';
    if (!(MEMBER_TYPES as readonly string[]).includes(b.member_type)) {
      return `member_type must be one of: ${MEMBER_TYPES.join(', ')}.`;
    }
  }

  // company — optional (subcontractors), length-capped
  if (b.company !== undefined && b.company !== null) {
    if (typeof b.company !== 'string') return 'company must be a string or null.';
    if (b.company.trim().length > CREW_LIMITS.MAX_COMPANY_LEN) {
      return `company too long (max ${CREW_LIMITS.MAX_COMPANY_LEN} chars).`;
    }
  }

  // trade — optional (subcontractors), length-capped
  if (b.trade !== undefined && b.trade !== null) {
    if (typeof b.trade !== 'string') return 'trade must be a string or null.';
    if (b.trade.trim().length > CREW_LIMITS.MAX_TRADE_LEN) {
      return `trade too long (max ${CREW_LIMITS.MAX_TRADE_LEN} chars).`;
    }
  }

  // is_lead — optional boolean
  if (b.is_lead !== undefined && b.is_lead !== null) {
    if (typeof b.is_lead !== 'boolean') return 'is_lead must be a boolean.';
  }

  // notes — optional, length-capped
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'string') return 'notes must be a string or null.';
    if (b.notes.length > CREW_LIMITS.MAX_NOTES_LEN) {
      return `notes too long (max ${CREW_LIMITS.MAX_NOTES_LEN} chars).`;
    }
  }

  return null; // all good
}

/**
 * Validates the UpdateCrewMemberBody payload (PATCH semantics — all fields
 * are optional but at least one must be present).
 * Returns `null` on success or an error string.
 */
export function validateUpdateMember(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';

  const b = body as Record<string, unknown>;
  const keys = Object.keys(b);
  if (keys.length === 0) return 'At least one field must be provided for update.';

  // Delegate individual field checks by constructing a merged object
  const merged: Record<string, unknown> = { name: 'placeholder', ...b };
  // name — if provided, validate
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || !b.name.trim()) return 'name cannot be blank.';
    if (b.name.trim().length > CREW_LIMITS.MAX_NAME_LEN) {
      return `name too long (max ${CREW_LIMITS.MAX_NAME_LEN} chars).`;
    }
  }
  // reuse create validator for all other fields (skip name check)
  const { name: _name, ...rest } = merged;
  void _name; // suppress unused-var lint
  const tempBody: Record<string, unknown> = { name: 'x', ...rest };
  const err = validateCreateMember(tempBody);
  if (err && err !== 'name is required.') return err;
  return null;
}

/**
 * Sanitises a CreateCrewMemberBody — trims strings, normalises phone,
 * lowercases email, deduplicates certifications.
 * Assumes `validateCreateMember` has already returned null.
 */
export function sanitiseCreateMember(body: CreateCrewMemberBody): Required<CreateCrewMemberBody> {
  const certs = (body.certifications ?? [])
    .map((c: string) => c.trim())
    .filter((c: string, i: number, arr: string[]) => c && arr.indexOf(c) === i); // dedup

  const phone = body.phone
    ? normalisePhone(body.phone)
    : null;

  const memberType: MemberType = body.member_type === 'subcontractor' ? 'subcontractor' : 'employee';

  return {
    name: body.name.trim(),
    role: (body.role ?? 'installer').trim() || 'installer',
    member_type: memberType,
    company: body.company?.trim() || null,
    trade: body.trade?.trim() || null,
    phone: phone && phone.ok ? phone.value : null,
    email: body.email ? body.email.toLowerCase().trim() : null,
    certifications: certs.length > 0 ? certs : null,
    is_lead: body.is_lead ?? false,
    notes: body.notes?.trim() || null,
  };
}

/**
 * Builds a partial update object from UpdateCrewMemberBody.
 * Only includes keys that were explicitly provided (not undefined).
 * Phone is normalised; email is lowercased; certifications are deduped.
 */
export function buildMemberUpdate(
  body: UpdateCrewMemberBody,
): Partial<Omit<CrewMember, 'id' | 'crew_id' | 'user_id' | 'created_at' | 'updated_at'>> {
  const update: Record<string, unknown> = {};

  if (body.name !== undefined) update.name = body.name.trim();
  if (body.role !== undefined) update.role = body.role.trim() || 'installer';
  if (body.phone !== undefined) {
    if (body.phone === null) {
      update.phone = null;
    } else {
      const res = normalisePhone(body.phone);
      update.phone = res.ok ? res.value : null;
    }
  }
  if (body.email !== undefined) {
    update.email = body.email ? body.email.toLowerCase().trim() : null;
  }
  if (body.certifications !== undefined) {
    if (body.certifications === null) {
      update.certifications = null;
    } else {
      const certs = body.certifications
        .map((c: string) => c.trim())
        .filter((c: string, i: number, arr: string[]) => c && arr.indexOf(c) === i);
      update.certifications = certs.length > 0 ? certs : null;
    }
  }
  if (body.member_type !== undefined) {
    update.member_type = body.member_type === 'subcontractor' ? 'subcontractor' : 'employee';
  }
  if (body.company !== undefined) update.company = body.company?.trim() || null;
  if (body.trade !== undefined) update.trade = body.trade?.trim() || null;
  if (body.is_lead !== undefined) update.is_lead = body.is_lead;
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null;

  return update as Partial<Omit<CrewMember, 'id' | 'crew_id' | 'user_id' | 'created_at' | 'updated_at'>>;
}

/**
 * Returns a display label for a role string.
 * Falls back to title-casing the raw value for unknown roles.
 */
export function formatRole(role: string): string {
  const labels: Record<string, string> = {
    lead_installer: 'Lead Installer',
    installer: 'Installer',
    apprentice: 'Apprentice',
    electrician: 'Electrician',
    project_manager: 'Project Manager',
    inspector: 'Inspector',
    laborer: 'Laborer',
    other: 'Other',
  };
  return labels[role] ?? role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ─────────────────────────────────────────────────────────────────────────────
// Certification vault helpers
// ─────────────────────────────────────────────────────────────────────────────

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a CreateCertificationBody. Returns null on success, else an error string. */
export function validateCreateCertification(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object.';
  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== 'string' || !b.name.trim()) return 'name is required.';
  if (b.name.trim().length > CREW_LIMITS.MAX_CERT_LEN) {
    return `name too long (max ${CREW_LIMITS.MAX_CERT_LEN} chars).`;
  }
  if (b.issuer !== undefined && b.issuer !== null) {
    if (typeof b.issuer !== 'string') return 'issuer must be a string or null.';
    if (b.issuer.trim().length > CREW_LIMITS.MAX_ISSUER_LEN) {
      return `issuer too long (max ${CREW_LIMITS.MAX_ISSUER_LEN} chars).`;
    }
  }
  for (const k of ['issued_on', 'expires_on'] as const) {
    if (b[k] !== undefined && b[k] !== null) {
      if (typeof b[k] !== 'string' || !ISO_DATE_RE.test(b[k] as string)) {
        return `${k} must be an ISO date (YYYY-MM-DD) or null.`;
      }
    }
  }
  if (b.file_url !== undefined && b.file_url !== null && typeof b.file_url !== 'string') {
    return 'file_url must be a string or null.';
  }
  if (b.notes !== undefined && b.notes !== null) {
    if (typeof b.notes !== 'string') return 'notes must be a string or null.';
    if (b.notes.length > CREW_LIMITS.MAX_NOTES_LEN) return `notes too long (max ${CREW_LIMITS.MAX_NOTES_LEN} chars).`;
  }
  return null;
}

/**
 * Classifies a cert by its expiry date relative to `now`.
 * 'expiring_soon' = expires within `soonDays` (default 60) — the loss-aversion nudge.
 * Pure + deterministic (caller passes nowMs so it's testable / SSR-safe).
 */
export function certExpiryStatus(
  expiresOn: string | null | undefined,
  nowMs: number,
  soonDays = 60,
): CertExpiryStatus {
  if (!expiresOn || !ISO_DATE_RE.test(expiresOn)) return 'no_expiry';
  const exp = Date.parse(`${expiresOn}T00:00:00Z`);
  if (Number.isNaN(exp)) return 'no_expiry';
  const days = (exp - nowMs) / 86_400_000;
  if (days < 0) return 'expired';
  if (days <= soonDays) return 'expiring_soon';
  return 'valid';
}
