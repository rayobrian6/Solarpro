/**
 * tests/priority-crew-settings.test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * CI guard for the Crew/Employee management layer:
 *   - lib/crews.ts validation logic
 *   - CrewMembersPanel component source structure
 *   - API route structure (DELETE/PATCH member endpoint)
 *   - Settings page Teams tab integration
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ── Import pure logic from lib/crews.ts ───────────────────────────────────
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
} from '../lib/crews';

const root = path.resolve(__dirname, '..');

// ─── CREW_MEMBER_ROLES ────────────────────────────────────────────────────

describe('CREW_MEMBER_ROLES', () => {
  it('includes lead_installer', () => expect(CREW_MEMBER_ROLES).toContain('lead_installer'));
  it('includes installer',      () => expect(CREW_MEMBER_ROLES).toContain('installer'));
  it('includes apprentice',     () => expect(CREW_MEMBER_ROLES).toContain('apprentice'));
  it('includes electrician',    () => expect(CREW_MEMBER_ROLES).toContain('electrician'));
  it('includes project_manager',() => expect(CREW_MEMBER_ROLES).toContain('project_manager'));
  it('includes inspector',      () => expect(CREW_MEMBER_ROLES).toContain('inspector'));
  it('includes laborer',        () => expect(CREW_MEMBER_ROLES).toContain('laborer'));
  it('includes other',          () => expect(CREW_MEMBER_ROLES).toContain('other'));
  it('has 8 roles', () => expect(CREW_MEMBER_ROLES).toHaveLength(8));
});

// ─── KNOWN_CERTIFICATIONS ─────────────────────────────────────────────────

describe('KNOWN_CERTIFICATIONS', () => {
  it('includes NABCEP PV Installation Professional', () =>
    expect(KNOWN_CERTIFICATIONS).toContain('NABCEP PV Installation Professional'));
  it('includes OSHA 10',          () => expect(KNOWN_CERTIFICATIONS).toContain('OSHA 10'));
  it('includes OSHA 30',          () => expect(KNOWN_CERTIFICATIONS).toContain('OSHA 30'));
  it('includes Journeyman Electrician', () =>
    expect(KNOWN_CERTIFICATIONS).toContain('Journeyman Electrician'));
  it('includes First Aid/CPR',    () => expect(KNOWN_CERTIFICATIONS).toContain('First Aid/CPR'));
  it('includes Fall Protection',  () => expect(KNOWN_CERTIFICATIONS).toContain('Fall Protection'));
  it('includes Battery Storage Systems', () =>
    expect(KNOWN_CERTIFICATIONS).toContain('Battery Storage Systems'));
  it('has at least 15 certifications', () => expect(KNOWN_CERTIFICATIONS.length).toBeGreaterThanOrEqual(15));
  it('has no duplicate certifications', () => {
    const set = new Set(KNOWN_CERTIFICATIONS);
    expect(set.size).toBe(KNOWN_CERTIFICATIONS.length);
  });
});

// ─── isKnownRole ──────────────────────────────────────────────────────────

describe('isKnownRole', () => {
  it('returns true for installer',        () => expect(isKnownRole('installer')).toBe(true));
  it('returns true for lead_installer',   () => expect(isKnownRole('lead_installer')).toBe(true));
  it('returns true for electrician',      () => expect(isKnownRole('electrician')).toBe(true));
  it('returns false for unknown role',    () => expect(isKnownRole('solar_wizard')).toBe(false));
  it('returns false for empty string',    () => expect(isKnownRole('')).toBe(false));
});

// ─── normalisePhone ───────────────────────────────────────────────────────

describe('normalisePhone', () => {
  it('strips whitespace', () => {
    const r = normalisePhone('(555) 123-4567');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('(555)123-4567');
  });

  it('accepts a plain 10-digit number', () => {
    const r = normalisePhone('5551234567');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('5551234567');
  });

  it('rejects a phone longer than MAX_PHONE_LEN', () => {
    const r = normalisePhone('1'.repeat(CREW_LIMITS.MAX_PHONE_LEN + 1));
    expect(r.ok).toBe(false);
  });

  it('accepts exactly MAX_PHONE_LEN digits', () => {
    const r = normalisePhone('1'.repeat(CREW_LIMITS.MAX_PHONE_LEN));
    expect(r.ok).toBe(true);
  });
});

// ─── isValidEmail ─────────────────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts valid email', () => expect(isValidEmail('alex@solarpro.com')).toBe(true));
  it('accepts sub-domain email', () => expect(isValidEmail('alex@mail.solar.com')).toBe(true));
  it('rejects missing @', () => expect(isValidEmail('alexsolarpro.com')).toBe(false));
  it('rejects missing domain', () => expect(isValidEmail('alex@')).toBe(false));
  it('rejects domain without dot', () => expect(isValidEmail('alex@domain')).toBe(false));
  it('rejects email over MAX_EMAIL_LEN', () => {
    expect(isValidEmail('a'.repeat(250) + '@example.com')).toBe(false);
  });
});

// ─── validateCreateMember ─────────────────────────────────────────────────

describe('validateCreateMember', () => {
  it('accepts minimal valid body', () => {
    expect(validateCreateMember({ name: 'Alex Johnson' })).toBeNull();
  });

  it('accepts full valid body', () => {
    expect(validateCreateMember({
      name: 'Alex Johnson',
      role: 'installer',
      phone: '5551234567',
      email: 'alex@crew.com',
      certifications: ['NABCEP PV Installation Professional', 'OSHA 10'],
      is_lead: false,
      notes: 'Experienced with SunPower panels',
    })).toBeNull();
  });

  it('rejects missing name', () => {
    expect(validateCreateMember({})).toBe('name is required.');
  });

  it('rejects blank name', () => {
    expect(validateCreateMember({ name: '   ' })).toBe('name is required.');
  });

  it('rejects name over MAX_NAME_LEN', () => {
    const err = validateCreateMember({ name: 'A'.repeat(CREW_LIMITS.MAX_NAME_LEN + 1) });
    expect(err).toContain('name too long');
  });

  it('rejects non-string body', () => {
    expect(validateCreateMember('string')).toBe('Request body must be a JSON object.');
  });

  it('rejects invalid email format', () => {
    const err = validateCreateMember({ name: 'Alex', email: 'not-an-email' });
    expect(err).toBe('email format is invalid.');
  });

  it('rejects non-boolean is_lead', () => {
    const err = validateCreateMember({ name: 'Alex', is_lead: 'yes' });
    expect(err).toBe('is_lead must be a boolean.');
  });

  it('rejects too many certifications', () => {
    const certs = Array.from({ length: CREW_LIMITS.MAX_CERTS_PER_MEMBER + 1 }, (_, i) => `cert${i}`);
    const err = validateCreateMember({ name: 'Alex', certifications: certs });
    expect(err).toContain('too many certifications');
  });

  it('rejects blank certification entry', () => {
    const err = validateCreateMember({ name: 'Alex', certifications: ['OSHA 10', ''] });
    expect(err).toBe('certification entries cannot be blank.');
  });

  it('rejects notes over MAX_NOTES_LEN', () => {
    const err = validateCreateMember({ name: 'Alex', notes: 'x'.repeat(CREW_LIMITS.MAX_NOTES_LEN + 1) });
    expect(err).toContain('notes too long');
  });
});

// ─── validateUpdateMember ─────────────────────────────────────────────────

describe('validateUpdateMember', () => {
  it('accepts partial update with only is_lead', () => {
    expect(validateUpdateMember({ is_lead: true })).toBeNull();
  });

  it('accepts partial update with only phone', () => {
    expect(validateUpdateMember({ phone: '5551234567' })).toBeNull();
  });

  it('rejects empty object', () => {
    expect(validateUpdateMember({})).toBe('At least one field must be provided for update.');
  });

  it('rejects blank name update', () => {
    const err = validateUpdateMember({ name: '' });
    expect(err).toBeTruthy();
  });

  it('rejects invalid email update', () => {
    const err = validateUpdateMember({ email: 'bad-email' });
    expect(err).toBe('email format is invalid.');
  });
});

// ─── sanitiseCreateMember ─────────────────────────────────────────────────

describe('sanitiseCreateMember', () => {
  it('trims name', () => {
    const r = sanitiseCreateMember({ name: '  Alex Johnson  ' });
    expect(r.name).toBe('Alex Johnson');
  });

  it('lowercases email', () => {
    const r = sanitiseCreateMember({ name: 'Alex', email: 'ALEX@SOLAR.COM' });
    expect(r.email).toBe('alex@solar.com');
  });

  it('deduplicates certifications', () => {
    const r = sanitiseCreateMember({
      name: 'Alex',
      certifications: ['OSHA 10', 'OSHA 10', 'Fall Protection'],
    });
    expect(r.certifications).toEqual(['OSHA 10', 'Fall Protection']);
  });

  it('defaults role to installer when not provided', () => {
    const r = sanitiseCreateMember({ name: 'Alex' });
    expect(r.role).toBe('installer');
  });

  it('defaults is_lead to false', () => {
    const r = sanitiseCreateMember({ name: 'Alex' });
    expect(r.is_lead).toBe(false);
  });

  it('normalises phone (strips spaces)', () => {
    const r = sanitiseCreateMember({ name: 'Alex', phone: '555 123 4567' });
    expect(r.phone).toBe('5551234567');
  });

  it('sets certifications to null when empty array provided', () => {
    const r = sanitiseCreateMember({ name: 'Alex', certifications: [] });
    expect(r.certifications).toBeNull();
  });
});

// ─── buildMemberUpdate ────────────────────────────────────────────────────

describe('buildMemberUpdate', () => {
  it('includes only provided fields', () => {
    const u = buildMemberUpdate({ is_lead: true });
    expect(u).toHaveProperty('is_lead', true);
    expect(u).not.toHaveProperty('name');
    expect(u).not.toHaveProperty('email');
  });

  it('trims name', () => {
    const u = buildMemberUpdate({ name: '  Alex  ' });
    expect(u.name).toBe('Alex');
  });

  it('lowercases email', () => {
    const u = buildMemberUpdate({ email: 'ALEX@SOLAR.COM' });
    expect(u.email).toBe('alex@solar.com');
  });

  it('sets email to null when null provided', () => {
    const u = buildMemberUpdate({ email: null });
    expect(u.email).toBeNull();
  });

  it('deduplicates certifications', () => {
    const u = buildMemberUpdate({ certifications: ['OSHA 10', 'OSHA 10'] });
    expect(u.certifications).toEqual(['OSHA 10']);
  });
});

// ─── formatRole ───────────────────────────────────────────────────────────

describe('formatRole', () => {
  it('formats lead_installer → "Lead Installer"', () =>
    expect(formatRole('lead_installer')).toBe('Lead Installer'));
  it('formats project_manager → "Project Manager"', () =>
    expect(formatRole('project_manager')).toBe('Project Manager'));
  it('title-cases unknown role', () =>
    expect(formatRole('solar_wizard')).toBe('Solar Wizard'));
});

// ─── Source code integrity checks ─────────────────────────────────────────

describe('CrewMembersPanel — source code structure', () => {
  const src = fs.readFileSync(
    path.join(root, 'components/settings/CrewMembersPanel.tsx'),
    'utf8',
  );

  it('renders a crews list', () => expect(src).toContain('crews.map'));
  it('has AddMemberForm component', () => expect(src).toContain('AddMemberForm'));
  it('has CrewRow component', () => expect(src).toContain('CrewRow'));
  it('uses GET /api/crews endpoint', () => expect(src).toContain('/api/crews'));
  it('uses POST /api/crews endpoint', () => expect(src).toContain("method: 'POST'"));
  it('uses DELETE /api/crews endpoint', () => expect(src).toContain("method: 'DELETE'"));
  it('uses PATCH for member update (is_lead toggle)', () => expect(src).toContain("method: 'PATCH'"));
  it('uses /api/crews/[id]/members endpoint', () => expect(src).toContain('/members'));
  it('renders CREW_MEMBER_ROLES dropdown', () => {
    expect(src).toContain('CREW_MEMBER_ROLES');
  });
  it('renders KNOWN_CERTIFICATIONS multi-select', () => {
    expect(src).toContain('KNOWN_CERTIFICATIONS');
  });
  it('has is_lead toggle', () => expect(src).toContain('is_lead'));
  it('has certifications section', () => expect(src).toContain('certifications'));
  it('has phone field', () => expect(src).toContain('phone'));
  it('has email field', () => expect(src).toContain('email'));
  it('has notes field', () => expect(src).toContain('notes'));
  it('has colour picker for crews', () => expect(src).toContain('CREW_COLORS'));
  it('has delete crew confirmation', () => expect(src).toContain('Delete Crew'));
  it('has delete member function', () => expect(src).toContain('deleteMember'));
  it('shows NABCEP certifications in the list', () => expect(src).toContain('NABCEP'));
  it('shows OSHA certifications in the list', () => expect(src).toContain('OSHA'));
});

describe('DELETE/PATCH member route — source code structure', () => {
  const src = fs.readFileSync(
    path.join(root, 'app/api/crews/[id]/members/[memberId]/route.ts'),
    'utf8',
  );

  it('exports DELETE handler', () => expect(src).toContain('export async function DELETE'));
  it('exports PATCH handler', () => expect(src).toContain('export async function PATCH'));
  it('validates crewId as UUID', () => expect(src).toContain('isValidUUID(crewId)'));
  it('validates memberId as UUID', () => expect(src).toContain('isValidUUID(memberId)'));
  it('verifies crew ownership before delete', () => expect(src).toContain('user_id = ${user.id}'));
  it('uses rate limiting', () => expect(src).toContain('checkRateLimit'));
  it('uses validateUpdateMember', () => expect(src).toContain('validateUpdateMember'));
  it('uses buildMemberUpdate', () => expect(src).toContain('buildMemberUpdate'));
  it('returns { deleted: true } on success', () => expect(src).toContain('deleted: true'));
  it('returns 404 when crew not found', () => expect(src).toContain('status: 404'));
  it('returns 400 for invalid UUID', () => expect(src).toContain('status: 400'));
});

describe('Settings page Teams tab integration', () => {
  const src = fs.readFileSync(
    path.join(root, 'app/settings/page.tsx'),
    'utf8',
  );

  it("imports CrewMembersPanel", () => {
    expect(src).toContain("import CrewMembersPanel from '@/components/settings/CrewMembersPanel'");
  });

  it("has 'teams' in the Tab type", () => {
    expect(src).toContain("'teams'");
  });

  it("has Teams tab entry in tabs array", () => {
    expect(src).toContain("id: 'teams'");
    expect(src).toContain("label: 'Teams'");
  });

  it("renders CrewMembersPanel when teams tab is active", () => {
    expect(src).toContain('activeTab === \'teams\'');
    expect(src).toContain('<CrewMembersPanel');
  });

  it('imports Users icon for the tab', () => {
    expect(src).toContain('Users');
  });
});
