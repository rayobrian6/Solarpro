# System Configuration Page — Overhaul Plan (hybrid + per-sub equipment)

Target: `app/engineering/page.tsx` (~16.8k lines, single `EngineeringPageInner` @ 1040).
Supporting: `lib/system/subSystemEquipment.ts`, `subSystemFleet.ts`, `designToEngineering.ts`,
`smartDefaults.ts`, `brandProfiles/*`.

## Root problems
- **B2 — silent micro default (THE cause of empty string lanes):** `getDefaultBrand('roof'/'fence')`
  → enphase → micro (`brandProfiles/enphase.ts:66`, `smartDefaults.ts:146-148`); auto-seed
  (`page.tsx:4336-4408`) commits micro with no prompt. `buildSubFleetForKey` (`page.tsx:4054-4081`)
  is the single topology choke point.
- **B1 — per-sub picker buried:** `renderSubSystemHeader` (`page.tsx:4769-4890`), only in hybrid,
  nested in the fleet list (`page.tsx:10252/10299`), 9px labels — undiscoverable.
- **B3 — two competing authorities:** `config.inverters[]` fleet vs `config.subSystems[key]` map.
  Map is authority but UI is fleet-centric; a sub can show a fleet while `subSystems[key].inverterId`
  is empty → the SLD reads empty. Model dropdown `page.tsx:10385-10393` only writes the map when
  `_rowSubKey` is set.
- **B4/B5/B6** — no hybrid-first IA; scattered non-actionable validation; topology settable 3 ways.

## Proposed IA
- **C1 — "System Builder" at the TOP of the config tab** (before `page.tsx:10083`): one card per
  sub-array (roof/ground/fence), promoting `renderSubSystemHeader`. Order per card: **Topology first**
  (String/Micro/Optimizer/Hybrid) → Inverter model → Panel → Mounting. Per-card status chip
  ("✓ 17 · SE7600H · 1 string" / "⚠ No inverter selected").
- **C2 — kill silent micro:** default topology suggestion rendered as "Suggested — confirm" chip
  (source:'defaults' + needsConfirmation), never auto-committed; prefer string for roof/ground unless
  micro explicitly chosen.
- **C3 — single authority:** all writes via `updateSubSystemEquip` (`4748`) + `rebuildSubFleet`
  (`4223`); fleet becomes read-derived; model dropdown always writes the map.
- **C4** — collapse fleet/string editor into per-sub "Advanced" expanders.
- **C5** — top hybrid validation strip from `hybridFleetPlan` (`2687`) + `fleetDiag` (`2672`):
  "PV-G: no inverter selected → SLD lane empty" (scrolls to card); promote "Rebuild fleets per sub".
- **C6** — plain-language per-sub summaries, completion checkmarks, "N/N configured" progress.

## Phases
0. Safety net: assert `subSystems[key].inverterId` populated whenever a sub has a fleet; topology
   survives hydration (`ensureSubSystemShape`, `subSystemEquipment.ts:264`).
1. Fix silent micro default (data-only, high impact): `enphase.ts:66`, `smartDefaults.ts:135-150`,
   `page.tsx:4054-4081`, `4336-4408`.
2. Promote per-sub picker to top System Builder (extract `4769-4890`; topology-first). Remove buried
   calls `10252/10299`.
3. Authority consolidation (C3).
4. Validation strip (C5) + progressive disclosure (C4).
5. Polish (C6).
6. (optional) extract the config-tab IIFE into its own component.

Highest leverage: Phase 1 + Phase 2 together resolve the "hybrid defaults to micro-everywhere → SLD
string lanes empty" failure.

_Source: config-page mapping pass, 2026-07-13. Coordinate Phase 1 with the per-sub equipment
data-flow fix (permit/utils) so both land the same invariant: a sub with a fleet always has a real,
tagged inverter._
