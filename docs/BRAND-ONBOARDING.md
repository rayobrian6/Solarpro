# Brand Onboarding — CI-Enforced Procedure (v47.425+)

This document is the **single source of truth** for adding a new inverter brand
to SolarPro.

Every step below is enforced by the **Brand Onboarding Smoke Suite**
(`lib/system/brandOnboardingSmoke.test.ts`, 317 CI-blocking tests as of v47.426).
If you skip any step, the suite will fail and the PR will be blocked.

---

## ✅ Proven Model (v47.426 reference)

**v47.426 onboarded Solis + Tesla + Tigo in a single commit** — 13 new SKUs
across 3 brands, all passing 317/317 smoke tests on the first run, with
zero changes to the sizing engine, string generator, compliance evaluator,
auto-heal loop, or panel compatibility gate.

The workflow that produced that result **IS** the canonical model:

1. **Research** — scrape the manufacturer datasheet PDF; verify every spec
   field against the literal datasheet value (no derived values).
2. **Draft** — write a short plan doc under `docs/` with the verified specs
   before touching code. This is how `docs/v47.426-batch-onboarding-plan.md`
   was structured.
3. **Register** — add SKUs to `lib/equipment-db.ts`, create the brand
   profile under `lib/system/brandProfiles/`, wire index + ECOSYSTEM_BRANDS.
4. **Audit** — write one `lib/<brand>-datasheet.test.ts` per brand that locks
   every equipment-db field to the literal datasheet value (no `1.25 × IMP`
   derivations — rule from v47.418).
5. **Gate** — run the smoke suite. If it passes, the brand is done.
   If it fails, the error message tells you exactly which invariant broke.
6. **Commit** — one commit, one version bump, push.

**Target turnaround: one session per batch of 2–4 brands.** No firefighting.

---

## 0. Pre-flight — gather from the manufacturer datasheet

- Per-MPPT max input current (A)
- Per-MPPT max short-circuit current (A)
- Max parallel strings per MPPT (the inverter's physical string input count)
- MPPT channel count (number of independent MPPT trackers)
- Max DC input voltage (V)
- MPPT voltage range (V_min, V_max)
- AC output (kW)
- Startup voltage (V)
- DC/AC ratio recommended range (min, max)

Cite the datasheet URL inline as a comment next to the registry entry.

---

## 1. Add inverter SKUs to `lib/equipment-db.ts`

Every inverter record **MUST** include all of:

```ts
{
  id: '<vendor>-<model-slug>',
  manufacturer: '<Display Name>',
  model: '<Datasheet Model String>',
  category: 'string_inverter',
  acOutputKw: <number>,
  dcInputKwMax: <number>,
  maxDcVoltage: <number>,
  mpptVoltageMin: <number>,
  mpptVoltageMax: <number>,
  maxInputCurrentPerMppt: <number>,       // REQUIRED
  maxShortCircuitCurrent: <number>,
  mpptChannels: <number>,                  // REQUIRED
  numberOfMPPT: <same-as-mpptChannels>,
  maxParallelStringsPerMppt: <number>,     // REQUIRED — 1 for small residential,
                                           //            2 for mid, 3+ for commercial
  recommendedStringRange: { min, max },
  acOutputVoltage: <number>,
  acOutputCurrentMax: <number>,
  efficiency: <number>, cec_efficiency: <number>,
  rapidShutdownCompliant: <boolean>,
  arcFaultProtection:   <boolean>,
  groundFaultProtection: <boolean>,
  integratedDcDisconnect: <boolean>,
  datasheetUrl: '<https://...>',
  ecosystemBrand:  '<brand-id>',
  ecosystemFamily: '<family-slug>',
  active: true,
}
```

**Gate:** Stage 2 of the smoke suite resolves every
`supportedInverterModels[].equipmentDbId` and validates
`REQUIRED_INVERTER_FIELDS = [maxInputCurrentPerMppt, mpptChannels,
maxParallelStringsPerMppt, maxDcVoltage, mpptVoltageMin, mpptVoltageMax,
acOutputKw]`. Missing or non-numeric fields fail the PR.

---

## 2. Create a BrandProfile — `lib/system/brandProfiles/<brand>.ts`

```ts
export const <BRAND>_PROFILE: BrandProfile = {
  id:                     '<brand-id>',       // kebab-case
  displayName:            '<Display Name>',
  manufacturer:           '<Manufacturer>',
  supportedSystemTypes:   ['roof', 'ground'],
  topology:               'string' | 'hybrid' | 'optimizer' | 'micro',
  inverterType:           'string' | 'micro',
  supportedInverterModels: [
    { equipmentDbId: '<id-from-equipment-db>', ... },
    ...
  ],
  sizingTiers: [
    { minDcKw: 0,     maxDcKw: 5,       equipmentDbId: '<small>' },
    { minDcKw: 5,     maxDcKw: 8,       equipmentDbId: '<mid>' },
    { minDcKw: 8,     maxDcKw: Infinity, equipmentDbId: '<large>' },
  ],
  battery: { capable: ..., required: ..., strategy: ..., defaultKwh: ... },
  requiredBOSFamilies: [...],
  compatibility: { incompatibleTopologies: [...], incompatibleBrands: [...] },
  recommendedFor: [...],
};
```

**Gate:** Stage 1 validates all 12 `REQUIRED_BRAND_FIELDS`. Stage 3 validates
sizing tiers: start at 0 kW, end at Infinity (or >=1000 kW), no gaps, no
overlaps, every tier's `equipmentDbId` appears in `supportedInverterModels`.

---

## 3. Register the profile

```ts
// lib/system/brandProfiles/index.ts
import { <BRAND>_PROFILE } from './<brand>';
export const BRAND_PROFILES: BrandProfile[] = [
  ...,
  <BRAND>_PROFILE,
];
export { <BRAND>_PROFILE };
```

---

## 4. Add to the ecosystem picker — `lib/system/brandProfiles/resolveBrandEquipment.ts`

```ts
export const ECOSYSTEM_BRANDS = [
  ...,
  { id: '<brand-id>', displayName: '<Display Name>', description: '<short blurb>' },
];
```

**Gate:** Global invariant 1 ensures every ECOSYSTEM_BRANDS entry has a
matching BRAND_PROFILES entry (unless it's a battery-only / generator-only
brand tagged in the `STORAGE_ONLY_ECOSYSTEMS` allowlist).

---

## 5. Verify at least one panel in `SOLAR_PANELS` is compatible

For the brand's strictest per-MPPT current cap (= `min(maxInputCurrentPerMppt)`
across all `supportedInverterModels`), there MUST exist at least one panel
whose `Isc × 1.25 ≤ cap`.

**Gate:** Global invariant 2 rejects any brand with zero compatible panels in
the catalog. If your brand has a very strict cap (<10A), add a low-Isc panel
(e.g., SunPower Maxeon 3 at Isc 6.58A) to SOLAR_PANELS.

---

## 6. Run the smoke suite

```bash
npx vitest run lib/system/brandOnboardingSmoke
```

All 233 tests must pass. Failures will name the brand + stage precisely.

---

## 7. Run the full suite + build

```bash
npx vitest run
npx tsc --noEmit
npm run build
```

- Full suite must be fully green
- TypeScript must compile with 0 errors
- Next.js build must succeed (all pages generated)

---

## Why this matters

The v47.424 bug (panel/brand MPPT mismatch producing MPPT_CURRENT_EXCEEDED
because config was never updated to match the gate's auto-swap verdict) was
a class of defect that could have been caught automatically. The smoke suite
is our **permanent** defence: it exercises every pipeline stage (schema,
registry, gate, sizing, compliance) across every brand × every representative
panel × every representative panel count.

Adding a new brand that fails any of the following invariants is blocked
automatically:

1. 12 required BrandProfile fields declared
2. Every `equipmentDbId` resolves in STRING_INVERTERS
3. Every inverter has the 7 required numeric fields
4. Sizing tiers cover 0 → Infinity with no gaps
5. `getBrandMinMpptCurrent(brand)` returns a non-null, positive value
6. At least one panel in SOLAR_PANELS is fully compatible
7. `sizeSystemFromBrand()` does not throw for the brand × panel × count matrix
8. Incompatible panels trigger either a swap OR a clear warning
9. When gate clears a pair AND sizing blesses an inverter → compliance is clean
10. No orphan ECOSYSTEM_BRANDS entries
11. Gate + sizing are deterministic across repeated calls

**User quote (v47.425 origin):** "I am not checking this until you create a 100% future pass of onboarding fix at the same time."