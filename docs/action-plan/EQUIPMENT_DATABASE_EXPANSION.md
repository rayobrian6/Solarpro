# Equipment Manufacturer Database Expansion Plan
**Priority:** P2 — Feature Enhancement  
**Estimated Effort:** 5–7 days

---

## Current Equipment Coverage

The application currently covers:
- **String Inverters:** Fronius, SMA, Sungrow, SolarEdge
- **Microinverters:** Enphase (IQ7, IQ8 series), APsystems (DS3 series), Hoymiles
- **Optimizers:** SolarEdge P-series, Tigo
- **Racking:** IronRidge, Unirac, EcoFasten
- **Monitoring:** Enphase IQ Gateway, SolarEdge Monitoring

**Missing:** Batteries, Generators, ATS, Backup UIs, many inverter brands

---

## Battery Storage Manufacturers

### Tier 1 — Add Immediately

| Manufacturer | Model | Capacity | Chemistry | Notes |
|-------------|-------|----------|-----------|-------|
| Tesla | Powerwall 3 | 13.5 kWh | LFP | 11.5 kW continuous, integrated inverter |
| Tesla | Powerwall 2 | 13.5 kWh | NMC | 5 kW continuous |
| Enphase | IQ Battery 5P | 5 kWh | LFP | Stackable, AC-coupled |
| Enphase | IQ Battery 10T | 10.08 kWh | LFP | 3-phase capable |
| Generac | PWRcell M3 | 9 kWh | NMC | 3 modules × 3 kWh |
| Generac | PWRcell M6 | 18 kWh | NMC | 6 modules × 3 kWh |
| SolarEdge | Home Battery 48V | 9.7 kWh | LFP | DC-coupled |
| LG Energy | RESU10H Prime | 9.6 kWh | NMC | 5 kW continuous |
| Sonnen | Eco 10 | 10 kWh | LFP | German engineering |
| Sonnen | Eco 20 | 20 kWh | LFP | Whole-home backup |
| Franklin Electric | aPower 2.0 | 13.6 kWh | LFP | 5 kW continuous |
| Panasonic | EverVolt H Series | 11.4 kWh | LFP | |
| BYD | Battery-Box Premium HVS | 5.1–12.8 kWh | LFP | Scalable |
| Sungrow | SBR096 | 9.6 kWh | LFP | |
| Sungrow | SBR128 | 12.8 kWh | LFP | |

### Tier 2 — Add in Phase 2

| Manufacturer | Model | Notes |
|-------------|-------|-------|
| Electriq Power | PowerPod 2 | |
| Pika Energy | Harbor Smart Battery | |
| SimpliPhi | PHI 3.8 | LFP, no BMS required |
| Fortress Power | eVault Max | LFP |
| Emphase | IQ Battery 3T | 3.36 kWh |
| Duracell Energy | PowerCenter | |

---

## Microinverter Manufacturers to Add

| Manufacturer | Models | Max AC Output | Notes |
|-------------|--------|--------------|-------|
| Enphase | IQ8A, IQ8H, IQ8X | 366W, 384W, 384W | Already in DB — verify specs |
| APsystems | DS3, DS3-S, DS3-L | 730W, 730W, 880W | Already in DB |
| Hoymiles | HM-600, HM-800, HM-1500 | 600W, 800W, 1500W | Already in DB |
| **Chilicon Power** | CP-720E | 720W | Add |
| **APS** | YC600, QS1 | 600W, 1200W | Add |
| **Darfon** | G320 | 320W | Add |
| **Altenergy** | APS-QS1 | 1200W | Add |
| **Siemens** | — | — | Future |
| **SolarBridge** | Pantheon II | 250W | Legacy |
| **Enecsys** | SMI-360W | 360W | Legacy |

---

## Optimizer Manufacturers to Add

| Manufacturer | Models | Notes |
|-------------|--------|-------|
| SolarEdge | P370, P401, P505, P600, P700, P800p | Already in DB |
| Tigo | TS4-A-O, TS4-A-2O | Already in DB |
| **Huawei** | SUN2000 Smart PV Optimizer | Add |
| **Fronius** | SnapINverter optimizers | Add |
| **SMA** | ShadeFix (software-based) | Note: no hardware optimizer |
| **Maxim Integrated** | Module-level electronics | Add |
| **Ampt** | String Optimizer | Add — utility scale |

---

## String Inverter Manufacturers to Add

| Manufacturer | Models | kW Range | Notes |
|-------------|--------|----------|-------|
| Fronius | Primo, Symo, Galvo | 3–27.6 kW | Already in DB |
| SMA | Sunny Boy, Sunny Tripower | 3–25 kW | Already in DB |
| Sungrow | SG5RS, SG10RS, SG15RS | 5–25 kW | Already in DB |
| SolarEdge | SE3000H–SE11400H | 3–11.4 kW | Already in DB |
| **Growatt** | MIN 3000TL-X, MOD 5000TL3-X | 3–50 kW | Add |
| **Huawei** | SUN2000-5KTL, SUN2000-10KTL | 5–100 kW | Add |
| **Goodwe** | GW5000-NS, GW10K-ET | 5–30 kW | Add |
| **Solax** | X1-Boost, X3-Hybrid | 3–15 kW | Add |
| **Deye** | SUN-5K-SG03LP1, SUN-12K-SG04LP3 | 5–12 kW | Add |
| **Chint** | CPS SCH5KTL-DO/US | 5–10 kW | Add |
| **Delta** | RPI M6A, RPI M8A | 6–8 kW | Add |
| **ABB/FIMER** | PVI-3.0-TL-OUTD | 3–10 kW | Add |
| **Schneider Electric** | XW Pro, SW | 2.8–6.8 kW | Add — hybrid |
| **OutBack Power** | FXR, VFXR | 2.5–3.5 kW | Add — off-grid/hybrid |
| **Magnum Energy** | MS4024, MS4448 | 4–4.4 kW | Add — off-grid |

---

## Generator Manufacturers

| Manufacturer | Models | kW Range | Fuel | Notes |
|-------------|--------|----------|------|-------|
| Generac | 7kW–22kW Air-Cooled | 7–22 kW | NG/LP | Most common residential |
| Generac | 22kW–150kW Liquid-Cooled | 22–150 kW | NG/LP/Diesel | Commercial |
| Kohler | 14RESAL, 20RESAL | 14–20 kW | NG/LP | |
| Kohler | 38RCLB, 48RCLB | 38–48 kW | NG/LP | |
| Briggs & Stratton | 10000–20000W | 10–20 kW | NG/LP | |
| Cummins | RS13A, RS20A | 13–20 kW | NG/LP | |
| Champion | 100174, 100177 | 8.5–12.5 kW | NG/LP | |
| Honeywell | HG10000EXKL | 10 kW | NG/LP | Rebranded Generac |
| Winco | PSS12HTO | 12 kW | NG/LP | |

---

## Automatic Transfer Switches (ATS)

| Manufacturer | Model | Amps | Notes |
|-------------|-------|------|-------|
| Generac | RTSC200A3 | 200A | Smart Management Module |
| Generac | RTSW200A3 | 200A | Whole-house |
| Kohler | RXT-JFTC-0200A | 200A | |
| Eaton | CHSPT2ULTRA | 200A | Surge protection included |
| Square D | QO2200TRNM | 200A | |
| Siemens | TF260 | 200A | |
| Reliance Controls | 310CRK | 30A | Manual transfer |
| Briggs & Stratton | 71036 | 200A | |

---

## Backup User Interfaces / Energy Management Systems

| Manufacturer | Product | Compatible With | Notes |
|-------------|---------|----------------|-------|
| Enphase | IQ System Controller 2 | Enphase IQ8 + IQ Battery | Whole-home backup |
| Tesla | Powerwall Gateway 2 | Tesla Powerwall | Backup gateway |
| Generac | PWRmanager | PWRcell | Load management |
| SolarEdge | Energy Hub | SE Home Battery | |
| Sonnen | sonnenConnect | Sonnen Eco | |
| Schneider Electric | XW Pro | XW Pro inverter | |
| OutBack Power | MATE3s | OutBack FX/VFX | |
| Victron Energy | Cerbo GX | Victron MultiPlus | |
| SMA | Sunny Home Manager 2.0 | SMA inverters | |

---

## Equipment Registry Schema Updates

Add new categories to `lib/equipment-registry.ts`:

```typescript
// New categories to add to EquipmentCategory type
type EquipmentCategory = 
  | 'string_inverter'
  | 'microinverter'
  | 'optimizer'
  | 'solar_panel'
  | 'racking'
  | 'battery'           // ← expand with new entries
  | 'gateway'
  | 'combiner'
  | 'disconnect'
  | 'generator'         // ← NEW
  | 'ats'               // ← NEW (Automatic Transfer Switch)
  | 'backup_interface'  // ← NEW (Energy management UI)
  | 'ev_charger'        // ← NEW (future)
  | 'load_controller';  // ← NEW (smart load management)

// New battery spec fields
interface BatterySpec {
  capacityKwh: number;
  continuousPowerKw: number;
  peakPowerKw: number;
  roundTripEfficiency: number;   // e.g., 0.90
  chemistry: 'LFP' | 'NMC' | 'NCA' | 'Lead-Acid';
  voltage: number;               // nominal DC voltage
  couplingType: 'AC' | 'DC' | 'AC/DC';
  warrantyYears: number;
  warrantyThroughput?: number;   // kWh lifetime throughput
  ul9540Certified: boolean;
  ul1973Certified: boolean;
}

// New generator spec fields
interface GeneratorSpec {
  ratedKw: number;
  standbyKw: number;
  fuelType: 'NG' | 'LP' | 'Diesel' | 'Gasoline';
  transferSwitchRequired: boolean;
  necArticle: '445' | '702';    // NEC 445 (generators) or 702 (optional standby)
  automaticStart: boolean;
  exerciseCycle?: string;       // "weekly"
}
```

---

## Implementation Priority

1. **Week 1:** Add Tesla Powerwall 3, Enphase IQ Battery 5P/10T, Generac PWRcell (most common)
2. **Week 2:** Add all Tier 1 batteries, top generator brands
3. **Week 3:** Add ATS, backup interfaces, expand microinverter list
4. **Week 4:** Add Tier 2 batteries, additional string inverters