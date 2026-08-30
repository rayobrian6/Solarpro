// ═══════════════════════════════════════════════════════════════════════════
// ONE WAY TO BUILD A POSTAL ADDRESS FROM PARTS, AND IT IS IDEMPOTENT.
//
// Two places composed a project address from a client record with the same
// expression:
//
//   [client.address, client.city, client.state, client.zip].filter(Boolean).join(', ')
//     app/api/projects/route.ts   (the server write path)
//     app/projects/new/page.tsx   (the form's auto-populate)
//
// `client.address` is frequently ALREADY a full address — the clients form
// geocodes a complete line — so composing it with city/state/zip produced:
//
//   "3 MELVIN DR APT A, GRANITE CITY, IL 62040, GRANITE CITY, IL, 62040"
//
// which is what then got stored on the project and handed to every downstream
// consumer: the geocoder, the AHJ resolver, the title block.
//
// ── WHY THE CHECK IS STRUCTURAL, NOT SUBSTRING ────────────────────────────
// The naive guard — "skip the city if the address already contains it" — is
// wrong, because a city name can legitimately appear inside a STREET name.
// "1 Granite City Rd" contains "Granite City" and still needs the city
// appended. So a component is skipped only when it already occupies a whole
// comma-separated segment (city), or is the trailing state/ZIP token pair.
//
// The result is idempotent: composing an already-composed address returns it
// unchanged, which is the property that makes it safe to call from both a form
// effect that may re-run and a server handler that may receive either shape.
// ═══════════════════════════════════════════════════════════════════════════

export interface PostalAddressParts {
  /** street line, or an already-complete address line. */
  line1?: string | null;
  city?: string | null;
  /** two-letter USPS code, or a full state name. */
  state?: string | null;
  zip?: string | null;
}

/** Compare on letters and digits only, so "St." / "St" and casing agree. */
const key = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const segmentsOf = (s: string): string[] =>
  s.split(',').map(p => p.trim()).filter(Boolean);

/**
 * Build "line1, City, ST 12345" from parts, appending only what is not already
 * there. Never throws; returns '' when there is nothing to compose.
 */
export function composePostalAddress(parts: PostalAddressParts): string {
  const line1 = (parts.line1 ?? '').trim();
  const city = (parts.city ?? '').trim();
  const state = (parts.state ?? '').trim();
  const zip = (parts.zip ?? '').trim();

  if (!line1) {
    // No street line: compose from whatever remains, in postal order.
    const tail = [state, zip].filter(Boolean).join(' ').trim();
    return [city, tail].filter(Boolean).join(', ');
  }

  const segs = segmentsOf(line1);
  const last = segs[segs.length - 1] ?? '';

  // CITY — present only if it is already a whole segment of its own. A city
  // name buried in a street name ("1 Granite City Rd") does not count.
  const hasCity = !!city && segs.some(s => key(s) === key(city));

  // STATE / ZIP — these live together in the final segment ("IL 62040"), so
  // look for them there rather than anywhere in the string; a five-digit house
  // number elsewhere in the line must not be mistaken for a ZIP.
  const hasZip = !!zip && new RegExp(`(^|\\s)${zip.replace(/[^0-9A-Za-z-]/g, '')}(\\s|$)`).test(last);
  const lastTokens = last.split(/\s+/).filter(Boolean);
  const hasState = !!state && lastTokens.some(t => key(t) === key(state));

  const out = [...segs];
  if (city && !hasCity) out.push(city);

  // The state and ZIP form ONE segment in US postal convention — "IL 62040",
  // not "IL, 62040". The old expression produced the comma form and handed it
  // to the Census geocoder.
  const tailParts: string[] = [];
  if (state && !hasState) tailParts.push(state);
  if (zip && !hasZip) tailParts.push(zip);
  if (tailParts.length) {
    // When only the ZIP is new and the state is already on the last segment,
    // append it to that segment instead of starting a new one.
    if (!state || hasState) {
      if (hasState && tailParts.length === 1 && tailParts[0] === zip) {
        out[out.length - 1] = `${out[out.length - 1]} ${zip}`.trim();
      } else {
        out.push(tailParts.join(' '));
      }
    } else {
      out.push(tailParts.join(' '));
    }
  }

  return out.join(', ');
}
