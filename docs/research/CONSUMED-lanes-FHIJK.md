# CONSUMED — Lanes F, H, I, J, K

Research consumption pass, 2026-09-25. Input: `docs/research/lanes/lane-F-site-survey.md`,
`lane-HI-finance-procurement.md`, `lane-JK-enterprise-admin.md`. Format follows
`docs/research/ROUND-3-TRIAGE.md`.

**This document gathers nothing new.** Every row below was re-verified against the code with
file:line evidence. Where a lane's claim did not survive verification it is marked **REFUTED** or
**REFINED** and the corrected claim is given. A refutation is as valuable as a confirmation.

**Governing constraint, applied to every row.** SolarPro must never gain a second authority — no
second source of truth for pricing, equipment, geometry or status. Any candidate that would create
one is `REJECT` with that reason stated in the row. Three candidates were rejected on exactly this
ground (I-5, J-5, H-5) and they are listed with the others, not hidden.

---

## VERIFICATION LOG — what survived, what did not

| # | lane claim | verdict | evidence |
|---|---|---|---|
| V1 | `lib/survey/evidence/fieldOrchestration.ts` is a 9-zone movement-ordered capture plan imported only by an admin page and its own test | **VERIFIED** | 9 steps `01_…`–`09_…`, each with `movementZone`, `technicianInstruction`, per-item `priority`/`canonicalCategory`/`engineeringUsage` (`lib/survey/evidence/fieldOrchestration.ts:14-19, 97-221`). Importers of `fieldOrchestration`: `app/admin/engineering-intelligence/project/[id]/page.tsx:7`, `app/admin/engineering-intelligence/components.tsx:49` (type-only), and `fieldOrchestration.test.ts`. `grep "survey/evidence" app/survey components/survey` → **zero hits** |
| V2 | Three disconnected taxonomies | **VERIFIED, with counts corrected** | `PhotoCategory` = **9** (`lib/survey/v2/types.ts:151-160`); `SurveyEvidenceCategory` = **26**, not ~25 (`lib/survey/evidence/categoryRegistry.ts:3-29`); `EngineeringRequirementId` = **12** (`lib/survey/evidence/engineeringRequirements.ts:16-28`). 3 `blocking` + 2 `review_required` confirmed at `engineeringRequirements.ts:196, 212, 228, 244, 292`. `rafters` is a `SurveyEvidenceCategory` with **no `PhotoCategory` slot**; `attic_access` is `review_required` in the registry but absent from `REQUIRED_PHOTO_CATEGORIES` (`types.ts:177-183`). The "finish 5/5 and drive away while structural review is already flagged" claim holds |
| V3 | No offline path in survey surfaces | **VERIFIED** | `grep -n "navigator.onLine\|serviceWorker\|indexedDB" app/survey components/survey lib/survey` → **zero hits** |
| V4 | `availableBreakerSlots` is a count that cannot answer NEC 705.12(B) adjacency | **VERIFIED** | Typed `string \| null` and preserved as a categorical label — `lib/siteSurvey/types.ts:288`, `lib/engineering/types.ts:240`; tests pin `'5+'` and `'1-2'` as opaque display strings (`lib/siteSurvey/siteSurvey.test.ts:422-434`). No busbar field anywhere in survey surfaces (`grep -i busbar lib/survey components/survey app/survey` → zero) |
| V5 | `lib/db.ts:608` carries `taxCreditRate: 30` with a comment asserting P.L. 119-21 has NOT been enacted, and the value is inert | **VERIFIED on both halves — but the lane understated the problem** | The comment at `lib/db.ts:608` is factually wrong (P.L. 119-21 enacted 2025-07-04). The value **is** inert: `defaultPricing` is read only at `lib/db.ts:626` by the in-memory `Database` class, surfaced by `getPricing()` at `:850`, which has **zero callers**; the only three importers of `lib/db` (`app/api/equipment/save/route.ts`, `app/api/hardware/route.ts`, `tests/panel-catalog-unified.test.ts`) call panel/inverter/mounting/battery methods only. **However — see V6. A live copy of the same false claim exists on a reachable path, and the lane missed it.** |
| V6 | (not claimed by any lane) | **NEW — P0** | `app/proposals/page.tsx:1219-1221` carries the same false assertion verbatim — *"P.L. 119-21 referenced in old comments is a hypothetical future bill that has NOT been enacted. Do not treat it as current law."* — and `:1240` resolves `(pricingCfg?.itcRateResidential ?? 30); // IRA §25D — 30% current law`. This is **not** a dead path. Full chain below |
| V7 | SolarPro's BOM sits inside the permit snapshot so a part swap moves the digest and retires a PE approval — a MOAT, not a defect | **VERIFIED** | `partNumber` is in the content identity key: `bomLineIdentityKey()` emits `PN:${norm(row.partNumber)}` (`lib/bom/bomLineId.ts:78-86`); the key is `stageId \| category \| partNumber-or-description \| unit \| subSystem` with quantity deliberately excluded. The BOM is inside the snapshot at `lib/permit/snapshot/build.ts:3155` (`bom: structAuth.bom`), and the digest is SHA-256 over the canonical JSON of the whole snapshot minus `meta.digest` and the build stamp (`lib/permit/snapshot/digest.ts:218-222`). A part swap therefore moves the digest, and per this project's standing ruling a digest move retires a live PE approval. **Write this up as an advantage to protect** |
| V8 | `pricing_config` is one global row | **VERIFIED** | `lib/migrations/004_pricing_config.sql` — no `user_id`, no `org_id`, no `company`; seeded `WHERE NOT EXISTS`. It is the **only** DDL for the table in `lib/migrations/` |
| V9 | `app/admin/pricing/page.tsx` masks the global row with a hardcoded fallback that DISAGREES with the schema's documented fallback | **REFINED — the stated disagreement is wrong, the real one is worse** | The page's `DEFAULTS` (`app/admin/pricing/page.tsx:39-48`: roof 3.10 / ground 2.35 / fence 4.25 / carport 3.75) **exactly match migration 004's seeded row values** — so the page does not disagree with the seed. The schema's `-- NULL = use price_per_watt` comment disagrees with the schema's own seed, which writes non-NULL per-type values. **The genuine, verified divergence is between the admin page and the calculating authority:** on a NULL column the page shows `?? DEFAULTS.groundPricePerWatt` = **$2.35/W** (`:301`) while `lib/pricingEngine.ts:170` resolves `row.groundPricePerWatt ?? row.pricePerWatt` = **$3.10/W**. The admin sees a price that is not the price that would be charged. That is a second display authority for money |
| V10 | No revert-to-inherited exists anywhere | **VERIFIED** | `lib/db/featureFlags.ts` exports `getFeatureFlag`, `listFeatureFlags`, `setFeatureFlag`, `invalidateFeatureFlagCache`, `getSolarDogEnabled`, `featureFlagsTableExists` — **no clear/delete/unset**. `app/api/admin/feature-flags/route.ts` exports `GET` (`:26`) and `PUT` (`:53`) only. Once a flag has a DB row it can never return to inheriting from the environment |
| V11 | The impersonation banner is client-side with a dismiss button | **VERIFIED** | `components/ui/ImpersonationBanner.tsx` — `'use client'`, detects impersonation from `?impersonating=1` into `sessionStorage`, and ships a dismiss control titled literally `Dismiss banner (impersonation still active)`. A new tab, a cleared session store or one click removes the only indication, while the session continues |

### V6 in full — the live residential-ITC chain (P0, not in any lane)

Five fallback constants for the same value, and they disagree:

| where | value | line |
|---|---|---|
| `lib/db/pricing.ts` (**DB read layer**) | `(row.itc_rate_residential as number) ?? 30` → **30** | `:46` |
| `lib/db/pricing.ts` (INSERT path) | `${data.itcRateResidential ?? 30}` → **30** | `:146` |
| `app/api/pricing/route.ts` `DEFAULT_CONFIG` | **30** | `:40` |
| `lib/pricingEngine.ts` `DEFAULT_CONFIG` | **0** | `:138` |
| `app/admin/pricing/page.tsx` `DEFAULTS` | **0** | `:58` |

The chain:

1. `lib/migrations/004_pricing_config.sql` — the only registered migration for this table — **does not create
   `itc_rate_residential` at all** (nor `pricing_mode`, `default_panel_wattage`, `itc_rate_commercial`,
   `*_price_per_panel`). `grep` for those column names across every `.sql` in the repo returns **zero**.
   The only DDL that creates them is an unregistered inline `CREATE TABLE IF NOT EXISTS` inside
   `app/api/pricing/route.ts:90-119` — which is a no-op on a database where 004 already created the table.
   Where the column does get created there, its DDL default is `NOT NULL DEFAULT 30`.
2. Either way `getPricingConfig()` returns `itcRateResidential: 30` — from `?? 30` when the column is absent
   or NULL, or from the DDL default when it exists.
3. `lib/pricingEngine.ts:179` then applies `itcRateResidential: row.itcRateResidential ?? 0`. **That guard can
   never fire**, because step 2 has already replaced null/undefined with 30. Same class of defect as memory
   `regex-backslash-b-becomes-backspace`: a guard that is structurally incapable of matching, tsc-clean.
4. `app/api/production/route.ts:91-93` — `itcPercent = pricingCfg.isCommercial ? itcRateCommercial :
   itcRateResidential` → `itcAmount = Math.round(cashPrice * itcPercent/100)` → `netCost = cashPrice -
   itcAmount`. Persisted as `costEstimate.taxCredit` / `costEstimate.netCost` (`:125-126`) on every save path
   (`:444`, `:553`). `lib/pricingEngine.ts:406` does the same in `calculateFinalPrice`.
5. **`guardItcValue()` does not cover this path.** Its only callers are `lib/proposal/buildCanonicalProposal.ts:726`
   and `lib/proposal/incentiveTruthEngine.ts:164`. `lib/pricingEngine.ts`, `app/api/production/route.ts` and
   `app/proposals/page.tsx` call neither `isItcEnabled()` nor `guardItcValue()`.
6. `app/proposals/page.tsx:1240` independently reproduces the 30% with a comment declaring it current law, and
   feeds `_preEffectiveNet` → `paybackYears` whenever `cost?.paybackYears` is absent.

**Net effect.** The canonical proposal is safe — `buildCanonicalProposal.ts:720-726` hardcodes residential to 0
and guards the amount. But the *stored cost estimate* the proposal reads first, and the proposal page's own
bootstrap payback, both compute a 30% residential credit that was repealed for 2026 installs. The admin looking
at `/admin/pricing` sees **0%** and has no reason to touch it. This is precisely the harm the CFPB spotlight in
Lane H names, produced by SolarPro rather than by a lender.

**Honest bound:** the value is 30 only where `itc_rate_residential` is absent or NULL — which is the default
state of every SolarPro database, since no registered migration creates the column. An admin who has explicitly
saved a 0 is safe, but the admin page shows 0 already, so they have no prompt to save one.

---

## THE MATRIX

`implementation status` is `PROPOSED` and `live acceptance` is `NOT STARTED` on every row, by instruction.

| lane | best competitor behavior | worst competitor behavior | SolarPro current behavior | verified gap | SolarPro advantage | recommended action | verdict | user value | RE+ impact | implementation risk | estimated scope | canonical authority affected | implementation status | live acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **H** | Aurora prints one cost under two labels — `Total system cost (incentives applied today)` / `Net cost (incentives applied later)` (`8cjFBN1GOBE` 12:52) | Aurora's own incentive row ships `Applied? = on`, `-30.00%` in a demo published 2025-10-28, four months after §25D repeal; OpenSolar defaults incentives on too | Canonical proposal is correct (`buildCanonicalProposal.ts:714-726`, `guardItcValue`), but the **cost-estimate** path computes a 30% residential credit: `lib/db/pricing.ts:46` `?? 30` → `pricingEngine.ts:179` `?? 0` (dead guard) → `app/api/production/route.ts:91-93` → persisted `costEstimate.netCost`; `app/proposals/page.tsx:1240` repeats it with the comment `// IRA §25D — 30% current law` | **VERIFIED P0.** A repealed credit reaches a stored, user-visible savings number and a payback year. Five disagreeing fallback constants; the admin page shows 0% while the read layer returns 30% | `incentivesConfig.ts` is already the right single authority — `isItcEnabled()`/`guardItcValue()` exist, are tested, and log `[INCENTIVE LEAK DETECTED]`. Nothing new needs inventing | Route **every** residential-ITC read through `isItcEnabled()`/`guardItcValue()`; delete the four non-authoritative fallbacks; fix the two false P.L. 119-21 comments | **STEAL** (own guard, applied everywhere) | HIGH | HIGH — "we never print a dead credit" is a demo line SolarPro can say truthfully | LOW | ~1 sitting, 8 files | `lib/incentivesConfig.ts` — strengthened, not duplicated | PROPOSED | NOT STARTED |
| **I** | SurgePV check 6 — a substitution is a state machine (`proposed → under review → accepted for a named purpose → rejected`), and acceptance must *"reopen that artifact and any dependent checks"* | OpenSolar states in its own docs that Hardware-tab edits *"do not impact your Design page or the proposal provided to the customer"* — a purchaser can swap the inverter and the SLD keeps naming the original | The BOM is generated from the design and lands **inside** the permit snapshot (`build.ts:3155`); `partNumber` is in the `bomLineId` content key (`bomLineId.ts:78-86`); the digest is SHA-256 over the whole snapshot (`digest.ts:218-222`). A part swap moves the digest and retires the PE approval — **automatically and unavoidably** | **No gap in the mechanism. The gap is that nothing tells the purchaser what they just did.** There is no substitution object, no approval state, no approver; the only governance is a printed note at `lib/permit_gen.mjs:608` | **This is the moat.** SolarPro is the only product in this corpus where a substitution *cannot* quietly invalidate a stamped design. Protect it explicitly: a "Sync from Design" style decoupling must never be added | Build the consequence screen: *"Changing this part moves the design digest and retires PE approval #NNN. Affected sheets: …"* Compute the affected set from the digest, which SolarPro can do exactly | **STEAL** (the screen) / **REJECT** (any decoupled BOM) | HIGH | HIGH — the single clearest leapfrog claim available | LOW | ~1 sitting, read-only screen | `lib/permit/snapshot/*` — **read only**, no new writer | PROPOSED | NOT STARTED |
| **F** | Scanifly gates Submit until every required field is filled and reveals per-section required-field counts; Interplay explains *why* each electrical question exists and its code basis | SiteCapture's completed report *"vanishes from the device for good"*; SolarTools ships in-app ads inside a professional survey tool | The full engineering requirement verdict exists and is tested (`buildEngineeringRequirementEvaluation`), but is rendered only on a 3,829-line office page at `app/projects/[id]/survey/[surveyId]/page.tsx`. `grep "survey/evidence" app/survey components/survey` → zero | **VERIFIED.** A crew can satisfy all 5 `REQUIRED_PHOTO_CATEGORIES` and leave while `structural_access` is already `review_required` (`engineeringRequirements.ts:292`) and `attic_access` is optional in the field app | SolarPro's satellite prefill with accept/override and a struck-through superseded value (`StepRoof.tsx`) is better than anything in the corpus. The registry itself is better than any competitor's authored checklist | Expose `GET /api/survey/readiness?token=…` and render blocking / review-required / informational as three bands on step 6, each naming the capture item and the zone to walk back to | **STEAL** | HIGH | HIGH — "the crew cannot leave missing what engineering needs" demos in 30 seconds | LOW | ~1 sitting, 1 route + 1 section | `lib/survey/evidence/engineeringRequirements.ts` — **the existing authority, newly reachable** | PROPOSED | NOT STARTED |
| **J** | Google Admin ships `On/Off Inherit Status` as a literal column reading `Inherited`/`Overridden` beside the value, plus a named `Inherit` button that restores the parent value (`6LBnZaDirCg` 05:42, 07:31) | Solargraf's "Copy settings to dealers" is a snapshot, not a link — after the copy the parent can never fix a mistake across its network; enabling dealer config is *irreversible* | `app/admin/pricing/page.tsx:301` shows `c.groundPricePerWatt ?? 2.35` while `lib/pricingEngine.ts:170` resolves `?? row.pricePerWatt` (3.10). `:58` shows residential ITC 0 while `lib/db/pricing.ts:46` returns 30 | **VERIFIED, sharper than claimed.** The lane said the page disagrees with the schema comment; in fact the page's constants match the seed exactly. The real divergence is **page vs calculating engine, on money, in two places** | The precedence primitive already exists in exactly one page: `app/admin/distributor-prices/page.tsx` carries `scope?: 'global' \| 'company'` and a written precedence note | Make `/admin/pricing` display the resolved value **from the engine**, labelled `stored` / `inherited from price_per_watt` / `platform default`, with the value it would restore. One page, no new store | **STEAL** (Google's inherit column) | HIGH | MED | LOW | ~1 sitting, 1 page + 1 selector | `lib/pricingEngine.ts` becomes the **only** price-display authority; the page stops computing | PROPOSED | NOT STARTED |
| **F** | SiteCapture holds and forwards — sync as you shoot, hold when there is no signal, flush on reconnect (`n6kYjYKm5bg` 5:04). Every field product in the corpus does this | Nobody demonstrates it; the claim rests on one operator statement and one vendor doc (Lane F's own criterion 5 is honest about this) | `StepPhotos.handleCapture` does a bare `fetch('/api/survey/upload-photo')` per photo; on failure it writes a red string into the slot and returns. The `localStorage` draft holds only the returned URL, never the file | **VERIFIED.** A photo taken in a dead spot is destroyed. `handleSubmit` is a single POST with no retry and no queue | Capture-time GPS sampling with soft failure (`StepPhotos.tsx:37`) is already better than EXIF-dependent competitors — the provenance model survives an offline queue unchanged | Write the `File` to IndexedDB at capture with category/GPS/timestamp; render captured-pending-upload; drain on `online` and before submit; block submit while unflushed | **STEAL** | HIGH | MED | MED | ~1 sitting + 1 hook; nothing server-side | none — the upload route and payload shape are unchanged | PROPOSED | NOT STARTED |
| **F** | Interplay asks breaker space as a *structure* — two adjacent slots for a 2-pole 240 V / two non-adjacent singles / none — and captures centre-fed because some AHJs restrict PV on centre-fed panels (`X_9r70-xhY0` 3:04, 4:03) | It is a training simulation, not a shipping app; nothing enforces it anywhere | `availableBreakerSlots` is a categorical string (`'0'\|'1-2'\|'3-4'\|'5+'`) preserved opaquely (`lib/siteSurvey/types.ts:288`; tests pin the strings at `siteSurvey.test.ts:422-434`). No busbar rating, no centre-fed, no rafter SIZE, no MSP clearance | **VERIFIED.** The captured field cannot answer the question NEC 705.12(B) asks. Busbar — the actual 120% input — is captured nowhere | SolarPro already asserts readiness on this; adding the inputs turns an asserted PASS into a computed one, which is the wedge | Add busbar rating, breaker-space **structure** + position relative to main, centre-fed, rafter SIZE, MSP side clearances as additive nullable fields | **STEAL** | HIGH | HIGH — "we print the 120% calculation from measured inputs" | MED | 2 sittings; additive fields, existing payloads valid as nulls | `lib/siteSurvey/types.ts` + `normalizeSurvey.ts` — extends the existing survey authority | PROPOSED | NOT STARTED |
| **K** | Shopify names roles after jobs with a one-line consequence each, in a searchable list, and identifies people by **email** (`HAaDk49oTcY` 01:03-01:57) | Salesforce's permission-set editor is a dropdown of ~18 internal metadata categories, and the official training's remedy is to hand-write a prose description — the UI cannot summarise its own grant | `lib/organizations/permissions.ts:80-84` — the entire resource vocabulary is `resource:create/read/update/delete/share`. Anonymous. `components/settings/OrganizationAuthorityPanel.tsx:631` is `Add member by user ID`, placeholder `User ID (UUID)` | **VERIFIED.** Five anonymous actions cover designs, plansets, permit packages, pricing, equipment and the AHJ registry indiscriminately, with `resource:delete` at `member` | Nothing is sold yet — the vocabulary is still free to change. That window closes at the first org-enabled customer | Replace `resource:*` with SolarPro's own functional areas (Designs, Plansets, Permit packages, Equipment catalog, Pricing, AHJ registry, Field measurement), verb-named, one consequence line each; name roles after solar jobs | **STEAL** | HIGH | LOW | MED | 1-2 sittings, vocabulary only (no UI) | `lib/organizations/permissions.ts` — replaced in place, single authority preserved | PROPOSED | NOT STARTED |
| **J** | Google restates scope inside the content (*"Showing status for apps in Contractors"*) and in every destructive confirmation (*"Calendar will be turned OFF for all users in Contractors"*) | Solargraf documents full impersonation with **no** always-on indicator | `components/ui/ImpersonationBanner.tsx` is `'use client'`, detects via `?impersonating=1` → `sessionStorage`, and ships a dismiss button titled `Dismiss banner (impersonation still active)` | **VERIFIED.** A new tab, a cleared session store, or one click removes the only indication that you are acting as someone else, while the session continues | SolarPro **has** a banner at all, mounted in the root layout — better than Solargraf documents. The fix is to harden it, not to build it | Make the indicator server-rendered from the session (not a query param), and non-dismissible. Remove the `X`. Restate the impersonated identity in every destructive confirmation | **STEAL** | MED | LOW | LOW | ~1 sitting | session (`lib/auth.ts`) becomes the impersonation authority instead of the URL | PROPOSED | NOT STARTED |
| **K** | Stripe stamps `details.user_roles.source` = Dashboard / SCIM / SSO on every role change — the **authority path**, not just the actor, with a named action taxonomy | Stripe's activity logs are API-only with no first-party UI and a ~10-minute delay | Two disconnected audit tables. `audit_log` is hash-chained with per-org chain partitioning (migration 107) — **unapplied, and no page reads it**. `app/admin/activity-log` reads `admin_activity_log`, whose org field is free-text `VARCHAR target_company` | Per memory `audit-trail-outage-107` this is a known live blocker, re-confirmed here from the lane audit | The hash-chained design is stronger than Stripe's; it just has no consumer | Apply 107, repoint `app/admin/activity-log` at `audit_log`, add Stripe's `source` field. **Gated on memory `migration-four-gates` — five registrations, not just the `.sql`** | **STEAL** | HIGH | LOW | MED | 2 sittings + a migration run (Ray's action) | `audit_log` becomes the single audit authority; `admin_activity_log` must be retired, not kept beside it | PROPOSED | NOT STARTED |
| **H** | OpenSolar splits incentives into `Claimed By Installer` / `Claimed By Customer` (`wsB6VRCWerY` 11:30) — one field that encodes the §48E-vs-§25D distinction | OpenSolar heads its pricing panel `Price breakdown for [Sungage — 20 years 0.9%]`: **the finance product selects the price** | `lib/incentivesConfig.ts` describes the distinction in a comment and enforces it via `allow_section48e` plus a prose instruction (*"Only show §48E messaging when financeType = 'lease' or 'ppa'"*) | The distinction is a comment, not a type. Nothing makes the compiler refuse an installer-claimed credit shown as a homeowner benefit | `gross_system_cost === systemCost === effectiveFinal` (`buildCanonicalProposal.ts:840-841`) — one cost, derived views. SolarPro already holds the line OpenSolar breaks | **Design-only model** (see Lane H section): add `claimedBy: 'installer' \| 'customer'` as a required field on the incentive record. No lender integration, no API | **STEAL** (model only) | MED | MED | MED | design doc only this round | `lib/incentivesConfig.ts` — a field on the existing authority, not a new one | PROPOSED | NOT STARTED |
| **H** | The operator script from `DvwcDCblOuo` 12:18 and the CFPB spotlight: *"Ask every installer for the cash price. Not the net cost after incentives."* | IntegrateSun documents the tactic: real loan amount in *"a small, light font"*, net system cost in *"a large, bright font"* | SolarPro's cash price **is** the single stored number (`costEstimate.cashPrice` → `storedCashPrice` → `systemCost`), but no surface labels it "cash price" beside an amount-financed figure | Presentation gap only — the number is already right, and already the only one | SolarPro has **no dealer fee to hide**: the only `dealer_fee` hit in the repo is `tests/marketplace-intelligence.test.ts:545` asserting it must not appear in output. `netDifferenceFinanced` is already reported separately and documented as possibly negative | Print cash price largest, amount financed at equal weight, net-of-incentives smallest with its timing caveat — the exact inverse of the CFPB-cited presentation | **STEAL** | HIGH | HIGH | LOW | ~1 sitting, render layer only | none — pure labelling of `financial.systemCost` | PROPOSED | NOT STARTED |
| **I** | OpenSolar shows `Stock Status` and `Select Source` as **per-line columns** beside qty and price, so a BOM can be split across distributors (`EbfFt_h-Fn8` 05:24) | In the captured frame the panel row has no source, `Stock Status: N/A`, `$0.00 undefined /unit` — and `Proceed to Checkout` is still live. `Exclude from Order` is a dropdown value with no recorded reason | `lib/bom/distributorPricing.ts` (948 lines) has a per-line `source` (`CED \| Soligent \| KWh \| Internal`) surfaced as a coloured badge in `app/admin/distributor-prices/page.tsx`. `grep purchaseOrder\|purchase_order\|poNumber` over `lib/ app/ components/` → **zero** | No stock, availability, lead time, backorder, quote, price-lock, PO or order status anywhere | The source badge already exists and is already authoritative; promoting it costs nothing | **Design-only model.** Promote the source badge to the project BOM view and add an availability column that honestly reads `not tracked`. **No supplier integration is proposed — there is no partner and no API** | **ADAPT** (UX only) | MED | MED | LOW | ~1 sitting for the columns; the feed is out of scope | `lib/bom/distributorPricing.ts` — displayed, not duplicated | PROPOSED | NOT STARTED |
| **I** | BayWa r.e.: *"The number you see is what we see in our backend systems, already accounting for sold and allocated units"* — available-to-promise, per warehouse; and a quote as a 30-day price lock | Source is five years old and substitution/backorder/approval are not described anywhere in it | SolarPro already ships manufacturer-driven supersession that prints itself: `supersededById`, `supersessionBasis`, `mountingSystemSupersession()` returning `{from, to, basis}` (`lib/mounting-hardware-db.ts`) — *"the substitution is never silent"* | The purchaser-driven case has no equivalent | The supersession record is the right shape already; it is the seed of the four-state object | **Design-only model.** Generalise `{from, to, basis}` into `{from, to, basis, state, reason, authority, reopenedArtifacts[]}`. Acceptance must state which dependent artifacts were reopened — SolarPro can compute that exactly from the digest | **STEAL** (model only) | HIGH | MED | MED | design doc only this round | `lib/permit/snapshot/procurementSufficiency.ts` is the pattern to generalise — **one** gate, not a second | PROPOSED | NOT STARTED |
| **J** | OpenSolar scopes pricing by state/zip with an explicit integer `Priority`, blank = applies everywhere, `Duplicate` to derive a regional variant (`TeYJ0JHVZKE` 00:58-01:55) | OpenSolar shows **nothing** about which scheme won on a given project or why; priority integers become tribal knowledge | `app/admin/distributor-prices/page.tsx` already carries `scope?: 'global' \| 'company'` and a precedence note — the only scoping primitive in the whole Admin Center, used on exactly one page | SolarPro's variance is regional (AHJ, setbacks, code edition, incentives, pricing), and there is nowhere to express it except a global row | The precedence chain is already written down in one place; it needs generalising, not inventing | Named, geographically-scoped rules with explicit priority and blank = everywhere — **plus the resolution explainer OpenSolar omits**: on any resolved value, a "why this value" popover naming the winning rule and the rules it beat | **STEAL + improve** | HIGH | MED | MED | 3+ sittings — **not bounded**, sequence after J-1 | would extend `pricing_config`; must stay ONE resolver, never a parallel store | PROPOSED | NOT STARTED |
| **H** | OpenSolar's payment options are configurable at account level *and* per project, so a company default exists and a project can deviate deliberately | Per-project deviation with **no recorded reason** — the same hole as its `Price Override Adjustment $6,106` free-form line | `salesOverride` (`pricingEngine.ts:352, 375`) lets a rep replace `finalPrice`, reachable over `POST /api/production` via `body.salesOverride` (`route.ts:284, 346, 439, 547`). It writes the project's stored cost estimate — correct architecture — but records **no reason** | A price change with no captured basis, on the authority the proposal then reads | The override goes through the one authority rather than creating a second price. That is already right | Add a required `reason` to `salesOverride`, stored and shown beside the overridden price. Precedent: `app/admin/reconciliation/page.tsx` — *"the operator selects a winner and MUST give a reason… No silent win"* | **STEAL** | MED | LOW | LOW | ~1 sitting | `lib/pricingEngine.ts` — a field on the existing override, not a new path | PROPOSED | NOT STARTED |
| **I** | — | OpenSolar's `Sync from Design` button with divergence as the silent default: *"the BOM becomes independent from your Design tab and won't auto-update"* | SolarPro's BOM is generated from the design and cannot be edited independently of it | none | The coupling **is** the product | **REJECT.** Adding an editable Hardware tab whose values do not flow back would create a second equipment authority and break the digest guarantee outright. If procurement needs to record a preference, it must be an annotation on the canonical line, never a parallel value | **REJECT — creates a second authority for equipment** | — | — | — | — | would fork `lib/bom/*` from the snapshot — forbidden | PROPOSED | NOT STARTED |
| **J** | Solargraf's two-column propagation dialog (which settings × which targets) with a domain-named setting list including Custom AHJs | Copy is a snapshot: after it, the link is gone and a later parent change silently does not propagate | No parent/child concept. `app/admin/companies` is a `GROUP BY users.company` over a free-text column (`app/api/admin/companies/route.ts:54`) | Two spellings of "Acme Solar" are two companies, and the typo-variants accrue every day | — | **REJECT the copy semantics** (a snapshot is a second authority by construction). **ADAPT the dialog** only over a live link with an explicit, recorded `Detach`. Not before J-1 and the ownership decision | **REJECT (copy) / BACKLOG (dialog)** | MED | MED | HIGH | — | would create per-dealer copies of pricing/AHJ — forbidden as specified | PROPOSED | NOT STARTED |
| **H** | Aurora's incentive-paydown loan is a mortgage loan + a 0% bullet loan sized to the credit, with a documented `Incentives apply to dealer fee` toggle defaulted **off** | The premise no longer exists for 2026 customer-owned systems; if the homeowner never pays it down, the payment jumps | No dealer fee, no prepayment, no re-amortisation; `financeApr` 7.99% and `financeTermYears` 25 are bare literals (`buildCanonicalProposal.ts:644-645`) | Real, but building it would import the exact harm the CFPB documented | Having no dealer fee is a **positioning asset**, not a gap | **REJECT** building a dealer-fee model. If one is ever added, copy the explicit tax-basis toggle defaulted off. Meanwhile promote the two bare literals to named, sourced constants | **REJECT (dealer fee) / BACKLOG (named APR constants)** | LOW | LOW | MED | — | would introduce a finance-selected cost — the exact anti-pattern | PROPOSED | NOT STARTED |

---

## LANE F — TOP BOUNDED CANDIDATES

**F-1. Run the engineering requirement registry on device, at step 6.**
*Build:* `GET /api/survey/readiness?token=…` returning `buildEngineeringRequirementEvaluation(...)`;
call it on entering step 6; render three bands (blocking / review-required / informational), each naming
the capture item and the `movementZone` from `fieldOrchestration.ts` to walk back to.
*Files:* `app/api/survey/readiness/route.ts` (new), `components/survey/StepReview.tsx`,
`lib/survey/evidence/engineeringRequirements.ts` (read only), `lib/survey/evidence/fieldOrchestration.ts` (read only).
*Proof:* a survey with 5/5 required photos and no attic/rafter evidence shows `structural_access: review
required` on the phone, and `app/projects/[id]/survey/[surveyId]` shows the **identical** verdict for the
same survey. Same function, two renderers.
*What could go wrong:* the token route is under `lib/survey/*`, which `AGENTS.md` §3 flags as requiring a
read of canonical §10 first. The route must be token-scoped and must not leak another survey's evaluation —
mirror the auth shape of `/api/survey/upload-photo` exactly. Do not add a second evaluation function; if the
office page and the phone ever disagree, the cause will be two callers, not one engine.

**F-2. Per-section outstanding-required counts on the progress strip.**
*Build:* a number beside each of the 6 step labels in `SurveyShell`'s progress bar, derived from
`canAdvanceStep()` plus the registry — never from a second hardcoded list.
*Files:* `components/survey/SurveyShell.tsx`, one selector in `lib/survey/v2/` beside `types.ts`,
`app/survey/[token]/page.tsx:64` (`canAdvanceStep`, read only).
*Proof:* the counts sum to zero exactly when Submit enables; forcing one required photo out of the payload
moves exactly one count from 0 to 1.
*What could go wrong:* the tempting shortcut is a second array of "what each step requires". That is a
second authority for survey completeness and must be refused — derive from `canAdvanceStep` and
`REQUIRED_PHOTO_CATEGORIES`, the two that already decide it.

**F-3. Offline capture queue.**
*Build:* write the `File` to IndexedDB at capture with `{category, gps, capturedAt}`; render the slot as
captured-pending-upload; drain on the `online` event and immediately before submit; block Submit while
anything is unflushed with a plain "3 photos still to upload".
*Files:* `components/survey/StepPhotos.tsx` (`handleCapture` ~:37), `components/survey/PhotoSlot.tsx`,
a new `lib/survey/v2/offlineQueue.ts`, `app/survey/[token]/page.tsx` (`handleSubmit`).
*Proof:* kill the network in devtools, capture all five required photos, restore the network, submit, and
all five are present server-side with their original `capturedAt` and GPS.
*What could go wrong:* IndexedDB is unavailable in private mode and can throw on open — every read and
write needs a try/catch with a graceful fall back to today's behaviour, never a thrown capture. Do **not**
let the queue become a second source of truth for what was captured: the slot UI must read the queue and
the uploaded set through one selector.

---

## LANE H — MODEL, NOT INTEGRATION (design-only)

**Explicitly design-only.** There is no lender, no TPO partner and no API. Nothing below proposes building
one, and no row above does either. The deliverable is the interaction design plus the data model it needs.

**H-1 (bounded, and the only one that should be *built* this round). Collapse the residential-ITC
fallbacks into the one authority.**
*Build:* every residential-ITC read goes through `isItcEnabled()` / `guardItcValue()`. Delete the
disagreeing constants. Fix the two false P.L. 119-21 comments.
*Files:* `lib/db/pricing.ts:46` (`?? 30` → `?? 0`) and `:146`; `lib/pricingEngine.ts:138, 179, 406`;
`app/api/pricing/route.ts:40` and the inline DDL default at `:116`; `app/api/production/route.ts:91-93`;
`app/proposals/page.tsx:1219-1241`; `app/admin/pricing/page.tsx:58`; plus the three already-named stale
constants `lib/db.ts:608`, `lib/companyPricing.ts:34`, `lib/pvwatts.ts:342`.
*Proof:* a project saved through `POST /api/production` on a database where `itc_rate_residential` is NULL
or absent must persist `costEstimate.taxCredit = 0` and `netCost === cashPrice`; `/admin/pricing` and
`/proposals` must print the same rate; `[INCENTIVE LEAK DETECTED]` must appear in no path.
*What could go wrong:* `lib/pvwatts.ts:342` sits in `calculateCost()`, which has **zero callers** — do not
"fix" it by wiring it up. `app/api/pricing/route.ts` also contains an unregistered inline `CREATE TABLE`
that is the only DDL for five columns; per memory `migration-four-gates`, moving it into a real migration
needs five registrations, so keep that as a separate, declared step rather than smuggling it into this fix.
Commercial §48E at 30% is still correct and must not be zeroed with it.

**H-2 (design-only). The two-label cost pattern.**
One `financial.systemCost`, two labelled readings — `Total system cost (incentives applied today)` and
`Net cost (incentives applied later)` — each carrying its timing phrase. Aurora's model, minus the
default-on credit. **No model change**: `gross_system_cost === systemCost` already. Render layer only.

**H-3 (design-only). The incentive record model.**
```
Incentive {
  id, programId, label
  claimedBy: 'installer' | 'customer'      // §48E is a company credit; §25D was a homeowner credit
  basis:     'system_cost' | 'per_watt' | 'per_kwh' | 'flat'
  rate, cap
  timing:    'applied_today' | 'applied_later'
  visibility:'internal' | 'customer'        // per-line, not per-screen (OpenSolar's footnote)
  enabledBy: reference into GLOBAL_INCENTIVES_CONFIG   // never a free boolean
}
```
`claimedBy` turns `incentivesConfig.ts`'s prose rule into a type the compiler enforces, and is the
prerequisite for ever adding lease/PPA. `enabledBy` is the guardrail: an incentive cannot be switched on
except through the existing authority, so this model **cannot** become a second incentives source of truth.
No lender fields. No dealer fee. No credit application.

---

## LANE I — MODEL, NOT INTEGRATION (design-only)

**Explicitly design-only.** No supplier API is proposed. There is no distributor partner. Availability
columns read `not tracked` until a feed exists, and that is the honest state.

**I-1 (bounded). The substitution-consequence screen.**
*Build:* when a part number changes on a project whose snapshot carries a live PE approval, show — before
the change commits — *"Changing MODULE X → Y moves the design digest from `D` to `D′` and retires PE
approval #NNN. Affected sheets: …"*, computed by re-running `computeSnapshotDigest` on the prospective
snapshot and diffing `bomLineId` sets.
*Files:* `lib/bom/bomLineId.ts` (read only), `lib/permit/snapshot/digest.ts` (read only),
`lib/permit/snapshot/build.ts:3155` (read only), a new read-only `lib/bom/substitutionConsequence.ts`,
and the equipment-selection surface that calls it.
*Proof:* swapping a module part number on a Braidon-shaped project produces a non-empty affected-sheet list
and a digest that differs from the approved one; swapping a *quantity* produces an **empty** list and an
unchanged digest (quantity is deliberately excluded from the identity key).
*What could go wrong:* this must be **read-only**. It computes a prospective digest and discards it. Per
memory `digest-moves-retire-pe-approvals` and `wsa-issued-package-immutability`, anything that writes a
snapshot on a preview path re-dates issued packages. Build it as a pure function with no persistence.

**I-2 (design-only). The four-state substitution object.**
```
Substitution {
  id, projectId, bomLineId          // the canonical line, never a copy of its values
  from: partNumber, to: partNumber
  state: 'proposed' | 'under_review' | 'accepted' | 'rejected'
  acceptedFor: string               // the named purpose — required when state = 'accepted'
  reason: string                    // required on every transition
  authority: userId + role          // who decided
  severity: derived                 // from the Energyscape always-revise list
  reopenedArtifacts: string[]       // computed from the digest diff, never hand-entered
}
```
Generalised from `lib/mounting-hardware-db.ts`'s `{from, to, basis}` and the fail-closed clearing pattern in
`lib/permit/snapshot/procurementSufficiency.ts`. `acceptedFor` is SurgePV's "accepted for a named purpose"
and doubles as the equivalency-letter carve-out. **This is a governance record about the canonical line —
it never holds a part value of its own**, which is what keeps it from becoming a second equipment authority.

**I-3 (design-only). Exclusions are recorded exceptions, not dropdown values.**
Reject OpenSolar's silent `Exclude from Order`. A line dropped from procurement is an exception with a
reason, closed at release — SurgePV checks 9 and 10. SolarPro's precedent is
`app/admin/reconciliation/page.tsx`'s `<textarea placeholder="reason (REQUIRED)">`.

---

## LANE J — THE SINGLE-ORG ASSUMPTIONS THAT WILL BE EXPENSIVE TO UNDO

Per the brief, this is the most valuable output of Lane J — more than any feature proposal. Ranked by
cost-to-undo, each with the file that encodes it. The lane's own list is sound; the ranking below is mine,
and it moves two items after verification.

| rank | assumption | file | why it costs what it costs | accruing now? |
|---|---|---|---|---|
| **1** | **Ownership is `user_id`, load-bearing in ~300 API routes.** `projects`, `clients`, `layouts`, `proposals`, `crews`, all four `user_equipment_*` catalogs and all white-label branding are keyed to a **person** | `app/api/proposals/route.ts:68` is representative (`WHERE user_id = ${user.id}`); the counter-example that shows the right shape is `lib/fieldMeasurement/postgresRepository.ts` (migration 118, `TenantKey = 'org:<uuid>' \| 'user:<uuid>'`) | The cost is not the migration. It is that **SolarPro has no concept of a company asset** — a branch manager cannot own a price book, a colleague cannot open a project. Every one of those becomes a human adjudication ("whose projects are these?") *after* users have built personal habits around personal ownership | **Yes — grows linearly with every new table** |
| **2** | **"Company" exists twice, and the free-text one is the one in production.** `users.company TEXT` vs the `organizations` table | `app/api/admin/companies/route.ts:54` (`GROUP BY users.company`); `app/admin/users/page.tsx` edits it as a plain `<input>` | Every day this runs, more typo-variants accumulate that a future reconciliation must resolve **by hand**. Unlike rank 1 this is not a schema problem — it is an irreversible data-quality problem, and the data is being created right now by admins typing into a text box | **Yes — actively accruing, today** |
| **3** | **The permission vocabulary is anonymous, and vocabularies freeze first.** `resource:create/read/update/delete/share` covering designs, plansets, permit packages, pricing, equipment and the AHJ registry indiscriminately, with `resource:delete` at `member` | `lib/organizations/permissions.ts:80-84` | Renaming a role after it has been sold breaks the customer's mental model **and their contract**. This is the one item with a hard deadline that is not a code deadline: the first org-enabled customer. It is also currently free to fix, because nothing consumes it | No — but the window closes discontinuously |
| **4** | **No revert-to-inherited exists anywhere, and the one override store makes overrides permanent** | `lib/db/featureFlags.ts` (no clear function); `app/api/admin/feature-flags/route.ts` (GET + PUT only) | Cheap in isolation — but **every override mechanism SolarPro adds from here will copy this shape**. The cost is the copying, not the flag. Fixing it once, centrally, is the cheapest high-value item in the whole study, and the UI compounds it by listing only flags that already have a row, so the inheritable surface is invisible | Yes — each new override surface doubles it |
| **5** | **`pricing_config` is one global row, and the admin page displays a different number from the one the engine charges** | `lib/migrations/004_pricing_config.sql`; `app/admin/pricing/page.tsx:301, 58` vs `lib/pricingEngine.ts:170, 179`; `lib/db/pricing.ts:46` | Verified worse than the lane stated (V9, V6). This is not only where a corporate-default-vs-branch-override control has to go — **it is already wrong on money today**, and it is the direct cause of the P0 in V6. Fix the divergence first; the scoping control lands in the same place afterwards | Yes — every proposal built off a stored cost estimate |
| **6** | **There is no scope indicator, and no place to put one** | `app/admin/AdminShell.tsx` — fixed sidebar, 2-level synthetic breadcrumb, decorative role badge, no search, no scope line | Retrofitting "which tenant am I in" into 30 pages after the fact is far more expensive than reserving the slot now, and it is the mitigation for the one failure mode that is **unrecoverable**: acting in the wrong tenant | No — but the retrofit cost grows with every admin page added |
| **7** | **The impersonation signal is client-side and dismissible** | `components/ui/ImpersonationBanner.tsx` — `?impersonating=1` → `sessionStorage`, dismiss button titled `Dismiss banner (impersonation still active)` | In a single-tenant product this is a support wart. In a multi-tenant product it is rank 6's catastrophe **with the airbag disabled**. Cheap to fix now, and it must land before an org switcher, not after | No — but it must not survive to the switcher |
| **8** | **Two audit tables, and the UI reads the weaker one** | `audit_log` (hash-chained, per-org partitioning, migration 107 **unapplied**, zero UI readers) vs `admin_activity_log` (free-text `VARCHAR target_company`) | Every month, the authoritative record of who-changed-what accumulates in the table that **cannot answer the question per-organisation**. The history is not recoverable later. See memory `audit-trail-outage-107` | **Yes — the wrong table is being written right now** |
| **9** | **Three feature-flag systems with three precedence rules, none org-aware** | env-only `ENTERPRISE_*`; DB-backed `app_feature_flags` (migration 121 written but **not registered with the runner** — the panel returns a 503 telling the operator to run a migration that cannot be run); plan gating via `users.plan` | A per-branch feature decision has nowhere to live and the operator has three places to look. Consolidate to one resolver with a visible chain — DB org override → DB global override → env default → off — and show which level supplied the current value | No — but it blocks rank 4's central fix |

**The ranking's one strong claim:** ranks 2, 5 and 8 are the ones accruing *irreversible* damage right now
(hand-typed company strings, wrong money in stored estimates, audit rows in the wrong table). Ranks 1, 3 and
6 are large but still fully recoverable. **Spend the next sitting on 5, then 2 and 8** — not on 1, which is
the biggest number and the one that most tempts a premature migration.

### LANE J — TOP BOUNDED CANDIDATES

**J-1. Make `/admin/pricing` display the resolved value, not its own constants.**
*Build:* the page renders what `lib/pricingEngine.loadPricingConfig()` resolved, each field labelled
`stored` / `inherited from price_per_watt` / `platform default`, with the value a revert would restore.
Delete the `DEFAULTS` coalescing.
*Files:* `app/admin/pricing/page.tsx:39-48, 295-313`; `lib/pricingEngine.ts:159-186` (read only); one new
resolved-config endpoint or a reuse of `GET /api/pricing`.
*Proof:* set `ground_price_per_watt` to NULL and the page must read **3.10 (inherited from price_per_watt)**,
matching what a quote would charge — not today's 2.35. Set residential ITC to NULL and the page must show the
same number the proposal uses.
*What could go wrong:* this is the same page as H-1 and the two edits touch the same lines. Do H-1 first, or
do them as one change — sequencing them apart will produce a merge conflict on `DEFAULTS` and, worse, a
window where the page is honest about price and still wrong about ITC.

**J-2. Add the revert, once, centrally.**
*Build:* `clearFeatureFlag(flagKey)` in `lib/db/featureFlags.ts` + `DELETE` on
`app/api/admin/feature-flags/route.ts`; list **every** known flag with an `Inherited`/`Overridden` column and
the env default beside the current value.
*Files:* `lib/db/featureFlags.ts`, `app/api/admin/feature-flags/route.ts`, `app/admin/system-tools/page.tsx`.
*Proof:* override a flag, revert it, and `getFeatureFlag` returns the env-derived value — not a row with the
env value copied into it. Copying the default into a row is the failure mode, not the fix.
*What could go wrong:* the panel currently returns 503 because migration 121 is written but not registered
with the runner (memory `migration-four-gates`). The revert must degrade correctly in that state rather than
appearing to succeed against a table that does not exist.

**J-3. Harden the impersonation indicator.**
*Build:* server-render the banner from the session rather than `?impersonating=1` + `sessionStorage`; remove
the dismiss control; restate the impersonated identity in every destructive confirmation.
*Files:* `components/ui/ImpersonationBanner.tsx`, the root layout that mounts it, `lib/auth.ts` (session shape).
*Proof:* impersonate, open a **new tab** directly at `/projects`, and the banner is present; clear
`sessionStorage` and it is still present; there is no control that removes it.
*What could go wrong:* `lib/auth.ts` is adjacent to `app/api/auth/*`, which `AGENTS.md` §3 gates behind a read
of canonical §10. If the session cannot carry the flag without touching auth routes, read a server-side
impersonation record (`admin_impersonation_tokens` exists) instead of widening the session.

---

## LANE K — TOP BOUNDED CANDIDATES

**K-1. Retire the second migration surface.**
*Build:* delete `app/admin/database/page.tsx`'s `prompt('Enter MIGRATE_SECRET to run migrations:')` path.
*Files:* `app/admin/database/page.tsx` (160 lines), nav entry in `app/admin/AdminShell.tsx`.
*Proof:* `grep -rn "MIGRATE_SECRET" app/` returns no client-side occurrence; the only migration path is
`app/admin/system-tools/migrations`, which demands TOTP, a written reason and the typed word `production`.
*What could go wrong:* it also hosts row counts and table sizes, which someone may use. Keep those two tiles
and delete only the migration control — deleting the page wholesale invites it being restored. Two migration
authorities with opposite ceremony is worse than either alone, and this one collects an env secret in
plaintext through a browser prompt.

**K-2. Lift the Migration Operator Console's ceremony into one shared component.**
*Build:* a `<DangerousAction>` component carrying (a) a required written reason, (b) a typed confirmation
naming the scope, (c) a named button with rationale prose instead of a generic "Run".
*Files:* new `components/admin/DangerousAction.tsx`, modelled on
`app/admin/system-tools/migrations/page.tsx` (626 lines) and `app/admin/reconciliation/page.tsx`'s
`reason (REQUIRED)` textarea; first adopters `app/admin/system-tools/page.tsx` and `app/admin/users/page.tsx`.
*Proof:* two previously-unceremonious destructive actions route through it and both record a reason.
*What could go wrong:* do not refactor the migrations console itself into the component this round — it is the
internal benchmark and the only fully governed surface; changing it to prove the abstraction risks the one
thing that works. Extract *from* it, adopt *elsewhere*.

**K-3. Rewrite the permission vocabulary (no UI).**
*Build:* replace `resource:create/read/update/delete/share` with SolarPro's functional areas — Designs,
Plansets, Permit packages, Equipment catalog, Pricing, AHJ registry, Field measurement — verb-named, one
consequence sentence each; roles named after solar jobs.
*Files:* `lib/organizations/permissions.ts:80-84` and its `PERMISSION_MATRIX`; consumers under
`lib/organizations/`; `components/settings/OrganizationAuthorityPanel.tsx` (also swap `Add member by user ID`
/ `User ID (UUID)` for invite-by-email).
*Proof:* `resource:` appears nowhere in `lib/organizations/`; every action has a one-line consequence string
that renders in the panel; `resource:delete` at `member` no longer exists as a grant.
*What could go wrong:* the whole module is flag-gated off and migration 105 was never applied
(`lib/fieldMeasurement/permitAccess.ts:53` records this in production code). That makes the rewrite **safe
now and expensive later** — which is the argument for doing it this round. Do not ship org UI with it.

---

## WHAT THIS PASS ADDS TO ROUND-3-TRIAGE

- **One new P0 that no lane found (V6).** A repealed 30% residential credit reaches stored cost estimates and
  a user-visible payback year, through a guard at `lib/pricingEngine.ts:179` that can never fire. It belongs
  in the P0/P1 table above Round 3's #7, at HIGH value / HIGH demo impact / LOW risk.
- **One refutation (V9).** The Lane J claim that the admin pricing page's fallback disagrees with the
  *schema's documented fallback* is wrong — the page matches the seed exactly. The real divergence is page vs
  engine, and it is worse.
- **One advantage promoted from a note to a protected property (V7).** Round 3's "the thing worth protecting"
  is now verified at file:line, and the corresponding REJECT (a decoupled Hardware-tab BOM) is written into
  the matrix so it cannot be proposed again without meeting it.
- **Round 3 #13 and #19 are re-verified here** as F-1 and J-2 and both survive unchanged.
