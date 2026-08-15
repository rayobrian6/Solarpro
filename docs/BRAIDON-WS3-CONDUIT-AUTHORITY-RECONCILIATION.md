# BRAIDON WS-3 — CONDUIT AUTHORITY RECONCILIATION

Continues from `503ec7a9`. WS-1 grounding topology, WS-2 Q-Cable procurement,
WS-4 racking architecture, the IQ8A grounding closure, the Illinois state
propagation, the Madison County jurisdiction and migration 117 are untouched and
re-asserted below.

---

## 0. THE HEADLINE FINDING

**Every in-conduit route segment stored a conduit statement that contradicted its
own raceway authority — and it survived precisely because a downstream fix had
already hidden it from the sheets.**

The engine's `run.conductorCallout` is a legacy concatenation that carries a
SECOND, hard-coded raceway. On the live Braidon design every in-conduit segment
was archived as:

```text
BRANCH_HOMERUN_RUN     raceway=PVC Sch 80  size=1-1/4"  →  "6×#10 THWN-2\n1×#12 GRN EGC\nIN 1-1/4\" 3/4\" EMT"
COMBINER_TO_DISCO_RUN  raceway=PVC Sch 80  size=1-1/4"  →  "2×#6 THWN-2\n1×#10 GRN EGC\nIN 1-1/4\" 3/4\" EMT"
DISCO_TO_METER_RUN     raceway=PVC Sch 80  size=1-1/4"  →  "3×#6 THWN-2\n1×#10 GRN EGC\nIN 1-1/4\" 3/4\" EMT"
MSP_TO_UTILITY_RUN     raceway=PVC Sch 80  size=2-1/2"  →  "3×#2/0 THWN-2\n1×#6 GRN EGC\nIN 2-1/2\" 3/4\" EMT"
```

Two defects in one string, on every run:

* **two trade sizes** — the record's real size, then a hard-coded `3/4"`;
* **a raceway TYPE contradiction** — `EMT` on a record whose own field says
  `PVC Sch 80`. Different NEC article (358 vs 352), different fill tables,
  different support rules, different bonding path.

### Why it was never caught

`projectCanonicalFeeder` already refused that string. Its type declaration says
so in as many words (`electricalProjection.ts:38`):

> *clean multi-fact callout built from the canonical segment ONLY — never the
> legacy `elec.acConductorCallout` that concatenated two conduit computations.*

An earlier pass diagnosed the same concatenation, rebuilt the sheets' callout
from canonical parts, and pinned it with a test
(`electrical-correction-0722.test.ts:64` — *"the malformed concatenation is
gone"*). That test asserts on the **projection**. Nothing corrupt therefore
PRINTS — verified: the token `EMT` appears in the rendered package only inside
base64 data URIs, never as sheet text.

But the snapshot is the **digest-bound archive of record**. The workaround fixed
the readout and left the authority wrong. WS-3 fixes it at the source.

---

## 1. WS-3A — CONDUIT SOURCE MAP

| Conduit fact | Source of truth | Value on the live design |
|---|---|---|
| Raceway type | `routeSegment.raceway` ← `run.conduitType` | `PVC Sch 80` |
| Trade size | `routeSegment.tradeSizeIn` ← `run.conduitSize` | `1-1/4"` (2-1/2" on the service run) |
| NEC raceway article | `routeSegment.racewayNecArticle` ← `racewayNecArticle(type)` | `352` / support `352.30` |
| Physical raceway set | `electrical.physicalRaceways` ← `computeSystem` | 3 records |
| Per-raceway fill | `physicalRaceway.fillPct` (NEC Ch.9 T1) | 23.4 / 29 / 29 % |
| Conductor totals | `physicalRaceway.conductorCount` / `currentCarryingCount` | 7/6, 4/2, 4/3 |
| Fill requirement verdict | `conduitFillAuthority` (AAC WS-7) | `computed`, 29 %, pass |
| Feeder conduit projection | `projectCanonicalFeeder` | `PVC Sch 80 1-1/4"`, 29.0 % |
| Rendered fill (PV-4B) | `_feed.fillPct` | **29.0 % — agrees** |
| BOM conduit | `bom-engine-v4` §6 per-raceway pass | 21 / 23 / 18 ft (Σ segment × 1.15) |
| **Segment callout** | **was `run.conductorCallout` (legacy)** | **← THE DEFECT** |

Everything in that table reconciled **except the callout**. The fill chain in
particular is sound end to end: authority 29 % → feeder projection 29 % →
PV-4B prints `29.0% (Max: 40%)`.

---

## 2. THE REPAIR

`lib/permit/snapshot/build.ts` — the route-segment record now DERIVES its callout
from the fields that same record publishes, and never trusts the engine string:

```ts
conductorCallout: _derivedCallout   // was: r.conductorCallout ?? null
```

Three rules govern the derivation:

1. **The raceway named is this record's raceway.** `IN ${tradeSizeIn} ${raceway}`,
   built from the same two fields the record publishes. One size, one type.
2. **The conductor count is the RACEWAY's, not the segment's.** `run.conductorCount`
   is PER CIRCUIT — the shared branch home-run reports 2 while three branch
   circuits share that raceway. The callout describes what is *in the raceway*,
   so it takes `physicalRaceway.conductorCount` minus the single EGC. Deriving
   from the segment alone would have traded a wrong RACEWAY for a wrong
   CONDUCTOR COUNT (`2×#10` where six #10s are installed) — caught in review and
   now pinned by test.
3. **A missing statement is honest; a contradicting one is not.** With no
   canonical gauge or count the callout is `null`, never a fabricated string.
   Open-air segments print `OPEN AIR — NEC 690.31` and never claim a conduit.

### Result on the live design

```text
ROOF_RUN               FREE_AIR             "2×#10 AWG USE-2/PV Wire\n1×#12 AWG GRN EGC\nOPEN AIR — NEC 690.31"
BRANCH_RUN             FREE_AIR             "2×#10 AWG THWN-2\n1×#12 AWG GRN EGC\nOPEN AIR — NEC 690.31"
BRANCH_HOMERUN_RUN     PVC Sch 80  1-1/4"   "6×#10 AWG THWN-2\n1×#12 AWG GRN EGC\nIN 1-1/4\" PVC Sch 80"
COMBINER_TO_DISCO_RUN  PVC Sch 80  1-1/4"   "3×#6 AWG THWN-2\n1×#10 AWG GRN EGC\nIN 1-1/4\" PVC Sch 80"
DISCO_TO_METER_RUN     PVC Sch 80  1-1/4"   "3×#6 AWG THWN-2\n1×#10 AWG GRN EGC\nIN 1-1/4\" PVC Sch 80"
MSP_TO_UTILITY_RUN     PVC Sch 80  2-1/2"   "3×#2/0 AWG THWN-2\n1×#6 AWG GRN EGC\nIN 2-1/2\" PVC Sch 80"
```

Each conductor total now equals its raceway's: 6+1 = **7**, 3+1 = **4**, 3+1 = **4**.

---

## 3. THE UTILITY-OWNED RUN — EXCLUSION CONFIRMED, NOT TOLERATED

`MSP_TO_UTILITY_RUN` is `installationMethod: 'in-conduit'` with a computed
`fillPct: 30.6` and its own 2-1/2" trade size, yet carries `physicalRacewayId:
null` and appears in no `physicalRaceways` record and no BOM conduit row.

That is **correct**, not a gap. `computed-system.ts` skips it explicitly:

```ts
if (run.isOpenAir || run.conduitType === 'NONE' || run.conduitSize === 'N/A' || run.isUtilityOwned) continue;
```

The main-service-panel → utility-meter run is utility-owned service equipment,
not PV scope, so it is neither procured nor counted as a project raceway. WS-3
asserts that exclusion by test rather than leaving it as an unexplained orphan.

---

## 4. TESTS

`tests/planset/ws3-conduit-authority.test.ts` — 13 gates:

* a segment callout names exactly ONE trade size, and it is that segment's;
* the callout names that segment's own raceway TYPE;
* no callout carries the legacy `<size> 3/4" EMT` concatenation;
* no PVC raceway is described as EMT;
* open-air segments never claim a conduit;
* every in-conduit, in-scope segment resolves to a physical raceway;
* the utility-owned service run is excluded from the PV raceway set;
* every raceway fill is ≤ the NEC Ch.9 T1 40 % limit;
* **the conductor count a callout names equals its raceway's total**;
* a segment's fill agrees with its own raceway's fill.

**Non-vacuity proven.** Replaying the gates against the pre-fix snapshot
(captured before the repair) detects **8 violations** across all four in-conduit
segments — 4 multi-size callouts and 4 PVC-described-as-EMT. A test that cannot
fail on the defect it names is worthless; this one fails on it.

---

## 5. VALIDATION

| Check | Result |
|---|---|
| Full test suite | **8939 passed / 0 failed** (489 skipped) — +13 WS-3 gates |
| Typecheck | clean, exit 0 |
| Lint | **0 errors** (1203 pre-existing `no-console` warnings) |
| Pagefit 16-sheet (design-review) | clipped=0 internal=0 h=0 |
| Pagefit 15-sheet (permit) | clipped=0 internal=0 h=0 |
| Pagefit 25-sheet (full) | clipped=0 internal=0 h=0 |
| Live regeneration | 16 / 15 / 25 sheets · **5 gates · 14 requirements · 0 advisories** |

### Evidence harnesses — A/B PROVEN UNCHANGED

⚠ **A correction to the previous pass's report.** It recorded "11/11 evidence
harnesses PASS". That number was wrong: the check piped the harness through
`tail`, so `$?` captured *tail's* exit status, not the harness's. The harnesses
must also be run against the **full** profile — the RS-1 review-status sheet only
exists there, so a design-review artifact nulls several gates.

Scored correctly against the full profile, **before and after** the WS-3 change:

| Harness | pre-WS-3 | post-WS-3 | WS-2 documented baseline |
|---|---|---|---|
| `bar-wse` | 36/36 exit 0 | **36/36 exit 0** | 36/36 ✓ |
| `bar` | 12/14 exit 2 | **12/14 exit 2** | 12/14 ✓ (wind-snow provenance, report-equals-rendered) |
| `co` | 20/20 exit 0 | **20/20 exit 0** | 20/20 ✓ |
| `ecd` | exit 2 | **exit 2** | pre-existing (no CableExtensionSolution for this design) |
| `ep` | 21/22 exit 2 | **21/22 exit 2** | 21/22 ✓ (no-unselected-racking-orderable) |
| `ppc` | 18/18 exit 0 | **18/18 exit 0** | 18/18 ✓ |
| `rgm` | 17/17 exit 0 | **17/17 exit 0** | 17/17 ✓ |
| `rp` | 20/20 exit 0 | **20/20 exit 0** | 20/20 ✓ |
| `w3` | exit 2 | **exit 2** | pre-existing (windSpeed formatting) |
| `w4` | exit 2 | **exit 2** | pre-existing (human-utility-name) |
| `planset-evidence` | exit 0 | **exit 0** | — |

Identical gate for gate. The A/B was run by reverting `build.ts` to HEAD,
regenerating, scoring, then restoring — not inferred from the failure text. Every
remaining failure is pre-existing and unrelated to conduit (wind/snow provenance,
utility naming, racking orderability, Q-Cable extension solutions).

---

## 6. WHAT REMAINS OPEN

* The 14 unresolved requirements (unchanged — `ROUTE-LENGTH-ESTIMATE` still
  governs conduit run lengths, which remain `cad-derived-estimate` and print
  `EST — FIELD VERIFY`; WS-3 reconciled the raceway IDENTITY, not the route
  MEASUREMENT).
* `_schedTrunkBomNote` in `structuralPages.ts` — still a dead binding
  (pre-existing; SCHED runs at low printable slack and wiring it needs its own
  pagefit pass).
* The pre-existing harness failures listed above.
* **No controlled production rendering image** — see
  `PLANSET-RENDERING-ENVIRONMENT.md`. Canonical PDFs still go through Vercel
  serverless `@sparticuz/chromium-min` with no font guarantee; three options are
  written up and the choice is Ray's.
* Obstruction nondeterminism (carried forward; WS-3 does not touch generation
  orchestration and no geometry regression was accepted).
