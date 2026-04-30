# Engineering Pipeline Audit — v58.7

**Date:** 2026-04-30  
**Branch:** dev  
**Scope:** How data flows in and out of `/engineering`; ecosystem picker UX gap.

---

## 1. Top-level shape

- `app/engineering/page.tsx` — **12,630 lines**, one monolithic React client component (`<EngineeringPage />`). All workspace state lives here: project identity, panels, inverters, wires, battery, topology, ecosystem brand, pricing, BOM, SLD, PlanSet, Compliance, Permit, Proposal.
- `app/engineering/[projectId]/page.tsx` — thin redirect that rewrites `/engineering/:id` → `/engineering?project=:id` so the monolithic page can hydrate from the URL.
- Routes under `app/api/engineering/**` (25+) provide the server side.

## 2. Pipelines IN (how data arrives in engineering)

| Source | Mechanism | Notes |
|---|---|---|
| **URL `?project=<id>`** | `useEffect` watches `searchParams`; calls `GET /api/projects/[id]` | Primary entry. Loads `engineeringSeed` JSONB + project metadata. |
| **`engineeringSeed` JSONB** | Written by `app/api/engineering/preliminary/route.ts` when survey is finalized. Shape: `{ panels, inverters, topology, batteries, … }` | **Seed writer currently hard-codes `inverter_type: 'micro'` and does NOT set `brand_id` / `ecosystemBrand`.** → Every project starts with no ecosystem applied. |
| **Site Survey → Preliminary** | Survey POST → `/api/survey-submissions/[id]/finalize` → `/api/engineering/preliminary` → `engineeringSeed` | One-way. Engineering doesn't reflect survey edits after initial seed. |
| **Saved outputs** | `GET /api/engineering/[id]/outputs` (BOM, SLD, PlanSet, etc.) | Only read on demand when user opens the tab. |
| **Local auto-defaults** | `applySmartDefaultsOnce()` runs once after config hydrates | Fills in missing panel power, wire sizes, racking; does not set ecosystem brand. |
| **EcosystemPicker** | User clicks "Apply" → `onApply(payload)` callback (page.tsx line ~6480) | **Only path that sets `config.ecosystemBrand`.** |

## 3. Pipelines OUT (how data leaves engineering)

| Output | Destination | Trigger |
|---|---|---|
| **`config` → DB** | `POST /api/engineering/[id]/save-config` | Autosaves on debounced config change + explicit Save. |
| **BOM** | `POST /api/engineering/[id]/save-outputs { bom }` | On "Generate BOM" button. |
| **SLD** | `POST /api/engineering/[id]/save-outputs { sld }` | On SLD tab render. |
| **PlanSet PDF** | `POST /api/engineering/[id]/planset` | Pulls from `config` at request time. |
| **Compliance report** | `POST /api/engineering/[id]/compliance` | Runs NEC code checks on `config`. |
| **Permit package** | `POST /api/engineering/[id]/permit-package` | Bundles PlanSet + Compliance + datasheets. |
| **Proposal** | `POST /api/engineering/[id]/proposal` | Pricing pulled from `config.pricing`. |

## 4. Ecosystem state machine

```
  [NO ecosystem]
      |
      | user picks brand + clicks "Apply" in EcosystemPicker
      v
  [ecosystemBrand = 'solaredge' | 'enphase' | …]
      |
      | user clicks "Change ecosystem"  ← v58.7 NEW visible button
      | OR user manually switches topology (page.tsx line ~6793)
      v
  [NO ecosystem] (picker reappears)
```

- `ecosystemBrand` is a **client-only string** that gates whether `<EcosystemPicker />` is visible. It does NOT automatically drive BOM, SLD, or pricing — those are driven by the concrete `inverters[]`, `batteries[]` selections that `onApply` populates.
- `onApply` sets:
  - `ecosystemBrand: payload.brand`
  - `inverters[0]` → resolved central/string/micro inverter
  - `batteries[0]` → resolved battery
  - `inverter_type` on first inverter → `'micro' | 'optimizer' | 'string'`

## 5. Gap identified in this audit

**User complaint:** "After I load into a project I have no way changing ecosystem if I made an error."

**Root cause:** The "Change" button at `app/engineering/page.tsx:6469` was styled with `text-[10px] text-slate-500` — 10px gray text on a dark background, effectively invisible. The feature existed; the UX did not surface it.

**Fix (v58.7):** Redesigned the applied-ecosystem pill into a proper card with an explicit, button-styled `[↻ Change ecosystem]` action, confirmation dialog, and banner feedback. See commit and diff in `app/engineering/page.tsx` lines 6456–6502.

## 6. Follow-ups (not in v58.7 scope)

1. **Seed writer should carry brand through** — `app/api/engineering/preliminary/route.ts` currently hard-codes `inverter_type: 'micro'`. It should propagate a brand hint from the survey (installer-level default) so projects don't all land in "no ecosystem" state.
2. **Survey edits after seed** — There's no re-sync from survey → engineering after initial `preliminary` call. If an installer edits the survey, engineering won't know. Out of scope; flagged.
3. **Monolith risk** — 12.6k-line page file. Future extraction opportunity: split ecosystem/inverter/battery panels into their own components. Not addressed here.

---

**Gate trio (v58.7 commit):**
- `npm run type-check` → exit 0
- `npm run lint` → exit 0 (warnings only, all pre-existing)
- `npm test` → 68 files / 2583 tests passed