# PLANSET AUTHORITY-FLOW AUDIT (Deliverable A)

**Date:** 2026-07-20 · **Trigger:** Braidon Pilla audit — Ray's mandate: one canonical
`PermitDesignSnapshot`, every sheet a read-only projection, generation fails closed.
**Method:** 4 parallel code audits (sheet templates; authority engines; structural/BOM/
geometry; code-cycles/labels/certification). Every claim cites file:line at dev
`4fb21d2f`. Companion register: `docs/DATA-AUTHORITY-AUDIT.md` (07-19 campaign; open
items cross-referenced as P/N numbers).

---

## 0. Executive summary

The planset has ~19 partial authorities that are real and good (conductorAuthority,
canonical, panelSpecs, branching, stdSizes, attachmentCapacity, nameplate, designTemps,
sheetManifest…) — and **none of them is a wall**. Sheets consult an authority when
convenient and fall back to local math, project scalars, or literals when not. The
concrete damage:

- **The NEC 120% busbar rule is implemented 6 times** with two different bases
  (busbar rating vs main-breaker rating): electricalPages.ts:63-65, electricalPages.ts:1311-1314
  (mainAmps basis), coverSheet.ts:78-82, buildPermitCoverSheet.ts:48-53,
  sld-professional-renderer.ts:2634-2666, sld-professional-renderer.ts:3929.
- **Two electrical engines coexist** with no equality contract: `runElectricalCalc`
  (permit path, generatePermit.ts:733) vs `computeSystem` (engineering page + SLD route,
  lib/computed-system.ts). `compliance.electrical` comes from the former; the app's SLD
  route renders from the latter.
- **Three thermal regimes in one package**: ASHRAE `getDesignTemps` on PV-5/PV-6
  (compliancePages.ts:53), flat −10 °C into the permit electrical engine
  (generatePermit.ts:705-707), −10/40 hardcoded in the BOM wire-sizing path
  (computedRuns.ts:138-139); β conventions ×1.25 blanket (PV-5), db β (PV-6),
  −0.27 literal (APP-A:816), −0.28 literal (SLD:3871).
- **The NEC edition defaults to two different years in the same package**: '2020'
  (electricalPages.ts:113, compliancePages.ts:27, coverSheet.ts:37, certPages.ts:26,
  structuralPages.ts:1456) vs '2023' (titleBlock.ts:24, electricalPages.ts:1089,
  certPages.ts:222/321/426). IBC/IRC are literal '2021' everywhere; IFC is a hardcoded
  ternary off the NEC year (5 copies); ASCE 7-22 is ~90 literals; **E-1's renderer takes
  no code edition input at all**. The live AHJ registry returns Building/Fire/Residential
  code editions and the mapper drops them (ahjRegistry.ts:83-85).
- **Cross-sheet physical contradictions**: fence foundation driven-post-no-concrete
  (structuralPages.ts:311) vs 3,000-psi concrete footing (certPages.ts:264-272,
  titleBlock.ts:167); RSD ≤80 V (electricalPages.ts:202) vs ≤30 V (titleBlock.ts:149);
  drawn attachment feet at hardcoded 48" (roof.ts:174) while the printed ATTACH SPACING
  is the engine-resolved value; SF "2.0" boilerplate beside a MIN_SF=1.0 test
  (structuralPages.ts:871 vs :601); two ampacity tables in one file
  (structuralPages.ts:1254 vs :1417); wind default 90 mph on one drawing path
  (roof.ts:1990) vs 115 everywhere else; fence embed defaults 2.5/3/3.5/4 ft across four
  files; ground BOM piles at 8-ft spacing vs 20-ft PLP bays on the drawing.
- **A fabricated dwelling load calc** renders on PV-4A: square footage inferred from
  service amps, 4,500 VA appliances, "5-ton/3-ton AC" assumed (electricalPages.ts:566-574).
- **PE letters carry vendor-default equipment**: `mountSys … || 'IronRidge XR100'` on a
  stamped structural letter (certPages.ts:491; compliancePages.ts:1001 same).
- **Trust boundary hole**: a client-POSTed `compliance.electrical` with any busbar result
  suppresses the server engine entirely (generatePermit.ts:477-479); `project.subSystems`
  client-wins (route.ts:599-607). No marker distinguishes engine-of-record from
  client-posted numbers.
- **No snapshot identity**: `designVersionId` exists in the engineering pipeline
  (lib/engineering/designSnapshot.ts:61) and has zero references in lib/permit. No sheet
  carries a content digest; `project_files.permit_input.json` is overwritten per
  generation with no version or hash.
- **No versioned equipment records**: none of the three stores (equipment-db,
  equipment-registry-v4, mounting-hardware-db) carries a datasheet-revision field;
  registry-v4 has no date/verified fields at all; RT-MINI's capacity exists as three
  independent numeric copies; `solfence-8ft` is absent from mounting-hardware-db so
  structural lookups silently fall to ironridge-xr100; BOM equipment resolution is
  4-stage model-substring fuzzy matching (bomForPermit.ts:104-137).
- **No engineer identity**: only `project.designer: string` exists. No PE license/state/
  seal fields in schema or DB. Certification language ("I hereby certify…",
  certPages.ts:57-64) renders unconditionally with blank underscores and an empty seal
  box; the only gate is the hybrid-cover DO-NOT-SUBMIT banner keyed partly on a
  compile-time constant (hybridReadiness.ts:38).

Full raw findings (≈300 line-cited items) are preserved in the four audit reports;
the register below is organized by the six authority classes.

---

## 1. Current authority landscape (what exists and who bypasses it)

| Authority module | Owns | Bypassed by (examples) |
|---|---|---|
| conductorAuthority (utils/conductorAuthority.ts) | branch rows, DC strings, AC feeder, EGC, POI, 20/30 branch ladder | sldAdapter:105 (project scalar+recompute); coverSheet:76; buildPermitCoverSheet:50; electricalPages:62,1027; renderer fallbacks 3005/3185/3349 |
| canonical (utils/canonical.ts) | systemType, site loads, layout dims, strict gate | route DB-wins chain vs fill-only propagation (P1-7); ground sheet snow reads ahjGroundSnowPsf directly (sheetComposition:347) |
| panelSpecs (utils/panelSpecs.ts) | per-sub module electrical/physical/thermal | sitePlan:73; roof.ts:149,1986; canonical:412 (buildLayoutDimensions); compliancePages:789-805; fire-setback coverage (sheetComposition:407) |
| branching (utils/branching.ts) | branch plan, per-model caps | computedRuns:137 (`inverterBranchLimit:13`); arrayPages:153 re-plans per sheet; renderer microBranchCount fallbacks |
| stdSizes (electrical/stdSizes.ts) | OCPD ladder | (well adopted; the 20/30-only branch law lives in conductorAuthority:191 + a renderer copy at 2543) |
| designTemps (utils/designTemps.ts) | ASHRAE temps | generatePermit:705 (engine at −10); computedRuns:139; APP-A:816; SLD:2599/3855 |
| nameplate (system/nameplate.ts) | per-sub nameplate law (save path) | permit path re-implements via subScopedInput Σ (generatePermit:211-241) |
| attachmentCapacity + structural-engine-v4 | mount spacing, SF, rackingBOM | drawn feet 48" hardcoded (roof.ts:174); registry accessory formulas (strings-proxy basis); SF "2.0" prose |
| integratedBos/integratedEquipment | combiner/BOS identity | sitePlan:61 (combiner = inverter mfr); electricalPages:265 ('IQ Combiner' literal + 4-branch cutoff); renderer 'IQ Combiner' fallbacks |
| sheetManifest | sheet order/index | buildPermitCoverSheet:140 static PERMIT_SHEET_INDEX |
| getEquipmentContext (systemAccessors) | normalized equipment read | titleBlock:64 (strings[0] chain); APP-A:768; sitePlan:42 |

**Two engines, one compliance object:** `compliance.electrical` is written by
`runElectricalCalc` only when the client didn't post one (generatePermit.ts:477-479);
`computeSystem` powers the engineering page + standalone SLD/pdf routes. conductorAuthority
normalizes only the permit path.

---

## 2. Violation register by authority class (condensed; full line lists in raw reports)

### 2.1 Project authority (address/APN/AHJ/codes/permits)
- NEC edition: default '2020' ×6 sites, '2023' ×4 sites; prefix-strip in only 3 of 10
  consumers (raw NEC string printed on PV-5/PV-6/CERT/PE-1).
- IBC/IRC '2021' literals: titleBlock:25-26, coverSheet:38, structuralPages:124/425/640,
  certPages:223, buildPermitCoverSheet:35. IFC ternary ×5 copies. IFC 2021 §-numbers
  printed literally on arrayPages:507-508 even where ifcVer would be 2024.
- ASCE 7-22 ~90 literals incl. sheetManifest:87 title, generatePermit:338 comment-law.
- AhjRecord has NO IBC/IRC/IFC/ASCE fields (ahj-national.ts:10-67); registry mapper drops
  the editions it receives (ahjRegistry.ts:83-85); no persisted AHJ record version.
- UL claims hardcoded (coverSheet:361-363; compliancePages:395,464,486,934-937;
  renderer BUI_BRAND_CONFIG:760-769). Sheet-size 'ANSI B' literals ×3.

### 2.2 Equipment authority
- Fabricated fallbacks printed as datasheet facts: watts 400 (×5 sites), Voc 41.6,
  Isc 12.26, dims 66×40, weight 44/45/50 (three different defaults), NOCT 45,
  tempCoeffPmax −0.35, module efficiency computed geometrically (APP-A:810).
- Fabricated equipment identity: 'PV Module'/'Inverter' strings (buildSLD:1017-1020),
  'IQ Battery 5P' (electricalPages:1035), 'ENPHASE'/'IQ8' (sitePlan:43), combiner
  'IQ Combiner 5C→6C' history, battery brand inferred by model-string sniffing
  (renderer:538-553), manufacturer split from model text (buildPermitCoverSheet:39).
- Registry-v4 duplicates mounting-hardware-db capacities (RT-MINI uplift 900 vs
  ALLOWABLE 600 basis record) with zero version fields; equipment-db ids ≠ registry ids
  bridged by fuzzy substring match (bomForPermit:104-137).
- No datasheet revision/source field in any store; FIELD-VERIFY flags live in comments.

### 2.3 Site & geometry authority
- Module dims: 5 independent sources (panelSpecs authority; project scalars; CAD-model
  carrier of project scalars; 66×40 literals; nearest-neighbor spacing INFERENCE in
  sitePlan:360-375).
- Pitch unit hazard: engine treats plane pitch as degrees unconditionally
  (structuralInput:35) while sheets/drawings treat ≤12 as rise:12 (sheetComposition:383,
  roof.ts:1956) — a "5" is 5° to the wind engine and 22.6° on the sheets. Defaults
  disagree (20 vs 5).
- Fire setbacks: computed per-sheet via shared util (ok) but sitePlan legend hardcodes
  '18" FIRE SETBACK' (sitePlan:636) against the computed band; pathway '36" per AHJ'
  literal not AHJ-sourced (arrayPages:510).
- panelPositions consumed directly by drawings (roof.ts:188), CAD engine, arrayLayout —
  no single frozen instance list.

### 2.4 Electrical topology authority
- Branch plan re-executed per sheet (arrayPages:153; buildSLD:1053; renderer fallbacks)
  instead of one assignment read by all.
- Feeder OCPD: triple-source fallbacks (auth ?? project scalar ?? local recompute) at
  electricalPages:60-62; literal 40 A (buildSLD:1027).
- Interconnection method: decided by sheet logic (electricalPages:68 resolves a failing
  120% up to supply-side), string-sniffed in the renderer (:1718), and hardcoded
  'Load Side Tap' rows (electricalPages:1348).
- Conductors: '#10 AWG THWN-2'/'3/4" EMT' literals ~20 sites; utility service conductor
  CHOSEN by template ladder (electricalPages:1419); battery wire chosen by renderer
  ladder (:2253); ALL DC source circuits on string lanes hardcoded #10 (renderer:3458-3515);
  EGC selections performed in templates (getEGCSize calls at electricalPages:82,
  renderer ×6); titleBlock EGC from `project.wireGauge` (:153).
- Conduit trade-size table + resistance constants embedded in renderer (:3072-3103);
  V-drop computed with assumed 25-ft lengths (:3905-3917).
- PV-6 single-system row prints stale `system.totalAcKw` beside authority-derived rated
  output on the same sheet (compliancePages:638 vs :536).
- Label values: Vmp/Imp synthesized (voc×0.83, watts/vmp) when db misses
  (compliancePages:87-88); dataset label amp figure regex-REWRITTEN by template (:326).
- Max-system-voltage limit 600 V literal (renderer:3876); '16 (NEC 690.8)' max-per-branch
  literal (buildSLD:1293) contradicting per-model caps.

### 2.5 Structural authority
- A complete fence wind/embedment engine implemented INSIDE templates, 3 copies of the
  constants (structuralPages:151-179, 326-345; validationPage:42-52, 556-560).
- Attachment spacing: engine-resolved value stored under "maxAllowedSpacing"
  (generatePermit:456), 3-source display chains ending `|| 48` (×3 files), drawn feet
  hardcoded 48" (roof.ts:174).
- Framing defaults '2x6'@24 repeated in 4 files + a different '2×4' truss default
  (roof.ts:1475). Fence embed 2.5/3/3.5/4-ft defaults across files; fence data zone
  hardcodes exposure 'C' + Cf 1.3 (sheetComposition:497-508) regardless of engine.
- Ground identity three-way split: dual-post analysis engine vs PLP drawings vs
  fabricated-SKU BOM at different pile spacings (8 vs 20 ft).
- lagBoltCapacity synthesized as uplift×SF (generatePermit:455); subSystemSheets back-
  derives capacity the same way (:341-343). PE roof letter computes its own pass/fail
  verdict (certPages:451).
- Wind 90-mph default survives on one drawing path (roof.ts:1990).

### 2.6 Derived system / BOM
- totals: cad||system dual-source reads (electricalPages:115; arrayPages:142;
  subSystemSheets:155); dcKw recomputed from watts×count in renderer (:2525) and
  buildSLD (:1277); dcAcRatio inline (generatePermit:245).
- BOM inputs keep guess fallbacks: attachments `|| ceil(panels×1.2)` (bomForPermit:632),
  railSections `|| ceil(panels/2)` (:633); registry quantity formulas on a strings-proxy
  basis compete with the geometry-derived rackingBOM; trunk footage vs deriveRunLengths
  heuristic footage are two different estimates; fence posts derived 3 ways (profiles,
  fenceCAD joints, structural engine).
- production estimate `totalDcKw × 1400` literal (titleBlock:184); NEC 220.82 dwelling
  load fabricated (electricalPages:566-574).

### 2.7 Certification
- Cert language unconditional; only gates: rafter-utilization electrical-scope self-limit
  (certPages:44-63) and hybrid cover banner keyed on WAVE6_GOLDEN_FIXTURE_GREEN=true
  compile-time constant (hybridReadiness:38). VAL-1 asserts 'PASS' literals for ground
  structural and cross-contamination checks without computing them (validationPage:119-157)
  and claims "generation was blocked if any required field was missing" unconditionally
  (:619-622). SCHED prints an unconditional VERIFIED badge (structuralPages:1440).
- No engineer identity/license/seal fields anywhere (schema or DB); vendor-EOR defaults
  survive in buildPermitCoverSheet:132,137.
- Document ID is a name+date slug, not a digest (certPages:119); REV row hardcoded.

---

## 3. Trust-boundary findings (input provenance)

- Client-trusted wholesale: nearly all `project.*` scalars, `system.inverters`,
  `compliance.electrical` when non-empty (suppresses the engine, generatePermit:477-479),
  `project.subSystems` map (client wins, route:599-607).
- Server-authoritative: systemType (DB), AHJ block (DB-wins, route:675-704), survey-wins
  physical fields (route:930-939), structural V4 overwrite, backfeed scalars post-engine
  (P0-1), totals tri-sync, generation date (P0-9).
- `permit_input.json` is the de-facto input of record — overwritten each generation, no
  id/hash/schema-version (route:1435-1452).
