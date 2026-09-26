/**
 * lib/portal/referral.ts
 *
 * 🚨 THE REFERRAL LINK RECORDED NOTHING AND LED NOWHERE.
 *
 * The portal's "Refer a Neighbor" card generated `<origin>/portal?ref=<first
 * name>` and invited the homeowner to send it to friends and neighbours. Three
 * separate things were wrong with that string:
 *
 *   1. `/portal` IS A LOGIN WALL. A neighbour who has never heard of the
 *      installer lands on an email-OTP sign-in for an account they do not have.
 *      No quote form, no explanation, no path forward. The most motivated
 *      customer the business will ever have — one volunteering to sell for it —
 *      was handed a dead end.
 *   2. `ref=<first name>` IS NOT AN IDENTITY. "Dave" does not identify a
 *      referrer, and it is the referring customer's personal data travelling in
 *      a URL they are told to post publicly.
 *   3. NOTHING READ THE PARAMETER. `/portal` has no referral handling at all, so
 *      even a correct value was discarded on arrival. A referral programme whose
 *      attributions are all dropped cannot pay anybody, which means it cannot be
 *      run.
 *
 * WHAT THIS BUILDS INSTEAD, AND WHY IN THESE EXACT PARAMETERS.
 *
 * `/free-solar-estimate` is the public intake funnel: no auth, a real form, and
 * it already forwards the canonical attribution parameters from its own query
 * string into `POST /api/intake/homeowner`, which persists them on the
 * `intake_events` row (see lib/intake/homeownerEventIntake.ts — utm_source,
 * utm_medium, utm_campaign, utm_content, utm_term are all stored).
 *
 * So the referring client's id travels in `utm_content`, because that is a
 * parameter the funnel ALREADY forwards and the intake route ALREADY stores.
 * Nothing new has to be wired for the attribution to survive the round trip.
 *
 * `ref` is sent as well, as the human-legible form of the same id. It is
 * currently NOT read by anything — stated plainly here rather than implied — and
 * exists so that a future `referral_code` consumer has the conventional
 * parameter to read. It must never be the only carrier of the attribution.
 *
 * WHAT THIS DOES NOT DO: it does not create the referral REWARD. Crediting a
 * referrer once their neighbour's project closes needs a consumer on the intake
 * side; this function only guarantees the fact reaches the database.
 */

/** Marks the channel on the intake row: a customer referral, from the portal. */
export const REFERRAL_UTM_SOURCE   = 'homeowner_referral';
export const REFERRAL_UTM_MEDIUM   = 'referral';
export const REFERRAL_UTM_CAMPAIGN = 'portal_referral';

/** The public intake funnel a referred neighbour lands on. */
export const REFERRAL_LANDING_PATH = '/free-solar-estimate';

/**
 * Builds the link a homeowner shares.
 *
 * @param baseUrl    Origin, with or without a trailing slash. May be ''.
 * @param clientId   The REFERRING client's id — never their name.
 *
 * Returns null when there is no client id to attribute to: a referral link that
 * cannot be credited is worse than no link, because the customer spends their
 * social capital and gets nothing for it.
 */
export function buildReferralUrl(baseUrl: string, clientId: string | null | undefined): string | null {
  const id = (clientId ?? '').trim();
  if (!id) return null;

  const base = baseUrl.replace(/\/+$/, '');
  const params = new URLSearchParams({
    utm_source:   REFERRAL_UTM_SOURCE,
    utm_medium:   REFERRAL_UTM_MEDIUM,
    utm_campaign: REFERRAL_UTM_CAMPAIGN,
    // The load-bearing one: forwarded by the funnel, stored by the intake route.
    utm_content:  id,
    // Conventional alias for the same id. Not yet read by anything.
    ref:          id,
  });
  return `${base}${REFERRAL_LANDING_PATH}?${params.toString()}`;
}
