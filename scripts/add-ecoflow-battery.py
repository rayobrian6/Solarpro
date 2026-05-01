#!/usr/bin/env python3
path = 'lib/equipment-db.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

marker = """    weightLbs: 286, outdoorRated: false, ipRating: 'IP21',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false,
    warrantyYears: 10, cycleGuarantee: '10000 cycles', capacityRetentionPct: 70,
    msrpUsd: 11000,
    necRefs: ['NEC 705.12(B) \u2014 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 \u2014 Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    isNew: true,
  },
];"""

replacement = """    weightLbs: 286, outdoorRated: false, ipRating: 'IP21',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: false,
    requiresGateway: false,
    warrantyYears: 10, cycleGuarantee: '10000 cycles', capacityRetentionPct: 70,
    msrpUsd: 11000,
    necRefs: ['NEC 705.12(B) \u2014 120% rule: battery backfeed breaker adds to bus loading', 'NEC 706 \u2014 Energy Storage Systems'],
    ulListing: 'UL 9540 / UL 9540A', certifications: ['UL 9540', 'UL 9540A', 'IEEE 1547', 'IEC 62619'],
    isNew: true,
  },
  // \u2550\u2550\u2550 EcoFlow PowerOcean LFP 5 kWh \u2014 stackable battery module, v47.358 \u2550\u2550\u2550
  // CROSS-REF: lib/ecoflow-system.ts (canonical), lib/equipment-registry-v4.ts (BOM lookup)
  // Sold as a module \u2014 multiple units stack (up to 9 = 45 kWh std, 16 = 80 kWh pro)
  {
    id: 'ecoflow-battery-5kwh',
    manufacturer: 'EcoFlow', model: 'PowerOcean LFP Battery Module (5kWh)',
    category: 'battery', subcategory: 'dc_coupled',
    usableCapacityKwh: 5.0, peakPowerKw: 5.0, continuousPowerKw: 5.0,
    roundTripEfficiencyPct: 98.0, chemistry: 'LFP', voltageNominalV: 51.2,
    acOutputVoltageV: 240, maxContinuousOutputA: 20.8,
    backfeedBreakerA: 0,
    minDedicatedBreakerA: 0,
    weightLbs: 110, outdoorRated: true, ipRating: 'IP65',
    gridFormingCapable: true, backupCapable: true, wholeHomeBackup: true,
    requiresGateway: true, gatewayModel: 'EcoFlow PowerOcean Monitoring Gateway',
    warrantyYears: 15, cycleGuarantee: '6000 cycles', capacityRetentionPct: 70,
    msrpUsd: 2800,
    necRefs: ['NEC 706 \u2014 Energy Storage Systems', 'NEC 690.71 \u2014 Battery installation'],
    ulListing: 'UL 9540A / UL 1973', certifications: ['UL 9540A', 'UL 1973', 'IEC 62619'],
    isNew: true,
  },
];"""

if marker not in content:
    # Try searching for the unique end
    idx = content.rfind("msrpUsd: 11000,")
    print(f"Marker not found exactly. Last msrpUsd: 11000 at offset {idx}")
    print("Content near insertion point:")
    print(repr(content[idx:idx+800]))
    exit(1)

new_content = content.replace(marker, replacement, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)
print("OK - inserted EcoFlow battery")