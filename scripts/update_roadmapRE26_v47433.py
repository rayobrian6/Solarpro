#!/usr/bin/env python3
"""Insert v47.433 Stage 8.4 entry into lib/roadmapRE26.ts after the v47.432 entry."""
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "lib" / "roadmapRE26.ts"

text = FILE.read_text(encoding="utf-8")

# Anchor: end of v47.432 entry (unique sequence before the "IN PROGRESS" marker).
anchor = (
    "    shippedIn: 'v47.432',\n"
    "    notes: 'Stage 8.3 (racking unification) and Stage 8.4 (brand-profile "
    "centralization + reconcile 3 documented stale profile drifts) remain deferred "
    "per user directive. Drift-guard audit log surfaces the full override list on "
    "every CI run for review visibility.',\n"
    "    createdAt: '2026-04-22',\n"
    "    updatedAt: '2026-04-22',\n"
    "  },\n"
)
if anchor not in text:
    raise SystemExit("ERROR: v47.432 entry anchor not found")

# New v47.433 entry (strictly single-quoted strings, no apostrophes in prose).
# Keep arrow characters as Unicode escapes to avoid any editor/encoding issues.
new_entry = """
  // v47.433 \u2014 Stage 8.4 Brand-Profile Centralization
  {
    id: 'v47.433-stage8_4-brand-profile-centralization',
    title: 'v47.433 \u2014 Stage 8.4: Brand-Profile Centralization',
    summary: 'Closes the brand-profile drift backlog surfaced by the v47.432 drift-guard. Per user directive: fix the 3 stale drifts, align the 2 intentional overrides to registry, leave zero overridesEquipmentDb=true flags remaining. Six value corrections across 4 brand profiles (no code-logic changes): (1) generic-string.ts se-7600h and se-10000h mpptCount 2 \u2192 1 (SolarEdge HD-Wave is single-MPPT per optimizer inverter); (2) sma.ts sma-sb-7.7 mpptCount 2 \u2192 3 (v47.417 US-41 datasheet correction now propagated); (3) sma.ts sma-sb-10.0 maxParallel 1 \u2192 6 (TL-US external combiner per datasheet; active:false SKU so zero live-project impact); (4) goodwe.ts goodwe-gw10k-ms acKw/dcKwMax/mpptCount 10.0/15.0/2 \u2192 9.6/14.4/3 (v47.417 remap to GW9600-MS-US); (5) sungrow.ts sungrow-sg15rs maxParallel 1 \u2192 2 (SG15RS datasheet; active:false SKU so zero live-project impact). ALL 6 overridesEquipmentDb=true flags removed; the drift-guard audit log now reports zero overrides on every CI run. The overridesEquipmentDb?:boolean field on BrandInverterModelRef is retained so future legitimate overrides have a documented mechanism. BOM accuracy impact: direct sizing improvement for three live-brand SKUs (SMA SB-7.7, GoodWe GW10K-MS, SolarEdge catch-all via generic-string). Every BOM, string-allocation, and compliance path downstream of BRAND_PROFILES inherits the fix automatically. Full suite 2075/2075 pass (same count as v47.432 \u2014 the drift-guard tests pass cleanly on the corrected values, confirming the corrections ARE the canonical registry values). TC=0, npm run build clean (46/46 pages). Stage 8.3 (racking unification) remains deferred.',
    track: 'infrastructure',
    priority: 'p1',
    status: 'done',
    effort: 's',
    files: [
      'lib/system/brandProfiles/generic-string.ts',
      'lib/system/brandProfiles/sma.ts',
      'lib/system/brandProfiles/goodwe.ts',
      'lib/system/brandProfiles/sungrow.ts',
      'docs/UPGRADE_ROADMAP_v47.399.md',
      'docs/stage8_4-todo.md',
      'lib/version.ts',
      'lib/roadmapRE26.ts',
    ],
    shippedIn: 'v47.433',
    notes: 'Stage 8.3 (racking unification) remains deferred. With Stage 8.4 complete, the core sizing + BOM layer is fully aligned with canonical equipment-db values. Next: site survey app integration.',
    createdAt: '2026-04-23',
    updatedAt: '2026-04-23',
  },
"""

text = text.replace(anchor, anchor + new_entry, 1)

# Atomic write
dir_ = FILE.parent
with tempfile.NamedTemporaryFile(
    mode="w", encoding="utf-8", delete=False, dir=dir_, prefix=".tmp_rm26_"
) as tf:
    tf.write(text)
    tmp_path = tf.name
os.replace(tmp_path, FILE)
print("roadmapRE26.ts updated with v47.433 entry (atomic write).")