# Equipment DB Ecosystem Audit — v47.397

**Goal**: Expand Tesla / Enphase / APsystems / Hoymiles / Generac / SolarEdge into complete ecosystem-aware brands without breaking the active pipeline.

---

## 1. Current Architecture Map

### Two-layer equipment system

**Layer A — `lib/equipment-db.ts` (1,979 lines)** — Physical hardware rows, canonical source for UI/BOM/Engineering.
- Flat, denormalized, spec-rich rows
- Consumed directly by `app/engineering/page.tsx`, `app/api/equipment/route.ts`, `lib/permit/*`, `lib/bom-engine*`
- Read via `getXById()` helpers — contract is stable, must not break

**Layer B — `lib/system/brandProfiles/*.ts`** — Brand-level system architecture.
- Defines topology, supported models, battery support, BOS families, compatibility
- Points into equipment-db via `equipmentDbId`
- Consumed by `sizingEngine.ts`, `bestFitEngine.ts`, `feasibilityEvaluator.ts`

**Layer C — `lib/equipment-registry-v4.ts`** — Rich registry for engineering accessories, structural/electrical specs, compatibility.

### Current schema interfaces (equipment-db.ts)

| Interface | Category | Key Fields |
|---|---|---|
| `SolarPanel` | `solar_panel` | watts, voc, vmp, isc, imp, tempCoeffs, bifacial, cellType |
| `StringInverter` | `string_inverter` | acOutputKw, dcInputKwMax, mppt*, acOutputCurrentMax, rapidShutdownCompliant |
| `Microinverter` | `microinverter` | acOutputW, dcInputWMax, modulesPerDevice, maxPerBranch20A/30A |
| `Optimizer` | `optimizer` | dcInputWMax, maxInputCurrent, compatibleInverters |
| `RackingSystem` | `racking` | foundationType, upliftCapacityLbs, iccEsReport, seamProfiles |
| `BatterySystem` | `battery` | usableCapacityKwh, peakPowerKw, chemistry, requiresGateway, gatewayModel, gridFormingCapable, wholeHomeBackup |
| `GeneratorSystem` | `generator` | ratedOutputKw, fuelType, neutralBonded, outputBreakerA |
| `ATSUnit` | `ats` | ampRating, serviceEntranceRated, neutralSwitched |
| `BackupInterface` | `backup_interface` | maxBackupOutputKw, gridFormingCapable, compatibleBatteries[], generatorCompatible |

---

## 2. Current Inventory Per Target Brand

### Tesla (9 models)
- **Batteries**: Powerwall 2, Powerwall 3
- **Backup Interface**: Backup Gateway 2
- **Missing**: Solar panels, Solar Roof, Wall Connector (EV), Powerwall+ (integrated inverter variant)

### Enphase (7 models)
- **Microinverters**: IQ8+, IQ8M, IQ8H, IQ8A, IQ8AC
- **Batteries**: IQ Battery 3T, IQ Battery 5P, IQ Battery 10T
- **Backup Interface**: IQ System Controller 3, IQ System Controller 3 ATS, IQ Combiner 5
- **Missing**: IQ Gateway (Envoy monitoring), IQ EV Charger, IQ Meter Collar

### APsystems (4 models)
- **Microinverters**: DS3-S, DS3-L, DS3, EZ1-M
- **Missing**: ECU-R / ECU-C (gateway/monitoring), Rapid shutdown transmitter

### Hoymiles (2 models)
- **Microinverters**: HM-800, HMS-800W-2T
- **Missing**: DTU-Pro (data transmission unit / gateway)

### Generac (8 models)
- **Generators**: Guardian 18/22/24/26 kW
- **Batteries**: PWRcell 9 kWh, PWRcell 17 kWh
- **Backup Interface**: PWRmanager, PWRcell Inverter 7.6kW
- **ATS**: RXSW200A3, RTSW200A3, RXSW100A3

### SolarEdge (10 models)
- **String Inverters**: SE3800H-US, SE6000H-US, SE7600H-US, SE10000H-US, SE11400H-US
- **Optimizers**: P320, P401, P505, P730, P850
- **Batteries**: Home Battery 10 kWh
- **Backup Interface**: Home Hub SE7600H-US, Home Hub SE10000H-US

---

## 3. Safe Extension Strategy (Additive Only)

### 3.1 New optional fields on ALL equipment interfaces
Added to every existing interface as optional `?` fields:
- `ecosystemBrand?: string` — canonical brand slug
- `ecosystemFamily?: string` — product family within brand
- `compatibleWith?: string[]` — equipment-db IDs this item pairs with
- `active?: boolean` — default true; false = legacy/deprecated

### 3.2 New interfaces (additive, not consumed by BOM yet)
- `MonitoringGateway` (`monitoring_gateway`) — Envoy, ECU-R, DTU-Pro, SolarEdge gateway
- `EVCharger` (`ev_charger`) — Tesla Wall Connector, Enphase IQ EV Charger

### 3.3 Solar Roof — DEFERRED
Tesla Solar Roof requires architectural work in `placementEngine.ts` and `roofCAD.ts` (geometric engine assumes discrete rectangular modules). Added to TODO, not in this pass.

---

## 4. Implementation Phases

- **Phase A** — Schema extension (this commit) ✅
- **Phase B** — Tesla ecosystem expansion
- **Phase C** — Enphase ecosystem expansion
- **Phase D** — APsystems ecosystem expansion
- **Phase E** — Hoymiles ecosystem expansion
- **Phase F** — Generac cleanup
- **Phase G** — SolarEdge cleanup

---

## 5. Validation

1. TypeScript clean after every phase
2. No existing IDs / category strings / interface field names changed
3. Only additive schema changes
4. API route returns expected shape unchanged
5. Engineering page selectors work unchanged
6. BOM continues to function (existing rows unchanged)