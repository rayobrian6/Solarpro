# CONSUMED — Lanes B (Engineering / Electrical) and C (Proposals / Sales)

**Date:** 2026-09-25. **Mode:** research consumption, not research gathering.
**Inputs:** `docs/research/lanes/lane-B-engineering-electrical.md`,
`docs/research/lanes/lane-C-proposals-sales.md`,
`docs/research/CONDUCTOR-AUTHORITY-VERIFICATION.md`,
`docs/research/PROPOSAL-INTEGRITY-VERIFICATION.md`, `docs/research/ROUND-3-TRIAGE.md`.
**Method:** every lane claim not already adjudicated by the two VERIFICATION docs was
re-derived from source with file:line evidence. Nothing was shipped. No product source
was edited, no git operation run, no test suite executed.

---

## 0. What did not survive contact with the code (read before ranking)

Carried forward from the verification passes, plus three new refutations found here.

| Claim | Source | Verdict |
|---|---|---|
| "Six voltage-drop implementations, two physical constants (1.732, 21.2), three disagreeing tables — app and planset print different numbers" | Lane B | **LARGELY FABRICATED.** No `1.732` and no `21.2` exist anywhere in `lib/`, `app/` or `components/`. The app and the planset run the *same* function with the *same* constant. The only two implementations both reachable in one package differ by **0.0069 pp**. (CONDUCTOR-AUTHORITY-VERIFICATION §Claim 1, §Claim 3.) **Do not rank this.** |
| "`conductorAuthority` is never read by the engineering page ⇒ app and planset disagree" | Lane B | **REFUTED AS STATED.** 17 call sites; it never computes a voltage drop. The real divergence is *inputs* (routed vs estimated length), already classified `intentional-supersession` at `lib/permit/snapshot/build.ts:1152` and gated by the blocking `ROUTE-LENGTH-ESTIMATE`. |
| "`string-generator.ts` has no UI" | Lane B | **REFUTED.** It runs on every Calculate via `app/api/engineering/calculate/route.ts:13`. (But see finding **B2** — the *readout the designer reads* is not its answer.) |
| "`ESS` / `PCS` — zero hits in repo, no NEC 705.13 anywhere" | Lane B | **REFUTED (new, this pass).** `lib/electrical-calc.ts:1259-1267` emits `I-PCS-705-13` with `necReference: 'NEC 705.13'`; `lib/equipment-db.ts:2589, 2614, 2818, 2841, 2858` carry a typed PCS mode, a `pcsLabelRequirement` and datasheet-sourced 705.13 provenance; `lib/permit/utils/fieldLabels.ts:252, 302` prints compound `705.12(B)(3) / 705.13` citations. The genuine gap is narrower than claimed — see **B7**. |
| "Storage backup capability is not modelled" | Lane B / Lane C (implied) | **REFUTED (new, this pass).** `lib/equipment-db.ts` carries `wholeHomeBackup`, `backupCapable`, `gridFormingCapable`, `requiresGateway`, `gatewayModel` on **every** battery record (`:2666`, `:2700`–`:3341`), and `lib/computed-system.ts:2745-2750` already inserts the gateway into the equipment set. The authority exists; nothing shows it to the buyer — see **C4**. |
| "`renderProposalHTML.ts` is an orphaned module" | Lane C | **REFUTED AS STATED.** It has a caller (`app/api/proposals/[id]/pdf/route.ts:231`). The *route* is what has no caller. |
| "`permitReadiness` accepts a FAIL" | Lane B | **CONFIRMED IN CODE, DEAD IN PRODUCT.** `app/engineering/page.tsx:8611` is real and never rendered. The snapshot's readiness builder is verdict-based and hardened. Hygiene only. |

**Ranking consequence:** the voltage-drop alarm is demoted to hygiene. The
**cold-temperature dataset** finding (CONFIRMED, 50 of 51 states, 11.5 % of
module×state combinations flip the legal string length, **zero digest impact**) is
promoted to #1, per the brief.

---

## 1. THE MATRIX

`implementation status` is `PROPOSED` on every row. `live acceptance` is `NOT STARTED`
on every row. This pass ships nothing.

| lane | best competitor behavior | worst competitor behavior | SolarPro current behavior | verified gap | SolarPro advantage | recommended action | verdict | user value | RE+ impact | implementation risk | estimated scope | canonical authority affected | implementation status | live acceptance |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **B1 — One thermal design basis** | HelioScope names the ASHRAE station *and its distance* as a hyperlink and shows the derived string range (`fS6ZXUnMuog` @0:50: `Kansas City Downtown Ap (1.5 mi)`, `Min 4 / Max 20`) | OpenSolar shows no temperature basis at all in a 20-min "advanced" module (`r9htS7Tq9yY`) | **Two live ASHRAE tables.** `lib/jurisdiction.ts:377` `getDesignTemperatures` (ASHRAE **2005**) feeds the app via `app/api/engineering/calculate/route.ts:68,143,167,418`; `lib/permit/utils/designTemps.ts:27` `STATE_TEMPS` (ASHRAE **2021**) feeds the stamped planset. A third regime, the literal `-10`, is the app's default at 11 sites in `app/engineering/page.tsx` and at `app/api/engineering/sld/route.ts:239` | **CONFIRMED (CONDUCTOR-AUTHORITY §Claim 2).** 50 of 51 states disagree, up to **16 °C** (AK). Over 33 module (Voc, βVoc) pairs × 51 states, **194/1,683 = 11.5 %** give a different max series string length at 600 V. In IL, 3 of 33 modules flip **13 → 12**: the designer builds a 13-module string the stamped set computes as over 600 V | The sanctioned single authority **already exists and is documented**: `lib/permit/utils/designTemps.ts:122` `getThermalDesignBasis`, whose header comment at `:84-85` explicitly names the repair — *"the APP-A -10 °C split is killed by routing APP-A through getThermalDesignBasis. One basis per package."* | Point `app/api/engineering/calculate/route.ts` at `getThermalDesignBasis`; delete `getDesignTemperatures` from `lib/jurisdiction.ts`; kill the 12 `-10` literals | **STEAL** (the disclosure) + **correctness repair** (the reconciliation) | HIGH | MED | **LOW** | S (1 sitting) | Thermal design basis — **collapses two onto one**; creates none | PROPOSED | NOT STARTED |
| **B2 — Kill the second string-sizing authority in the UI** | Solargraf validates on every panel hover and refuses to close an invalid string (`K5Wea5GERpo` @1:43); Aurora colours the string red/green/yellow live (`ZD4TfdUcW50` @1:50) | Aurora never discloses *which* of two rules was violated at drag time (`pkirWQXOczQ` @1:33) | The `String Sizing (NEC 690.7 @ {T}°C)` box the designer actually reads is a **40-line inline recompute** at `app/engineering/page.tsx:~10879-10890`, not the engine. It uses `compliance.autoDetected?.designTempMin ?? cs.designTempMin ?? -10`, `maxDcVoltage \|\| 600`, `mpptVoltageMin \|\| 100`, `vmp \|\| 41.8`, and `Math.floor(maxDcV / vocCorr)` | **CONFIRMED + NEW (verified this pass).** It contradicts `lib/string-generator.ts` **twice**: (a) on thermal basis (B1); (b) **on optimizer topology** — it excludes only `micro` (`if (inv.type === 'micro') return null`), so an optimizer system prints `floor(maxDcV/vocCorr)` ≈ 10-13, while `lib/string-generator.ts:243-284` sets max = 200 / brand-capped 25 and min = 1 because **Voc×N is inapplicable to optimizers** (the exact defect retired in v47.412, `lib/electrical-calc.ts:607-620`). The UI is showing a ceiling the engine deliberately abolished | `lib/string-generator.ts` is a genuinely good 859-line engine and is already live on every Calculate; the answer exists, it is simply not what is rendered | Delete the inline recompute; render `string-generator`'s `maxPanelsPerString` / `minPanelsPerString` / `recommended` from the `/api/engineering/calculate` response already stored at `page.tsx:6455`. Then, and only then, add the live colour state | **STEAL** (live validity) — but the prerequisite is a **second-authority deletion** | HIGH | HIGH | **LOW** for the deletion; MED for the colour | S for the deletion; M for the colour | String sizing (NEC 690.7) — **collapses two onto one**; creates none | PROPOSED | NOT STARTED |
| **C1 — Drift banner, in-proposal refresh, terminal-state guard** | Enerflo puts the sync button **inside the proposal** and re-runs pricing, production and consumption in one action (`1FZra98qfPg` @23:45); Aurora refreshes a **stable** link (`aBy9AeiUPf0` @22:52) | Nobody guards the refresh against an already-signed document (unverified for competitors — no account was used) | `PATCH /api/proposals/[id]` `{action:'refresh_snapshot'}` (`:365-432`) does exactly Enerflo's job but is reachable **only** from a kebab menu on the LIST page (`app/proposals/page.tsx:164`). It has **no status/`signed_at` gate**, and it rewrites `project` **without** `pricingSnapshot`, producing a mixed-vintage document. `POST /api/proposals/[id]/share:55-94` has the same hole and *does* rewrite `pricingSnapshot`. Zero drift detection anywhere | **CONFIRMED (PROPOSAL-INTEGRITY §1, §2).** Plus **NEW-A**: the live signing path (`components/SignatureModal.tsx:159` → PATCH) has **no idempotency check**, while a guarded `/sign` route with a 409 (`app/api/proposals/[id]/sign/route.ts:144-149`) sits orphaned — a share-link holder can overwrite an executed signature and re-date it. Plus **NEW-B**: signing writes the `status` column, the installer list reads `data_json.status`, so a signed proposal still reports `draft` | The guard idiom is already in-repo: `app/api/cron/proposal-expiry/route.ts:90,105` filter `AND p.signed_at IS NULL`. And `lib/proposal/buildCanonicalProposal.ts` is a genuine single financial authority (308 `cp.*` accesses across 3 renderers) — none of these defects are miscalculations, they are all about *when inputs may be rewritten* | Terminal-state gate on `refresh_snapshot`, `share`, the status PATCH and `bulk`; route `SignatureModal` at the guarded `/sign` route and delete the loser; add a `snapshotAt` vs `project.updated_at` banner with a **Refresh from design** button in the proposal view and the project's Proposal tab; refresh `project` + `pricingSnapshot` as one vintage | **STEAL** (in-proposal refresh) + **correctness repair** (the guards) | HIGH | HIGH | **LOW** | M (guards = S; banner = S; one vintage = S) | Proposal snapshot + signature record — **hardens the existing authority**; creates none | PROPOSED | NOT STARTED |
| **C2 — Send gated on save** | OpenSolar disables *Send Proposal to Customer* with the reason on the button: *"Save changes to enable send to customer."* (`wsB6VRCWerY` @18:12) | Solargraf's trainer tells reps to **hide pages** rather than fix stale data (`KNMbxIB3X-c` @20:43) | `components/project/ProposalTab.tsx:51` — `const canGenerate = hasDesign && hasBill;`. There is no staleness or dirty-state term. Generate/Send fire against any design state | **CONFIRMED (verified this pass).** No guard in `POST /api/proposals` or `POST /api/proposals/[id]/send-email` | **The exact affordance already exists in the same file** — `ProposalTab.tsx:240` `disabled={!canGenerate \|\| generating}` and `:627` `disabled={!isDirty \|\| saving}`. This is a one-term change to an existing pattern, plus a server 409 | Add a staleness term to `canGenerate` with the reason rendered on the disabled button; mirror it as a 409 in the two POST routes | **STEAL** | HIGH | MED | **LOW** | S | Proposal generation gate — no new authority | PROPOSED | NOT STARTED |
| **C3 — Show the array in the proposal** | Every product leads with the design: Aurora's irradiance overlay + sun path as trust tools (`8cjFBN1GOBE` @09:13), OpenSolar's per-module sun access (`LmM360ajtUo` @07:55) | Solargraf's own marketing frame shows a 9.35 kW residential job priced at $972,435.98 — nobody sanity-checks what is rendered (`GDltNssKDL8` t00122) | `app/proposals/view/[id]/page.tsx:837-858` builds a Google Static Maps tile from `clientLat`/`clientLng` only — **no `path=`, no `markers=`, no overlay, no canvas** — captioned *"Your Property — system designed for this site"*. `app/proposals/page.tsx:1754` builds the identical URL for the installer preview | **CONFIRMED (PROPOSAL-INTEGRITY §Claim 3).** The caption asserts something the image does not show. Neither audience ever sees the array. Incidental: the Google Maps key is a **client-source string literal** at `view/[id]/page.tsx:841` and `page.tsx:1753` | `layout.panels[]` already carries per-panel geometry **and** `annualShadeFactor`, and `panelsShadeDerateComputedPct` is already computed at `view/[id]/page.tsx:359-375` — so the shade-graded version (Lane C cand. 5) is a rendering change on top, not new data | Render the panel geometry server-side **at snapshot time**, store the image with the proposal so it is immutable with the rest of the snapshot and survives into the raster PDF. v1 needs no live 3D. Move the API key out of client source in the same pass | **STEAL** | HIGH | **HIGH** | MED | M | Layout geometry — **read-only consumer**; the image must be derived at snapshot time, never hand-authored | PROPOSED | NOT STARTED |
| **C4 — Backup capability disclosure (battery ≠ backup)** | The buyer-side source names it the single most common homeowner misconception: *"It is assumed by customers that in the event that their power goes out… all solar and battery storage systems will just carry on working. That's an incorrect statement"* — needs a gateway, and it **does not factor into ROI** (`hWXD0vR5xd4` @11:46-13:18). Solargraf surfaces the outcome: *"Cloudy: 49 Hours / Sunny: 7+ Days"* (`GDltNssKDL8`) | Aurora's storage screen is a **sales tier picker** with no topology at all (`T-ya6_lvEF8`); its own frame at ~4:57 shows a red toast *"System Design Engine failed to initialize"* | **Grep for `gateway` and `backup` across `app/proposals/view/[id]/page.tsx`, `lib/proposal/buildCanonicalProposal.ts` and `lib/proposal/renderProposalHTML.ts` returns ZERO hits.** The homeowner is sold a battery with no statement of whether the house stays on | **CONFIRMED + NEW (verified this pass).** The fact is already canonical and already consumed elsewhere — `lib/equipment-db.ts` carries `backupCapable`, `wholeHomeBackup`, `gridFormingCapable`, `requiresGateway`, `gatewayModel` on every battery (`:2666`, `:2700`–`:3341`), and `lib/computed-system.ts:2745-2750` already adds the gateway to the equipment set when `requiresGateway && gatewayModel` | SolarPro already does the thing the buyer-side source demands elsewhere: the equipment block prints **exact make and model** (`view/[id]/page.tsx:1862-1897`, `data-block-id="equipment"`), which the source names as the trust lever — *"too many contractors only list solar panels without specifying models"*. And the *"How Your Energy Value Is Calculated"* section already beats Aurora and OpenSolar by splitting self-consumed vs exported | Add one sentence to the `equipment` block, read from the selected battery's existing fields: whole-home / partial / **no backup without a transfer gateway**, naming the gateway when `requiresGateway` is true and it is absent from the BOM. State plainly that backup capability sits **outside** the ROI figure | **ADAPT** | HIGH | MED | **LOW** | S | Equipment (`equipment-db`) — **read-only consumer of an existing authority**; creates none | PROPOSED | NOT STARTED |
| **B3 — Violations as navigable objects** | Aurora's Components view is an indented electrical tree where **every node carries a return arrow** that jumps to that exact object in the layout, and it separates *NEC code violations* from *system design best-practice errors* (`ZD4TfdUcW50` @4:42-5:04) | Aurora's violation text carries **no NEC citation**: `Max. possible continuous output current (32.0A) is above disconnect current rating (30A)` | Flat red list `[CODE] message → suggestion` in the electrical tab plus a rules accordion in compliance. No deep-link, no tree | **CONFIRMED (verified this pass).** `lib/electrical-calc.ts:173-183` — `CalcIssue` is `{code, severity, message, value?, limit?, necReference?, suggestion?, autoResolved?, resolvedValue?}`. **There is no `target` field.** The user reads `String 1-1: Corrected Voc (612.3V) exceeds…` and hunts for string 1-1 by hand | SolarPro's issues already carry `necReference` — which **Aurora's do not** — plus `value`, `limit` and `suggestion`. SolarPro is one additive field away from strictly beating the behaviour it is copying | Add `target?: { kind: 'string'\|'inverter'\|'run'\|'panel'; id: string }` to `CalcIssue`, populate it at the ~6 emit sites, render a jump control per row. **UI layer only — keep `target` out of the permit snapshot** | **STEAL** | HIGH | MED | **LOW-MED** | M | Electrical issues — additive field on an existing type; no new authority, **must not enter the snapshot** | PROPOSED | NOT STARTED |
| **B4 — Consequence-annotated conductor picker** | HelioScope annotates **every** option in the gauge dropdown with the voltage drop it would produce (`8 AWG (Copper), 0.2%` … `14 AWG (Copper), 0.6%`), and the operator narrates the whole loop in one breath: 12→8 AWG, 1.9 %→0.7 %, *"it updates in the single line diagram"* (`hxWGSVqdJ4o` @26:58-27:06) | HelioScope's SLD is a modal step you "save and exit"; wiring topology is assigned by **dragging field segments between zones**, discoverable only via a permanent instruction label | Voltage drop appears only as a result column in the conduit schedule (red above 3 %) and as a band on the multi-lane SLD. The gauge is picked blind | **PARTLY CONFIRMED, alarm DEMOTED.** The "six disagreeing implementations" premise is refuted — the displayed number (`lib/segment-schedule.ts:362`, called `:504`) and the planset number are **the same function with the same constant**. The genuine residual is *inside the permit path*: `segment-schedule` (K = 12.9) vs `routeVoltageDropRecalc`/`routeLengthBound` (NEC Ch.9 T8), which makes the blocking length gate **0.22 % permissive relative to the number it grades** (engine crosses 3 % at 144.84 ft; the gate bounds at 145 ft) | `lib/electrical/routeLengthBound.ts` cleanly separates SolarPro's **design target** (2 %/3 %) from the **NEC recommendation** (3 %/3 %/5 %) and notes that NEC 90.5(C) makes informational notes unenforceable — better discipline than anything watched. `routeVoltageDropRecalc` **refuses rather than guesses** and prints its derivation | Annotate the picker from the **canonical** `segment-schedule` number only. Do **not** ship the annotation until the permit path has one resistance basis, or the user will be deciding on a number the gate disagrees with | **ADAPT** | HIGH | MED | MED | M | Voltage drop — the render is a read-only consumer; **the underlying unification needs a digest ruling** (shifts `electrical.routeSegments[].voltageDropPct` by ~0.22 %) | PROPOSED | NOT STARTED |
| **C5 — One link, N options + compare matrix** | The independent operator names it his #1 feature: *"You can toggle between multiple options right in the same proposal link. No juggling multiple PDFs or multiple links even."* (`LmM360ajtUo` @10:13). Solargraf's Compare is a **2-axis matrix** — design option × finance product — with a **BACKUP HOURS** row (`GDltNssKDL8` @01:56). OpenSolar **collapses the chooser on acceptance** (`wsB6VRCWerY` @18:52) | Solargraf caps visible options at 3 and its own demo frame prices a 9.35 kW job at $972,435.98. OpenSolar's clone is dumb — the operator spends ~55 s on camera rebuilding option 2 by hand | **Zero** hits for `systemOption\|proposalOption\|variant\|goodBetterBest\|tierOption` across `app/proposals`, `app/api/proposals`, `lib/proposal`, `components/proposals`. The only branch is the binary Finance/Cash toggle (`view/[id]/page.tsx:310`, 14 render branches). `Duplicate` creates a whole second proposal row and therefore a second link | **CONFIRMED (PROPOSAL-INTEGRITY §Claim 5).** The buyer-side source names the exact question it answers: *"this one's 10,000 and this one's 12,000. What am I getting for the extra 2 grand?"* | `lib/proposal/buildCanonicalProposal.ts` is already the one financial calculator (3 call sites, 308 `cp.*` accesses, dev-time `assertTruth` and a system-size truth lock at `:363-375`). An option-aware loop over the **same** builder is architecturally clean | Options must be **design clones re-run through `buildCanonicalProposal`**, each carrying its own production, BOM and price, with a right-rail switcher and a design×finance compare table. The backup row must read from `equipment-db` (see C4) | **ADAPT** — ⚠ **REJECT the variant that stores per-option prices or specs directly in `data_json` and renders them without re-running the canonical builder.** That is proposal-only pricing and a second financial authority, which the architecture forbids outright | HIGH | **HIGH** | **HIGH** | L | Proposal financials — **high risk of creating a second pricing authority**; only admissible as N passes through the existing builder | PROPOSED | NOT STARTED |
| **B5 — Org-level electrical standards** | Solargraf encodes the shop's standards **once**, at org level, and constrains every future auto-generation: allowed AC conduit types, minimum conduit trade size (0.75 in → nothing smaller is ever used), and **breaker sizes to exclude** so they never appear in any SLD (`Pj9EuXHNbB8` @0:46-1:09) | The settings are buried three levels deep and no per-project override is shown | No org-level electrical standards object exists (**verified: zero hits for `company_settings\|companySettings\|org_settings\|orgSettings` across `lib/` and `app/`**). `lib/electrical/stdSizes.ts` exposes the full unconstrained NEC OCPD ladder; conduit type is a per-project field | **CONFIRMED (verified this pass).** Installers are offered sizes they do not stock and silently hand-edit | `lib/electrical/stdSizes.ts:52` already exports `boundedLadder(maxA)`, and its header comment at `:9` already instructs *"express it with boundedLadder(maxA) and a comment"*. The singleton admin-config shape also already exists as a precedent: the `pricing_config` table read by `lib/pricingEngine.ts:150-151` | Build the settings object and apply it as a **filter** on the existing ladder functions — never as a second selection engine | **STEAL** — but ⚠ **BLOCKED ON A DIGEST RULING.** Excluding a breaker size or raising a minimum conduit size changes the selected values that land in the permit snapshot, which **moves the digest and retires live PE approvals** (see [[digest-moves-retire-pe-approvals]]) | HIGH | MED | MED (code) / **HIGH (governance)** | M | OCPD + conduit selection — snapshot-visible. **Ruling required before anyone touches it** | PROPOSED | NOT STARTED |
| **B6 — Print the symbolic formula and the "why" sentence on the SLD** | Solargraf prints givens → symbolic formula → substituted values → result → one sentence of intent: `Isc(T) = Isc(25°C) x [1 + Tisc x (T-25°C)]`, and the 120 % block closes with `CALCULATION ENSURES BUS IS SAFE REGARDLESS OF LOADS`. Its notes are **edition-qualified**: `AS PER NEC 2023 705.12(B)(2)` | Generation is a 20-30 s async job, not live; Solargraf admits *"currently 240 V single-phase residential only"* | **Verified this pass.** `lib/sld-professional-renderer.ts:3106-3137` and `:4576-4595` emit label/value rows only — `Bus Rating`, `PV Breaker`, `Total Backfeed`, `Bus 120% Limit`, `120% Rule PASS ✓`. **The relation is never printed and neither is the intent.** A plan checker must trust the tool | **CONFIRMED** | The **planset** is already more rigorous than any competitor sheet watched: `lib/permit/snapshot/electricalProjection.ts:1321` `ampacityChainLines()` emits every factor — `base 55A (90°C col.) ×0.80 (6 CCC) ×0.87 amb 41°C = 38.28A allow (75°C cap 50A) req 30.00A cont · PASS`. The discipline exists; it just has not reached the SLD's 120 % panel | Add a symbolic relation line and one plain sentence of intent to the existing panels. Static text in an existing renderer | **STEAL** — ⚠ **needs a re-issue ruling, but NOT for the reason Lane B gave.** The digest is computed over the snapshot **JSON** (`lib/permit/snapshot/digest.ts:223`), so static SVG text **does not move the digest**. It *does* change the appearance of a sheet a PE has stamped, so an already-issued package would regenerate differently | MED | MED | LOW (code) / MED (governance) | S | SLD rendering only — no calculation authority touched | PROPOSED | NOT STARTED |
| **C6 — Per-channel section visibility + resolve the two PDF renderers** | Aurora toggles a section independently for the **live presentation**, the **web leave-behind** and the **PDF** (`8cjFBN1GOBE` @06:40). Solargraf previews desktop / mobile / tablet / PDF with a light-dark toggle (`e92Ufia8Vio` @02:44) | Template sprawl; Solargraf's trainer uses page-hiding to conceal bad data rather than fix it | One fixed homeowner page, dark theme only (`bg-slate-900`), 20 responsive-breakpoint usages across 2,472 lines, no section toggles, no device preview | **CONFIRMED.** Plus the renderer split: `lib/proposal/renderProposalHTML.ts` (963-1,005 lines) is reachable **only by typing the URL** — both download buttons import `lib/proposalPDF`. `lib/roadmapRE26.ts:931` asserts the wiring exists; **it does not**. And that route derives `purchaseMode` from admin config (`pdf/route.ts:168`) while the web derives it from the homeowner's toggle — a latent cash-vs-finance disagreement that goes live the moment anyone wires the button up | **The anchor set already exists**: 26 distinct `data-block-id` values in `app/proposals/view/[id]/page.tsx` (`hero`, `system-summary`, `equipment`, `financial-summary`, `energy-policy`, `next-steps`, …), already used by the PDF packer | Build the manifest against the existing `data-block-id` set, and force the renderer decision in the same pass — wire the route (after fixing `purchaseMode`) or delete it and correct `roadmapRE26.ts:931`. **Do not keep two hand-maintained renderers** | **ADAPT** | MED | MED | MED | M | Proposal presentation — ⚠ the **two renderers are already a second presentation authority**; this candidate is only admissible if it ends with one | PROPOSED | NOT STARTED |
| **B7 — Storage as an engineering surface** | Aurora expresses storage as outcomes a homeowner understands — `8 kWh / 25% / 5 Hrs`, `100% / 5 Days` — and its confirm modal states exactly what happens next (`T-ya6_lvEF8` @0:53, @4:49) | **Nobody has an engineering storage surface.** Aurora's is a sales tier picker; Solargraf asks the installer to *type* the backup class into the permit form | Battery panel is model + units + kWh/unit with `~Est. Backup %` and `~Est. Runtime h` explicitly marked **"UI only"** (`app/engineering/page.tsx:9366`), plus one electrical line `+{n}A bus load (NEC 705.12B)` | **PARTLY CONFIRMED, scope corrected.** The lane's "zero hits for ESS/PCS" is false (see §0). What is genuinely absent is a **backup-class / critical-loads-panel decision surface** — no whole-home vs partial vs grid-tied-no-backup input, no critical-loads list, no explicit AC- vs DC-coupled decision | The SLD **already draws** battery, BUI, backup sub-panel, generator and ATS; `lib/electrical-calc.ts:1259-1267` already raises the 705.13 PCS path; `equipment-db` already knows `wholeHomeBackup` and `requiresGateway`; `computed-system.ts:2745` already inserts the gateway. The rendering and equipment halves exist | **BACKLOG with intent.** Recommended on white-space reasoning, not competitive evidence — no product watched sets a bar here, so the design is unvalidated. Validate before scheduling | **BACKLOG** | HIGH | MED | MED-HIGH | L | Would create a **new** design-input authority (backup class). Must be defined once and consumed by SLD, BOM, busbar and proposal alike — never per-surface | PROPOSED | NOT STARTED |
| **B8 — Delete the dead electrical code** | — (hygiene; no competitor signal) | — | ~1,437 lines strictly dead (`app/engineering/core/stringSystem.ts` 382, `microSystem.ts` 252, `systemFactory.ts` 215, `lib/segment-builder.ts` 588) + ~1,081 orphaned behind live HTTP with no client (`lib/engineering-automation.ts` 767 + 4 routes) | **CONFIRMED, figure larger than claimed (CONDUCTOR-AUTHORITY §Claim 6).** ~2,518 lines removable. The hazard is specific: `lib/segment-builder.ts:177` is the one implementation with a genuinely **different physical basis** (NEC T8 *solid* copper, 240 V hardcoded on DC runs). If anyone ever wires `cs.segments`, a third answer arrives silently | The project already knows this: `lib/electrical-calc.ts` + `lib/wire-autosizer.ts` are correctly retained as **shadow-only by ruling** on the permit path, not deleted | Delete, after verifying `cs.segments` / `segmentIssues` / `segmentInterconnectionPass` are absent from the `ComputedSystem` snapshot surface | **ADAPT** (do it, but as hygiene) | LOW | LOW | LOW | S | Removes a latent **fourth** voltage-drop authority. No live authority touched — **verify snapshot absence first** | PROPOSED | NOT STARTED |
| **B9 — `permitReadiness` truthiness** | — (hygiene) | — | `app/engineering/page.tsx:8611` — `ok: !!(compliance.overallStatus)`, and `'FAIL'` is truthy, so the ring could read 100 % over a failing verdict | **CONFIRMED IN CODE, DEAD IN PRODUCT.** No JSX consumes `permitReadiness`; the visible ring is driven by `_readyPct` from the sheet manifest | The snapshot's real readiness builder is verdict-based throughout (`build.ts:2341, 2352, 2444, 2629, 2754`) and carries explicit fail-closed comments at `:2167-2178` **against exactly this defect class** | Fix to `=== 'PASS'` or delete the unrendered array | **ADAPT** | LOW | LOW | LOW | XS | None (unrendered) | PROPOSED | NOT STARTED |

---

## 2. LANE B — TOP BOUNDED CANDIDATES

Three candidates, each implementable by a main thread in one sitting.

### B-I. One thermal design basis for the engineering page *(highest confidence in this document)*

**Exactly what to build.** Make the app read the same design temperatures as the
stamped planset, and make the designer's string-length readout come from the engine
rather than from a page-local recompute. This is one job because the readout's wrong
answer has two causes and both live in the same render path.

1. In `app/api/engineering/calculate/route.ts`, replace `getDesignTemperatures(stateCode)`
   (line 68, consumed at `:143`, `:167`, `:262-263`, `:418-419`) with
   `getThermalDesignBasis(...)` from `lib/permit/utils/designTemps.ts:122`.
2. Delete `getDesignTemperatures` from `lib/jurisdiction.ts:377` and its import at
   `app/api/engineering/calculate/route.ts:7`.
3. Remove the `-10` literal `designTempMin` defaults — 11 sites in
   `app/engineering/page.tsx` (`:447, 1451, 1571, 1864, 2050, 2385, 2970, 3580, 4282, 6247, 8076`)
   and `app/api/engineering/sld/route.ts:239`. Fail loudly instead of defaulting.
4. Replace the inline recompute at `app/engineering/page.tsx:~10879-10890` with the
   `maxPanelsPerString` / `minPanelsPerString` / `recommended` already returned by
   `/api/engineering/calculate` and stored at `page.tsx:6455`. Delete the
   `|| 600`, `|| 100`, `|| 41.8` fallbacks with it.

**Files.**
`app/api/engineering/calculate/route.ts` ·
`lib/jurisdiction.ts` ·
`lib/permit/utils/designTemps.ts` (read-only — this is the authority) ·
`app/engineering/page.tsx` ·
`app/api/engineering/sld/route.ts` ·
`lib/string-generator.ts` (read-only — this is the engine).

**What would prove it works.**
- Illinois, a 40.95 V Voc / −0.27 %/°C module: the page's `Max/string` must print **12**,
  matching the planset. Today it prints **13**. Repeat for the other two IL modules that
  flip (40.92 V / −0.27, 41.20 V / −0.26).
- A SolarEdge optimizer system: the readout must show the brand ceiling (25), not
  `floor(maxDcVoltage / vocCorrected)` ≈ 10-13, and must agree with what
  `lib/string-generator.ts:247` returns for the same inputs.
- Alaska (Δ = 16 °C) and Nevada (Δ = 10 °C): app and planset `designTempMin` identical.
- A harness asserting `getDesignTemperatures` has **no importers**.
- Grep proves zero `-10` design-temperature literals survive.

**What could go wrong.**
- **The app's numbers all move.** Every designed string length changes in the 11.5 % of
  module×state combinations that flip, and IL is one of them — a designer mid-job will
  see a design go from valid to invalid. That is the point, but it needs to be announced,
  not discovered.
- **Digest:** none. `lib/jurisdiction.ts` values never reach the snapshot; the snapshot
  already reads `proj.designTempMin ?? designTemps.ashraeExtremeLowC` (`build.ts:2977`).
  No PE approval is retired. *This is the whole reason it ranks first.*
- Removing the `-10` defaults can surface a genuine `undefined` on a project with no
  resolvable state. Decide explicitly: refuse, or fall back with a visible provenance
  label — do not silently reintroduce a third regime.
- `getThermalDesignBasis` takes `lat`/`lng`/`state`/`address` and an override; the app's
  call sites must pass the project's AHJ design-low override or the override silently
  stops applying on the app side.

### B-II. `target` on every electrical issue, with a jump control

**Exactly what to build.** Add `target?: { kind: 'string' | 'inverter' | 'run' | 'panel'; id: string }`
to `CalcIssue` (`lib/electrical-calc.ts:173-183`), populate it at the emit sites that
already know the object (`:622` `E-VOC-EXCEED`, `:635` `W-MPPT-HIGH`, `:647` `W-MPPT-LOW`,
the `resolveOCPD` block at `:659-674`, and the `rules-engine.ts` pass emitters), and
render a jump control on each row in the electrical and compliance tabs that selects
that object and scrolls the config tab to it.

**Files.** `lib/electrical-calc.ts` · `lib/rules-engine.ts` · `app/engineering/page.tsx`.

**What would prove it works.** For each of the ~6 electrical issue codes, the emitted
issue carries a target id that resolves to a control actually present in the config tab,
and activating it focuses that control. Plus a negative test: `target` does **not** appear
anywhere under `lib/permit/snapshot/`.

**What could go wrong.** The one real hazard is `target` leaking into the permit snapshot
via `compliance.electrical`. That would move the digest and retire live PE approvals for a
pure UI affordance. Strip it at the projection boundary and assert its absence in the test.
Secondary: `stringLabel` is currently a display string (`` `${invIdx+1}-${strIdx+1}` ``),
not a stable id — reordering inverters would break the link. Derive the target from the
config object's identity, not from the label.

### B-III. The symbolic relation and the "why" sentence on the SLD's 120 % panel

**Exactly what to build.** In `lib/sld-professional-renderer.ts`, extend the two 120 %
row builders (`:3106-3137` load-side / supply-side / backfed, and `:4576-4595` the
POI panel) with (a) a symbolic relation line — `Bus × 1.2 ≥ Main OCPD + Σ Backfeed` —
printed above the substituted values it already shows, and (b) one plain sentence of
intent beneath the verdict. Do the same for the DC block's Voc/Isc correction, whose
substituted values are already printed.

**Files.** `lib/sld-professional-renderer.ts` only.

**What would prove it works.** Per [[hybrid-planset-visual-mandate]]: regenerate the
Braidon planset and **screenshot the SLD page**. Ray judges a sheet by how it looks.
Check the added lines do not overflow the panel at `PRH_MAX` / `acRh` sizing, and that
they render on all three interconnection branches (load-side, supply-side, backfed).

**What could go wrong.**
- **Governance, not digest.** The digest is over the snapshot JSON
  (`lib/permit/snapshot/digest.ts:223`), so static SVG text does not move it. But an
  already-issued, PE-stamped package would regenerate with a visibly different sheet.
  **Get a ruling on re-issue before shipping.** Do not let anyone conflate this with the
  digest question — they are different risks with different answers.
- Row-height arithmetic: `acRh = Math.min(PRH_MAX, (PCH-17)/acRows.length)` shrinks every
  row as rows are added. Two extra rows on the supply-side branch may push text under the
  panel border.
- Resist the temptation to *compute* anything new here. The renderer must stay a
  presentation of `poiRulePasses` and friends; a locally recomputed verdict would be a
  second interconnection authority on the sheet.

---

## 3. LANE C — TOP BOUNDED CANDIDATES

### C-I. Terminal-state guards + one signing authority

**Exactly what to build.** Four guards and one deletion.

1. `app/api/proposals/[id]/route.ts:365` (`refresh_snapshot`) — refuse when
   `signed_at IS NOT NULL OR status IN ('accepted','signed')`, offering *Create revision*.
2. `app/api/proposals/[id]/share/route.ts:55-94` — same guard. This one is hit more often
   (it is the ordinary re-send) and it is the only path that rewrites `pricingSnapshot`.
3. `app/api/proposals/[id]/route.ts:346-351` (status PATCH) and
   `app/api/proposals/bulk/route.ts:89-101` — refuse a transition off a terminal state, so
   a returning homeowner cannot downgrade `accepted` back to `viewed`.
4. Point `components/SignatureModal.tsx:159` at `POST /api/proposals/{id}/sign`, which
   already returns 409 on `signed_at || status === 'accepted'`
   (`app/api/proposals/[id]/sign/route.ts:144-149`). Then delete whichever of
   `components/proposals/SignatureBlock.tsx` or the PATCH signature branch loses — **do
   not leave two signing authorities standing.**

Copy the in-repo idiom: `app/api/cron/proposal-expiry/route.ts:90,105` already filter
`AND p.signed_at IS NULL`.

**Files.** `app/api/proposals/[id]/route.ts` · `app/api/proposals/[id]/share/route.ts` ·
`app/api/proposals/bulk/route.ts` · `components/SignatureModal.tsx` ·
`app/api/proposals/[id]/sign/route.ts` · `components/proposals/SignatureBlock.tsx` (delete
candidate) · `app/proposals/view/[id]/page.tsx:146-152` (stop the unconditional `viewed` PATCH).

**What would prove it works.** Sign a proposal, then: refresh is refused with a revision
offer; re-share is refused; the bulk route refuses `draft`; re-opening the link does not
write `viewed`; and re-submitting the signature returns 409 with the original signer's
name, email and timestamp intact. Plus a grep proving exactly one signing write path exists.

**What could go wrong.** The `status` split-brain (NEW-B) means a "signed" proposal still
reports `draft` from `data_json.status` to the list API (`app/api/proposals/route.ts:28`) —
so a guard written against `data_json.status` will **never fire**. Write the guards against
the **column** and `signed_at`, and resolve the split-brain in the same pass or the guards
are decorative. Second risk: refusing the share-route refresh could break a legitimate
"resend the same link" flow — separate *re-send* from *re-snapshot* rather than blocking both.

### C-II. Send gated on save

**Exactly what to build.** Add a staleness term to
`components/project/ProposalTab.tsx:51` — `const canGenerate = hasDesign && hasBill && !designNewerThanSnapshot` —
render OpenSolar's affordance on the already-disabled button at `:240` (the reason *on*
the control, e.g. *"Save changes to enable send to customer"*), and mirror it as a 409 in
`POST /api/proposals` and `POST /api/proposals/[id]/send-email`.

**Files.** `components/project/ProposalTab.tsx` · `app/api/proposals/route.ts` ·
`app/api/proposals/[id]/send-email/route.ts`.

**What would prove it works.** Dirty the design, attempt Generate → button is disabled and
states why; call the API directly → 409 with the reason; save → both succeed.

**What could go wrong.** Little. The disabled-with-reason pattern already exists twice in
the same file (`:240`, `:627`). The only judgement call is what counts as "newer" — use the
same `snapshotAt` vs `project.updated_at` comparison C-III needs, so the two features share
one definition of staleness rather than inventing two.

### C-III. Backup-capability disclosure in the proposal

**Exactly what to build.** One sentence in the `data-block-id="equipment"` block of
`app/proposals/view/[id]/page.tsx` (`:1862-1897`), derived from the selected battery's
**existing** `equipment-db` fields — `backupCapable`, `wholeHomeBackup`, `requiresGateway`,
`gatewayModel` — stating whether the house stays on in an outage, naming the gateway when
`requiresGateway` is true, saying plainly when the gateway is **not** in the BOM that there
will be no backup, and noting that backup capability sits outside the ROI figure. Surface
the same derivation through `buildCanonicalProposal` so the web view and the PDF path
cannot disagree.

**Files.** `lib/proposal/buildCanonicalProposal.ts` (derive once) ·
`app/proposals/view/[id]/page.tsx` (render) ·
`lib/proposal/renderProposalHTML.ts` (render, if that route survives C6) ·
`lib/equipment-db.ts` (read-only — this is the authority) ·
`lib/computed-system.ts:2745-2750` (read-only — the existing gateway consumer, to mirror
its logic rather than re-implement it).

**What would prove it works.** A battery with `requiresGateway: true` and no gateway in the
BOM renders the no-backup sentence; adding the gateway flips it to the capability sentence
naming the model; `wholeHomeBackup: false` renders *partial*, never *whole-home*; a
battery-free proposal renders nothing; and the 25-year savings figure is byte-identical
before and after, proving the disclosure never entered the ROI frame.

**What could go wrong.** The strong temptation is to hand-write backup copy per battery in
the proposal layer — that is a second equipment authority and must be refused. Derive it in
`buildCanonicalProposal` and render it, so both surfaces read one value. Second risk:
`computed-system.ts:2745` gates on `bat.requiresGateway && bat.gatewayModel`; a record with
`requiresGateway: true` and a null `gatewayModel` silently adds nothing today — the proposal
must treat that as "no backup", not as "gateway present", or the disclosure will be
confidently wrong in exactly the case the buyer-side source warns about.

---

## 4. ARCHITECTURAL GUARD — what was rejected and why

SolarPro's hard rule: **never create a second authority.** Applied to these lanes:

| Tempting candidate | Ruling |
|---|---|
| Store per-option prices/specs in `data_json` and render them without re-running `buildCanonicalProposal` (C5) | **REJECT.** Proposal-only pricing. Options are admissible **only** as design clones passed through the existing canonical builder. |
| Hand-write backup copy per battery in the proposal layer (C4) | **REJECT.** Second equipment authority. Derive from `equipment-db` via `buildCanonicalProposal`. |
| Keep both `lib/proposalPDF.ts` and `lib/proposal/renderProposalHTML.ts` while adding section toggles (C6) | **REJECT as specified.** Two hand-maintained renderers already disagree on `purchaseMode`. The candidate is admissible only if it ends with one renderer. |
| Fix the String Sizing readout by "correcting" the inline recompute (B2) | **REJECT.** That preserves the second string-sizing authority. Delete it and render the engine's answer. |
| Recompute the 120 % verdict inside the SLD renderer to print the relation (B6) | **REJECT.** Render `poiRulePasses`; never recompute on the sheet. |
| Re-introduce Voc×N checking for optimizer topology to "match Aurora" (B-lane cand. 2 framing) | **REJECT.** `lib/electrical-calc.ts:607-620` and `lib/string-generator.ts:228-249` retired it in v47.412 with a stated physical rationale and a named regression. The lane read the absence of a check as a gap; it is a fix. |

### 🚨 Digest / PE-approval flags

| Candidate | Digest impact | Ruling needed |
|---|---|---|
| **B1** thermal basis reconciliation | **NONE.** `jurisdiction.ts` values never reach the snapshot (`build.ts:2977`). | No — ship it. |
| **B2** delete the inline readout | **NONE.** App render only. | No. |
| **C1/C2/C3/C4** proposal work | **NONE.** The permit snapshot is a different artifact. | No. |
| **B3** `target` on issues | **NONE — if and only if** `target` is stripped before `compliance.electrical` reaches the snapshot. | No, but assert it. |
| **B5** org electrical standards | **MOVES THE DIGEST.** Changes the selected OCPD and conduit values inside the snapshot. | **YES.** |
| **B4** one resistance basis on the permit path | **MOVES THE DIGEST.** `routeSegments[].voltageDropPct` and `feeder.voltageDropPct` shift ~0.22 %. | **YES.** |
| **B6** SLD formula + why-sentence | **Digest: none** (digest is over snapshot JSON, `digest.ts:223`). **But** a stamped sheet regenerates differently. | **YES — a re-issue ruling, not a digest ruling.** |
| **B8** delete dead modules | **NONE** if `cs.segments` / `segmentIssues` / `segmentInterconnectionPass` are absent from the snapshot surface. | Verify first. |

---

## 5. WHAT TO PROTECT

Three things in these lanes are already better than every product watched, and every
candidate above must preserve them.

1. **`lib/proposal/buildCanonicalProposal.ts` as the one financial calculator** — 3 call
   sites, 308 `cp.*` accesses across the renderers, `assertTruth` and a system-size truth
   lock that throw in development. None of the proposal defects found are miscalculations;
   they are all about *when* its inputs may be rewritten.
2. **The planset's shown work** — `ampacityChainLines()` at
   `lib/permit/snapshot/electricalProjection.ts:1321` prints every derating factor in one
   line. No competitor sheet watched comes close.
3. **`lib/electrical/routeLengthBound.ts`** — separates SolarPro's design target from the
   NEC recommendation, with the note that NEC 90.5(C) makes informational notes
   unenforceable. Better discipline than anything in the research. And
   `routeVoltageDropRecalc` **refuses rather than guesses**.

Plus one already named in ROUND-3-TRIAGE and re-confirmed here: SolarPro's BOM sits inside
the permit snapshot, so a part swap moves the digest and retires the PE approval. OpenSolar
states in its own docs that Hardware-tab changes do not affect the design or the proposal.
SolarPro is the only product in this research where a substitution **cannot** quietly
invalidate a stamped design. The gap is a screen, not a mechanism.
