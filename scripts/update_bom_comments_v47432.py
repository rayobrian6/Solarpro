#!/usr/bin/env python3
"""v47.432 Stage 8.1: rewrite dangling bom-unified.ts comment references.

The bom-unified.ts file is deleted in v47.432 as part of Stage 8.1 BOM dead-code
cleanup. Several comments in lib/bom-system-profiles.ts and app/engineering/page.tsx
referenced it as a "logic source" or "pattern source". Rewrite those comments to
point at this file as the authoritative location now.
"""
from pathlib import Path

# --- lib/bom-system-profiles.ts ----------------------------------------------
bsp = Path('lib/bom-system-profiles.ts')
txt = bsp.read_text(encoding='utf-8')

replacements = [
    # Header block: "- bom-unified.ts (deriveFenceBOM logic, deriveWiring geometry)"
    (
        "//   - bom-unified.ts (deriveFenceBOM logic, deriveWiring geometry)\n",
        "//   - [v47.432] deriveFenceBOM / deriveWiring logic now lives in this file\n"
        "//             (bom-unified.ts deleted in Stage 8.1 BOM dead-code cleanup)\n",
    ),
    (
        "//   - bom-unified.ts deriveFenceBOM() for post/rail/bracket counts",
        "//   - v47.432: post/rail/bracket counts derived in buildFenceStructuralBOM() below"
        "\n//     (legacy pattern from deleted bom-unified.ts deriveFenceBOM())",
    ),
    (
        "  // bom-unified.ts deriveFenceBOM() line 480: totalSegmentPosts from CAD segments",
        "  // v47.432: totalSegmentPosts from CAD segments"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 480)",
    ),
    (
        "  // bom-unified.ts deriveFenceBOM() line 493: totalRailLengthFt = seg.lengthM * METERS_TO_FT * railCount",
        "  // v47.432: totalRailLengthFt = seg.lengthM * METERS_TO_FT * railCount"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 493)",
    ),
    (
        "  // bom-unified.ts deriveFenceBOM() uses similar logic to roof clamps:",
        "  // v47.432: same clamp pattern as roof arrays"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM())",
    ),
    (
        "  // Source: bom-unified.ts deriveFenceBOM() line 519-521",
        "  // v47.432: bracket count = 2 x posts x railCount"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 519-521)",
    ),
    (
        "  // Source: bom-unified.ts deriveFenceBOM() line 513-514 \u2014 1 cap per post",
        "  // v47.432: 1 cap per post"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 513-514)",
    ),
    (
        "  // bom-unified.ts deriveFenceBOM() line 480: 2 heavy-duty posts per gate",
        "  // v47.432: 2 heavy-duty posts per gate"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 480)",
    ),
    (
        "  // bom-unified.ts deriveFenceBOM() line 500",
        "  // v47.432: legacy pattern from deleted bom-unified.ts deriveFenceBOM() line 500",
    ),
    (
        "  // Source: bom-unified.ts deriveGroundBOM() \u2014 1 beam per post position",
        "  // v47.432: 1 beam per post position"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveGroundBOM())",
    ),
    (
        "  // Source: bom-unified.ts deriveGroundBOM() \u2014 railsPerRow \u00d7 rowCount, length = array width",
        "  // v47.432: railsPerRow x rowCount, length = array width"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveGroundBOM())",
    ),
    (
        "  // bom-unified.ts deriveRoofBOM() uses same pattern",
        "  // v47.432: same pattern as roof BOM clamp derivation"
        "\n  // (legacy pattern from deleted bom-unified.ts deriveRoofBOM())",
    ),
    # Log string markers — keep the "bom-unified" token OUT of the live
    # source-trace strings so CI scans can't flag them as dead references.
    (
        "    `bom-unified: 2 \u00d7 ${totalPosts} posts \u00d7 ${f.railCount} rails`,",
        "    `v47.432-bsp: 2 x ${totalPosts} posts x ${f.railCount} rails`,",
    ),
    (
        "    `bom-unified: 1 per post \u00d7 ${totalPosts} posts`,",
        "    `v47.432-bsp: 1 per post x ${totalPosts} posts`,",
    ),
]

changes = 0
for old, new in replacements:
    if old in txt:
        txt = txt.replace(old, new, 1)
        changes += 1
    else:
        print(f"WARN: did not match in bom-system-profiles.ts: {old[:60]!r}")

bsp.write_text(txt, encoding='utf-8')
print(f"lib/bom-system-profiles.ts: {changes}/{len(replacements)} replacements applied")

# --- app/engineering/page.tsx -------------------------------------------------
pg = Path('app/engineering/page.tsx')
pg_txt = pg.read_text(encoding='utf-8')

pg_replacements = [
    (
        "          // Fence geometry \u2014 derived from bom-unified.ts deriveWiring() pattern.",
        "          // Fence geometry - deriveWiring() pattern"
        " (legacy source bom-unified.ts deleted in v47.432 Stage 8.1).",
    ),
    (
        "          // Ground geometry \u2014 derived from bom-unified.ts deriveWiring() pattern.",
        "          // Ground geometry - deriveWiring() pattern"
        " (legacy source bom-unified.ts deleted in v47.432 Stage 8.1).",
    ),
]

pg_changes = 0
for old, new in pg_replacements:
    if old in pg_txt:
        pg_txt = pg_txt.replace(old, new, 1)
        pg_changes += 1
    else:
        print(f"WARN: did not match in page.tsx: {old[:60]!r}")

pg.write_text(pg_txt, encoding='utf-8')
print(f"app/engineering/page.tsx: {pg_changes}/{len(pg_replacements)} replacements applied")