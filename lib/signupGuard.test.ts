/**
 * lib/signupGuard.test.ts
 * Unit tests for bot-detection helpers.
 */
import { describe, it, expect } from 'vitest';
import { isGibberish, isDisposableEmail, checkHoneypot } from './signupGuard';

// ── isGibberish ─────────────────────────────────────────────────────────────
describe('isGibberish', () => {
  // ── Known bot strings (must be detected) ──
  it('detects bot company string QlYQBVuDHDLRnJXEslH', () => {
    expect(isGibberish('QlYQBVuDHDLRnJXEslH')).toBe(true);
  });
  it('detects bot company string LpmyeQFXeFuaJWYToFSbUx', () => {
    expect(isGibberish('LpmyeQFXeFuaJWYToFSbUx')).toBe(true);
  });
  it('detects bot username meaioGMtCwSIF2ygn', () => {
    expect(isGibberish('meaioGMtCwSIF2ygn')).toBe(true);
  });
  it('detects bot username fAZKlltHksNuACMA', () => {
    expect(isGibberish('fAZKlltHksNuACMA')).toBe(true);
  });
  it('detects obvious alternating-case gibberish xYzAbCdEfGhIjKlMnOpQr', () => {
    expect(isGibberish('xYzAbCdEfGhIjKlMnOpQr')).toBe(true);
  });
  it('detects high-entropy sequential gibberish ABCDefGHIJklmNOPQRstu', () => {
    expect(isGibberish('ABCDefGHIJklmNOPQRstu')).toBe(true);
  });

  // ── Real company names (must NOT be flagged) ──
  it('allows real company SolarEdgeTechnologies (no spaces, long)', () => {
    expect(isGibberish('SolarEdgeTechnologies')).toBe(false);
  });
  it('allows real company BrightSunEnergy', () => {
    expect(isGibberish('BrightSunEnergy')).toBe(false);
  });
  it('allows real company TeslaEnergyProducts', () => {
    expect(isGibberish('TeslaEnergyProducts')).toBe(false);
  });
  it('allows real company NovaSolarSystems', () => {
    expect(isGibberish('NovaSolarSystems')).toBe(false);
  });
  it('allows real company SunrunSolarInstall', () => {
    expect(isGibberish('SunrunSolarInstall')).toBe(false);
  });
  it('allows real company PowerHomesSolarLLC (with LLC)', () => {
    expect(isGibberish('PowerHomesSolarLLC')).toBe(false);
  });
  it('allows real company TexasSolarAndMore', () => {
    expect(isGibberish('TexasSolarAndMore')).toBe(false);
  });
  it('allows real company MyCompanyLLCExtra', () => {
    expect(isGibberish('MyCompanyLLCExtra')).toBe(false);
  });

  // ── Real names ──
  it('allows real name Jane Smith (with space)', () => {
    expect(isGibberish('Jane Smith')).toBe(false);
  });
  it('allows real name Luis Mora (with space)', () => {
    expect(isGibberish('Luis Mora')).toBe(false);
  });
  it('allows single-word company Arespro', () => {
    expect(isGibberish('Arespro')).toBe(false);
  });
  it('allows brand SunPower', () => {
    expect(isGibberish('SunPower')).toBe(false);
  });
  it('allows real name no space RobertJohnsonSolar', () => {
    expect(isGibberish('RobertJohnsonSolar')).toBe(false);
  });
  it('allows real name ChristopherAnderson', () => {
    expect(isGibberish('ChristopherAnderson')).toBe(false);
  });
  it('allows real name JohnDoe (short)', () => {
    expect(isGibberish('JohnDoe')).toBe(false);
  });

  // ── Edge cases ──
  it('allows empty string', () => {
    expect(isGibberish('')).toBe(false);
  });
  it('allows ALL CAPS abbreviation ALLUPPERCASECOMPANY', () => {
    expect(isGibberish('ALLUPPERCASECOMPANY')).toBe(false);
  });
  it('allows all-caps SOLARPOWERLLC', () => {
    expect(isGibberish('SOLARPOWERLLC')).toBe(false);
  });
  it('allows company with spaces Solar Solutions LLC', () => {
    expect(isGibberish('Solar Solutions LLC')).toBe(false);
  });
});

// ── isDisposableEmail ────────────────────────────────────────────────────────
describe('isDisposableEmail', () => {
  it('detects mailinator.com', () => {
    expect(isDisposableEmail('test@mailinator.com')).toBe(true);
  });
  it('detects guerrillamail.com', () => {
    expect(isDisposableEmail('abc@guerrillamail.com')).toBe(true);
  });
  it('detects yopmail.com', () => {
    expect(isDisposableEmail('user@yopmail.com')).toBe(true);
  });
  it('detects trashmail.me', () => {
    expect(isDisposableEmail('x@trashmail.me')).toBe(true);
  });
  it('detects temp-mail.org', () => {
    expect(isDisposableEmail('hi@temp-mail.org')).toBe(true);
  });
  it('detects maildrop.cc', () => {
    expect(isDisposableEmail('drop@maildrop.cc')).toBe(true);
  });
  it('allows gmail.com', () => {
    expect(isDisposableEmail('user@gmail.com')).toBe(false);
  });
  it('allows yahoo.com', () => {
    expect(isDisposableEmail('user@yahoo.com')).toBe(false);
  });
  it('allows hotmail.com', () => {
    expect(isDisposableEmail('user@hotmail.com')).toBe(false);
  });
  it('allows hotmail.co.uk', () => {
    expect(isDisposableEmail('user@hotmail.co.uk')).toBe(false);
  });
  it('allows outlook.com', () => {
    expect(isDisposableEmail('user@outlook.com')).toBe(false);
  });
  it('allows icloud.com', () => {
    expect(isDisposableEmail('user@icloud.com')).toBe(false);
  });
  it('allows custom business domain', () => {
    expect(isDisposableEmail('jane@solarcompany.com')).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(isDisposableEmail('X@MAILINATOR.COM')).toBe(true);
  });
  it('handles malformed email gracefully', () => {
    expect(isDisposableEmail('notanemail')).toBe(false);
  });
});

// ── checkHoneypot ────────────────────────────────────────────────────────────
describe('checkHoneypot', () => {
  it('returns true when website field is filled', () => {
    expect(checkHoneypot({ website: 'http://bot.example.com' })).toBe(true);
  });
  it('returns true for any non-empty website value', () => {
    expect(checkHoneypot({ website: 'x' })).toBe(true);
  });
  it('returns false when website field is empty string', () => {
    expect(checkHoneypot({ website: '' })).toBe(false);
  });
  it('returns false when website field is absent', () => {
    expect(checkHoneypot({ name: 'Jane', email: 'jane@example.com' })).toBe(false);
  });
  it('returns false when website is whitespace only', () => {
    expect(checkHoneypot({ website: '   ' })).toBe(false);
  });
});
