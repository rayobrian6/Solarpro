# Session 5 — SolarPro Permit Pipeline Error Hunt

## Completed
- [x] Commit and push session 4 changes (42f149f8)

## Investigation Areas — Findings & Fixes

### Error 5a: `(cad as any).arrayWidthFt` in structuralPages.ts — field doesn't exist on CADModel
- [ ] Fix: use `cad.ground?.arrays?.[0]?.dimensions?.arrayWidthM * 3.28084` instead

### Error 5b: `(strings[0] as any)?.ocpd` in sldAdapter.ts — `ocpd` IS on the type already
- [ ] Fix: use `strings[0]?.ocpd` (field already declared as `ocpd?: number`)

### Error 5c: `(inv0 as any)?.mpptChannels` in sldAdapter.ts — missing from inverter type
- [ ] Fix: add `mpptChannels?: number` to inverter type in `PermitInput.system.inverters`

### Error 5d: `compliance.electrical?: any` / `compliance.structural?: any` — typed as `any`
- Too broad to fix in one shot (many sub-fields). Keep as-is but fix specific `as any` casts:
- [ ] Fix `(compliance as any)?.electrical?.acConductorCallout` → `compliance.electrical?.acConductorCallout` (2 occurrences)
- [ ] Fix `(compliance as any)?.electrical?.dcConductorCallout` → `compliance.electrical?.dcConductorCallout` (1 occurrence)
- [ ] Fix `(compliance as any).structural?.seismic?.sdc` → `compliance.structural?.seismic?.sdc` (2 occurrences)
- [ ] Fix `compliance.electrical as any` in bomForPermit.ts → remove `as any`

### Error 5e: Unnecessary `as any` on `canonical` write-path in generatePermit.ts
- `canonical.electrical.totalPanels` and `totalDcKw` ARE on CanonicalElectrical type
- `canonical.site.windSpeed` IS on CanonicalSite type
- `canonical.structure.*` fields ARE on CanonicalStructure type
- `canonical.layoutDimensions` IS on CanonicalInput type
- [ ] Fix: remove `as any` from all canonical.* mutations in generatePermit.ts (lines 107-120, 157, 160, 167)

### Error 5f: `(snap.panel as any).weight` in reportGenerator.ts — weight IS on SolarPanel type
- [ ] Fix: use `snap.panel.weight` (already `weight?: number` on SolarPanel)

### Error 5g: `(panel as any).voc/.vmp/.isc/.imp` in reportGenerator.ts — NOT on SolarPanel type
- These are electrical spec fields used for engineering calculations
- [ ] Fix: add `voc?: number; vmp?: number; isc?: number; imp?: number` to SolarPanel type

### Error 5h: `(inverter as any)?.maxDcVoltage/.mpptVoltageMax` in reportGenerator.ts — NOT on Inverter type
- [ ] Fix: add `maxDcVoltage?: number; mpptVoltageMax?: number` to Inverter type

### Error 5i: Unnecessary `as any` in engineering — `designSnapshot.ts`
- `(project.selectedPanel || DEFAULT_PANEL as any)` — type mismatch between selectedPanel and DEFAULT_PANEL
- [ ] Investigate and fix if possible

### Error 5j: `(project as any).address/.clientId/.clientName` in syncPipeline.ts
- `address` and `clientId` ARE on Project type
- `clientName` should use `project.client?.name`
- [ ] Fix the two unnecessary casts and the one field name fix

### Remaining write-path `as any` in generatePermit.ts (lower priority)
- [ ] `(input.layout as any).systemType` — layout type may not have systemType as writable
- [ ] `(cad.roof as any).planes` / `(cad.ground as any).arrays` / `(cad.fence as any).segments` — mutating CADModel arrays
- [ ] `delete (cad as any).roof/.ground/.fence` — deleting keys from CADModel
- [ ] `(input.compliance as any).structural = s` — setting nested field on `any`-typed compliance
- [ ] `(documentProvenance as any).engineeringStateRegistry/.invalidationLineage` — external lib type
