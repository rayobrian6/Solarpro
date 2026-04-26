#!/usr/bin/env python3
"""v47.432 Stage 8.1 pass 2: remaining bom-unified / bom-merge comment refs."""
from pathlib import Path

# --- lib/bom-engine-v4.ts ----------------------------------------------------
v4 = Path('lib/bom-engine-v4.ts')
txt = v4.read_text(encoding='utf-8')
old = "  // bom-system-profiles.ts and merged via bom-merge.ts mergeBOM() in the API route.\n"
new = ("  // v47.432: bom-system-profiles.ts now generates these items directly; bom-merge.ts\n"
       "  // was deleted in Stage 8.1 (only bom-engine-v4 remains as the canonical BOM engine).\n")
if old in txt:
    txt = txt.replace(old, new, 1)
    v4.write_text(txt, encoding='utf-8')
    print("lib/bom-engine-v4.ts: bom-merge comment updated")
else:
    print("WARN: bom-engine-v4.ts comment not matched")

# --- app/engineering/page.tsx ------------------------------------------------
pg = Path('app/engineering/page.tsx')
pg_txt = pg.read_text(encoding='utf-8')

pg_replacements = [
    (
        "      // derivedFrom: 'estimated-geometry' (not CAD model \u2014 see bom-unified.ts for CAD-based version)\n",
        "      // derivedFrom: 'estimated-geometry' (not CAD model)\n"
        "      // v47.432: CAD-based version historically lived in bom-unified.ts (deleted Stage 8.1)\n",
    ),
    (
        "          //   bom-unified.ts deriveWiring(): micro \u2192 2ft/panel DC, string \u2192 3ft/panel DC\n",
        "          //   Legacy deriveWiring() defaults: micro -> 2ft/panel DC, string -> 3ft/panel DC\n"
        "          //   (source bom-unified.ts deleted in v47.432 Stage 8.1)\n",
    ),
    (
        "            ROOF_RUN:              userDcLen ?? 3,           // micro DC: panel-to-micro ~3ft (bom-unified.ts: 2ft/panel)",
        "            ROOF_RUN:              userDcLen ?? 3,           // micro DC: panel-to-micro ~3ft (legacy bom-unified.ts: 2ft/panel)",
    ),
    (
        "          //   bom-unified.ts: string \u2192 3ft/panel DC + 2\u00d7 diagonal, micro \u2192 2ft/panel + 1.5\u00d7 diagonal\n",
        "          //   Legacy defaults: string -> 3ft/panel DC + 2x diagonal, micro -> 2ft/panel + 1.5x diagonal\n"
        "          //   (source bom-unified.ts deleted in v47.432 Stage 8.1)\n",
    ),
]

pg_changes = 0
for old, new in pg_replacements:
    if old in pg_txt:
        pg_txt = pg_txt.replace(old, new, 1)
        pg_changes += 1
    else:
        print(f"WARN: page.tsx pass2 did not match: {old[:70]!r}")

pg.write_text(pg_txt, encoding='utf-8')
print(f"app/engineering/page.tsx pass 2: {pg_changes}/{len(pg_replacements)} applied")