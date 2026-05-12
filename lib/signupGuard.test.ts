/**
 * lib/signupGuard.test.ts
 * Unit tests for bot-detection helpers.
 */
import { describe, it, expect } from 'vitest';
import { isGibberish, isDisposableEmail, checkHoneypot } from './signupGuard';

// ── isGibberish ─────────────────────────────────────────────────────────────
describe('isGibberish', () => {
  // ── Known bot strings — Incident 1 (must be detected) ──
  // These are EXACT strings from the first live security incident
  it('detects actual incident bot name jdasson09DUmrrF7gp', () => {
    expect(isGibberish('jdasson09DUmrrF7gp')).toBe(true);
  });
  it('detects actual incident bot name tAZWINSdnBiCAM', () => {
    expect(isGibberish('tAZWINSdnBiCAM')).toBe(true);
  });
  it('detects bot token GYODALRJNOSLRSHSEM', () => {
    expect(isGibberish('GYODALRJNOSLRSHSEM')).toBe(true);
  });
  it('detects bot token L3yizkTVAHJA9HT0DEu', () => {
    expect(isGibberish('L3yizkTVAHJA9HT0DEu')).toBe(true);
  });
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

  // ── Known bot strings — Incident 2 (May 2025) — new evasion patterns ──
  // Rule 8: moderate mc + decent ur + digits present
  it('detects incident-2 bot nikosOMIUnxF7cgn (mc=0.286, ur=0.333, dr=0.063)', () => {
    expect(isGibberish('nikosOMIUnxF7cgn')).toBe(true);
  });
  // Rule 9: high ur, low mc, high entropy + digits
  it('detects incident-2 bot drklinsdoHARCHINE12 (ur=0.471, mc=0.063, e=3.722)', () => {
    expect(isGibberish('drklinsdoHARCHINE12')).toBe(true);
  });
  // Rule 10: lower-entropy mixed-case
  it('detects incident-2 bot weWeETRCEfwkofBgchF (e=3.221, mc=0.389, ur=0.421)', () => {
    expect(isGibberish('weWeETRCEfwkofBgchF')).toBe(true);
  });
  // Rule 11: digit-heavy alphanumeric token
  it('detects incident-2 bot hw1975ming2hh891 (dr=0.500, e=3.453)', () => {
    expect(isGibberish('hw1975ming2hh891')).toBe(true);
  });
  // Other incident-2 bots covered by existing rules
  it('detects incident-2 bot VWYgJcAMYnjgvePsmH', () => {
    expect(isGibberish('VWYgJcAMYnjgvePsmH')).toBe(true);
  });
  it('detects incident-2 bot GTDOEAUSDHLLXBM5H', () => {
    expect(isGibberish('GTDOEAUSDHLLXBM5H')).toBe(true);
  });
  it('detects incident-2 bot LqmseYFtuFLJdYTRQx', () => {
    expect(isGibberish('LqmseYFtuFLJdYTRQx')).toBe(true);
  });
  it('detects incident-2 bot mbaldiAMtCwIPType', () => {
    expect(isGibberish('mbaldiAMtCwIPType')).toBe(true);
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
  // Incident-2 false-positive guards — ensure Rule 8-11 don\'t block legit names
  it('allows MyCompanyLLCExtra (no digits, safe from Rule 8)', () => {
    expect(isGibberish('MyCompanyLLCExtra')).toBe(false);
  });
  it('allows HW1975Mining (dr=0.333, below Rule 11 threshold)', () => {
    expect(isGibberish('HW1975Mining')).toBe(false);
  });
  it('allows PowerHomesSolarLLC (ur=0.333, below Rule 10 threshold)', () => {
    expect(isGibberish('PowerHomesSolarLLC')).toBe(false);
  });
  it('allows drklinsdorf (short lowercase, no pattern match)', () => {
    expect(isGibberish('drklinsdorf')).toBe(false);
  });

  // ── Incident-3 bot cases (new wave) ────────────────────────────────────────
  it('detects incident-3 bot dVurUJFXanbwHaqrcWGBXaL (caught by Rule 1)', () => {
    expect(isGibberish('dVurUJFXanbwHaqrcWGBXaL')).toBe(true);
  });
  it('detects incident-3 bot RLJjbumPbonAlbrLr (mc=0.438, Rule 12)', () => {
    expect(isGibberish('RLJjbumPbonAlbrLr')).toBe(true);
  });
  it('detects incident-3 bot gLtmTjHtvsnUJhWwg (mc=0.625, Rule 12)', () => {
    expect(isGibberish('gLtmTjHtvsnUJhWwg')).toBe(true);
  });
  it('detects incident-3 bot fISMSeLikrryap (mc=0.308, ur=0.357, Rule 13)', () => {
    expect(isGibberish('fISMSeLikrryap')).toBe(true);
  });
  it('detects incident-3 company qSTJMuuKkuHpmnuApKjxCZ (Rule 1)', () => {
    expect(isGibberish('qSTJMuuKkuHpmnuApKjxCZ')).toBe(true);
  });
  it('detects incident-3 company agmAkvnMkjdLAQEYSJ (Rule 3)', () => {
    expect(isGibberish('agmAkvnMkjdLAQEYSJ')).toBe(true);
  });
  it('detects incident-3 company XuRuFciiBMFFJQCJGEJcrmax (Rule 3)', () => {
    expect(isGibberish('XuRuFciiBMFFJQCJGEJcrmax')).toBe(true);
  });

  // ── Incident-3 false-positive guards ───────────────────────────────────────
  it('allows BlueSkyEnergyLLC (mc=0.400, below Rule 12 threshold)', () => {
    expect(isGibberish('BlueSkyEnergyLLC')).toBe(false);
  });
  it('allows MyCompanyLLCExtra (ur=0.353, below Rule 13 threshold)', () => {
    expect(isGibberish('MyCompanyLLCExtra')).toBe(false);
  });
  it('allows NovaSolarGroup (mc=0.385, below Rule 12 threshold)', () => {
    expect(isGibberish('NovaSolarGroup')).toBe(false);
  });
  it('allows TexasSolarAndMore (mc=0.438 but ur=0.235, below Rule 12 ur guard)', () => {
    expect(isGibberish('TexasSolarAndMore')).toBe(false);
  });
  it('detects incident-3 bot iCfhgzhvctUMeartt (consonant run=9, Rule 14)', () => {
    expect(isGibberish('iCfhgzhvctUMeartt')).toBe(true);
  });
  it('allows SchwartzSolarGroup (Schw=4 consonants, below Rule 14)', () => {
    expect(isGibberish('SchwartzSolarGroup')).toBe(false);
  });
  it('allows SolarStrengthGroup (ngth=4 consonants, below Rule 14)', () => {
    expect(isGibberish('SolarStrengthGroup')).toBe(false);
  });
  it('allows FirstSolarInstall (rstS=4 consonants, below Rule 14)', () => {
    expect(isGibberish('FirstSolarInstall')).toBe(false);
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
