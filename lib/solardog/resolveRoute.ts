/**
 * lib/solardog/resolveRoute.ts
 *
 * SolarDog navigation resolver + intent detection.
 *
 * Resolves a user intent string to a SiteRoute using:
 *   1. Exact alias match (canonical + learned)
 *   2. Partial/contains match against aliases
 *   3. Substring match against route labels and descriptions
 *
 * Returns a ResolveResult with confidence and the matched route.
 * Never throws — returns { confidence: 'none' } if nothing matches.
 *
 * v10.2: detectLearnIntent() is now STRICT — only fires on explicit
 *        "X is Y", "X means Y", or "X = Y" patterns with validation.
 *        Added detectUnlearnIntent() for "unlearn that" / "remove that mapping".
 */

import { SITE_MAP, SiteRoute, buildAliasMap, normalizePhrase } from './siteMap';

export type RouteConfidence = 'high' | 'medium' | 'low' | 'none';

export interface ResolveResult {
  route: SiteRoute | null;
  confidence: RouteConfidence;
  /** The alias / phrase that triggered the match */
  matchedOn: string;
  /** Final URL with optional projectId appended */
  resolvedUrl: string | null;
}

/** Learned alias type (loaded from DB at runtime) */
export interface LearnedAlias {
  phrase: string;
  route: string;
  label?: string;
}

/**
 * Build a map from learned DB aliases.
 * Learned aliases shadow canonical ones (user intent wins).
 */
function buildLearnedMap(learned: LearnedAlias[]): Map<string, SiteRoute> {
  const map = new Map<string, SiteRoute>();
  for (const la of learned) {
    const key = normalizePhrase(la.phrase);
    // Create a synthetic SiteRoute for the learned alias
    const synth: SiteRoute = {
      route:       la.route,
      label:       la.label ?? la.route,
      description: `Learned: "${la.phrase}" → ${la.route}`,
      aliases:     [la.phrase],
    };
    map.set(key, synth);
  }
  return map;
}

/**
 * Main resolver.
 *
 * @param intent     - Raw user phrase, e.g. "take me to command center"
 * @param projectId  - Current project ID (for scoped routes)
 * @param learned    - Learned aliases from DB
 */
export function resolveRoute(
  intent:    string,
  projectId: string | null = null,
  learned:   LearnedAlias[] = [],
): ResolveResult {
  const normalized = normalizePhrase(intent);

  // Extract navigation intent from longer phrases
  // e.g. "take me to command center" → "command center"
  // e.g. "go to engineering" → "engineering"
  // e.g. "open the design page" → "design"
  const intentStripped = normalized
    .replace(/^(take me to|go to|go back to|navigate to|open|show me|bring me to|head to|switch to|i want to go to|let me see|take me|show|get me to|let's go to|lets go to|bring up|pull up|jump to|go)\s+/, '')
    .replace(/\s+(page|tab|section|screen|view|panel|tool|area|module)$/, '')
    .trim();

  // Build alias maps
  const canonicalMap = buildAliasMap(SITE_MAP);
  const learnedMap   = buildLearnedMap(learned);

  // ── 1. Exact match in learned aliases (highest priority) ──────────────────
  const learnedExact = learnedMap.get(normalized) ?? learnedMap.get(intentStripped);
  if (learnedExact) {
    return makeResult(learnedExact, 'high', normalized, projectId);
  }

  // ── 2. Exact match in canonical aliases ───────────────────────────────────
  const canonicalExact = canonicalMap.get(normalized) ?? canonicalMap.get(intentStripped);
  if (canonicalExact) {
    return makeResult(canonicalExact, 'high', intentStripped, projectId);
  }

  // ── 3. Partial match — does the normalized intent CONTAIN a known alias? ──
  let bestPartial: { route: SiteRoute; alias: string; len: number } | null = null;

  // Check canonical
  for (const [alias, route] of canonicalMap) {
    if (normalized.includes(alias) || intentStripped.includes(alias)) {
      if (!bestPartial || alias.length > bestPartial.len) {
        bestPartial = { route, alias, len: alias.length };
      }
    }
  }
  // Check learned (learned wins on tie)
  for (const [alias, route] of learnedMap) {
    if (normalized.includes(alias) || intentStripped.includes(alias)) {
      if (!bestPartial || alias.length >= bestPartial.len) {
        bestPartial = { route, alias, len: alias.length };
      }
    }
  }

  if (bestPartial) {
    return makeResult(bestPartial.route, 'high', bestPartial.alias, projectId);
  }

  // ── 4. Does any alias CONTAIN the stripped intent? ────────────────────────
  let bestReverse: { route: SiteRoute; alias: string } | null = null;
  for (const [alias, route] of canonicalMap) {
    if (alias.includes(intentStripped) && intentStripped.length >= 3) {
      if (!bestReverse) bestReverse = { route, alias };
    }
  }
  if (bestReverse) {
    return makeResult(bestReverse.route, 'medium', bestReverse.alias, projectId);
  }

  // ── 5. Token overlap match ────────────────────────────────────────────────
  const tokens = intentStripped.split(' ').filter(t => t.length >= 3);
  if (tokens.length > 0) {
    let topScore = 0;
    let topRoute: SiteRoute | null = null;
    let topAlias = '';

    for (const siteRoute of SITE_MAP) {
      for (const alias of siteRoute.aliases) {
        const score = tokens.filter(t => alias.includes(t)).length;
        if (score > topScore) {
          topScore = score;
          topRoute = siteRoute;
          topAlias = alias;
        }
      }
      // Also match against label
      const labelNorm = normalizePhrase(siteRoute.label);
      const labelScore = tokens.filter(t => labelNorm.includes(t)).length;
      if (labelScore > topScore) {
        topScore = labelScore;
        topRoute = siteRoute;
        topAlias = labelNorm;
      }
    }

    if (topRoute && topScore >= 1) {
      return makeResult(topRoute, topScore >= 2 ? 'medium' : 'low', topAlias, projectId);
    }
  }

  // ── No match ──────────────────────────────────────────────────────────────
  return { route: null, confidence: 'none', matchedOn: '', resolvedUrl: null };
}

/** Build the final URL, injecting projectId for project-scoped routes */
function makeResult(
  route:      SiteRoute,
  confidence: RouteConfidence,
  matchedOn:  string,
  projectId:  string | null,
): ResolveResult {
  let url = route.route;

  const params = new URLSearchParams();
  if (route.projectScoped && projectId) {
    params.set('projectId', projectId);
  }
  if (route.defaultTab) {
    params.set('tab', route.defaultTab);
  }
  const qs = params.toString();
  if (qs) url += '?' + qs;

  return { route, confidence, matchedOn, resolvedUrl: url };
}

/**
 * Detect if a user message is a navigation intent.
 * Returns true if the message looks like "go to X", "take me to X", etc.
 */
export function isNavigationIntent(message: string): boolean {
  const lower = message.toLowerCase().trim();
  return /^(take me to|go to|go back to|navigate to|open|show me|bring me to|head to|switch to|i want to go to|let me see|take me|get me to|let's go to|lets go to|bring up|pull up|jump to|go)\b/.test(lower)
    || /\b(page|navigate|navigation|go to|take me|open the)\b/.test(lower);
}

// ─────────────────────────────────────────────────────────────────────────────
// v10.2: STRICT Learn Intent Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that a learn phrase is safe to store.
 * Rules:
 *   - At least 2 chars
 *   - No more than 40 chars
 *   - No more than 4 words
 *   - Not a navigation phrase itself (avoid "go to X is Y" type confusion)
 */
export function isValidLearnPhrase(phrase: string): boolean {
  if (!phrase || phrase.length < 2) return false;
  if (phrase.length > 40) return false;
  const words = phrase.trim().split(/\s+/);
  if (words.length > 4) return false;
  // Reject if it looks like a full navigation command
  if (/^(take me to|go to|navigate to|open|show me)\b/i.test(phrase)) return false;
  return true;
}

/**
 * Validate that a learn target resolves to a known route.
 * Target must match something in the SITE_MAP (exact label, route, or alias).
 */
export function isValidLearnTarget(target: string): boolean {
  if (!target || target.length < 2) return false;
  const normalized = normalizePhrase(target);
  // Strip leading articles ("the", "a", "an") for matching
  const stripped = normalized.replace(/^(the|a|an)\s+/, '');
  // Check if target matches any known route, label, or alias
  for (const entry of SITE_MAP) {
    const label = normalizePhrase(entry.label);
    const route = normalizePhrase(entry.route);
    if (label === normalized || label === stripped) return true;
    if (route === normalized || route === stripped) return true;
    if (entry.aliases.some(a => normalizePhrase(a) === normalized || normalizePhrase(a) === stripped)) return true;
    // Partial match: known label contains the stripped target (target is a prefix/subset of a label)
    // e.g. 'engineer' matches 'Engineering'
    // NOT: target contains label (avoids 'on engineering' matching 'Engineering')
    if (label.includes(stripped) && stripped.length >= 3) return true;
  }
  return false;
}

/**
 * Detect if a message is a STRICT "learn" intent.
 *
 * v10.2: ONLY fires on:
 *   "X is Y"     — "command center is dashboard"
 *   "X means Y"  — "hub means engineering"
 *   "X = Y"      — "the shed = projects"
 *
 * All other patterns from v10.1 have been REMOVED to prevent alias poisoning.
 * The phrase must pass isValidLearnPhrase() validation.
 * The target must pass isValidLearnTarget() validation.
 *
 * Returns { phrase, target } or null.
 */
export function detectLearnIntent(message: string): { phrase: string; target: string } | null {
  const lower = message.toLowerCase().trim();

  // Bail early on question patterns — "what is X", "where is X", etc.
  if (/^(what|where|when|who|why|how|which|is|are|can|does|do|did)\b/.test(lower)) {
    return null;
  }

  // Bail on navigation intents — they're not learn intents
  if (isNavigationIntent(message)) return null;

  // Bail on unlearn intents
  if (detectUnlearnIntent(message)) return null;

  // ── STRICT patterns only (v10.2) ──────────────────────────────────────────
  // Pattern 1: "X is Y"
  const isPattern = lower.match(/^(.+?)\s+is\s+(.+)$/);
  if (isPattern) {
    const phrase = normalizePhrase(isPattern[1]).trim();
    const target = normalizePhrase(isPattern[2]).trim();
    if (isValidLearnPhrase(phrase) && isValidLearnTarget(target)) {
      return { phrase, target };
    }
  }

  // Pattern 2: "X means Y"
  const meansPattern = lower.match(/^(.+?)\s+means?\s+(.+)$/);
  if (meansPattern) {
    const phrase = normalizePhrase(meansPattern[1]).trim();
    const target = normalizePhrase(meansPattern[2]).trim();
    if (isValidLearnPhrase(phrase) && isValidLearnTarget(target)) {
      return { phrase, target };
    }
  }

  // Pattern 3: "X = Y"
  const equalsPattern = lower.match(/^(.+?)\s*=\s*(.+)$/);
  if (equalsPattern) {
    const phrase = normalizePhrase(equalsPattern[1]).trim();
    const target = normalizePhrase(equalsPattern[2]).trim();
    if (isValidLearnPhrase(phrase) && isValidLearnTarget(target)) {
      return { phrase, target };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// v10.2: Unlearn Intent Detection
// ─────────────────────────────────────────────────────────────────────────────

export interface UnlearnIntent {
  /** The phrase to delete, if specified. Null if "forget that" type (frontend uses last phrase). */
  phrase: string | null;
}

/**
 * Detect if a message is an "unlearn" / "forget" intent.
 *
 * Matches:
 *   "unlearn that"
 *   "forget that"
 *   "remove that mapping"
 *   "delete that alias"
 *   "unlearn X"
 *   "forget X"
 *   "remove the mapping for X"
 */
export function detectUnlearnIntent(message: string): UnlearnIntent | null {
  const lower = message.toLowerCase().trim();

  // "unlearn that" / "forget that" / "remove that mapping" / "delete that alias"
  if (/^(unlearn|forget)\s+that\b/.test(lower)) {
    return { phrase: null };
  }
  // "remove that mapping" / "delete that alias" — "that" must be present (no phrase)
  if (/^(remove|delete)\s+that\s+(mapping|alias)\b/.test(lower)) {
    return { phrase: null };
  }
  // "remove mapping" / "remove alias" bare (no "for X") — also no phrase
  if (/^(remove|delete)\s+(mapping|alias)\s*$/.test(lower)) {
    return { phrase: null };
  }

  // "unlearn X" — extract the phrase
  const unlearnMatch = lower.match(/^unlearn\s+(.+)$/);
  if (unlearnMatch) {
    const phrase = normalizePhrase(unlearnMatch[1]).trim();
    if (phrase.length >= 2) return { phrase };
  }

  // "forget X"
  const forgetMatch = lower.match(/^forget\s+(.+)$/);
  if (forgetMatch) {
    const phrase = normalizePhrase(forgetMatch[1]).trim();
    if (phrase.length >= 2) return { phrase };
  }

  // "remove the mapping for X" / "remove mapping for X"
  const removeMatch = lower.match(/^(?:remove|delete)\s+(?:the\s+)?(?:mapping|alias)\s+(?:for\s+)?(.+)$/);
  if (removeMatch) {
    const phrase = normalizePhrase(removeMatch[1]).trim();
    if (phrase.length >= 2) return { phrase };
  }

  return null;
}