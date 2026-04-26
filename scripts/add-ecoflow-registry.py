#!/usr/bin/env python3
"""Insert EcoFlow entries into equipment-registry-v4.ts"""

path = 'lib/equipment-registry-v4.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# Insertion point: just before the closing `];` of INVERTERS_AND_BATTERIES array
marker = "    ulListing: 'UL 1741 SA',\n    warranty: '12-year standard',\n  },\n];"

ecoflow_block = """    ulListing: 'UL 1741 SA',
    warranty: '12-year standard',
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ECOFLOW POWEROCEAN — Hybrid inverter + LFP battery system (v47.358)
  // Source: lib/ecoflow-system.ts (single source of truth for EcoFlow catalog)
  // Default baseline for SolFence projects.
  // ═══════════════════════════════════════════════════════════════════════
  {
    id: 'ecoflow-power-ocean-5kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean 5kW Hybrid',
    partNumber: 'EF-PO-5K-HV',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 7.5, maxDcVoltage: 600,
      mpptVoltageMin: 80, mpptVoltageMax: 550,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 97.5, mpptChannels: 2,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      { category: 'smart_meter', description: 'EcoFlow Smart Meter (CT-based)', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Smart Meter', defaultPartNumber: 'EF-SMART-METER', necReference: 'NEC 705.12' },
      { category: 'monitoring', description: 'EcoFlow Monitoring Gateway', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Monitoring Gateway', defaultPartNumber: 'EF-MON-GW' },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 25, max: 30 } },
    notesTemplates: ['EcoFlow PowerOcean 5kW \u2014 LFP-compatible hybrid, 2 MPPT, for \u22646 kW DC arrays'],
    ulListing: 'UL 1741-SA',
    warranty: '10-year standard',
  },
  {
    id: 'ecoflow-power-ocean-10kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean 10kW Hybrid',
    partNumber: 'EF-PO-10K-HV',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 10.0, dcInputKwMax: 15.0, maxDcVoltage: 600,
      mpptVoltageMin: 120, mpptVoltageMax: 600,
      acOutputVoltage: 240, acOutputCurrentMax: 41.7,
      efficiency: 97.8, mpptChannels: 3,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      { category: 'smart_meter', description: 'EcoFlow Smart Meter (CT-based)', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Smart Meter', defaultPartNumber: 'EF-SMART-METER', necReference: 'NEC 705.12' },
      { category: 'monitoring', description: 'EcoFlow Monitoring Gateway', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Monitoring Gateway', defaultPartNumber: 'EF-MON-GW' },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 50, max: 60 } },
    notesTemplates: ['EcoFlow PowerOcean 10kW \u2014 LFP-compatible hybrid, 3 MPPT, for 6\u201312 kW DC arrays'],
    ulListing: 'UL 1741-SA',
    warranty: '10-year standard',
  },
  {
    id: 'ecoflow-power-ocean-20kw',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean Pro 20kW Hybrid',
    partNumber: 'EF-PO-20K-HV-PRO',
    category: 'string_inverter',
    topologyType: 'HYBRID_INVERTER',
    electricalSpecs: {
      acOutputKw: 20.0, dcInputKwMax: 30.0, maxDcVoltage: 1000,
      mpptVoltageMin: 120, mpptVoltageMax: 1000,
      acOutputVoltage: 240, acOutputCurrentMax: 83.3,
      efficiency: 98.0, mpptChannels: 4,
      rapidShutdownCompliant: true, arcFaultProtection: true,
    },
    requiredAccessories: [
      { category: 'smart_meter', description: 'EcoFlow Smart Meter (CT-based)', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Smart Meter', defaultPartNumber: 'EF-SMART-METER', necReference: 'NEC 705.12' },
      { category: 'monitoring', description: 'EcoFlow Monitoring Gateway', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Monitoring Gateway', defaultPartNumber: 'EF-MON-GW' },
    ],
    compatibilityRules: [],
    defaultOCPDRanges: { dcStringOCPD: { min: 15, max: 20 }, acOutputOCPD: { min: 100, max: 125 } },
    notesTemplates: ['EcoFlow PowerOcean Pro 20kW \u2014 LFP-compatible hybrid, 4 MPPT, for >12 kW DC arrays'],
    ulListing: 'UL 1741-SA',
    warranty: '10-year standard',
  },

  // EcoFlow LFP battery module \u2014 stackable 5 kWh
  {
    id: 'ecoflow-battery-5kwh',
    manufacturer: 'EcoFlow',
    model: 'PowerOcean LFP Battery Module (5kWh)',
    partNumber: 'EF-BATT-5K-LFP',
    category: 'battery',
    topologyType: 'AC_COUPLED_BATTERY',
    electricalSpecs: {
      acOutputKw: 5.0, dcInputKwMax: 5.0, maxDcVoltage: 51.2,
      acOutputVoltage: 240, acOutputCurrentMax: 20.8,
      efficiency: 98.0,
    },
    requiredAccessories: [
      { category: 'battery_base', description: 'PowerOcean Battery Base / Stack Frame', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Battery Base', defaultPartNumber: 'EF-BATT-BASE' },
      { category: 'battery_combiner', description: 'PowerOcean Battery Combiner Box', required: true, quantityRule: 'perSystem',
        defaultManufacturer: 'EcoFlow', defaultModel: 'PowerOcean Battery Combiner', defaultPartNumber: 'EF-BATT-COMB' },
    ],
    compatibilityRules: [],
    notesTemplates: ['EcoFlow PowerOcean LFP 5 kWh \u2014 stackable module, 15-yr warranty, max 9 modules (45 kWh std)'],
    ulListing: 'UL 9540A, UL 1973',
    warranty: '15-year standard',
  },
];"""

if marker not in content:
    print("ERROR: insertion marker not found!")
    # Try alternate marker
    alt = content[-400:]
    print("Last 400 chars of file for debugging:")
    print(repr(alt))
    exit(1)

new_content = content.replace(marker, ecoflow_block, 1)
with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)
print(f"OK - inserted EcoFlow block ({len(ecoflow_block)} chars)")