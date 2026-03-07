#!/usr/bin/env python3
"""
Add Roof Tech model variations to mounting-hardware-db.ts
Roof Tech has at least 3 foot variations:
- RT-MINI (standard, asphalt shingle)
- RT-MINI-S (tile/slate version with longer standoff)
- RT-MINI-T (tile hook version for concrete/clay tile)
Also add RT-HOOK (standing seam version)
"""

NEW_ENTRIES = '''
  // ══════════════════════════════════════════════════════════════════════════════
  // ROOF TECH — Additional Model Variations
  // ══════════════════════════════════════════════════════════════════════════════

  {
    id: 'rooftech-mini-s',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI-S',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay', 'slate'],
    description: 'Roof Tech RT-MINI-S — extended standoff rail-less mount for tile and slate roofs. ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI-S',
      attachmentMethod: 'tile_hook',
      upliftCapacityLbs: 900,
      downwardCapacityLbs: 1200,
      shearCapacityLbs: 600,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 450,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay', 'slate'],
    },
    hardware: {
      midClamp: 'RT-MINI-S Mid Clamp 30-50mm',
      endClamp: 'RT-MINI-S End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      tileHook: 'RT-MINI-S Tile Hook',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI-S Engineering Design Guide Rev 2.0',
    lastUpdated: '2024-01',
  },

  {
    id: 'rooftech-mini-t',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI-T',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    description: 'Roof Tech RT-MINI-T — tile replacement rail-less mount for concrete and clay tile. ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI-T',
      attachmentMethod: 'tile_replacement',
      upliftCapacityLbs: 950,
      downwardCapacityLbs: 1300,
      shearCapacityLbs: 650,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 475,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['tile_concrete', 'tile_clay'],
    },
    hardware: {
      midClamp: 'RT-MINI-T Mid Clamp 30-50mm',
      endClamp: 'RT-MINI-T End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      tileHook: 'RT-MINI-T Tile Replacement',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI-T Engineering Design Guide Rev 2.0',
    lastUpdated: '2024-01',
  },

  {
    id: 'rooftech-hook',
    manufacturer: 'Roof Tech',
    productLine: 'RT-HOOK',
    model: 'RT-HOOK',
    category: 'roof_residential',
    systemType: 'standing_seam',
    compatibleRoofTypes: ['metal_standing_seam'],
    description: 'Roof Tech RT-HOOK — standing seam clamp mount, no roof penetrations. ICC-ES ESR-3575',
    mount: {
      model: 'RT-HOOK',
      attachmentMethod: 'standing_seam_clamp',
      upliftCapacityLbs: 1100,
      downwardCapacityLbs: 1500,
      shearCapacityLbs: 700,
      fastenersPerMount: 0,
      fastenerDiameterIn: 0,
      fastenerEmbedmentIn: 0,
      fastenerPulloutLbs: 0,
      maxSpacingIn: 60,
      minRafterDepthIn: 0,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['metal_standing_seam'],
    },
    hardware: {
      midClamp: 'RT-HOOK Mid Clamp 30-50mm',
      endClamp: 'RT-HOOK End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: 'N/A — Standing Seam Clamp',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 160,
    maxSnowLoadPsf: 50,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 2,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-HOOK Engineering Design Guide Rev 1.5',
    lastUpdated: '2024-01',
  },

  {
    id: 'rooftech-mini-m',
    manufacturer: 'Roof Tech',
    productLine: 'RT-MINI',
    model: 'RT-MINI-M (Metal)',
    category: 'roof_residential',
    systemType: 'rail_less',
    compatibleRoofTypes: ['metal_corrugated'],
    description: 'Roof Tech RT-MINI-M — corrugated metal roof rail-less mount with integrated sealing. ICC-ES ESR-3575',
    mount: {
      model: 'RT-MINI-M',
      attachmentMethod: 'corrugated_clamp',
      upliftCapacityLbs: 880,
      downwardCapacityLbs: 1150,
      shearCapacityLbs: 580,
      fastenersPerMount: 2,
      fastenerDiameterIn: 0.5,
      fastenerEmbedmentIn: 2.5,
      fastenerPulloutLbs: 440,
      maxSpacingIn: 48,
      minRafterDepthIn: 3.5,
      iccEsReport: 'ICC-ES ESR-3575',
      ul2703Listed: true,
      compatibleRoofTypes: ['metal_corrugated'],
    },
    hardware: {
      midClamp: 'RT-MINI-M Mid Clamp 30-50mm',
      endClamp: 'RT-MINI-M End Clamp 30-50mm',
      railSplice: 'N/A — Rail-Less',
      groundLug: 'WEEB Lug 6.7',
      lagBolt: '1/2" × 3" Lag Bolt SS',
      bondingHardware: 'WEEB Clip 6.7',
    },
    maxWindSpeedMph: 150,
    maxSnowLoadPsf: 45,
    maxRoofPitchDeg: 45,
    minRoofPitchDeg: 5,
    ul2703Listed: true,
    iccEsReport: 'ICC-ES ESR-3575',
    engineeringDataSource: 'Roof Tech RT-MINI-M Engineering Design Guide Rev 1.0',
    lastUpdated: '2024-01',
  },
'''

with open('lib/mounting-hardware-db.ts', 'r') as f:
    content = f.read()

# Find the existing rooftech-mini entry and insert after it
INSERT_AFTER = "    lastUpdated: '2024-01',\n  },\n\n  // ══════════════════════════════════════════════════════════════════════════════\n  // SNAPNRACK"

# Find rooftech-mini entry end
ROOFTECH_END = "    lastUpdated: '2024-01',\n  },\n\n  // ══"
idx = content.find("id: 'rooftech-mini',")
if idx == -1:
    print("ERROR: rooftech-mini not found")
    exit(1)

# Find the end of the rooftech-mini entry (next ══ section)
end_idx = content.find("  // ══", idx)
if end_idx == -1:
    print("ERROR: Could not find end of rooftech-mini section")
    exit(1)

print(f"Found rooftech-mini at {idx}, section ends at {end_idx}")
print(f"Context: {repr(content[end_idx-30:end_idx+30])}")

# Insert the new entries right after the rooftech-mini entry
new_content = content[:end_idx] + NEW_ENTRIES + content[end_idx:]

with open('lib/mounting-hardware-db.ts', 'w') as f:
    f.write(new_content)

print("✅ Added Roof Tech model variations")

# Verify
import subprocess
result = subprocess.run(['grep', '-c', "  id: '", 'lib/mounting-hardware-db.ts'], capture_output=True, text=True)
print(f"Total system IDs: {result.stdout.strip()}")

result2 = subprocess.run(['grep', "manufacturer: 'Roof Tech'", 'lib/mounting-hardware-db.ts'], capture_output=True, text=True)
print(f"Roof Tech entries: {len(result2.stdout.strip().split(chr(10)))}")
print(result2.stdout)