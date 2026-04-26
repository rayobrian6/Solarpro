#!/usr/bin/env python3
"""Update docs/UPGRADE_ROADMAP_v47.399.md for v47.433 (Stage 8.4 shipped).

Safe-write pattern: write to a temp file, then os.replace() to swap atomically.
Avoids the truncate-on-encoding-error trap.
"""
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "UPGRADE_ROADMAP_v47.399.md"

text = DOC.read_text(encoding="utf-8")

# --- 1. Update the Stage 8 checklist line to reflect 8.4 shipped -----------
lines = text.splitlines(keepends=True)
target_idx = None
for i, line in enumerate(lines):
    if "8.1 shipped v47.432" in line and "Stage 8 \u2014 Consolidation" in line:
        target_idx = i
        break

if target_idx is None:
    raise SystemExit("ERROR: Stage 8 checklist line not found")

orig = lines[target_idx]
trailing = "\n" if orig.endswith("\n") else ""

new_check = (
    "- [~] Stage 8 \u2014 Consolidation execution: **8.1 shipped v47.432** "
    "(BOM dead-code deletion: 7 files / -3,278 lines, 0 API changes), "
    "**8.2 shipped v47.432** (drift-fence CI tests: rackingDatabaseDriftGuard "
    "+45 tests, brandProfileDriftGuard +228 tests with overridesEquipmentDb "
    "opt-out). **8.4 shipped v47.433** (brand-profile centralization: 6 drift "
    "corrections across 4 profiles \u2014 SMA SB-7.7 mpptCount 2\u21923, SMA SB-10.0 "
    "maxParallel 1\u21926, GoodWe GW10K-MS 10/15/2\u21929.6/14.4/3, Sungrow SG15RS "
    "maxParallel 1\u21922, SolarEdge generic-string SE-7600H/SE-10000H "
    "mpptCount 2\u21921; all 6 overridesEquipmentDb flags removed; drift-guard "
    "audit log now reports zero overrides). **8.3 deferred** (racking unification)."
    + trailing
)
lines[target_idx] = new_check
text = "".join(lines)

# --- 2. Append Stage 8.4 section after the 8.1+8.2 block -------------------
STAGE_84_SECTION = """

### \U0001F527 Stage 8.4 \u2014 Brand-Profile Centralization (shipped v47.433)

**Scope:** close the brand-profile drift backlog surfaced by the v47.432 drift-guard. Fix the 3 stale profile drifts, align the 2 \"intentional\" overrides to registry, leave zero `overridesEquipmentDb=true` flags remaining. Per user directive: \"fix the 3 stale brand-profile values, remove overridesEquipmentDb flags where no longer needed, ensure drift-guards pass clean with no intentional overrides remaining.\"

**Deliverables:**

1. **`lib/system/brandProfiles/generic-string.ts`** \u2014 SolarEdge HD-Wave catch-all corrections:
   - `se-7600h` mpptCount: **2 \u2192 1** (HD-Wave is single-MPPT per optimizer inverter; dedicated `solaredge.ts` profile already had mpptCount=1)
   - `se-10000h` mpptCount: **2 \u2192 1** (same rationale)

2. **`lib/system/brandProfiles/sma.ts`** \u2014 SMA inverter corrections:
   - `sma-sb-7.7` mpptCount: **2 \u2192 3** (v47.417 US-41 datasheet: SB 6.0/7.0/7.7 all have 3 MPPT trackers)
   - `sma-sb-10.0` maxParallelStringsPerMppt: **1 \u2192 6** (TL-US datasheet: 6 parallel strings via external DC Combiner Box; SKU is `active: false` so zero live-project impact)

3. **`lib/system/brandProfiles/goodwe.ts`** \u2014 GoodWe MS-US correction:
   - `goodwe-gw10k-ms` acKw/dcKwMax/mpptCount: **10.0/15.0/2 \u2192 9.6/14.4/3** (v47.417 remap: the equipmentDbId resolves to GoodWe GW9600-MS-US; canonical spec per MS-US datasheet)

4. **`lib/system/brandProfiles/sungrow.ts`** \u2014 Sungrow correction:
   - `sungrow-sg15rs` maxParallelStringsPerMppt: **1 \u2192 2** (SG15RS datasheet; SKU is `active: false` so zero live-project impact)

**Opt-out flag disposition:** all 6 `overridesEquipmentDb=true` flags REMOVED. The drift-guard audit log now reports zero overrides on every CI run. The `overridesEquipmentDb?: boolean` field on `BrandInverterModelRef` in `types.ts` is RETAINED so future legitimate overrides have a documented mechanism (must carry in-code justification per test comment), but no SKU currently uses it.

**BOM accuracy impact:** this release directly improves sizing accuracy for three live-brand SKUs:
- SMA SB-7.7 projects now correctly distribute strings across 3 MPPT trackers instead of 2
- GoodWe GW10K-MS projects now use the correct 9.6 kW AC / 14.4 kW DC / 3 MPPT spec instead of the stale 10.0/15.0/2
- SolarEdge catch-all projects via `generic-string` now correctly treat HD-Wave as 1-MPPT

Every BOM, string-allocation, and compliance path downstream of `BRAND_PROFILES` inherits the fix automatically (no code-logic changes).

**Verification:** 2075/2075 tests pass (same count as v47.432 \u2014 the drift-guard tests pass cleanly on the corrected values, confirming the corrections ARE the canonical registry values). TC=0, `npm run build` clean (46/46 pages).

**Stage 8.3 remains deferred** (racking unification): retire `structural-engine-v3` via adapter to `mounting-hardware-db.ts`, reconcile the 2 racking divergences in `EXPECTED_DIVERGENCES`, delete `racking-database.ts`.
"""

anchor = (
    "- **Stage 8.4** \u2014 Brand-profile spec centralization (reconcile the 3 "
    "stale profile drifts flagged by the drift-guard: sma-sb-7.7, goodwe-gw10k-ms, "
    "and the 2 SolarEdge catch-alls in generic-string; optionally remove the "
    "duplicated fields from `BrandInverterModelRef` so profiles read from "
    "`equipment-db` directly)"
)
if anchor not in text:
    raise SystemExit("ERROR: Stage 8.4 backlog anchor not found")
text = text.replace(anchor, anchor + STAGE_84_SECTION, 1)

# --- Safe atomic write -----------------------------------------------------
dir_ = DOC.parent
with tempfile.NamedTemporaryFile(
    mode="w", encoding="utf-8", delete=False, dir=dir_, prefix=".tmp_roadmap_"
) as tf:
    tf.write(text)
    tmp_path = tf.name
os.replace(tmp_path, DOC)
print("Roadmap updated for v47.433 (atomic write).")