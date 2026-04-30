# Brand Onboarding Audit

**Date**: 2026-04-30
**Version**: v58.14
**Scope**: Full audit of how manufacturer "ecosystems" are onboarded — plus the onboarding of EcoFlow OCEAN Pro into the engineering picker.

---

## TL;DR

Adding a new brand-as-ecosystem to SolarPro is a **four-layer** operation. Every layer must be coherent or the brand will be invisible, un-sizeable, or rejected by downstream gates.

| Layer | File(s) | What it defines |
|-------|---------|-----------------|
| **A — Equipment DB** | `lib/equipment-db.ts` | Raw SKU rows (inverter, battery, gateway, …) — electrical specs, datasheet URL, `ecosystemBrand` tag |
| **B — Brand Profile** | `lib/system/brandProfiles/<brand>.ts` | Logical brand identity the sizing engine consumes (tiers, battery strategy, compatibility, BOS) |
| **C — Registry** | `lib/system/brandProfiles/index.ts` | Imports & re-exports the profile in `BRAND_PROFILES` |
| **D — UI Picker** | `lib/system/brandProfiles/resolveBrandEquipment.ts` (`ECOSYSTEM_BRANDS`) | The filtered shortlist rendered by `<EcosystemPicker />` |

If you skip Layer D, the brand exists internally but **cannot be selected by the user**. This was exactly the EcoFlow situation before v58.14.

---

## Detailed Pipeline

### Layer A — Equipment DB (`lib/equipment-db.ts`)

This is the raw SKU catalog. Every inverter / battery / gateway / EV charger / ATS / generator is a single `TypedObject` with electrical specs.

**Required fields for a new inverter SKU:**

```ts
{
  id: 'vendor-model-variant',          // kebab-case, unique
  manufacturer: 'Vendor',
  model: 'Product Name',
  category: 'string_inverter',         // or 'microinverter', 'optimizer'
  acOutputKw: 11.5,
  dcInputKwMax: 40.0,
  maxDcVoltage: 600,
  mpptVoltageMin: 60, mpptVoltageMax: 480,
  maxInputCurrentPerMppt: 16,
  maxShortCircuitCurrent: 20,
  mpptChannels: 8, numberOfMPPT: 8,
  maxParallelStringsPerMppt: 1,
  recommendedStringRange: { min: 4, max: 16 },
  acOutputVoltage: 240, acOutputCurrentMax: 48,
  efficiency: 97.5, cec_efficiency: 97.0,
  weight: 146.6, dimensions: '43.3 x 17.3 x 10.3',
  warranty: '15yr standard',
  ulListing: 'UL 1741-SB',
  rapidShutdownCompliant: true,
  arcFaultProtection: true,
  groundFaultProtection: true,
  integratedDcDisconnect: true,
  datasheetUrl: 'https://…/datasheet.pdf',
  ecosystemBrand: 'vendor',            // ← THIS tag drives getEquipmentByEcosystem()
  ecosystemFamily: 'product-line',
  active: true,                        // ← MUST be true for sizing engine
  isNew: true,
}
```

**Required fields for a battery SKU:**
```ts
{
  id: 'vendor-battery-id',
  manufacturer: 'Vendor',
  model: 'Battery Model',
  category: 'battery', subcategory: 'dc_coupled',  // or 'ac_coupled'
  usableCapacityKwh: 10.0,
  peakPowerKw: 10.0, continuousPowerKw: 10.0,
  chemistry: 'LFP', voltageNominalV: 400,
  acOutputVoltageV: 240, maxContinuousOutputA: 26.32,
  backfeedBreakerA: 0,                 // 0 for DC-coupled (inverter backfeed)
  gridFormingCapable: true,
  backupCapable: true, wholeHomeBackup: true,
  ulListing: 'UL 9540 / UL 9540A / UL 1973',
  certifications: ['UL 9540A', 'UL 1973', …],
  ecosystemBrand: 'vendor',
  ecosystemFamily: 'product-line',
  compatibleWith: ['vendor-inverter-1', 'vendor-inverter-2'],  // strict subset
  active: true,
  datasheetUrl: 'https://…/datasheet.pdf',
}
```

**Gotcha 1 — `active: false` traps**: Any SKU with `active: false` is filtered out of the UI but remains in the registry for back-compat. If your sizing tier references an `active: false` SKU, sizing will silently fail. Always assert `active: true` in tests for any SKU a tier points to.

**Gotcha 2 — `ecosystemBrand` tag**: This is what `getEquipmentByEcosystem()` filters on. Without this tag, the SKU is invisible to the ecosystem picker even if it's in the registry and active.

**Gotcha 3 — `compatibleWith` (batteries only)**: This is read by the compatibility gate to confirm a battery may be used with a given inverter. If a battery is compatible with multiple inverter SKUs in the same family, enumerate them all.

---

### Layer B — Brand Profile (`lib/system/brandProfiles/<brand>.ts`)

This is the logical identity the sizing engine and BOM generator consume. Reference: `lib/system/brandProfiles/types.ts`.

**Minimum viable profile:**

```ts
export const VENDOR_PROFILE: BrandProfile = {
  id: 'vendor',
  displayName: 'Vendor Product Line',
  manufacturer: 'Vendor',
  supportedSystemTypes: ['roof', 'ground', 'fence'],
  topology: 'hybrid',                  // 'micro' | 'string' | 'optimizer' | 'hybrid'
  inverterType: 'vendor',              // free-text; used by smart-defaults

  supportedInverterModels: [
    { equipmentDbId: 'vendor-model-1', acKw: 11.5, dcKwMax: 40, mpptCount: 8,
      minPanelsPerString: 4, maxPanelsPerString: 16 },
    // … more SKUs
  ],

  sizingTiers: [                       // MUST cover 0 → Infinity with no gaps
    { minDcKw: 0,   maxDcKw: 20,       equipmentDbId: 'vendor-model-1' },
    { minDcKw: 20,  maxDcKw: Infinity, equipmentDbId: 'vendor-model-2' },
  ],

  battery: {
    capable: true,
    required: false,
    recommendedBatteryBrands: ['vendor'],
    sizingStrategy: 'modular_stack',   // 'modular_stack' | 'single_pack' | 'per_module' | 'custom'
    defaultTargetKwh: 10,
    minKwh: 5, maxKwh: 80,
  },

  requiredBOSFamilies: [
    { category: 'inverter_base',      qtyPolicy: 'per_inverter', required: true },
    { category: 'smart_meter',        qtyPolicy: 'fixed_one',    required: true },
    { category: 'monitoring_gateway', qtyPolicy: 'fixed_one',    required: true },
    // …
  ],

  compatibility: {
    incompatibleTopologies: ['micro'],   // vendor hybrid can't mix with micros
    incompatibleBrands: ['enphase'],
    dcAcRatioRange: { min: 1.0, max: 1.7 },
    maxDcKwPerInverter: 40,
  },

  recommendedFor: ['fence'],           // baseline recommendation for system types
  recommendedRackingBrands: ['ironridge'],
  notes: 'Short description of the brand.',
};
```

**Gotcha 4 — sizing tier gap coverage**: Every gap between `maxDcKw` of tier N and `minDcKw` of tier N+1 = unsized projects. The brand onboarding smoke test asserts no gaps.

**Gotcha 5 — `active:false` tier reference**: If a sizing tier points at an `active:false` SKU, the sizing engine picks nothing. Keep tiers restricted to US-saleable SKUs.

---

### Layer C — Registry (`lib/system/brandProfiles/index.ts`)

Add the import and entry to `BRAND_PROFILES`:

```ts
import { VENDOR_PROFILE } from './vendor';
// …
export const BRAND_PROFILES: ReadonlyArray<BrandProfile> = [
  VENDOR_PROFILE,       // ← add here
  // …
];
```

Also re-export for external consumers at the bottom:

```ts
export { VENDOR_PROFILE, … };
```

**Gotcha 6 — order matters for `recommendedFor`**: `getRecommendedBrandForSystem()` returns the **first** profile whose `recommendedFor` includes the system type. If two profiles compete (e.g., two brands both marked `recommendedFor: ['roof']`), the earlier one wins.

---

### Layer D — UI Picker (`ECOSYSTEM_BRANDS` in `lib/system/brandProfiles/resolveBrandEquipment.ts`)

This is the array the `<EcosystemPicker />` component iterates over. **If your brand is missing from this array, the user cannot select it** — even if Layers A/B/C are perfect.

```ts
export const ECOSYSTEM_BRANDS = [
  {
    id: 'vendor',
    displayName: 'Vendor',
    description: 'One-sentence pitch the UI card uses',
  },
  // …
];
```

**Global invariants enforced in tests** (`lib/system/brandOnboardingSmoke.test.ts`):
- **GLOBAL 1**: every `ECOSYSTEM_BRANDS` entry must have a matching `BRAND_PROFILES` entry OR be explicitly tagged as storage-only (allowlist in test file).
- **GLOBAL 2**: every non-micro brand must have at least one compatible panel in the catalog (else no system can be sized).

---

## Consumers downstream of the four layers

Once Layers A–D are coherent, the brand flows through the full pipeline automatically:

```
EcosystemPicker           → resolveBrandEquipment()    (Layer D → A)
onApply payload           → EngineeringPage.updateConfig
config                    → useMemo sizingRecommendation
sizeSystemFromBrand()     → brand profile (Layer B) tiers
  ↓
selected SKU              → equipment-db lookup (Layer A)
  ↓
BOM                       → BOMGeneratorV4 reads ecosystemBrand tag
SLD renderer              → symbol map + inverter/battery IDs
Permit PDF                → ecosystem-aware electrical pages
Proposal                  → deriveEcosystemSummary()
Compliance engine         → brand.compatibility rules
```

---

## Checklist for onboarding a new brand ecosystem

- [ ] **Layer A** — add one or more SKUs to `equipment-db.ts`:
  - `ecosystemBrand` tag set
  - `active: true` for US-saleable SKUs (`active: false` only for legacy/foreign)
  - `datasheetUrl` verified HTTP 200
  - `compatibleWith` enumerates every inverter in the family (for batteries)
- [ ] **Layer B** — create `lib/system/brandProfiles/<brand>.ts`:
  - `supportedInverterModels` references every active SKU
  - `sizingTiers` cover 0→Infinity with no gaps, ONLY referencing active SKUs
  - `battery` block matches the hardware capabilities
  - `compatibility.incompatibleTopologies` / `incompatibleBrands` set correctly
- [ ] **Layer C** — register in `BRAND_PROFILES` array + re-export
- [ ] **Layer D** — add to `ECOSYSTEM_BRANDS` with description
- [ ] **Tests** — add a datasheet-lock test file following the `growatt-datasheet.test.ts` / `ecoflow-ocean-pro-datasheet.test.ts` pattern:
  - Per-SKU electrical-field assertions (catches accidental edits)
  - Brand-profile integration asserts (tier coverage, active SKUs, UI registration)
- [ ] **Gate trio** — typecheck, lint, all tests pass before committing

---

## Case Study: EcoFlow OCEAN Pro onboarding (v58.14)

**Starting state (pre-v58.14)**:
- ✅ Layer A — had 3 inverters (`ecoflow-power-ocean-5kw / 10kw / 20kw`) all `active: false` (EU/AU only) + 1 battery module (5 kWh, also active:true but pointing at the inactive 10kW)
- ✅ Layer B — brand profile existed but built around obsolete EU SKUs
- ✅ Layer C — registered in `BRAND_PROFILES`
- ❌ Layer D — **missing from `ECOSYSTEM_BRANDS`** → user could not select

**Actions taken**:
1. **Layer A** — added 3 new rows:
   - `ecoflow-ocean-pro-11kw` (EF-PCS-24 @ 11.5 kW tier, active:true)
   - `ecoflow-ocean-pro-24kw` (EF-PCS-24 @ 24 kW tier, active:true)
   - `ecoflow-ocean-pro-bp-10` (EF-BP-10 battery, 10 kWh LFP HV, active:true, UL 9540B)
   - Broadened legacy `ecoflow-battery-5kwh.compatibleWith` to cover all 3 legacy inverter SKUs
2. **Layer B** — rewrote `ecoflow.ts` profile:
   - `displayName` bumped to `'EcoFlow OCEAN Pro'`
   - `supportedInverterModels` lists the 2 new OCEAN Pro SKUs first, then legacy for back-compat
   - `sizingTiers` point ONLY at active US SKUs (no legacy references)
   - `battery.maxKwh` raised to 80 (datasheet cap)
   - `compatibility.dcAcRatioRange` extended to 1.7 (OCEAN Pro 40 kW DC on 24 kW AC)
3. **Layer D** — added EcoFlow entry to `ECOSYSTEM_BRANDS`
4. **Tests** — created `lib/ecoflow-ocean-pro-datasheet.test.ts` with 65 new lock-in assertions

**Gate trio results**:
- typecheck: exit 0
- lint: exit 0 (pre-existing warnings only)
- vitest: **69 files / 2661 tests passed** (78 new)

---

## Future work

1. **Generalise the sizing engine's hardcoded EcoFlow constants** (`ECOFLOW_MODULE_KWH=5`, `ECOFLOW_STD_CAP_KWH=45`, hardcoded `'ecoflow-battery-5kwh'`) in `lib/system/sizingEngine.ts`. These should be read from the brand profile so the OCEAN Pro 10 kWh module is selected by default for EcoFlow projects. Until then, `ecoflow.ts` keeps `minKwh: 5, defaultTargetKwh: 10` for back-compat with existing regression tests.

2. **Validate legacy `active: false` SKUs on project load**. If a project was saved with an inactive SKU, surface a warning and offer migration to the modern equivalent.

3. **Brand-profile drift-guard enhancement**: extend `lib/system/brandProfileDriftGuard.ts` to fail CI when a sizing tier references an `active: false` SKU.