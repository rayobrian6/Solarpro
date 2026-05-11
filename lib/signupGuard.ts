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
 *   Requires ALL of: length > 14, Shannon entropy > 3.4, plus at least one of:
 *
 *   Rule 1 — high case-alternation ratio (mc > 0.35):
 *     Random generators produce upper/lower transitions on nearly every character.
 *     Normal CamelCase company names only capitalise word starts.
 *
 *   Rule 2 — extremely high entropy (> 4.0):
 *     Catches sequential-character strings that evade the mc check.
 *
 *   Rule 3 — elevated uppercase ratio + some mixing (ur > 0.38 AND mc > 0.15):
 *     Catches strings where many random chars happen to be uppercase.
 *     The mc > 0.15 guard excludes legitimate ALL-CAPS company abbreviations.
 *
 *   Rule 4 — combined mc + ur signal (mc + ur > 0.70 AND mc > 0.15):
 *     Catches mid-level cases like "meaioGMtCwSIF2ygn" where neither rule
 *     alone fires but the combined score is clearly non-human.
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

/**
 * Returns true if the string looks like a machine-generated gibberish token.
 * Only fires on single-word strings longer than 14 characters with high entropy.
 * All legitimate company names and personal names in our test suite pass through.
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

  // Length and entropy gate — all rules require this baseline.
  if (len <= 14 || e <= 3.4) return false;

  // Rule 1: high case-alternation (classic random generator output)
  if (mc > 0.35) return true;

  // Rule 2: extremely high entropy alone (sequential-unique characters)
  if (e > 4.0) return true;

  // Rule 3: many uppercase chars + some mixing (exclude pure ALL-CAPS abbreviations)
  if (ur > 0.38 && mc > 0.15) return true;

  // Rule 4: combined mc + ur signal (catches mid-level cases)
  if ((mc + ur) > 0.70 && mc > 0.15) return true;

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
