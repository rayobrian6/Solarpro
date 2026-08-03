# WS-5 §26 / §40 FINDINGS TRIAGE

Verified decomposition of the open findings recorded in
`BRAIDON-WS5-FIELD-MEASUREMENT-REACHABILITY-CLOSURE.md`. Every claim below was
reproduced in code at `01d128a2` and adversarially re-verified against the
source; refuted and corrected claims are marked as such.

**Nothing in this document was implemented.** It is a decomposition and an
ordered remediation plan. The one source change made in this pass (the missing
migration-118 operator button) is recorded in
`MIGRATION-118-POSTGRES-AND-WS5-SECTION40-TRIAGE.md` and is not a §40 item.

---

## 0. A CORRECTION TO THE BRIEF: THERE ARE TWO LISTS

The instruction asked for "the six findings documented in §40" *and* for "three
procurement/current defects" plus the blanket `1.15`. Those are **not the same
list**. The report carries two:

| Section | Belongs to | Contents |
|---|---|---|
| **§26** OPEN DEFECTS RECORDED, NOT CLOSED | Part I (WS-5) | the `1.15`, the two procurement bases, the null currents, `ecd` exit 2, migration 118, the PG adapter |
| **§40** WHAT THIS REPAIR DOES **NOT** CLAIM | Part II (D5/D6) | `generatedAtIso`, `routeProvenanceLabel`, self-heal re-stamp, registry dates, client UTC defaults, the profile-count distinction |

The "three procurement/current defects" are **§26 items 1–3**. Both lists are
triaged here, extracted verbatim, not paraphrased.

---

## 1. §40 FINDINGS — EXACT TEXT AND VERDICT

### §40-1 · `generatedAtIso` holds a localised date in ISO-declared fields

> `snapshot.meta.generatedAtIso` (and `environmentalCapturedAtIso`,
> `_capturedIso`) store a localised `M/D/YYYY` string in ISO-declared fields
> when no instant is injected — see §34 for why the digest blocks the fix.

**REPRODUCED, AND WIDER THAN RECORDED.**

| | |
|---|---|
| Source | `lib/permit/snapshot/build.ts:2282`, `:1488`, `:1025` |
| Current | An unfrozen render writes `"8/3/2026"` into **six digested slots**: `meta.generatedAtIso`, `codeAuthority.capturedAtIso`, `projectAuthority.capturedAtIso`, `project.ahj.recordCapturedAtIso`, every `permitReadiness.registry[].createdAtIso`, and the derived stage's `ctx.nowIso`. |
| Expected | An ISO-declared field holds an ISO instant, or at minimum the unambiguous `YYYY-MM-DD` the resolver already computes as `_issue.issueDateIso`. |
| Risk | **authority** (digested) + presentation |
| Blast radius | Snapshot identity, CERT Document ID, engineering-review coverage |

Three facts the original finding did not record:

1. **The digest provably covers it.** `computeSnapshotDigest`
   (`lib/permit/snapshot/digest.ts:28-34`) deletes only `meta.digest` and
   `meta.snapshotId`. Measured on identical input:
   `2026-08-02T12:00:00Z` → `PDS-52CF36872161`, Document ID `…-822026`;
   `2026-08-03T12:00:00Z` → `PDS-21C1D035FC38`, Document ID `…-832026`.
   **Snapshot identity changes with the calendar day for an unchanged design.**
2. **One of the six reaches a sheet.** The derived stage's `nowIso` flows to
   `derived.ts:437 lastResolutionAttempt` → `evidence.ts:79` →
   `reviewStatus.ts:241`, printed verbatim on **RS-1**. A live artifact shows
   *both* `lastResolutionAttempt 8/1/2026` and
   `lastResolutionAttempt 2026-08-02T01:31:25.447Z` on the same sheet — two
   formats, and the raw UTC instant is one calendar day ahead of the title
   block. RS-1 is dropped from both compact profiles, so this is an internal
   review surface, not the AHJ submittal.
3. **`environmentalCapturedAtIso` is a DEAD write.** `environmentalAuthority.ts`
   declares it on the args interface (line 79) and never reads it. Not digested,
   not rendered.

`Date.parse("8/3/2026")` does not throw — it returns a **host-zone-dependent**
instant (`T05:00:00Z` on a Chicago box, `T00:00:00Z` on a UTC container). That
is the D6 defect re-armed for the first consumer that touches it. There are no
readers today.

**Test coverage.** `d6-document-issue-date.test.ts` test 27 asserts the ISO
shape only on the *injected* path, so it is blind to the live fallback.
**Missing:** no test asserts the field's shape on the default path; no test
asserts digest stability across a calendar-day boundary. Three existing
digest-stability tests (`aac-ws3-ws4:912`, `wave6-legacy-sweep:142`,
`aac-ws8-ws9:693`) are **racy across local midnight** and rely on the
day-granular fallback.

---

### §40-2 · `routeProvenanceLabel` — divergent verification rule ★ PRIORITY

> `routeProvenanceLabel` (`electricalProjection.ts`) carries a **second,
> divergent** copy of the verification rule: it counts `field-measured` as
> verified where canonical `closesFieldVerification` does not. It drives PV-1 /
> roof-template conduit callouts and is pinned by an existing test. Same defect
> class as D5; deliberately left alone because it sits inside the route-length
> resolver this repair was told not to reopen.

## CLASSIFICATION: **PRESENTATION-ONLY DIVERGENCE**

…**for the divergence as stated.** But the trace surfaced a *different, live*
defect in the same function that is materially worse. Both are set out below.

#### 2a. The stated divergence — real, latent, unreachable in production

`lib/permit/snapshot/electricalProjection.ts:203-207`:

```ts
export function routeProvenanceLabel(snap: PermitDesignSnapshot | null | undefined): string {
  const st = routeVerificationStatus(snap);
  const verified = st === 'field-measured' || st === 'field-verified' || st === 'as-built-verified';
  return verified ? 'ROUTE FIELD-VERIFIED' : 'CAD-DERIVED ESTIMATE — FIELD VERIFY';
}
```

Truth table across all seven `RouteVerificationStatus` values — exactly **one**
disagreement with `closesFieldVerification` (`types.ts:337-339`):

| state | `routeProvenanceLabel` | `closesFieldVerification` |
|---|---|---|
| unverified-estimate / cad-derived-estimate / geometry-derived / field-reported | false | false |
| **field-measured** | **TRUE** | **FALSE** ← divergent |
| field-verified / as-built-verified | true | true |

**The divergent input is not producible by the production builder.**
`build.ts:645-648` co-writes `lengthSource` **and** `verificationStatus`; the
WS-5 applier at `build.ts:1430-1432` co-writes them from
`measurementAuthorityPair`, which can only emit `field-reported` or
`field-verified` (`fieldMeasurement/types.ts:229-234`). The only route to
`field-measured` is the `?? statusForLengthSource(...)` fallback
(`electricalProjection.ts:183-184`), which fires **only when `verificationStatus`
is absent** — and no production writer leaves it absent.

**Decision surface: zero.** All production call sites are string interpolation —
`roof.ts:774`, `roof.ts:1908` (SVG `<text>`), `sheetComposition.ts:884`
(`CalloutItem.sub` → `escapeH` → `<span>`), and
`scripts/braidon-correction-artifacts.ts:139/176` (JSON + console). *Correction
to the first analysis:* there are **nine** call sites, not four — five are test
assertions comparing the return value by exact string equality. Every real
decision reads canonical predicates directly: release closure via
`sourceClosesRouteLengthRequirement` (`build.ts:1845-1846`,
`derived.ts:178-179`), VD grading via `closesFieldVerification`
(`electricalProjection.ts:558`), the `verifiedFieldLengthFt` write via
`a.closesFieldVerification` (`build.ts:1438`), BOM procurement state via the
blocker code (`bomForPermit.ts:1641-1647`). `routeVerificationStatus` is
*downstream* of the blocker (`electricalProjection.ts:178` reads it and caps
itself) — there is no feedback path into any gate.

**Converging changes zero rendered bytes on Braidon.** Its governing state is
`cad-derived-estimate`; both predicates return false. One test would need
editing: `electrical-correction-0722.test.ts:81-84`.

*Correction to the §40 note:* "not even a legal `RouteLengthSource`" is **half
right**. `field-measurement` is illegal as a `RouteLengthSource` but is fully
legal for the field it is actually assigned to. There are two length-source
vocabularies and the repo already hand-translates between them
(`ws5-field-measurement-reachability.test.ts:430-432`). What makes the fixture
non-production is its **shape** (it omits `verificationStatus`), not illegality.

#### 2b. THE LIVE DEFECT — the opposite direction, rendered today

`routeProvenanceLabel` collapses seven states to two, takes the **package-wide
weakest** across *all* segments, and does **not** filter
`routeAuthorityApplicability`. `MSP_TO_UTILITY_RUN` is `UTILITY_OWNED`
(`build.ts:618-619`), can never receive a measurement (`build.ts:1428`), and so
holds `cad-derived-estimate` permanently. Combined with the blocker cap, the
label is **structurally pinned** to the estimate string — the
`ROUTE FIELD-VERIFIED` branch is effectively **unreachable in production**.

Extracted from checked-in renders:

| Artifact | PV-4B / PV-4B.1 | PV-1 callout ④ / SCHED |
|---|---|---|
| `braidon_full.html` | `CAD ROUTE — GEOMETRY DERIVED` (BRANCH_RUN) | `CAD-DERIVED ESTIMATE — FIELD VERIFY` |
| `controlled-reported_full.html` | `FIELD-REPORTED (UNVERIFIED)` | `CAD-DERIVED ESTIMATE — FIELD VERIFY` |
| `controlled-verified_full.html` | **`FIELD VERIFIED`** | **`CAD-DERIVED ESTIMATE — FIELD VERIFY`** / `ROUTE AUTHORITY: PENDING` |

**A genuinely field-verified feeder renders as a CAD estimate on PV-1 and SCHED
while PV-4B says FIELD VERIFIED.** That is a cross-sheet contradiction on a
stamped drawing set — the exact class the §3 SEGMENT AUTHORITY campaign and D5
existed to kill. It understates rather than overstates, so it is not a safety
defect, but it is the same defect shape.

#### 2c. `routeProvenanceLabel` is NOT the only second copy

| Site | What it does |
|---|---|
| `electricalProjection.ts:205` | the §40 finding |
| `electricalProjection.ts:1350` | `_VERIFIED_ROUTE = new Set(['field-measured','field-verified','as-built-verified'])` — **inside `projectE1PhysicalSchedule`, the PV-4B.1 path** |
| `structuralPages.ts:1986` | makes **SCHED print `ROUTE AUTHORITY: VERIFIED`** on exactly the input `closesFieldVerification` refuses — the same bug with a stronger word attached |
| `electricalProjection.ts:1738/1752` | *manufactures* the `field-measured` state and feeds it to `gradeVoltageDrop`, which correctly refuses it — accidentally correct, by way of the canonical predicate catching the second copy's output |

None of the three additional copies is pinned by any test.

| | |
|---|---|
| Risk | **presentation** for 2a; **presentation / cross-sheet authority contradiction** for 2b |
| Migration impact | none |
| Snapshot-schema impact | none |
| Blast radius | PV-1 array plan (callout ④, JB label, hybrid trench label), SCHED route-authority block, one JSON evidence artifact |

### Why this was NOT implemented in this pass

The brief permits implementing a proven presentation-only repair "if the repair
is tiny". Converging the one predicate *is* tiny — but it would fix **one of four
copies** and leave the live cross-sheet contradiction untouched, while producing
zero visible change. That is worse than leaving it: it manufactures the
appearance of convergence without the substance. All four copies plus the
applicability-scope fix belong in one workstream (**WS-A**), with the
contradiction tests written first.

---

### §40-3 · GET self-heal re-stamps an issued package ★ MOST SERIOUS

> The GET self-heal path regenerates without replaying the issue context, so a
> version-bump read re-stamps an already-issued package with today's date. The
> `explicitIssueDate` hook now exists to fix it; wiring it is a save-path change.

**REPRODUCED END TO END. This is the highest-severity finding in either list.**

`app/api/engineering/permit/route.ts:303-306`, gated at `:271` on
`(!html || isStale) && inputJson` where `isStale = savedVerNum <
PLANSET_ENGINE_VERSION`. No instant and no issue date are passed;
`generatePermit.ts:156-161` then unconditionally overwrites `project.date`.

**A READ mutates an issued document.** Confirmed consequences:

1. **The replay hooks are dead.** `generatePermit.ts:150-151` reads
   `project.issueDate ?? input.documentIssueDate`; **neither has any writer**
   anywhere in `lib/`, `app/` or `components/`.
2. `permit_input.json` **is** written with the issued date (`route.ts:1590` runs
   after `:1557`; `generatePermit` mutates `project` in place) — and is then
   **ignored on re-read**.
3. CERT Document ID changes: `822026` → `832026` (`certPages.ts:254`).
4. Snapshot digest and `snapshotId` change.
5. **A licensed engineering approval stops covering.** `validate.ts:662`
   re-checks `review.reviewedDigest === s.meta.digest`;
   `attachPriorSnapshotDigest` hands the resolver the *old* digest so the
   approval is found, and the build then rejects it against the new one.
6. The self-heal **persists the re-dated HTML over the issued copy**
   (`route.ts:311-322`) but does **not** rewrite `permit_input.json`, so the
   served artifact's digest and the stored input's digest diverge.

| | |
|---|---|
| Risk | **authority / release** — the strongest in this document |
| Migration impact | none |
| Snapshot-schema impact | none (a `documentIssue` field on `PermitInput` is optional) |
| Blast radius | Every issued package that is read after an engine version bump |
| Test coverage | **Source-grep only.** `aac-ws1-resolver-lifecycle.test.ts:424` and `aac-ws8-ws9:667-669` assert on source *text*. **No test regenerates a stored input on a later simulated day.** |

Note `certPages.ts:254` is separately **not injective**: it strips slashes, so
`1/22/2026` and `12/2/2026` both render `1222026`.

---

### §40-4 · Registry document dates sliced from a UTC ISO string

> `jurisdictionResolvers.ts` / `structuralResolvers.ts` derive document-registry
> dates by slicing a UTC ISO string. These are third-party retrieval stamps, not
> the document's issue date, and sit in doc-control — left alone by scope.

**REPRODUCED — and the original scoping call was right, but for the wrong
reason.**

The UTC slice is **defensible**: a retrieval is a machine event with no
jurisdiction, UTC is the correct frame, full-precision `retrievedAtIso` is
preserved alongside, and the value reaches **no sheet** (grep of
`lib/permit/sections` finds zero renderers for `revisionOrDate` /
`versionOrDate` / `sourceVersionOrDate`).

**The real defect is the SLOT, not the timezone.**
`lib/migrations/113_manufacturer_document_registry.sql:38` declares
`document_date TEXT, -- publication / effective date (ISO or label)`. Both
resolvers write *when we fetched it* into *when it was published*, so a 2016
ASCE dataset archived today reads as a **2026** document. That is a wrong claim
about a third-party document, independent of any date-math question.

| | |
|---|---|
| Risk | **provenance semantics** — not a date defect |
| Blast radius | The `documents` table and `/admin/document-registry`. Not rendered. |
| Migration impact | Potentially a column-comment or new retrieval column (additive) |
| Test coverage | None. `d6` test 30's scan does not cover resolvers and requires a literal `toISOString()` call, which `record.retrievedAtIso.slice(0,10)` would not match. |

---

### §40-5 · Client-side UTC date defaults

> Client-side UTC date defaults (`app/engineering/page.tsx`, `lib/system-state.ts`)
> show a Central-time operator tomorrow's date in the UI before generation. The
> server overwrites it; the UI is not an authoritative generator.

**REPRODUCED. The server overwrite is confirmed** — the fixture posts
`date: '2026-07-21'` and the render carries `8/3/2026`.

**But the client value survives into a real artifact by a route the finding does
not name.** `config.date` is posted as `drawingDate` to
`/api/engineering/sld`, stamped into the SVG title block, and saved as
`SLD_*.svg` in `project_files`. It is kept out of the planset only because E-1
fails closed on the live renderer and explicitly discards the stored SVG
(`void storedSldSvg`) — an accident of a different repair, not a guard.

| | |
|---|---|
| Risk | presentation, on a downloadable non-planset artifact |
| Blast radius | Saved SLD SVGs; the operator's pre-generation UI |
| Migration / schema impact | none |

---

### §40-6 · Fixture 6 gates / 13 requirements vs live 5 / 14

> The frozen fixture renders **6 gates / 13 requirements**; the accepted live
> Planset 19 artifact says **5 gates / 14 requirements**. Different inputs — the
> fixture is not the live design (as with the 58 ft vs 64 ft `BRANCH_RUN`).
> Neither was changed to match the other, and nothing was suppressed to move a
> count.

**NOT A DEFECT — a standing reporting rule.** No remediation. Every count table
in every future report must label **profile, fixture/project, snapshot id, sheet
count, gate count, requirement count** before any comparison is drawn. Carried
forward as a non-goal, not a workstream.

---

## 2. §26 FINDINGS — THE PROCUREMENT / CURRENT CLUSTER

### §26-1 · `LEGACY_GLOBAL_SLACK` — the blanket 1.15

> `deriveRunLengths` bakes a blanket 1.15 into `onewayLengthFt`, which the
> snapshot consumes as the CALCULATION length. Named in `routeProcurementPolicy.ts`.

**CONFIRMED — and it is a CALCULATION risk, not merely a reporting one.**

`lib/bom/deriveRunLengths.ts:43-44`:

```ts
/** NEC 15% slack/waste factor applied to all derived run lengths. */
const SLACK_FACTOR = 1.15;
```

The comment is **false**: no NEC article prescribes 15%. It is a single
unexamined guess, propagated by copy.

**The number drives conductor gauge selection.** `computed-system.ts:1444-1462`
spreads the padded map into `defaultRunLengths` → `RunSegment.onewayLengthFt` →
the `onewayFt` argument to `autoSizeWire`/`calcVoltageDrop`. `autoSizeWire`
(`computed-system.ts:800-818`) walks the AWG ladder and accepts the first gauge
passing **both** ampacity and voltage drop — so a 15%-inflated length can force
a larger conductor, which then changes conduit fill, EGC size, the ampacity
chain and BOM cost. On Braidon no gauge moves (both padded runs sit at the `#10`
floor), but the mechanism is live on every project whose VD sits within 15% of
the limit.

**Ampacity itself does not consume the length** — it depends on current, ambient
temperature, rooftop adder and CCC count only. The **1.25 beside it is NEC
690.8(B) continuous current**, a genuinely different number. *Any repair must
not touch it.*

### §26-2 · Two procurement bases on a measured run

> The canonical segment uses the itemised policy; the BOM engine still applies
> its own 1.15.

**CONFIRMED — and worse than "two bases": the estimate path is DOUBLE-APPLIED.**

`lib/bom-engine-v4.ts:320` declares its own `const _WASTE = 1.15;` and applies
it to the **same** `onewayLengthFt` that already carries `deriveRunLengths`' 1.15
— at `:365` (conduit), `:525` and `:526` (hots/EGC).

> **Compound factor on the CAD-estimate path is 1.15 × 1.15 = `1.3225`.**

It propagates into **discrete part counts**, not just feet:
`:424 coupQty = max(1, ceil(ft/10) - 1)` and `:439 strapQty = max(2, ceil(ft/10) + 1)`
are functions of the already-doubled footage.

On a field-measured run: BOM orders `ceil(measured × 1.15)` while the canonical
segment simultaneously publishes `ceil(measured × 1.0815 + 3)` — **two different
orders for one run**, exactly as §26 states.

### §26-3 · `continuousCurrentA` / `operatingCurrentA` null on every segment

> The mapper reads field names the engine does not emit. Named in `build.ts`.

**CONFIRMED — and there is a trap underneath it.**

`build.ts:546-549` reads `r.operatingCurrentA`, `r.currentA`,
`r.continuousCurrentA`, `r.effectiveCurrentA`. **The engine emits none of the
four.** It emits `continuousCurrent` (`computed-system.ts:196`) and
`requiredAmpacity` (`:197`). All three fields are `null` on all six segments of
every archived snapshot in the repo.

> **THE TRAP:** the engine's field *named* `continuousCurrent` is semantically
> the **OPERATING** current. `requiredAmpacity = continuousCurrent × 1.25`
> (`computed-system.ts:794`). Proven numerically: the feeder's stored
> `0.36936055%` VD reproduces to 7 digits from **45.079 A** (operating), not
> **56.349 A** (continuous). A naive `continuousCurrent → continuousCurrentA`
> mapping would understate the NEC 690.8(A) basis by 25% on every segment.

**Live consequences — two, neither a printed wrong magnitude:**

1. **One suppressed verdict.** `electricalProjection.ts:1687` feeds
   `num(seg.continuousCurrentA)` into the `DISCO_TO_METER_RUN` ampacity chain →
   `null` → fails closed to `PENDING`, beside a fully resolved
   `finalAllowableAmpacityA: 65`. The true value is 56.349 A → 65 ≥ 56.35 →
   **PASS**. It does **not** substitute the OCPD, so this is *not* the W1d
   defect class in code — but the rendered row invites a human to make that
   substitution.
2. **A wrong statement in the digest-bound archive.** On the field-measured
   path, `build.ts:1459` passes the *operating* current into the recalculator's
   `continuousCurrentA` slot; `:1467` overwrites the correct
   `voltageDropCurrentBasis: 'operating'` with `'continuous'`; `:1471` writes a
   provenance sentence declaring 45.079 A to be the continuous current. Renders
   on zero sheets today.

`calculatedCurrentA` has **zero readers anywhere**. **No test pins any of the
three fields.**

### §26-4/5/6 · `ecd` exit 2, migration 118, PG adapter

- **`planset-evidence-ecd` exits 2** — pre-existing; verified in the prior pass
  to fail *identically* on the `6bafde00` baseline artifact (gates 8/9, Q-CONN
  promotion + export scope). Not caused by, and not repaired by, D5/D6.
- **Migration 118 / PG adapter** — Phase A of this pass. See
  `MIGRATION-118-POSTGRES-AND-WS5-SECTION40-TRIAGE.md`.

---

## 3. THE `1.15` DEPENDENCY GRAPH

```
lib/bom/deriveRunLengths.ts:44  SLACK_FACTOR = 1.15
        │  (8 heuristic run ids; NOT applied to the 3 hardcoded defaults)
        ▼
DerivedRunLengths.runLengths
        │
        ▼
computed-system.ts:1444-1462  defaultRunLengths
        │
        ├──────────────► RunSegment.onewayLengthFt ─────────────┐
        │                                                        │
        ▼                                                        ▼
autoSizeWire / calcVoltageDrop                          bom-engine-v4.ts:320
(computed-system.ts:800-818, :778)                      _WASTE = 1.15  ← SECOND
        │                                                        │
        │ CALCULATION                                            │ ×1.15 AGAIN
        ▼                                                        ▼
   • voltage-drop %                                   • conduit ft  (×1.3225)
   • CONDUCTOR GAUGE  ← drives fill, EGC, ampacity     • hots / EGC ft
        │                                              • couplings ceil(ft/10)-1
        ▼                                              • straps    ceil(ft/10)+1
build.ts:631  routeSegments[].oneWayFt
build.ts:652  routeSegments[].calculationLengthFt   ← IDENTICAL VALUE (§26-1)
        │
        ├──► electricalProjection.ts:1360 _vdLenOf → gradeVoltageDrop
        └──► electricalPages.ts:174  PV-4B / PV-4B.1 "Length" column

ESCAPE HATCH: build.ts:1363-1367 overwrites BRANCH_RUN with geometric _maxDesigned
  → snapshot says 58 ft, the engine run the BOM reads still holds 68 ft.
    One segment, two lengths, one build, nothing reconciles them.
    computed-system.ts:2741 still checks trunkCable against the 68-basis (±20 ft).

FIELD-MEASURED PATH (clean of the blanket factor at the engine):
  applyFieldMeasurements.ts:72 substitutes the bare measured length
  build.ts:1446  deriveFieldMeasuredProcurement  (×1.05 ×1.03 +3 ft ⇒ 1.0815)
  …but bom-engine-v4.ts:365 still hits that measured length with its own 1.15.
```

**Six independent re-declarations, five different meanings, one number:**

| Site | Meaning it carries |
|---|---|
| `deriveRunLengths.ts:44` | route slack |
| `bom-engine-v4.ts:320` | fitting/termination waste |
| `segment-schedule.ts:925` | (re-declared) |
| `computed-system.ts:2629` | (re-declared) |
| `computed-multi-system.ts:161-211` | (re-declared) |
| Q-Cable path | reel-cut waste / additive service loop |

There is **no shared constant** — a change to one silently desynchronises the
others. There is **no project-, AHJ- or segment-level override anywhere**:
`wasteFactor` / `waste_factor` / `slack` appear in zero migrations and zero API
routes. The only tunable is `opts.qcableServiceLoopAllowance`, which is
*additive feet*, not a multiplier.

### What would actually move on Braidon

`deriveRunLengths` emits **nothing** for `COMBINER_TO_DISCO_RUN`,
`DISCO_TO_METER_RUN` or `MSP_TO_UTILITY_RUN` — the fixture CAD has zero
`conduitRoutes` and zero `electricalNodes`. Those three lengths (20 / 15 / 5 ft)
are **hardcoded defaults** (`computed-system.ts:1452/1453/1455`), not padded.
Only **two** Braidon segments actually carry the blanket factor:

| Segment | Now | Bare | VD now | VD bare |
|---|---|---|---|---|
| `ROOF_RUN` | 25 ft | 22 ft | 2.2891% | 2.0144% |
| `BRANCH_HOMERUN_RUN` | 18 ft | 16 ft | 0.29819% | 0.26506% |

`BRANCH_RUN` (58 ft, 0.18223%) is untouched — it takes the geometric escape
hatch. The Q-Cable 152 ft procurement is untouched.

### Why there is no safe one-line fix

The digest is SHA-256 over the whole canonical snapshot body
(`digest.ts:29-34`), so **any** calculation-length change re-digests every
snapshot and, because `build.ts:1649-1653` requires
`reviewedDigest === meta.digest`, **invalidates every existing digest-bound
engineering-review approval on every historical project**. Committed goldens
(`tests/goldens/wave0-computed-system.golden.test.ts`) pin
`r.onewayLengthFt` in `__snapshots__`; `bom-racking-scope.test.ts:167` pins
`40 × 1.15 = 46 ft`, couplings 4, straps 6.

Worse, `ws5-braidon-truth-state.test.ts:88` asserts
`derived[0].calculationLengthFt === derived[0].oneWayFt` — **it pins the
conflation rather than catching it.**

---

## 4. RISK SUMMARY

| ID | Finding | Class | Rendered wrong today? | Migration | Schema |
|---|---|---|---|---|---|
| §40-3 | self-heal re-stamps an issued package | **authority / release** | yes — date, Doc ID, digest, review coverage | no | no |
| §26-2 | double-applied 1.15 → 1.3225 | **procurement** | yes — every conduit/conductor/fitting quantity | no | no |
| §26-1 | blanket 1.15 in the calculation length | **calculation** | yes — VD %, and gauge where marginal | no | no |
| §40-2b | package-wide-weakest route label | **cross-sheet contradiction** | yes — PV-1/SCHED vs PV-4B | no | no |
| §26-3 | null segment currents | calculation (suppressed verdict) + archive | one verdict falsely PENDING | no | no |
| §40-1 | localised date in 6 digested ISO slots | authority (digest churn) | RS-1 only, internal profile | no | no |
| §40-2a | `routeProvenanceLabel` divergent predicate | **presentation** | no — unreachable in production | no | no |
| §40-5 | client UTC default → saved SLD SVG | presentation | non-planset artifact | no | no |
| §40-4 | retrieval time in a publication-date column | provenance semantics | not rendered | maybe (additive) | no |
| §40-6 | fixture vs live counts | **not a defect** | — | — | — |

---

## 5. RECOMMENDED WORKSTREAMS AND ORDER

The brief's proposed order was `routeProvenanceLabel → current semantics →
calculation/procurement separation → remaining procurement`. **The code trace
argues for a different order**, and the brief invited that: §40-3 mutates issued
documents on a read and needs no coordination with anything else, so it goes
first; the `1.15` cluster is one indivisible problem, not three.

### WS-A · Issue-date replay on regeneration ★ FIRST
*Fixes §40-3.* Highest severity, smallest blast radius, zero interaction with the
others. A read must never re-date an issued package.
- Persist and replay the document issue context through `permit_input.json`;
  feed the **existing** highest-precedence `explicitIssueDate` hook.
- Make the self-heal rewrite input and HTML together, or neither.
- Make `certPages.ts:254`'s Document ID injective.
- **Validation:** regenerate a stored input under a frozen later day; assert
  issue date, Document ID, digest and engineering-review coverage are all
  preserved. This test does not exist in any form today.
- **Non-goals:** the digest's coverage of the generation date (that is WS-D).

### WS-B · Route-authority label convergence
*Fixes §40-2a **and** 2b together.* Do not ship 2a alone.
- Converge **all four** inline copies onto `closesFieldVerification` —
  `electricalProjection.ts:205`, `:1350`, `:1738/1752`, `structuralPages.ts:1986`
  (the last prints the word `VERIFIED` and is the most dangerous).
- Scope `routeVerificationStatus` to **PROJECT_OWNED** runs, the way
  `build.ts:1837-1838` and `derived.ts:173` already do.
- Build the `RouteLengthAuthoritySummary` object the brief describes and project
  every label from it.
- **Validation:** a cross-sheet contradiction test pinning PV-1 / SCHED against
  PV-4B / PV-4B.1 for the *same segment* across all three controlled fixtures —
  the gap `d5-voltage-drop-cross-sheet.test.ts:55` leaves open. Rewrite
  `electrical-correction-0722.test.ts:82` to a production-shaped fixture.
- **Non-goals:** any change to release closure, VD grading or procurement — all
  four already bypass these labels.

### WS-C · Current-semantics separation
*Fixes §26-3.* Independent of the `1.15`; must precede it so the ampacity chain
is trustworthy before lengths move.
- Map `continuousCurrent → operatingCurrentA` and
  `requiredAmpacity → continuousCurrentA`. **Rename the engine field** or
  document the trap at the mapper — the current name will mislead the next
  reader.
- Fix `build.ts:1459/1467/1471` to stop labelling the operating current
  'continuous'.
- **Validation:** assert the `requiredAmpacity = continuousCurrent × 1.25`
  relationship; assert `DISCO_TO_METER_RUN` reaches PASS rather than PENDING.
- **Expect a digest re-base** — `routeSegments` is inside the digest.

### WS-D · Calculation length vs procurement allowance ★ LARGEST
*Fixes §26-1 and §26-2 as one problem.* Do not attempt piecemeal.
- Emit the **bare** centre-line length from `deriveRunLengths`; move every
  allowance into the itemised policy that already exists and is already correct
  (`routeProcurementPolicy.ts`) but is reachable only from the field branch.
- Give the five re-declarations one named constant each, by **meaning** — the
  same number must stop representing five concepts.
- Remove the second `_WASTE` application in `bom-engine-v4.ts`.
- Reconcile the `BRANCH_RUN` 58/68 split-brain, including
  `computed-system.ts:2741`'s tolerance check.
- **Requires an explicit decision from Ray** on digest re-basing and the fate of
  every existing engineering-review approval. **Do not start without it.**
- **Validation:** re-base goldens deliberately; assert calculation length ≠
  procurement length on every segment; assert the compound factor is gone.

### WS-E · Provenance and low-risk cleanups
*Fixes §40-4, §40-5, and §40-1's non-digest half.*
- Stop writing retrieval time into `document_date`; add a retrieval column or
  leave it null.
- Route the RS-1 `lastResolutionAttempt` through `formatInDocumentTimezone`.
- Fix the client UTC defaults and the SLD `drawingDate` path.
- Store `_issue.issueDateIso` in the six slots (option (a) — removes the
  `M/D/YYYY`-in-an-ISO-field defect, keeps every byte-identical test green).

### WS-F · Digest scope *(requires a decision, do last)*
*Fixes §40-1's digest half and the daily churn.*
- Exclude `meta.generatedAtIso` from `computeSnapshotDigest` **and** stop
  `_capturedIso` feeding the five digested record fields — otherwise churn
  re-enters through `createdAtIso`/`capturedAtIso`.
- Breaks `blocker-registry-w10.test.ts:62` **by construction** — that assertion
  *is* the coupling that has to be cut.
- Re-bases every absolute digest in `docs/evidence` and both closure reports.
- Also fixes the midnight-raciness in three existing digest-stability tests.

---

## 6. EXPLICIT NON-GOALS

1. **Do not remove or alter the blanket `1.15` outside WS-D**, and never without
   Ray's decision on digest re-basing.
2. **Do not touch the NEC 690.8(B) `1.25`** — it is a different quantity that
   happens to sit beside the slack factor.
3. **Do not "fix" the fixture-vs-live count difference** (6/13 vs 5/14) or the
   `BRANCH_RUN` 58 ft vs 64 ft split. Different inputs.
4. **Do not reopen WS-5** — persistence, migration 118 design, the measurement
   API, RBAC, audit records, or the operator UI.
5. **Do not converge `routeProvenanceLabel` alone.** One of four copies is worse
   than none.
6. **Do not add fictional field measurements to Braidon**, and do not use Braidon
   as a disposable fixture.
7. **Do not repair `planset-evidence-ecd`** as part of any of these — it is a
   separate, pre-existing failure with its own root cause.
8. **Do not suppress a gate or a requirement** to make a count move.
