# BUILD v21 — Equipment Ecosystem Audit & Expansion

## Phase 1: Audit & Gap Analysis
- [x] Read current equipment-db.ts state (all sections)
- [x] Identify brand ecosystem gaps

## Phase 2: Equipment-db.ts Additions
- [ ] Add Enphase ATS entry (IQ System Controller 3 acts as ATS — missing from ATS_UNITS)
- [ ] Add new STRING_INVERTERS: SolarEdge SE3800H, SE6000H, SE11400H; SMA SB5.0, SB10.0; Fronius Primo 5.0, 10.0; Sungrow SG5RS, SG7.6RS, SG15RS; GoodWe GW5000-NS, GW10K-MS
- [ ] Add new MICROINVERTERS: Enphase IQ8A, IQ8AC; APsystems EZ1-M; Hoymiles HMS-800W-2T
- [ ] Add new OPTIMIZERS: SolarEdge P320, P730, P850; Tigo TS4-A-2O (dual-module)
- [ ] Add new BATTERIES: Enphase IQ Battery 3T; Tesla Powerwall 2; Generac PWRcell 17; Panasonic EverVolt 11.4; Sonnen Eco 10
- [ ] Add new GENERATORS: Generac Guardian 26kW, 18kW; Kohler 14RESAL; Cummins RS20A
- [ ] Add new ATS_UNITS: Enphase IQ System Controller 3 ATS mode; Generac RXSW100A3; Kohler RXT-100; Briggs & Stratton 200A ATS; Eaton CHT200
- [ ] Add new BACKUP_INTERFACES: SolarEdge Home Hub SE10000H; Generac PWRcell Inverter 7.6kW; Enphase IQ Combiner 5

## Phase 3: SLD Integration
- [ ] Audit current SLD rendering for battery/generator/ATS nodes
- [ ] Add battery node rendering to SLD engine
- [ ] Add generator + ATS node rendering to SLD engine

## Phase 4: UI "New" Badge
- [ ] Add isNew flag to new equipment entries
- [ ] Render "NEW" badge in equipment selectors in engineering UI

## Phase 5: TypeScript Validation & Build
- [ ] Run tsc --noEmit, fix all errors
- [ ] Commit as BUILD v21, push, package ZIP