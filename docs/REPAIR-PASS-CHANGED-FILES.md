# Repair-Pass Changed-File List — grouped by authority layer

Source-of-truth repair pass (post-campaign), branch `dev`. Pipeline order:
**INPUT AUTHORITY → NORMALIZATION → ENGINE → VALIDATED SNAPSHOT → READ-ONLY PROJECTION → RENDERER**.
Each file is listed under the layer it primarily changes; the workstream (W1–W10) it serves
is in brackets. Full defect chains: `docs/REPAIR-PASS-ROOT-CAUSE-MAP.md`.

## Input authority (records — no calculation)
- `lib/equipment-db.ts` — [W5a] `enphase-iq8a` corrected: 366 VA peak / 349 continuous / 1.45 A max-cont / 97.5% CEC / 2.38 lb; `partNumber: IQ8A-72-2-US` added (was SKU-less).
- `lib/equipment-registry-v4.ts` — [W5/W6/§10] SKU reconciliation; rail-accessory descriptions/notes sanitized (no "or equivalent"/"or compatible" substitute language).
- `lib/equipment-registry.ts` — [W6/§10] same substitute-language sanitation on the legacy registry rail accessories.
- `lib/mounting-hardware-db.ts` — [W6] RT-MINI rail-paired topology + canonical fastener record (5/16" × 3.5" structural wood screw).
- `lib/permit/utils/designTemps.ts` — [W5b] singular ThermalDesignBasis (ASHRAE extreme-low authority); APP-A −10 °C hardcode retired.
- `lib/permit/utils/structuralInput.ts` — [W7c/W8] wind speed/exposure + framing input authority (115 mph engine basis; framing defaults gated, not asserted).

## Engine (calculation)
- `lib/structural-engine-v4.ts` — [W7] per-attachment reaction / zone / tributary model; conservative screening envelope basis.
- `lib/permit/snapshot/structuralEngine.ts` — [W7d] reaction reconciliation split into separate closure / lost-load / duplicate-area / count / per-limit-state checks (3.0× band retired; upper bound 2.05).
- `lib/bom-engine-v4.ts` — [W4a/W4b/§10] topology threaded so pure-micro emits no DC string home-run rows / DC conduit fittings; junction-box substitute phrase removed.
- `lib/engineering/reportGenerator.ts` — [W4/§10] rapid-shutdown device substitute phrase sanitized (non-permit path).

## Snapshot (canonical object model)
- `lib/permit/snapshot/build.ts` — [W1/W2/W5/W10] canonical route segments, service topology, feeder, grounding objects, thermal basis, SKU via `partNumber`, blocker registry emission (tap/fill/designer/TEST-name/module-datasheet codes).
- `lib/permit/snapshot/types.ts` — [W1/W10] segment/topology/registry schema (`permitReadiness.registry`, per-segment full field set).
- `lib/permit/snapshot/rackingAssembly.ts` — [W6] exact RackingAssembly object; PENDING rail/capacity honest (no fabrication); RT-MINI II PE-letter (ASCE 7-10 KY) provenance labeled unverified.
- `lib/permit/snapshot/structuralAuthority.ts` — [W7/W8] per-attachment artifact + capacity-gate blocker collection.
- `lib/permit/snapshot/projectAuthority.ts` — [W10] project authority stays UNVERIFIED / PENDING (no ZIP inference); issue-state gate.
- `lib/permit/utils/bomForPermit.ts` — [W4] authoritative `isMicro`/topology threaded into the BOM engine.
- `lib/permit/utils/sldAdapter.ts` — [W1/W3] branch segment carriage (`branchConduitSize`/`Type`/`IsOpenAir`) — corrected SLD-input output (golden regenerated).

## Validator / gate
- `lib/permit/snapshot/structuralProjection.ts` — [W8/W10] capacity gate reaches PE-1 + PV-4C; structural-blocker set; banner union source.
- `lib/permit/utils/structuralBanner.ts` — [W10a] structural-else-everything ternary replaced by the deduped UNION (non-structural blockers surface).

## Read-only projection
- `lib/permit/snapshot/electricalProjection.ts` — [W1/W3] canonical feeder + route-provenance-label accessors (one raceway/size/VD/length/fill source).
- `lib/permit/snapshot/equipmentProjection.ts` — [W5] **NEW** — verified equipment/document projection for APP-A (per-value provenance: equipment id + SKU + document id + verify state).

## Renderer (read-only sheets — no truth origination)
- `lib/permit/sections/reviewStatus.ts` — [W10] **NEW** — RS-1 review-status sheet; renders EVERY active `permitReadiness.registry` blocker.
- `lib/permit/sheetManifest.ts` — [W9/W10] RS-1 inserted; manifest == rendered.
- `lib/permit/generatePermit.ts` — [W9] RS-1 wired into composition.
- `lib/permit/sections/compliancePages.ts` — [W2a/W5/W6b] PV-6 disconnect roles from serviceTopology; APP-A from the verified projection; APP-A fastener-length invention formula deleted (record or PENDING).
- `lib/permit/sections/electricalPages.ts` — [W1a/W1c/W1d] PV-4A from canonical feeder (legacy rulesResult summary retired); operating current vs OCPD distinguished.
- `lib/permit/sections/structuralPages.ts` — [W7/W8] per-attachment schedule + reconciliation; capacity UNVERIFIED gate on PV-4C.
- `lib/permit/sections/certPages.ts` — [W8/W10] PE-1 capacity gate + affirmative-conclusion gate; banner union.
- `lib/permit/sections/datasheetAppendix.ts` — [W5c] exact-model datasheet resolution (module-datasheet PENDING surfaced).
- `lib/drafting/templates/roof.ts` — [W3a/W6b] "wired in series" → parallel Q-Cable AC-branch language; fastener from record (record-first, PENDING-safe fallback).
- `lib/drafting/sheetComposition.ts` — [W3b/W6b] conduit-run callout from route-provenance authority (no "route field-verified" literal); fastener from record.
- `lib/sld-professional-renderer.ts` — [W1b] E-1 branch/feeder rows from the snapshot (branch vs feeder disambiguated).

## Tests (focused)
- `tests/planset/electrical-repair-0722b.test.ts` — **NEW** [W1–W3] segment authority, route verification status, no "route field-verified".
- `tests/planset/equipment-document-authority-w5.test.ts` — **NEW** [W5] APP-A verified-document projection; no invented 4" SS lag.
- `tests/planset/blocker-registry-w10.test.ts` — **NEW** [W10] registry gate 14/15, banner union, identity blockers.
- `tests/planset/pagination-w9.test.ts` — **NEW** [W9] one physical page per logical sheet.
- `tests/planset/structural-correction-w.test.ts` — [W6–W8] package-wide substitute-language + capacity-gate assertions.
- `tests/planset/snapshot-w1.test.ts`, `tests/planset/wave6-legacy-sweep.test.ts` — updated for the corrected segment/legacy surfaces.
- `test-fixtures/golden/golden.json` — regenerated (sldAdapter added `branchConduitSize`/`Type`/`IsOpenAir` — corrected output).
- `tests/goldens/__snapshots__/wave0-bom-legacy.golden.test.ts.snap` — regenerated (junction-box substitute phrase removed).

## Harness / evidence / docs
- `scripts/planset-evidence-rp.mjs` — **NEW** — the 20-gate rendered-truth harness (incl. report-equals-rendered); fixture + live modes; exits non-zero on any violation.
- `scripts/repair-pass-artifacts.mjs` — **NEW** — emits the docs/evidence acceptance artifacts (independent attachment-reaction recompute).
- `docs/REPAIR-PASS-DIRECTIVE.md`, `docs/REPAIR-PASS-ROOT-CAUSE-MAP.md`, `docs/REPAIR-PASS-CHANGED-FILES.md` — directive, forensic map, this inventory.
- `docs/evidence/braidon-*` — canonical segment, service topology, grounding, BOM-to-object, equipment/document projection, racking assembly, attachment reaction, structural basis, active blocker registry, equipment-reconciliation audit (NONE EXISTS — conflict active), physical page-count, W4 + RP evidence (both modes).
