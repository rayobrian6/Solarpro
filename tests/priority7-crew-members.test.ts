// ────────────────────────────────────────────────────────────────────────────
// Priority 7: Crew Members — individual crew member records
//
// Tests cover:
//   1. Type contract — CREW_MEMBER_ROLES and KNOWN_CERTIFICATIONS arrays
//   2. isKnownRole — recognition of canonical roles
//   3. normalisePhone — stripping whitespace and length validation
//   4. isValidEmail — RFC-5321 simplified validation
//   5. validateCreateMember — full payload validation (positive + negative cases)
//   6. validateUpdateMember — PATCH semantic validation
//   7. sanitiseCreateMember — trimming, dedup, normalisation
//   8. buildMemberUpdate — partial update object construction
//   9. formatRole — human-readable role labels
//  10. DB migration source — Migration 041 blocks exist in migrate/route.ts
//  11. API route source — crew member endpoints exist with correct patterns
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  CREW_MEMBER_ROLES,
  KNOWN_CERTIFICATIONS,
  CREW_LIMITS,
  isKnownRole,
  normalisePhone,
  isValidEmail,
  validateCreateMember,
  validateUpdateMember,
  sanitiseCreateMember,
  buildMemberUpdate,
  formatRole,
  type CrewMemberRole,
  type CreateCrewMemberBody,
  type UpdateCrewMemberBody,
} from '../lib/crews';

// ─── helpers ─────────────────────────────────────────────────────────────────

function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. CREW_MEMBER_ROLES constant
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — CREW_MEMBER_ROLES constant', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(CREW_MEMBER_ROLES)).toBe(true);
    expect(CREW_MEMBER_ROLES.length).toBeGreaterThanOrEqual(5);
  });

  it('contains the core solar roles', () => {
    const roles = CREW_MEMBER_ROLES as readonly string[];
    expect(roles).toContain('installer');
    expect(roles).toContain('lead_installer');
    expect(roles).toContain('apprentice');
    expect(roles).toContain('electrician');
    expect(roles).toContain('project_manager');
  });

  it('has no duplicate role values', () => {
    const set = new Set(CREW_MEMBER_ROLES);
    expect(set.size).toBe(CREW_MEMBER_ROLES.length);
  });

  it('every role is a non-empty lowercase underscore-separated string', () => {
    for (const role of CREW_MEMBER_ROLES) {
      expect(role).toMatch(/^[a-z][a-z_]*$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. KNOWN_CERTIFICATIONS constant
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — KNOWN_CERTIFICATIONS constant', () => {
  it('is a non-empty readonly array', () => {
    expect(Array.isArray(KNOWN_CERTIFICATIONS)).toBe(true);
    expect(KNOWN_CERTIFICATIONS.length).toBeGreaterThanOrEqual(5);
  });

  it('contains NABCEP credentials', () => {
    const certs = KNOWN_CERTIFICATIONS as readonly string[];
    expect(certs.some(c => c.includes('NABCEP'))).toBe(true);
  });

  it('contains OSHA certifications', () => {
    const certs = KNOWN_CERTIFICATIONS as readonly string[];
    expect(certs.some(c => c.includes('OSHA'))).toBe(true);
  });

  it('has no duplicate entries', () => {
    const set = new Set(KNOWN_CERTIFICATIONS);
    expect(set.size).toBe(KNOWN_CERTIFICATIONS.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. CREW_LIMITS constants
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — CREW_LIMITS constants', () => {
  it('MAX_NAME_LEN is at least 60', () => {
    expect(CREW_LIMITS.MAX_NAME_LEN).toBeGreaterThanOrEqual(60);
  });

  it('MAX_PHONE_LEN is at least 15', () => {
    expect(CREW_LIMITS.MAX_PHONE_LEN).toBeGreaterThanOrEqual(15);
  });

  it('MAX_EMAIL_LEN is at least 100', () => {
    expect(CREW_LIMITS.MAX_EMAIL_LEN).toBeGreaterThanOrEqual(100);
  });

  it('MAX_CERTS_PER_MEMBER is between 5 and 30', () => {
    expect(CREW_LIMITS.MAX_CERTS_PER_MEMBER).toBeGreaterThanOrEqual(5);
    expect(CREW_LIMITS.MAX_CERTS_PER_MEMBER).toBeLessThanOrEqual(30);
  });

  it('MAX_MEMBERS_PER_CREW is between 10 and 100', () => {
    expect(CREW_LIMITS.MAX_MEMBERS_PER_CREW).toBeGreaterThanOrEqual(10);
    expect(CREW_LIMITS.MAX_MEMBERS_PER_CREW).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. isKnownRole
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — isKnownRole()', () => {
  it('returns true for every canonical role', () => {
    for (const role of CREW_MEMBER_ROLES) {
      expect(isKnownRole(role)).toBe(true);
    }
  });

  it('returns false for unknown roles', () => {
    expect(isKnownRole('driver')).toBe(false);
    expect(isKnownRole('INSTALLER')).toBe(false); // case-sensitive
    expect(isKnownRole('')).toBe(false);
    expect(isKnownRole('crew_boss')).toBe(false);
  });

  it('narrows type to CrewMemberRole when true', () => {
    const role: string = 'installer';
    if (isKnownRole(role)) {
      // TypeScript type-narrowing test — compile-time check
      const _typed: CrewMemberRole = role;
      expect(_typed).toBe('installer');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. normalisePhone
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — normalisePhone()', () => {
  it('strips internal whitespace', () => {
    const res = normalisePhone('(555) 867 5309');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('(555)8675309');
  });

  it('strips leading and trailing whitespace', () => {
    const res = normalisePhone('  +1-800-555-0199  ');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('+1-800-555-0199');
  });

  it('returns a string identical to input when no whitespace', () => {
    const res = normalisePhone('+18005550199');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toBe('+18005550199');
  });

  it('rejects strings longer than MAX_PHONE_LEN after stripping', () => {
    const longPhone = '1'.repeat(CREW_LIMITS.MAX_PHONE_LEN + 1);
    const res = normalisePhone(longPhone);
    expect(res.ok).toBe(false);
  });

  it('accepts phone exactly at MAX_PHONE_LEN', () => {
    const maxPhone = '1'.repeat(CREW_LIMITS.MAX_PHONE_LEN);
    const res = normalisePhone(maxPhone);
    expect(res.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. isValidEmail
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — isValidEmail()', () => {
  it('accepts valid email addresses', () => {
    expect(isValidEmail('john.doe@example.com')).toBe(true);
    expect(isValidEmail('installer+1@solarpro.io')).toBe(true);
    expect(isValidEmail('user@subdomain.example.org')).toBe(true);
  });

  it('rejects emails missing @', () => {
    expect(isValidEmail('nodomain')).toBe(false);
    expect(isValidEmail('missing.at.sign')).toBe(false);
  });

  it('rejects emails with empty local part', () => {
    expect(isValidEmail('@example.com')).toBe(false);
  });

  it('rejects emails with domain that has no dot', () => {
    expect(isValidEmail('user@localhost')).toBe(false);
  });

  it('rejects emails exceeding MAX_EMAIL_LEN', () => {
    const local = 'a'.repeat(CREW_LIMITS.MAX_EMAIL_LEN + 10);
    expect(isValidEmail(`${local}@example.com`)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. validateCreateMember — positive cases
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — validateCreateMember() — valid payloads', () => {
  it('accepts minimal payload (name only)', () => {
    expect(validateCreateMember({ name: 'John Smith' })).toBeNull();
  });

  it('accepts full valid payload', () => {
    const body: CreateCrewMemberBody = {
      name: 'Maria Garcia',
      role: 'lead_installer',
      phone: '555-867-5309',
      email: 'maria@example.com',
      certifications: ['NABCEP PV Installation Professional', 'OSHA 10'],
      is_lead: true,
      notes: 'Lead on all residential jobs.',
    };
    expect(validateCreateMember(body)).toBeNull();
  });

  it('accepts unknown/free-text role', () => {
    expect(validateCreateMember({ name: 'Tom', role: 'rigger' })).toBeNull();
  });

  it('accepts null optional fields', () => {
    expect(
      validateCreateMember({
        name: 'Alex',
        phone: null,
        email: null,
        certifications: null,
        notes: null,
      }),
    ).toBeNull();
  });

  it('accepts certifications array with one entry', () => {
    expect(
      validateCreateMember({ name: 'Jane', certifications: ['OSHA 30'] }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. validateCreateMember — negative cases
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — validateCreateMember() — invalid payloads', () => {
  it('rejects null body', () => {
    expect(validateCreateMember(null)).not.toBeNull();
  });

  it('rejects non-object body', () => {
    expect(validateCreateMember('string')).not.toBeNull();
    expect(validateCreateMember(42)).not.toBeNull();
  });

  it('rejects missing name', () => {
    expect(validateCreateMember({})).not.toBeNull();
  });

  it('rejects empty-string name', () => {
    expect(validateCreateMember({ name: '' })).not.toBeNull();
    expect(validateCreateMember({ name: '   ' })).not.toBeNull();
  });

  it('rejects name longer than MAX_NAME_LEN', () => {
    const longName = 'A'.repeat(CREW_LIMITS.MAX_NAME_LEN + 1);
    expect(validateCreateMember({ name: longName })).not.toBeNull();
  });

  it('rejects role longer than MAX_ROLE_LEN', () => {
    const longRole = 'r'.repeat(CREW_LIMITS.MAX_ROLE_LEN + 1);
    expect(validateCreateMember({ name: 'X', role: longRole })).not.toBeNull();
  });

  it('rejects invalid email format', () => {
    expect(validateCreateMember({ name: 'X', email: 'not-an-email' })).not.toBeNull();
  });

  it('rejects email with no dot in domain', () => {
    expect(validateCreateMember({ name: 'X', email: 'user@localhost' })).not.toBeNull();
  });

  it('rejects phone longer than MAX_PHONE_LEN after stripping', () => {
    const longPhone = '1'.repeat(CREW_LIMITS.MAX_PHONE_LEN + 1);
    expect(validateCreateMember({ name: 'X', phone: longPhone })).not.toBeNull();
  });

  it('rejects certifications as non-array', () => {
    expect(validateCreateMember({ name: 'X', certifications: 'OSHA 10' })).not.toBeNull();
  });

  it('rejects certifications with blank entry', () => {
    expect(validateCreateMember({ name: 'X', certifications: ['OSHA 10', ''] })).not.toBeNull();
  });

  it('rejects certifications with entry over MAX_CERT_LEN', () => {
    const longCert = 'C'.repeat(CREW_LIMITS.MAX_CERT_LEN + 1);
    expect(validateCreateMember({ name: 'X', certifications: [longCert] })).not.toBeNull();
  });

  it('rejects more than MAX_CERTS_PER_MEMBER certifications', () => {
    const certs = Array.from({ length: CREW_LIMITS.MAX_CERTS_PER_MEMBER + 1 }, (_, i) => `Cert ${i}`);
    expect(validateCreateMember({ name: 'X', certifications: certs })).not.toBeNull();
  });

  it('rejects is_lead as non-boolean', () => {
    expect(validateCreateMember({ name: 'X', is_lead: 'yes' })).not.toBeNull();
  });

  it('rejects notes longer than MAX_NOTES_LEN', () => {
    const longNotes = 'n'.repeat(CREW_LIMITS.MAX_NOTES_LEN + 1);
    expect(validateCreateMember({ name: 'X', notes: longNotes })).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. validateUpdateMember
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — validateUpdateMember()', () => {
  it('accepts a single field update', () => {
    expect(validateUpdateMember({ role: 'electrician' })).toBeNull();
    expect(validateUpdateMember({ is_lead: true })).toBeNull();
    expect(validateUpdateMember({ notes: 'Updated notes.' })).toBeNull();
  });

  it('accepts a multi-field update', () => {
    expect(
      validateUpdateMember({
        name: 'Maria G.',
        phone: '+15551234567',
        certifications: ['OSHA 10'],
      }),
    ).toBeNull();
  });

  it('rejects empty body object', () => {
    expect(validateUpdateMember({})).not.toBeNull();
  });

  it('rejects null', () => {
    expect(validateUpdateMember(null)).not.toBeNull();
  });

  it('rejects blank name when name is provided', () => {
    expect(validateUpdateMember({ name: '  ' })).not.toBeNull();
  });

  it('rejects invalid email in partial update', () => {
    expect(validateUpdateMember({ email: 'bad-email' })).not.toBeNull();
  });

  it('accepts null phone (clearing the field)', () => {
    expect(validateUpdateMember({ phone: null })).toBeNull();
  });

  it('accepts null email (clearing the field)', () => {
    expect(validateUpdateMember({ email: null })).toBeNull();
  });

  it('accepts null certifications (clearing the array)', () => {
    expect(validateUpdateMember({ certifications: null })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. sanitiseCreateMember
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — sanitiseCreateMember()', () => {
  it('trims name', () => {
    const s = sanitiseCreateMember({ name: '  John Smith  ' });
    expect(s.name).toBe('John Smith');
  });

  it('defaults role to "installer" when not provided', () => {
    const s = sanitiseCreateMember({ name: 'John' });
    expect(s.role).toBe('installer');
  });

  it('uses provided role', () => {
    const s = sanitiseCreateMember({ name: 'John', role: 'lead_installer' });
    expect(s.role).toBe('lead_installer');
  });

  it('normalises phone (strips whitespace)', () => {
    const s = sanitiseCreateMember({ name: 'John', phone: '(555) 867 5309' });
    expect(s.phone).toBe('(555)8675309');
  });

  it('lowercases email', () => {
    const s = sanitiseCreateMember({ name: 'John', email: 'John.DOE@Example.COM' });
    expect(s.email).toBe('john.doe@example.com');
  });

  it('deduplicates certifications', () => {
    const s = sanitiseCreateMember({
      name: 'John',
      certifications: ['OSHA 10', 'NABCEP PV Installation Professional', 'OSHA 10'],
    });
    expect(s.certifications).toEqual(['OSHA 10', 'NABCEP PV Installation Professional']);
  });

  it('returns null for empty certifications array', () => {
    const s = sanitiseCreateMember({ name: 'John', certifications: [] });
    expect(s.certifications).toBeNull();
  });

  it('defaults is_lead to false when not provided', () => {
    const s = sanitiseCreateMember({ name: 'John' });
    expect(s.is_lead).toBe(false);
  });

  it('preserves is_lead = true', () => {
    const s = sanitiseCreateMember({ name: 'John', is_lead: true });
    expect(s.is_lead).toBe(true);
  });

  it('converts empty notes string to null', () => {
    const s = sanitiseCreateMember({ name: 'John', notes: '   ' });
    expect(s.notes).toBeNull();
  });

  it('trims notes when provided', () => {
    const s = sanitiseCreateMember({ name: 'John', notes: '  Some note.  ' });
    expect(s.notes).toBe('Some note.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. buildMemberUpdate
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — buildMemberUpdate()', () => {
  it('includes only provided keys', () => {
    const update = buildMemberUpdate({ role: 'electrician' });
    expect(Object.keys(update)).toContain('role');
    expect(Object.keys(update)).not.toContain('name');
    expect(Object.keys(update)).not.toContain('phone');
  });

  it('trims name', () => {
    const update = buildMemberUpdate({ name: '  Maria  ' });
    expect(update.name).toBe('Maria');
  });

  it('lowercases email', () => {
    const update = buildMemberUpdate({ email: 'MARIA@Example.COM' });
    expect(update.email).toBe('maria@example.com');
  });

  it('sets email to null when explicitly nulled', () => {
    const update = buildMemberUpdate({ email: null });
    expect(update.email).toBeNull();
  });

  it('sets phone to null when explicitly nulled', () => {
    const update = buildMemberUpdate({ phone: null });
    expect(update.phone).toBeNull();
  });

  it('deduplicates certifications', () => {
    const update = buildMemberUpdate({
      certifications: ['OSHA 10', 'OSHA 10', 'First Aid/CPR'],
    });
    expect(update.certifications).toEqual(['OSHA 10', 'First Aid/CPR']);
  });

  it('sets certifications to null for empty array after dedup', () => {
    const update = buildMemberUpdate({ certifications: [] });
    expect(update.certifications).toBeNull();
  });

  it('handles null certifications (clear the array)', () => {
    const update = buildMemberUpdate({ certifications: null });
    expect(update.certifications).toBeNull();
  });

  it('includes is_lead when provided', () => {
    const update = buildMemberUpdate({ is_lead: true });
    expect(update.is_lead).toBe(true);
  });

  it('converts empty notes to null', () => {
    const update = buildMemberUpdate({ notes: '  ' });
    expect(update.notes).toBeNull();
  });

  it('returns empty object for completely empty body', () => {
    const update = buildMemberUpdate({});
    expect(Object.keys(update).length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. formatRole
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — formatRole()', () => {
  it('returns correct labels for all canonical roles', () => {
    expect(formatRole('installer')).toBe('Installer');
    expect(formatRole('lead_installer')).toBe('Lead Installer');
    expect(formatRole('apprentice')).toBe('Apprentice');
    expect(formatRole('electrician')).toBe('Electrician');
    expect(formatRole('project_manager')).toBe('Project Manager');
    expect(formatRole('inspector')).toBe('Inspector');
    expect(formatRole('laborer')).toBe('Laborer');
    expect(formatRole('other')).toBe('Other');
  });

  it('title-cases unknown free-text roles with underscores', () => {
    expect(formatRole('safety_officer')).toBe('Safety Officer');
    expect(formatRole('driver')).toBe('Driver');
  });

  it('does not throw on empty string', () => {
    expect(() => formatRole('')).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. DB migration source — Migration 041 exists
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — DB migration source (Migration 041)', () => {
  const migrationSrc = readSource('app/api/migrate/route.ts');

  it('contains Migration 041 marker comment', () => {
    expect(migrationSrc).toContain('Migration 041');
  });

  it('creates crew_members table', () => {
    expect(migrationSrc).toContain('CREATE TABLE IF NOT EXISTS crew_members');
  });

  it('crew_members has crew_id with FK reference to crews', () => {
    expect(migrationSrc).toContain('REFERENCES crews(id)');
  });

  it('crew_members has ON DELETE CASCADE', () => {
    expect(migrationSrc).toContain('ON DELETE CASCADE');
  });

  it('crew_members has name column', () => {
    expect(migrationSrc).toContain('name             TEXT');
  });

  it('crew_members has role column', () => {
    expect(migrationSrc).toContain("role             TEXT        NOT NULL DEFAULT 'installer'");
  });

  it('crew_members has phone column', () => {
    expect(migrationSrc).toContain('phone            TEXT');
  });

  it('crew_members has email column', () => {
    expect(migrationSrc).toContain('email            TEXT');
  });

  it('crew_members has certifications TEXT[] column', () => {
    expect(migrationSrc).toContain('certifications   TEXT[]');
  });

  it('crew_members has is_lead BOOLEAN column', () => {
    expect(migrationSrc).toContain('is_lead          BOOLEAN');
  });

  it('crew_members has updated_at column', () => {
    expect(migrationSrc).toContain('updated_at       TIMESTAMPTZ');
  });

  it('creates idx_crew_members_crew index', () => {
    expect(migrationSrc).toContain('idx_crew_members_crew');
  });

  it('creates idx_crew_members_user index', () => {
    expect(migrationSrc).toContain('idx_crew_members_user');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. API route source — member endpoints
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — API route source (crews/[id]/members)', () => {
  const membersSrc = readSource('app/api/crews/[id]/members/route.ts');

  it('exports GET handler', () => {
    expect(membersSrc).toContain('export async function GET(');
  });

  it('exports POST handler', () => {
    expect(membersSrc).toContain('export async function POST(');
  });

  it('GET handler verifies crew ownership', () => {
    expect(membersSrc).toContain('user_id = ${user.id}');
  });

  it('GET orders members by is_lead DESC, name ASC', () => {
    expect(membersSrc).toContain('is_lead DESC, name ASC');
  });

  it('POST validates body with validateCreateMember', () => {
    expect(membersSrc).toContain('validateCreateMember');
  });

  it('POST sanitises with sanitiseCreateMember', () => {
    expect(membersSrc).toContain('sanitiseCreateMember');
  });

  it('POST enforces member cap (CREW_LIMITS.MAX_MEMBERS_PER_CREW)', () => {
    expect(membersSrc).toContain('MAX_MEMBERS_PER_CREW');
  });

  it('POST returns 201 status', () => {
    expect(membersSrc).toContain('status: 201');
  });

  it('imports rate limiter', () => {
    expect(membersSrc).toContain('checkRateLimit');
  });

  it('has maxDuration export', () => {
    expect(membersSrc).toContain('export const maxDuration = 30');
  });
});

describe('Priority 7 — API route source (crew-members/[memberId])', () => {
  const memberIdSrc = readSource('app/api/crew-members/[memberId]/route.ts');

  it('exports PATCH handler', () => {
    expect(memberIdSrc).toContain('export async function PATCH(');
  });

  it('exports DELETE handler', () => {
    expect(memberIdSrc).toContain('export async function DELETE(');
  });

  it('PATCH validates with validateUpdateMember', () => {
    expect(memberIdSrc).toContain('validateUpdateMember');
  });

  it('PATCH builds update with buildMemberUpdate', () => {
    expect(memberIdSrc).toContain('buildMemberUpdate');
  });

  it('PATCH enforces ownership via crews join', () => {
    expect(memberIdSrc).toContain('JOIN crews c ON c.id = cm.crew_id');
  });

  it('PATCH sets updated_at = NOW()', () => {
    expect(memberIdSrc).toContain('updated_at     = NOW()');
  });

  it('DELETE uses USING crews join for ownership check', () => {
    expect(memberIdSrc).toContain('USING crews');
  });

  it('DELETE checks user_id via crews.user_id', () => {
    expect(memberIdSrc).toContain('crews.user_id = ${user.id}');
  });

  it('DELETE returns { deleted: true }', () => {
    expect(memberIdSrc).toContain('deleted: true');
  });

  it('has maxDuration export', () => {
    expect(memberIdSrc).toContain('export const maxDuration = 30');
  });

  it('validates memberId is a UUID before any DB call', () => {
    expect(memberIdSrc).toContain('isValidUUID(memberId)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. lib/crews.ts source — exported symbols
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — lib/crews.ts source exports', () => {
  const crewsLibSrc = readSource('lib/crews.ts');

  it('exports CREW_MEMBER_ROLES', () => {
    expect(crewsLibSrc).toContain('export const CREW_MEMBER_ROLES');
  });

  it('exports KNOWN_CERTIFICATIONS', () => {
    expect(crewsLibSrc).toContain('export const KNOWN_CERTIFICATIONS');
  });

  it('exports CREW_LIMITS', () => {
    expect(crewsLibSrc).toContain('export const CREW_LIMITS');
  });

  it('exports CrewMember interface', () => {
    expect(crewsLibSrc).toContain('export interface CrewMember');
  });

  it('CrewMember has certifications field typed as string[] | null', () => {
    expect(crewsLibSrc).toContain('certifications: string[] | null');
  });

  it('CrewMember has is_lead boolean field', () => {
    expect(crewsLibSrc).toContain('is_lead: boolean');
  });

  it('exports CrewWithMembers interface (crew + members array)', () => {
    expect(crewsLibSrc).toContain('export interface CrewWithMembers');
  });

  it('CrewWithMembers extends Crew with members array', () => {
    expect(crewsLibSrc).toContain('members: CrewMember[]');
  });

  it('exports CreateCrewMemberBody interface', () => {
    expect(crewsLibSrc).toContain('export interface CreateCrewMemberBody');
  });

  it('exports UpdateCrewMemberBody interface', () => {
    expect(crewsLibSrc).toContain('export interface UpdateCrewMemberBody');
  });

  it('exports isKnownRole function', () => {
    expect(crewsLibSrc).toContain('export function isKnownRole(');
  });

  it('exports normalisePhone function', () => {
    expect(crewsLibSrc).toContain('export function normalisePhone(');
  });

  it('exports isValidEmail function', () => {
    expect(crewsLibSrc).toContain('export function isValidEmail(');
  });

  it('exports validateCreateMember function', () => {
    expect(crewsLibSrc).toContain('export function validateCreateMember(');
  });

  it('exports validateUpdateMember function', () => {
    expect(crewsLibSrc).toContain('export function validateUpdateMember(');
  });

  it('exports sanitiseCreateMember function', () => {
    expect(crewsLibSrc).toContain('export function sanitiseCreateMember(');
  });

  it('exports buildMemberUpdate function', () => {
    expect(crewsLibSrc).toContain('export function buildMemberUpdate(');
  });

  it('exports formatRole function', () => {
    expect(crewsLibSrc).toContain('export function formatRole(');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. Existing crews route is unchanged (regression guard)
// ─────────────────────────────────────────────────────────────────────────────
describe('Priority 7 — regression: existing /api/crews route is intact', () => {
  const crewsSrc = readSource('app/api/crews/route.ts');

  it('still has GET handler for listing crews', () => {
    expect(crewsSrc).toContain('export async function GET(');
  });

  it('still has POST handler for creating crews', () => {
    expect(crewsSrc).toContain('export async function POST(');
  });

  it('still has DELETE handler for removing crews', () => {
    expect(crewsSrc).toContain('export async function DELETE(');
  });

  it('SELECT still includes id, name, color columns', () => {
    expect(crewsSrc).toContain('id, name, color');
  });
});
