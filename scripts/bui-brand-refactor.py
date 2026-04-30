#!/usr/bin/env python3
"""
v58.18 – BUI brand-awareness refactor
Replaces the isEnphase/isTesla boolean pair with a normalised buiBrand string
so all 7 registered BUI brands (Tesla, EcoFlow, Enphase, SolarEdge, Generac,
Sol-Ark, Growatt) get correct colours, header text, NEC footnotes and label
fallbacks instead of falling through to the generic "BACKUP INTERFACE UNIT".
"""

import re, sys
from pathlib import Path

RENDERER = Path("lib/sld-professional-renderer.ts")
src = RENDERER.read_text(encoding="utf-8")
original = src  # keep for diff check

# ─── Patch 1: renderBUI() signature ─────────────────────────────────────────
# Replace:  isEnphase: boolean, isTesla: boolean,
# With:     buiBrand: string,
OLD_SIG = "  isEnphase: boolean, isTesla: boolean,"
NEW_SIG = "  buiBrand: string,      // normalised lowercase brand key e.g. 'enphase', 'tesla', 'solark'"

assert src.count(OLD_SIG) == 1, f"Expected 1 occurrence of OLD_SIG, got {src.count(OLD_SIG)}"
src = src.replace(OLD_SIG, NEW_SIG)

# ─── Patch 2: BUI_CLR + brand config block (replaces the one-liner) ─────────
OLD_CLR = "  const BUI_CLR = isEnphase ? '#0D47A1' : isTesla ? '#CC0000' : '#1565C0';"
NEW_CLR = """\
  // ── Brand config table ────────────────────────────────────────────────────
  // Each entry: [accentColour, headerText, defaultModel, necNote]
  const BUI_BRAND_CONFIG: Record<string, [string, string, string, string]> = {
    enphase:    ['#0D47A1', 'IQ SYSTEM CONTROLLER 3',  'IQ SC3',             'NEC 706 / NEC 230.82 / UL 1741-SA'],
    tesla:      ['#CC0000', 'BACKUP GATEWAY 2',         'Backup Gateway 2',   'NEC 706 / UL 9540A'],
    ecoflow:    ['#006D5B', 'SMART HOME PANEL',         'Smart Home Panel',   'NEC 706 / UL 1741 / UL 9540'],
    solaredge:  ['#E8520A', 'BACKUP INTERFACE',         'Backup Interface',   'NEC 706 / UL 1741-SB'],
    generac:    ['#1B5E20', 'PWRmanager',               'PWRmanager',         'NEC 706 / UL 1008 / UL 1741'],
    solark:     ['#1A237E', 'SMART LOAD CENTER',        'Smart Load Center',  'NEC 706 / UL 1741-SB'],
    growatt:    ['#2E7D32', 'ATS-S TRANSFER SWITCH',    'ATS-S 200A',         'NEC 706 / UL 1008'],
  };
  const _bCfg   = BUI_BRAND_CONFIG[buiBrand] ?? ['#1565C0', 'BACKUP INTERFACE UNIT', 'BUI', 'NEC 706 / UL 1741'];
  const BUI_CLR = _bCfg[0];
  const _buiHeaderText  = _bCfg[1];
  const _buiDefaultModel = _bCfg[2];
  const _buiNecNote     = _bCfg[3];\
"""

assert src.count(OLD_CLR) == 1, f"Expected 1 occurrence of OLD_CLR, got {src.count(OLD_CLR)}"
src = src.replace(OLD_CLR, NEW_CLR)

# ─── Patch 3: headerText (replaces the 3-line ternary) ───────────────────────
OLD_HDR = (
    "  const headerText = isEnphase ? 'IQ SYSTEM CONTROLLER 3'\n"
    "    : isTesla ? 'BACKUP GATEWAY 2'\n"
    "    : 'BACKUP INTERFACE UNIT';"
)
NEW_HDR = "  const headerText = _buiHeaderText;"

assert src.count(OLD_HDR) == 1, f"Expected 1 occurrence of OLD_HDR, got {src.count(OLD_HDR)}"
src = src.replace(OLD_HDR, NEW_HDR)

# ─── Patch 4: labelBrand / labelModel fallbacks ───────────────────────────────
OLD_LBL = (
    "  const labelBrand = brand || (isEnphase ? 'Enphase' : isTesla ? 'Tesla' : 'BUI');\n"
    "  const labelModel = model || (isEnphase ? 'IQ SC3' : isTesla ? 'Gateway 2' : 'BUI');"
)
NEW_LBL = (
    "  const labelBrand = brand || (buiBrand ? buiBrand.charAt(0).toUpperCase() + buiBrand.slice(1) : 'BUI');\n"
    "  const labelModel = model || _buiDefaultModel;"
)

assert src.count(OLD_LBL) == 1, f"Expected 1 occurrence of OLD_LBL, got {src.count(OLD_LBL)}"
src = src.replace(OLD_LBL, NEW_LBL)

# ─── Patch 5: NEC footnote (replaces if/else isEnphase block) ─────────────────
OLD_NEC = (
    "  if (isEnphase) {\n"
    "    p.push(txt(cx, by2+H2+36, 'NEC 706 / NEC 230.82 / UL 1741-SA', {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));\n"
    "  } else {\n"
    "    p.push(txt(cx, by2+H2+36, 'NEC 706 / UL 1741', {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));\n"
    "  }"
)
NEW_NEC = (
    "  p.push(txt(cx, by2+H2+36, _buiNecNote, {sz: F.tiny, anc: 'middle', italic: true, fill: BUI_CLR}));"
)

assert src.count(OLD_NEC) == 1, f"Expected 1 occurrence of OLD_NEC, got {src.count(OLD_NEC)}"
src = src.replace(OLD_NEC, NEW_NEC)

# ─── Patch 6: Main render loop — replace isEnphase/isTesla detection ─────────
# Old block:
#   const isEnphase = !!(input.backupInterfaceBrand?.toLowerCase().includes('enphase') || ...)
#   const isTesla   = !!(input.backupInterfaceBrand?.toLowerCase().includes('tesla')   || ...)
OLD_DETECT = (
    "    const isEnphase = !!(input.backupInterfaceBrand?.toLowerCase().includes('enphase') ||\n"
    "      input.inverterManufacturer?.toLowerCase().includes('enphase') ||\n"
    "      input.batteryModel?.toLowerCase().includes('enphase') ||\n"
    "      input.batteryModel?.toLowerCase().includes('iq battery'));\n"
    "    const isTesla = !!(input.backupInterfaceBrand?.toLowerCase().includes('tesla') ||\n"
    "      input.batteryModel?.toLowerCase().includes('powerwall'));"
)
NEW_DETECT = """\
    // Derive a normalised BUI brand key (mirrors normalizeDeviceBrandKey).
    // Priority: explicit backupInterfaceBrand > inverter manufacturer > battery model sniff.
    const _normBuiKey = (s?: string) =>
      (s ?? '').toLowerCase().replace(/[\\u00ae\\u2122\\u00a9]/g, '').replace(/[\\s\\-_.]+/g, '').trim();
    const _buiBrandFromInput: string = (() => {
      if (input.backupInterfaceBrand) return _normBuiKey(input.backupInterfaceBrand);
      // Infer from inverter brand (Enphase micro system → IQ SC3; Tesla → Gateway 2)
      const invKey = _normBuiKey(input.inverterManufacturer);
      if (invKey === 'enphase') return 'enphase';
      if (invKey === 'tesla')   return 'tesla';
      // Infer from battery model string as last resort
      const batM = (input.batteryModel ?? '').toLowerCase();
      if (batM.includes('enphase') || batM.includes('iq battery')) return 'enphase';
      if (batM.includes('powerwall'))                               return 'tesla';
      if (batM.includes('ecoflow') || batM.includes('ocean'))       return 'ecoflow';
      if (batM.includes('solaredge') || batM.includes('energy bank')) return 'solaredge';
      if (batM.includes('generac') || batM.includes('pwrcell'))     return 'generac';
      if (batM.includes('sol-ark') || batM.includes('solark'))      return 'solark';
      if (batM.includes('growatt') || batM.includes('ark lv'))      return 'growatt';
      return '';
    })();
    // Legacy compat flags (used by backupPanelBrand fallback below)
    const isEnphase = _buiBrandFromInput === 'enphase';
    const isTesla   = _buiBrandFromInput === 'tesla';\
"""

assert src.count(OLD_DETECT) == 1, f"Expected 1 occurrence of OLD_DETECT, got {src.count(OLD_DETECT)}"
src = src.replace(OLD_DETECT, NEW_DETECT)

# ─── Patch 7: renderBUI() call site — replace isEnphase/isTesla args ─────────
OLD_CALL = (
    "      input.backupInterfaceBrand ?? (isEnphase ? 'Enphase' : isTesla ? 'Tesla' : ''),\n"
    "      input.backupInterfaceModel ?? (isEnphase ? 'IQ System Controller 3' : isTesla ? 'Backup Gateway 2' : 'BUI'),\n"
    "      buiAmpRating,\n"
    "      isEnphase, isTesla,"
)
NEW_CALL = (
    "      input.backupInterfaceBrand ?? '',\n"
    "      input.backupInterfaceModel ?? '',\n"
    "      buiAmpRating,\n"
    "      _buiBrandFromInput,"
)

assert src.count(OLD_CALL) == 1, f"Expected 1 occurrence of OLD_CALL, got {src.count(OLD_CALL)}"
src = src.replace(OLD_CALL, NEW_CALL)

# ─── Write back ───────────────────────────────────────────────────────────────
assert src != original, "No changes made — something went wrong"
RENDERER.write_text(src, encoding="utf-8")
print("✅ lib/sld-professional-renderer.ts patched successfully")

# ─── Quick sanity: old strings must be gone ───────────────────────────────────
checks_gone = [
    "isEnphase ? 'IQ SYSTEM CONTROLLER 3'",
    "isTesla ? 'BACKUP GATEWAY 2'",
    "isEnphase ? '#0D47A1'",
    "input.batteryModel?.toLowerCase().includes('iq battery')",
]
checks_present = [
    "BUI_BRAND_CONFIG",
    "_buiBrandFromInput",
    "SMART HOME PANEL",
    "PWRmanager",
    "SMART LOAD CENTER",
    "ATS-S TRANSFER SWITCH",
    "BACKUP INTERFACE",
]
ok = True
for s in checks_gone:
    if s in src:
        print(f"  ❌ STILL PRESENT (should be gone): {s!r}")
        ok = False
for s in checks_present:
    if s not in src:
        print(f"  ❌ MISSING (should be present): {s!r}")
        ok = False
if ok:
    print("✅ All sanity checks passed")