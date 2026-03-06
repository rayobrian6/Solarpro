# SolarPro Platform — Master Action Plan
**Version:** 1.0  
**Date:** March 2026  
**Prepared for:** SolarPro Engineering Team

---

## Executive Summary

This document outlines a structured action plan for four improvement areas in the SolarPro solar/electrical design application:

1. **P1 Bug Fix** — Load-side tap interconnection shows incorrect "backfed breaker" error
2. **P2 Feature** — Utility database expansion (Illinois Co-Ops + national coverage)
3. **P2 Feature** — AHJ database enhancement
4. **P2 Feature** — Equipment manufacturer database expansion
5. **P2 UI** — Application badging update for next release

---

## Priority 1: Bug Fix — Load-Side Tap Error

### Status: ✅ FIXED in BUILD v19.2

### Problem
When selecting "Load-Side Tap" as the interconnection method, the Electrical Sizing tab displays an error message using the term "backfed breaker" — which is incorrect for load-side tap. Additionally, the NEC 705.12(B) 120% rule was being applied to supply-side tap connections, which is incorrect (supply-side tap is governed by NEC 705.11, which has no 120% busbar restriction).

### Root Cause
In `lib/computed-system.ts`, the interconnection compliance check at lines 1044–1057 ran unconditionally before the interconnection method was resolved, always using the generic "backfed" label regardless of the selected method.

### Fix Applied
```typescript
// BEFORE (incorrect):
const interconnectionPass = (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);
if (!interconnectionPass) {
  message: `Interconnection: ${backfeedBreakerAmps}A backfeed + ...`  // always says "backfeed"
}

// AFTER (correct):
const _isSupplySideTap = _interconMethodRaw.includes('SUPPLY') || _interconMethodRaw.includes('LINE_SIDE');
const interconnectionPass = _isSupplySideTap
  ? true  // NEC 705.11: no busbar loading concern
  : (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);
if (!interconnectionPass) {
  const _interconLabel = _interconMethodRaw.includes('BACKFED') ? 'backfed breaker' : 'load-side breaker';
  message: `Interconnection: ${backfeedBreakerAmps}A ${_interconLabel} + ...`  // correct label
}
```

### NEC Compliance
| Method | NEC Reference | 120% Rule |
|--------|--------------|-----------|
| Load-Side Tap | NEC 705.12(B) | ✅ Applies |
| Supply-Side Tap | NEC 705.11 | ❌ Does NOT apply |
| Main Breaker Derate | NEC 705.12(B) | ✅ Applies |
| Backfed Breaker | NEC 705.12(B) | ✅ Applies |

---

## Priority 2: Utility Database Expansion

### Timeline: 3–5 weeks

### Phase 1 — Illinois Co-Ops (Week 1)
Add JSON files for all Illinois electric cooperatives:

| Co-Op | EIA ID | Service Area |
|-------|--------|-------------|
| Southwestern Electric Cooperative | 17609 | SW Illinois |
| Tri-County Electric Cooperative | — | Central IL |
| Corn Belt Energy | — | Central IL |
| Eastern Illini Electric Cooperative | — | NE Illinois |
| Coles-Moultrie Electric Cooperative | — | E Central IL |
| Egyptian Electric Cooperative | — | S Illinois |
| Menard Electric Cooperative | — | Central IL |
| Monroe County Electric Cooperative | — | SW Illinois |
| Norris Electric Cooperative | — | SE Illinois |
| Shelby Electric Cooperative | — | Central IL |
| Spoon River Electric Cooperative | — | W Central IL |
| Western Illinois Electrical Cooperative | — | W Illinois |

### Phase 2 — API Integration (Weeks 2–3)

**Recommended APIs (in priority order):**

1. **OpenEI / NREL Utility Rates API** ⭐ HIGHEST VALUE
   - URL: `https://developer.nrel.gov/api/utility_rates/v3.json`
   - Free API key at developer.nrel.gov
   - Provides: zip code → utility name + EIA ID + rate schedules
   - Use case: Auto-detect utility from project address

2. **EIA Open Data API** ⭐ GOOD FOR BULK DATA
   - URL: `https://api.eia.gov/v2/electricity/`
   - Free API key at eia.gov/opendata
   - Provides: All US utilities, generation data, customer counts
   - Use case: Bulk utility list, verify EIA IDs

3. **FERC EQRDATA** — Large IOUs only, no API
4. **NERC** — Grid reliability data, not utility-specific

### Phase 3 — National Expansion (Weeks 4+)
Priority states: TX, AZ, CO, NY, MA, NJ, GA, NC, VA, WA

---

## Priority 2: AHJ Database Enhancement

### Timeline: 4–6 weeks

### Phase 1 — Illinois AHJs (Week 1–2)
- City of Chicago
- Cook County (unincorporated)
- DuPage County
- Lake County
- Will County
- Top 20 Illinois cities by solar permit volume

### Phase 2 — SolarAPP+ Integration (Weeks 3–4)
SolarAPP+ (DOE-funded) provides instant permit approval for qualifying residential systems. Integration enables:
- Auto-check permit eligibility
- Direct permit submission
- Instant approval for qualifying jobs

**API:** `https://api.solarapp.nrel.gov/v1`  
**Cost:** Free for qualifying jurisdictions  
**Value:** Eliminates permit wait time for ~40% of residential jobs

### Phase 3 — National AHJ Coverage (Weeks 5–6)
Priority: CA, FL, TX, AZ, CO, NY, NJ, MA

---

## Priority 2: Equipment Database Expansion

### Timeline: 5–7 weeks

### Immediate Additions (Week 1)
**Batteries — Most Common:**
- Tesla Powerwall 3 (13.5 kWh, 11.5 kW, LFP, integrated inverter)
- Tesla Powerwall 2 (13.5 kWh, 5 kW, NMC)
- Enphase IQ Battery 5P (5 kWh, LFP)
- Enphase IQ Battery 10T (10.08 kWh, LFP)
- Generac PWRcell M3/M6 (9/18 kWh, NMC)
- SolarEdge Home Battery (9.7 kWh, LFP)
- LG RESU10H Prime (9.6 kWh, NMC)
- Sonnen Eco 10/20 (10/20 kWh, LFP)

**Generators — Most Common:**
- Generac 7kW–22kW air-cooled (NG/LP)
- Kohler 14–20 kW (NG/LP)
- Cummins RS13A/RS20A (NG/LP)

**ATS — Most Common:**
- Generac RTSC200A3 (200A)
- Kohler RXT-JFTC-0200A (200A)
- Square D QO2200TRNM (200A)

### Phase 2 (Weeks 2–3)
- Additional battery brands (Franklin, Panasonic, BYD, Sungrow)
- Backup interfaces (Enphase IQ System Controller 2, Tesla Gateway 2)
- Additional microinverter brands (Chilicon, APS QS1)
- Additional string inverters (Growatt, Huawei, Goodwe)

### Phase 3 (Weeks 4–7)
- Complete optimizer coverage
- EV charger integration (future)
- Smart load controllers

---

## Priority 2: UI Badging Update

### Current Version Badge
The application currently shows BUILD v19 / v19.1 / v19.2 in various places.

### Recommended Update
Update version badge to **BUILD v20** for the next major release that includes:
- Bug fixes (v19.1, v19.2)
- Utility database expansion
- AHJ database
- Equipment database expansion

### Files to Update
```
app/engineering/page.tsx    — version badge display
package.json                — version field
```

### Badge Update Code
```typescript
// In app/engineering/page.tsx, find version badge:
const APP_VERSION = 'BUILD v20';
const APP_BUILD_DATE = new Date().toISOString().split('T')[0];
```

---

## Recommended Development Timeline

| Week | Tasks |
|------|-------|
| **Week 1** | ✅ Bug fix deployed (v19.2), Illinois Co-Op JSON files, Top battery brands |
| **Week 2** | OpenEI API integration, Illinois AHJ data, Generator/ATS database |
| **Week 3** | EIA API integration, SolarAPP+ feasibility study, Backup interface DB |
| **Week 4** | National utility expansion (TX, AZ, CO), AHJ Phase 2 |
| **Week 5** | Equipment Phase 2 (additional brands), UI badging update |
| **Week 6** | Testing, QA, BUILD v20 release |

---

## API Keys Required

| Service | URL | Cost | Priority |
|---------|-----|------|----------|
| NREL/OpenEI | developer.nrel.gov | Free | HIGH |
| EIA Open Data | eia.gov/opendata | Free | HIGH |
| SolarAPP+ | solarapp.nrel.gov | Free | MEDIUM |
| DSIRE | dsireusa.org | Free (limited) | LOW |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| API rate limits | Medium | Low | Cache responses, use static fallback |
| Co-Op data accuracy | High | Medium | Mark data as "estimated" until verified |
| AHJ data staleness | High | Medium | Add "last verified" date, flag old records |
| Equipment spec changes | Medium | Low | Version equipment records |
| SolarAPP+ jurisdiction coverage | High | Low | Only show for supported jurisdictions |

---

## Appendix: File Structure

```
data/
  utilities/
    ameren.json          ← existing
    comed.json           ← existing
    swec-il.json         ← NEW
    corn-belt-energy.json ← NEW
    [12 more IL co-ops]  ← NEW
    oncor-tx.json        ← Phase 3
    ...
  ahj/
    IL/
      chicago.json       ← NEW
      cook-county.json   ← NEW
      ...
    CA/
      los-angeles.json   ← Phase 3
      ...
lib/
  utility-lookup.ts      ← NEW (API integration)
  ahj-lookup.ts          ← NEW (AHJ lookup)
  equipment-registry.ts  ← EXPAND (batteries, generators, ATS)
```