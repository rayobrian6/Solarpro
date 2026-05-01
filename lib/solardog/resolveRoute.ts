/**
 * lib/solardog/resolveRoute.ts
 *
 * SolarDog navigation resolver.
 *
 * Resolves a user intent string to a SiteRoute using:
 *   1. Exact alias match (canonical + learned)
 *   2. Partial/contains match against aliases
 *   3. Substring match against route labels and descriptions
 *
 * Returns a ResolveResult with confidence and the matched route.
 * Never throws — returns { confidence: 'none' } if nothing matches.
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

/**
 * Detect if a message is a "learn" intent.
 * e.g. "command center is dashboard", "command center means dashboard"
 * Returns { phrase, route } or null.
 */
export function detectLearnIntent(message: string): { phrase: string; target: string } | null {
  const lower = message.toLowerCase().trim();

  // Bail early on question patterns — "what is X", "where is X", etc.
  if (/^(what|where|when|who|why|how|which|is|are|can|does|do|did)\b/.test(lower)) {
    return null;
  }
  // Bail on navigation intents — they're not learn intents
  if (isNavigationIntent(message)) return null;

  // Pattern 1: "<phrase> is <target>" / "<phrase> means <target>"
  const patterns = [
    /^(.+?)\s+is\s+(?:the\s+)?(.+)$/,
    /^(.+?)\s+means?\s+(?:the\s+)?(.+)$/,
    /^(.+?)\s+=\s+(.+)$/,
    /^call\s+(.+?)\s+(?:the\s+)?(.+)$/,
    /^(?:when i say|if i say|whenever i say)\s+(.+?)[,\s]+(?:go to|it means?|open|navigate to|it'?s?)\s+(.+)$/,
    /^(.+?)\s+(?:should go to|should open|should navigate to)\s+(.+)$/,
    /^remember[,:]?\s+(.+?)\s+is\s+(.+)$/,
    /^teach:?\s+(.+?)\s+→\s+(.+)$/,
    /^teach:?\s+(.+?)\s+->\s+(.+)$/,
  ];

  for (const pattern of patterns) {
    const m = lower.match(pattern);
    if (m) {
      const phrase  = normalizePhrase(m[1]).trim();
      const target  = normalizePhrase(m[2]).trim();
      if (phrase.length >= 2 && target.length >= 2) {
        return { phrase, target };
      }
    }
  }
  return null;
}