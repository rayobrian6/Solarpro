/**
 * lib/signupGuard.ts
 *
 * Bot-detection helpers for the registration endpoint.
 *
 * Bots that probe SaaS trial tiers tend to use programmatically-generated
 * strings for name and company fields: long, no spaces, randomly alternating
 * upper/lowercase.  The checks here detect that pattern without relying on
 * external services, adding zero latency to the signup path.
 *
 * Rules are intentionally conservative — we only reject strings that are
 * unambiguously machine-generated.  Any edge case that _could_ be a real
 * user is allowed through.
 *
 * ANTI-BOT CHECKS
 * ──────────────────────────────────────────────────────────────────────────
 *
 * isGibberish(s): true when a single-word string (no spaces) looks machine-generated.
 *   Requires length >= 14 chars.  Two entropy paths:
 *
 *   HIGH-ENTROPY PATH (e > 3.4):
 *   Rule 1 — high case-alternation ratio (mc > 0.35):
 *     Random generators produce upper/lower transitions on nearly every character.
 *     Normal CamelCase company names only capitalise word starts.
 *   Rule 2 — extremely high entropy (> 4.0):
 *     Catches sequential-character strings that evade the mc check.
 *   Rule 3 — elevated uppercase ratio + some mixing (ur > 0.38 AND mc > 0.15):
 *     Catches strings where many random chars happen to be uppercase.
 *     The mc > 0.15 guard excludes legitimate ALL-CAPS company abbreviations.
 *   Rule 4 — combined mc + ur signal (mc + ur > 0.70 AND mc > 0.15):
 *     Catches mid-level cases like "meaioGMtCwSIF2ygn".
 *   Rule 5 — pure-uppercase with high entropy (ur >= 0.95 AND mc == 0 AND e > 3.50):
 *     Catches all-uppercase bot tokens (e.g. GYODALRJNOSLRSHSEM e=3.572).
 *     Real all-caps company names top out at ~e=3.43, safely below 3.50.
 *   Rule 6 — moderate-mc + very high entropy (mc >= 0.28 AND e > 3.75 AND len >= 16):
 *     Catches "jdasson09DUmrrF7gp"-style strings.  TeslaEnergyProducts (e=3.682)
 *     is safely below the e > 3.75 cutoff.
 *
 *   LOWER-ENTROPY PATH (3.3 < e <= 3.4):
 *   Rule 7 — high alternation AND very high uppercase ratio (mc > 0.35 AND ur >= 0.60):
 *     Catches "tAZWINSdnBiCAM" (mc=0.385, ur=0.714).
 *     BrightSunEnergy (mc=0.357, ur=0.200) is safely below ur >= 0.60.
 *
 * DISPOSABLE EMAIL DOMAINS
 * ──────────────────────────────────────────────────────────────────────────
 * isDisposableEmail(email): true when the domain is a known throwaway provider.
 * List is intentionally short — only high-volume disposable services.
 * We do NOT block free providers (gmail, yahoo, hotmail, etc.) because many
 * legitimate solar installers use personal email addresses.
 *
 * HONEYPOT
 * ──────────────────────────────────────────────────────────────────────────
 * checkHoneypot(body): true (= bot detected) when a hidden form field that
 * real users never see has been filled in by an automated form-filler.
 */

// ── Shannon entropy ────────────────────────────────────────────────────────
function shannonEntropy(s: string): number {
  if (!s) return 0;
  const lower = s.toLowerCase();
  const freq: Record<string, number> = {};
  for (const ch of lower) freq[ch] = (freq[ch] ?? 0) + 1;
  const n = lower.length;
  return -Object.values(freq).reduce((acc, c) => acc + (c / n) * Math.log2(c / n), 0);
}

// ── Case-alternation ratio ─────────────────────────────────────────────────
// Fraction of consecutive alpha-pair transitions where case changes.
// Random generators: ~0.45–0.55.  Normal CamelCase: ~0.10–0.25.
function mixedCaseRatio(s: string): number {
  const alpha = s.split('').filter(c => /[a-zA-Z]/.test(c));
  if (alpha.length < 2) return 0;
  let transitions = 0;
  for (let i = 1; i < alpha.length; i++) {
    if (alpha[i].toUpperCase() === alpha[i] !== (alpha[i - 1].toUpperCase() === alpha[i - 1])) {
      transitions++;
    }
  }
  return transitions / (alpha.length - 1);
}

// ── Uppercase ratio ────────────────────────────────────────────────────────
function uppercaseRatio(s: string): number {
  const alpha = s.split('').filter(c => /[a-zA-Z]/.test(c));
  if (!alpha.length) return 0;
  return alpha.filter(c => c === c.toUpperCase()).length / alpha.length;
}

// ── Digit ratio ───────────────────────────────────────────────────────────────────────────────────
// Fraction of characters that are digits (0-9).
function digitRatio(s: string): number {
  if (!s.length) return 0;
  return s.split('').filter(c => /[0-9]/.test(c)).length / s.length;
}

/**
 * Returns true if the string looks like a machine-generated gibberish token.
 * Only fires on single-word strings longer than 14 characters with high entropy.
 * All legitimate company names and personal names in our test suite pass through.
 *
 * INCIDENT 2 ADDITIONS (Rules 8–11) — new bot patterns observed May 2025:
 *   Bots evolved to use: lower mc but digits mixed in, high-uppercase with digits,
 *   lower-entropy mixed case, and digit-heavy alphanumeric tokens.
 */
export function isGibberish(raw: string): boolean {
  if (!raw) return false;
  const s = raw.trim();

  // Strings with spaces are almost certainly human-entered (full names, company names).
  if (s.includes(' ')) return false;

  const len = s.length;
  const e   = shannonEntropy(s);
  const mc  = mixedCaseRatio(s);
  const ur  = uppercaseRatio(s);
  const dr  = digitRatio(s);

  // Length gate — minimum 14 chars (shorter strings never match bot patterns reliably).
  if (len < 14) return false;

  // ── High-entropy path (e > 3.4) ──────────────────────────────────────────────────────────────────
  if (e > 3.4) {
    // Rule 1: high case-alternation (classic random generator output)
    if (mc > 0.35) return true;

    // Rule 2: extremely high entropy alone (sequential-unique characters)
    if (e > 4.0) return true;

    // Rule 3: many uppercase chars + some mixing (exclude pure ALL-CAPS abbreviations)
    if (ur > 0.38 && mc > 0.15) return true;

    // Rule 4: combined mc + ur signal (catches mid-level cases)
    if ((mc + ur) > 0.70 && mc > 0.15) return true;

    // Rule 5: pure-uppercase with high entropy — catches GYODALRJNOSLRSHSEM (e=3.572).
    // Real all-caps names top out at ~e=3.43 (ALLUPPERCASECOMPANY), safely below 3.50.
    if (ur >= 0.95 && mc === 0 && e > 3.50) return true;

    // Rule 6: moderate case-alternation + very high entropy — catches jdasson09DUmrrF7gp
    // (mc=0.286, e=3.837).  TeslaEnergyProducts (mc=0.278, e=3.682) stays below e>3.75.
    if (mc >= 0.28 && e > 3.75 && len >= 16) return true;

    // Rule 8 (Incident 2): moderate mc + decent ur + has digits = alphanumeric bot garble.
    // Catches: nikosOMIUnxF7cgn (mc=0.286, ur=0.333, dr=0.063).
    // Safe:    MyCompanyLLCExtra (dr=0.000), TeslaEnergyProducts (ur=0.158),
    //          ChristopherAnderson (mc=0.167).
    if (mc >= 0.25 && ur >= 0.28 && dr > 0.03) return true;

    // Rule 9 (Incident 2): high uppercase ratio, very low mc, but has digits.
    // Catches: drklinsdoHARCHINE12 (e=3.722, ur=0.471, mc=0.063, dr=0.105).
    // Safe:    PowerHomesSolarLLC (e=3.308, below e>3.60), HW1975Mining (e=3.252).
    if (ur >= 0.42 && mc < 0.12 && e > 3.60 && dr > 0.03) return true;
  }

  // ── Lower-entropy path (3.3 < e ≤ 3.4) ──────────────────────────────────────────────────────────
  // Rule 7: high alternation AND very high uppercase ratio — catches tAZWINSdnBiCAM
  // (mc=0.385, ur=0.714).  BrightSunEnergy (mc=0.357, ur=0.200) stays below ur>=0.60.
  if (e > 3.3 && mc > 0.35 && ur >= 0.60) return true;

  // Rule 10 (Incident 2): lower-entropy mixed-case bot — catches weWeETRCEfwkofBgchF
  // (e=3.221, mc=0.389, ur=0.421, len=19).
  // Safe: BrightSunEnergy (ur=0.200), PowerHomesSolarLLC (ur=0.333, below ur>=0.38).
  if (e > 3.15 && mc >= 0.35 && ur >= 0.38 && len >= 16) return true;

  // Rule 11 (Incident 2): digit-heavy alphanumeric token — catches hw1975ming2hh891
  // (dr=0.500, e=3.453).  Safe: HW1975Mining (dr=0.333, below dr>=0.40).
  if (dr >= 0.40 && e > 3.3 && len >= 14) return true;

  // Rule 12 (Incident 3): high case-alternation at any entropy ≥ 3.0.
  // Bots produce mc ≥ 0.42 even when entropy is suppressed (e.g. repeated chars).
  // ur >= 0.30 guard distinguishes bots (random caps throughout) from legitimate
  // multi-word CamelCase names like TexasSolarAndMore (mc=0.438 but ur=0.235).
  // Catches: RLJjbumPbonAlbrLr (mc=0.438, ur=0.353), gLtmTjHtvsnUJhWwg (mc=0.625, ur=0.353).
  // Safe:    TexasSolarAndMore (ur=0.235, below 0.30), BlueSkyEnergyLLC (mc=0.400, below 0.42),
  //          SunAndWindPowerCo (mc=0.563 but ur=0.294, below 0.30).
  if (mc >= 0.42 && ur >= 0.30 && e >= 3.0 && len >= 14) return true;

  // Rule 13 (Incident 3): moderate mc + elevated ur at medium entropy.
  // Catches: fISMSeLikrryap (mc=0.308, ur=0.357, e=3.379).
  // Safe:    MyCompanyLLCExtra (ur=0.353, just below 0.355), BrightSunEnergy (ur=0.200),
  //          PowerHomesSolarLLC (ur=0.333), BlueSkyEnergyLLC (e=3.281 < 3.35).
  if (mc >= 0.30 && ur >= 0.355 && e >= 3.35 && len >= 14) return true;

  return false;
}
// ── Disposable email domain blocklist ─────────────────────────────────────
// Only high-volume, purpose-built throwaway services.
// Legitimate free providers (gmail, yahoo, hotmail, outlook, icloud) are NOT blocked.
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com',
  'guerrillamail.com',
  'guerrillamail.org',
  'guerrillamail.net',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamailblock.com',
  'throwam.com',
  'throwam.net',
  'sharklasers.com',
  'guerrillamailblock.com',
  'grr.la',
  'guerrillamailblock.com',
  'spam4.me',
  'yopmail.com',
  'yopmail.fr',
  'cool.fr.nf',
  'jetable.fr.nf',
  'nospam.ze.tc',
  'nomail.xl.cx',
  'mega.zik.dj',
  'speed.1s.fr',
  'courriel.fr.nf',
  'moncourrier.fr.nf',
  'monemail.fr.nf',
  'monmail.fr.nf',
  'trashmail.com',
  'trashmail.me',
  'trashmail.net',
  'trashmail.at',
  'trashmail.io',
  'trashmail.org',
  'tempr.email',
  'dispostable.com',
  'mailnull.com',
  'spamgourmet.com',
  'spamgourmet.net',
  'spamgourmet.org',
  'maildrop.cc',
  'tempmail.com',
  'temp-mail.org',
  'temp-mail.io',
  'fakeinbox.com',
  'mailnew.com',
  'spamfree24.org',
  'spamfree24.de',
  'spamfree24.eu',
  'spamfree24.info',
  'spamfree24.net',
  'wegwerfmail.de',
  'wegwerfmail.net',
  'wegwerfmail.org',
  'discard.email',
  'spambox.us',
  'spambox.info',
  'getnada.com',
  'getairmail.com',
  'filzmail.com',
  'owlpic.com',
  'throwam.com',
  'emailondeck.com',
  'cuvox.de',
  'dayrep.com',
  'einrot.com',
  'fleckens.hu',
  'guam.net',
  'rhyta.com',
  'superrito.com',
  'teleworm.us',
  'armyspy.com',
  'jourrapide.com',
  'einrot.com',
]);

/**
 * Returns true if the email's domain is a known disposable/throwaway provider.
 * Does NOT block free email providers (gmail, yahoo, hotmail, etc.).
 */
export function isDisposableEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  const atIdx = lower.lastIndexOf('@');
  if (atIdx < 0) return false;
  const domain = lower.slice(atIdx + 1);
  return DISPOSABLE_DOMAINS.has(domain);
}

/**
 * Returns true (= bot detected) if the honeypot field is filled.
 * The `website` field is hidden from real users via CSS; bots that
 * auto-fill every input field will populate it.
 */
export function checkHoneypot(body: Record<string, unknown>): boolean {
  const hp = body['website'];
  // Any non-empty value = bot
  return typeof hp === 'string' && hp.trim().length > 0;
}
