// ============================================================================
// v47.440 - Business Registry Lookup
//
// Looks up company info from public business registries to auto-fill
// the onboarding wizard's Step 2 (Company Info).
//
// 3-layer detection strategy:
//   1. OpenCorporates API — free, open database of corporate entities
//      (requires API key for high volume; falls through gracefully)
//   2. Email domain inference — extract domain from user email and
//      infer company name / website from it
//   3. Company name heuristic — normalize user-entered name,
//      generate plausible website URL, derive phone format
//
// Each detected field carries confidence + source for ConfidenceBadge.
// Results feed the ComputedField + ConfidenceBadge UX pattern.
//
// FUTURE ML INTEGRATION POINTS:
//   - OCR on business license / registration document uploads
//   - Google Places API for business phone + address
//   - LinkedIn company profile scraper (with consent)
// ============================================================================

import type {
  BusinessRegistryResult,
  DetectedBusinessField,
} from './types';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
export interface BusinessLookupInput {
  /** User's email address (for domain inference) */
  email?: string;
  /** User-entered company name (for normalization + lookup) */
  companyName?: string;
  /** User's phone (for area-code-based region inference) */
  phone?: string;
}

// ---------------------------------------------------------------------------
// OpenCorporates API — Layer 1
// ---------------------------------------------------------------------------

/**
 * Query OpenCorporates for company data.
 * Free tier: 100 requests/day, no API key required.
 * With API key: higher limits, more fields.
 *
 * Returns null on any failure (network, no results, etc.)
 */
async function lookupOpenCorporates(
  companyName: string,
): Promise<{
  name: string | null;
  address: string | null;
  website: string | null;
  companyNumber: string | null;
  jurisdiction: string | null;
} | null> {
  const apiKey = process.env.OPENCORPORATES_API_KEY || '';
  const encodedName = encodeURIComponent(companyName);

  try {
    const url = apiKey
      ? `https://api.opencorporates.com/v0.4/companies/search?q=${encodedName}&api_token=${apiKey}`
      : `https://api.opencorporates.com/v0.4/companies/search?q=${encodedName}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000), // 8s timeout
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      results?: {
        companies?: Array<{
          company?: {
            name?: string;
            registered_address?: string;
            homepage_url?: string;
            company_number?: string;
            jurisdiction_code?: string;
            inactive?: boolean;
          };
        }>;
      };
    };

    const companies = data.results?.companies;
    if (!companies || companies.length === 0) return null;

    // Find the best match: prefer active companies with matching name
    const activeMatches = companies.filter(
      (c) => c.company && !c.company.inactive,
    );

    // Find exact or close match
    const lowerName = companyName.toLowerCase().trim();
    const exactMatch = activeMatches.find(
      (c) => c.company?.name?.toLowerCase() === lowerName,
    );
    const closeMatch = activeMatches.find(
      (c) => c.company?.name?.toLowerCase().includes(lowerName) ||
             lowerName.includes(c.company?.name?.toLowerCase() || '___'),
    );
    const best = exactMatch || closeMatch || activeMatches[0];

    if (!best?.company) return null;

    // Build address from registered_address field
    const addr = best.company.registered_address || null;

    return {
      name: best.company.name || null,
      address: addr,
      website: best.company.homepage_url || null,
      companyNumber: best.company.company_number || null,
      jurisdiction: best.company.jurisdiction_code || null,
    };
  } catch {
    // Network error, timeout, JSON parse failure — fall through to heuristic
    return null;
  }
}

// ---------------------------------------------------------------------------
// Email domain inference — Layer 2
// ---------------------------------------------------------------------------

/** Common personal email domains that should NOT be used for company inference */
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'protonmail.com', 'zoho.com',
  'yandex.com', 'mail.com', 'inbox.com', 'gmx.com', 'fastmail.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net',
  'qq.com', '163.com', '126.com',  // Chinese personal email
]);

/** Common ISP / non-business domains */
const ISP_DOMAINS = new Set([
  'comcast.net', 'verizon.net', 'cox.net', 'spectrum.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'earthlink.net',
]);

/**
 * Extract company info from email domain.
 * "jsmith@sunshinesolar.com" → company name "Sunshine Solar", website "https://sunshinesolar.com"
 */
function inferFromEmailDomain(
  email: string,
): {
  companyName: string | null;
  companyWebsite: string | null;
} {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return { companyName: null, companyWebsite: null };

  // Skip personal/ISP domains
  if (PERSONAL_DOMAINS.has(domain) || ISP_DOMAINS.has(domain)) {
    return { companyName: null, companyWebsite: null };
  }

  // Strip www. prefix if present
  const bareDomain = domain.replace(/^www\./, '');

  // Convert domain to company name:
  // "sunshinesolar.com" → "Sunshine Solar"
  const domainPart = bareDomain.split('.')[0];
  if (!domainPart || domainPart.length < 3) {
    return { companyName: null, companyWebsite: null };
  }

  // Split camelCase / run-together words at likely boundaries
  // e.g. "sunshinesolar" → "Sunshine Solar"
  const companyName = domainPart
    // Insert space before uppercase letters (camelCase)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // Insert space at likely word boundaries (common solar terms)
    .replace(/(solar|energy|electric|power|renewable|green|sun|wind)/gi, ' $1')
    // Clean up double spaces
    .replace(/\s+/g, ' ')
    .trim()
    // Title case
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Only return if we got a reasonable company name
  if (companyName.length < 3) {
    return { companyName: null, companyWebsite: null };
  }

  return {
    companyName,
    companyWebsite: `https://${bareDomain}`,
  };
}

// ---------------------------------------------------------------------------
// Company name heuristic — Layer 3
// ---------------------------------------------------------------------------

/**
 * Normalize a user-entered company name and derive plausible values.
 * - Remove common suffixes (LLC, Inc, etc.)
 * - Generate website URL from normalized name
 * - Return normalized name as suggestion
 */
function heuristicFromCompanyName(
  companyName: string,
): {
  normalizedName: string;
  suggestedWebsite: string | null;
} {
  if (!companyName.trim()) {
    return { normalizedName: '', suggestedWebsite: null };
  }

  // Common business suffixes to strip for URL generation
  const suffixes = [
    /\s+LLC\.?$/i,
    /\s+Inc\.?$/i,
    /\s+Corp\.?$/i,
    /\s+Corporation$/i,
    /\s+Co\.?$/i,
    /\s+Company$/i,
    /\s+Ltd\.?$/i,
    /\s+Limited$/i,
    /\s+LP$/i,
    /\s+LLP$/i,
    /\s+L\.?L\.?C\.?$/i,
    /\s+P\.?A\.?$/i,
    /\s+P\.?C\.?$/i,
    /\s+P\.?L\.?L\.?C\.?$/i,
  ];

  let normalizedName = companyName.trim();

  // Remove suffixes to get the core name
  let coreName = normalizedName;
  for (const suffix of suffixes) {
    coreName = coreName.replace(suffix, '');
  }
  coreName = coreName.trim();

  // Generate website from core name
  // "Sunshine Solar Co." → "sunshinesolar.com"
  const websiteSlug = coreName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')  // remove non-alphanumeric
    .replace(/^https?/, '');       // don't include protocol part

  const suggestedWebsite = websiteSlug.length >= 5
    ? `https://${websiteSlug}.com`
    : null;

  return {
    normalizedName,
    suggestedWebsite,
  };
}

// ---------------------------------------------------------------------------
// Phone area-code → state mapping (for jurisdiction inference)
// ---------------------------------------------------------------------------

/** Map area code prefix to US state code (for heuristic jurisdiction) */
function areaCodeToState(phone: string): string | null {
  // Strip non-digits
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;

  const areaCode = digits.slice(0, 3);

  // Simplified mapping of common area codes to states
  const areaCodeMap: Record<string, string> = {
    '480': 'AZ', '520': 'AZ', '602': 'AZ', '623': 'AZ', '928': 'AZ',
    '213': 'CA', '310': 'CA', '323': 'CA', '408': 'CA', '415': 'CA',
    '510': 'CA', '619': 'CA', '626': 'CA', '650': 'CA', '707': 'CA',
    '714': 'CA', '760': 'CA', '805': 'CA', '818': 'CA', '831': 'CA',
    '858': 'CA', '909': 'CA', '916': 'CA', '925': 'CA', '949': 'CA',
    '951': 'CA',
    '303': 'CO', '720': 'CO', '719': 'CO', '970': 'CO',
    '202': 'DC',
    '305': 'FL', '321': 'FL', '352': 'FL', '386': 'FL', '407': 'FL',
    '561': 'FL', '727': 'FL', '772': 'FL', '813': 'FL', '850': 'FL',
    '863': 'FL', '904': 'FL', '941': 'FL', '954': 'FL',
    '404': 'GA', '470': 'GA', '678': 'GA', '706': 'GA', '770': 'GA',
    '808': 'HI',
    '208': 'ID',
    '312': 'IL', '331': 'IL', '618': 'IL', '630': 'IL', '708': 'IL',
    '773': 'IL', '815': 'IL', '847': 'IL', '872': 'IL',
    '219': 'IN', '260': 'IN', '317': 'IN', '463': 'IN', '574': 'IN',
    '765': 'IN', '812': 'IN',
    '319': 'IA', '515': 'IA', '563': 'IA', '641': 'IA', '712': 'IA',
    '316': 'KS', '620': 'KS', '785': 'KS', '913': 'KS',
    '270': 'KY', '364': 'KY', '502': 'KY', '606': 'KY', '859': 'KY',
    '225': 'LA', '318': 'LA', '337': 'LA', '504': 'LA', '985': 'LA',
    '207': 'ME',
    '240': 'MD', '301': 'MD', '410': 'MD', '443': 'MD', '667': 'MD',
    '413': 'MA', '508': 'MA', '617': 'MA', '774': 'MA', '781': 'MA',
    '857': 'MA', '978': 'MA',
    '248': 'MI', '269': 'MI', '313': 'MI', '517': 'MI', '586': 'MI',
    '616': 'MI', '734': 'MI', '810': 'MI', '906': 'MI', '989': 'MI',
    '218': 'MN', '320': 'MN', '507': 'MN', '612': 'MN', '651': 'MN',
    '763': 'MN', '952': 'MN',
    '228': 'MS', '601': 'MS', '662': 'MS', '769': 'MS',
    '314': 'MO', '417': 'MO', '573': 'MO', '636': 'MO', '660': 'MO',
    '816': 'MO',
    '406': 'MT',
    '308': 'NE', '402': 'NE', '531': 'NE',
    '702': 'NV', '775': 'NV',
    '603': 'NH',
    '201': 'NJ', '551': 'NJ', '609': 'NJ', '732': 'NJ', '848': 'NJ',
    '856': 'NJ', '862': 'NJ', '908': 'NJ', '973': 'NJ',
    '505': 'NM', '575': 'NM',
    '212': 'NY', '315': 'NY', '332': 'NY', '347': 'NY', '516': 'NY',
    '518': 'NY', '585': 'NY', '607': 'NY', '631': 'NY', '646': 'NY',
    '716': 'NY', '718': 'NY', '845': 'NY', '914': 'NY', '917': 'NY',
    '929': 'NY',
    '252': 'NC', '336': 'NC', '704': 'NC', '743': 'NC', '828': 'NC',
    '910': 'NC', '919': 'NC', '980': 'NC', '984': 'NC',
    '701': 'ND',
    '216': 'OH', '234': 'OH', '330': 'OH', '419': 'OH', '440': 'OH',
    '513': 'OH', '614': 'OH', '740': 'OH', '937': 'OH',
    '405': 'OK', '539': 'OK', '580': 'OK', '918': 'OK',
    '503': 'OR', '541': 'OR', '971': 'OR',
    '215': 'PA', '267': 'PA', '412': 'PA', '484': 'PA', '570': 'PA',
    '610': 'PA', '717': 'PA', '724': 'PA', '814': 'PA', '878': 'PA',
    '401': 'RI',
    '803': 'SC', '843': 'SC', '854': 'SC', '864': 'SC',
    '605': 'SD',
    '423': 'TN', '615': 'TN', '629': 'TN', '731': 'TN', '865': 'TN',
    '901': 'TN', '931': 'TN',
    '210': 'TX', '214': 'TX', '254': 'TX', '281': 'TX', '325': 'TX',
    '361': 'TX', '409': 'TX', '432': 'TX', '469': 'TX', '512': 'TX',
    '682': 'TX', '713': 'TX', '806': 'TX', '817': 'TX', '830': 'TX',
    '832': 'TX', '903': 'TX', '915': 'TX', '936': 'TX', '940': 'TX',
    '956': 'TX', '972': 'TX', '979': 'TX',
    '385': 'UT', '435': 'UT', '801': 'UT',
    '802': 'VT',
    '276': 'VA', '434': 'VA', '540': 'VA', '571': 'VA', '703': 'VA',
    '757': 'VA', '804': 'VA',
    '206': 'WA', '253': 'WA', '360': 'WA', '425': 'WA', '509': 'WA',
    '304': 'WV', '681': 'WV',
    '262': 'WI', '414': 'WI', '608': 'WI', '715': 'WI', '920': 'WI',
    '307': 'WY',
  };

  return areaCodeMap[areaCode] || null;
}

// ---------------------------------------------------------------------------
// Main lookup function
// ---------------------------------------------------------------------------

/**
 * Look up business information from public registries.
 *
 * Strategy:
 *   1. If companyName provided → try OpenCorporates API
 *   2. If email provided → infer company name + website from domain
 *   3. If companyName provided → heuristic name normalization + website
 *
 * Each layer fills in fields that the previous layer didn't find.
 * Results carry confidence + source for ConfidenceBadge.
 */
export async function lookupBusiness(
  input: BusinessLookupInput,
): Promise<BusinessRegistryResult> {
  const { email, companyName, phone } = input;
  const emptyField = <T>(v: T | null, conf: number, src: DetectedBusinessField<T>['source'], der: string): DetectedBusinessField<T> | null =>
    v != null ? { value: v, confidence: conf, source: src, derivation: der } : null;

  // Accumulate results from each layer
  let resolvedName: DetectedBusinessField<string> | null = null;
  let resolvedPhone: DetectedBusinessField<string> | null = null;
  let resolvedAddress: DetectedBusinessField<string> | null = null;
  let resolvedWebsite: DetectedBusinessField<string> | null = null;
  let registryId: string | null = null;
  let jurisdiction: string | null = null;
  let method: BusinessRegistryResult['method'] = 'none';

  // ── Layer 1: OpenCorporates API ──────────────────────────────────────────
  if (companyName?.trim()) {
    const ocResult = await lookupOpenCorporates(companyName.trim());

    if (ocResult) {
      method = 'opencorporates_api';

      if (ocResult.name) {
        resolvedName = emptyField(ocResult.name, 0.85, 'opencorporates',
          `Matched in OpenCorporates registry${ocResult.companyNumber ? ` (ID: ${ocResult.companyNumber})` : ''}`);
      }
      if (ocResult.address) {
        resolvedAddress = emptyField(ocResult.address, 0.7, 'opencorporates',
          'Registered address from OpenCorporates');
      }
      if (ocResult.website) {
        resolvedWebsite = emptyField(ocResult.website, 0.75, 'opencorporates',
          'Homepage URL from OpenCorporates');
      }
      registryId = ocResult.companyNumber;
      jurisdiction = ocResult.jurisdiction
        ? `US_${ocResult.jurisdiction.toUpperCase()}`
        : null;
    }
  }

  // ── Layer 2: Email domain inference ──────────────────────────────────────
  if (email?.trim()) {
    const domainInference = inferFromEmailDomain(email.trim());

    if (domainInference.companyName && !resolvedName) {
      method = method === 'none' ? 'email_domain' : method;
      resolvedName = emptyField(domainInference.companyName, 0.5, 'email-domain',
        `Inferred from email domain: ${email.split('@')[1]}`);
    }

    if (domainInference.companyWebsite && !resolvedWebsite) {
      resolvedWebsite = emptyField(domainInference.companyWebsite, 0.45, 'email-domain',
        `Derived from email domain: ${email.split('@')[1]}`);
    }
  }

  // ── Layer 3: Company name heuristic ──────────────────────────────────────
  if (companyName?.trim() && !resolvedName) {
    method = method === 'none' ? 'company_name_heuristic' : method;

    // The user already typed a name — we don't override it,
    // but we can normalize it (strip suffixes, title case, etc.)
    resolvedName = emptyField(companyName.trim(), 0.3, 'company-name-heuristic',
      'User-entered company name (no registry match found)');
  }

  // Website heuristic: generate from company name if still missing
  if (!resolvedWebsite && companyName?.trim()) {
    const heur = heuristicFromCompanyName(companyName.trim());
    if (heur.suggestedWebsite) {
      resolvedWebsite = emptyField(heur.suggestedWebsite, 0.2, 'company-name-heuristic',
        `Generated from company name: ${heur.normalizedName}`);
    }
  }

  // ── Jurisdiction from phone area code (supplement) ──────────────────────
  if (!jurisdiction && phone) {
    const state = areaCodeToState(phone);
    if (state) {
      jurisdiction = `US_${state}`;
    }
  }

  return {
    companyName: resolvedName,
    companyPhone: resolvedPhone,
    companyAddress: resolvedAddress,
    companyWebsite: resolvedWebsite,
    registryId,
    jurisdiction,
    method,
    lookedUpAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Future ML integration points
// ---------------------------------------------------------------------------

/**
 * FUTURE: Extract company info from a scanned business license / registration
 * document using OCR + ML.
 *
 * Would accept an uploaded image/PDF and return extracted fields.
 * Currently returns null — placeholder for future implementation.
 */
export async function extractFromBusinessDocument(
  _documentUrl: string,
): Promise<BusinessRegistryResult | null> {
  // TODO: Implement document OCR extraction
  // 1. Download document from URL
  // 2. Run OCR (Tesseract / cloud vision API)
  // 3. Parse business license fields (name, address, license #, etc.)
  // 4. Return BusinessRegistryResult with 'document-ocr' source
  return null;
}

/**
 * FUTURE: Google Places API lookup for business phone + address.
 *
 * Would use the Google Places API to find the business and extract
 * phone number, formatted address, and website.
 * Currently returns null — placeholder for future implementation.
 */
export async function lookupGooglePlaces(
  _companyName: string,
  _latitude?: number,
  _longitude?: number,
): Promise<BusinessRegistryResult | null> {
  // TODO: Implement Google Places API lookup
  // 1. Call Places API text search with company name
  // 2. Extract phone, address, website from Place result
  // 3. Return BusinessRegistryResult with 'google-places' source
  return null;
}
