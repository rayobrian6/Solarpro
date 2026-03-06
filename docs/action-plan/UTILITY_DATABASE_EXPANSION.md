# Utility Database Expansion Plan
**Priority:** P2 — Feature Enhancement  
**Estimated Effort:** 3–5 days

---

## Current State

The application currently has 8 utility JSON files:
- `ameren.json` (IL, MO)
- `comed.json` (IL)
- `default.json` (fallback)
- `duke.json`
- `fpl.json` (FL)
- `pge.json` (CA)
- `pseg.json` (NJ)
- `sce.json` (CA)

**Gap:** No Illinois Co-Op utilities, no rural electric cooperatives, limited national coverage.

---

## Illinois Electric Cooperatives to Add

Based on research, the following Illinois Co-Ops need to be added:

| Co-Op Name | Service Territory | Notes |
|-----------|------------------|-------|
| Southwestern Electric Cooperative (SWEC) | SW Illinois | $50 app fee ≤10kW, NM at avoided cost |
| Tri-County Electric Cooperative | Central IL | Has solar program |
| Corn Belt Energy | Central IL | |
| Eastern Illini Electric Cooperative | NE Illinois | |
| Coles-Moultrie Electric Cooperative | E Central IL | |
| Egyptian Electric Cooperative | S Illinois | |
| Menard Electric Cooperative | Central IL | |
| Monroe County Electric Cooperative | SW Illinois | |
| Norris Electric Cooperative | SE Illinois | |
| Prairie Power | Central IL | Wholesale supplier |
| Shelby Electric Cooperative | Central IL | |
| Spoon River Electric Cooperative | W Central IL | |
| Western Illinois Electrical Cooperative | W Illinois | |

---

## API Integration Plan

### 1. EIA Open Data API (Primary Source)
**URL:** `https://api.eia.gov/v2/electricity/`  
**API Key Required:** Yes (free at https://www.eia.gov/opendata/)

```typescript
// Utility lookup by state
const EIA_BASE = 'https://api.eia.gov/v2/electricity/state-electricity-profiles';
const response = await fetch(
  `${EIA_BASE}/source-disposition?api_key=${EIA_KEY}&facets[stateid][]=${stateCode}&frequency=annual&data[]=generation`
);
```

**Available Data:**
- Utility names and IDs
- Service territory by state
- Generation capacity
- Customer counts

**Limitations:** Does not include interconnection rules or net metering policies.

### 2. OpenEI Utility Rate Database API (Secondary Source)
**URL:** `https://developer.nrel.gov/api/utility_rates/v3.json`  
**API Key Required:** Yes (free at https://developer.nrel.gov/)

```typescript
// Look up utility by zip code
const OPENEI_BASE = 'https://developer.nrel.gov/api/utility_rates/v3.json';
const response = await fetch(
  `${OPENEI_BASE}?api_key=${NREL_KEY}&address=${zipCode}&radius=0&detail=full`
);
// Returns: utility name, rate schedules, EIA utility ID
```

**Available Data:**
- Utility name and EIA ID
- Rate schedules (residential, commercial, TOU)
- Net metering availability
- Zip code to utility mapping

**Best Use:** Zip code → utility lookup for auto-detection.

### 3. FERC EQRDATA (Tertiary — Large Utilities)
**URL:** `https://www.ferc.gov/industries-data/electric/general-information/electric-industry-forms/form-no-1-annual-report`  
**API Key Required:** No (public data)

**Best Use:** Large IOU (Investor-Owned Utility) data verification.

---

## Recommended Implementation

### Phase 1: Static JSON Files (Week 1)
Add Illinois Co-Op JSON files manually with researched data:

```json
// data/utilities/swec-il.json
{
  "id": "swec-il",
  "name": "Southwestern Electric Cooperative",
  "states": ["IL"],
  "type": "cooperative",
  "eiaId": "17609",
  "preferredInterconnection": "LOAD_SIDE",
  "maxLoadSideBreaker": 40,
  "maxSystemSizeKw": 10,
  "applicationFeeBase": 50,
  "applicationFeePerKw": 1,
  "applicationFeeThresholdKw": 10,
  "allowsMainBreakerDerate": false,
  "allowsLineSideTap": false,
  "requiresVisibleDisconnect": true,
  "requiresProductionMeter": true,
  "requiresAntiIslanding": true,
  "netMeteringAvailable": true,
  "netMeteringProgram": "Net Metering at Avoided Cost",
  "netMeteringMaxKw": 10,
  "interconnectionApplicationRequired": true,
  "interconnectionApplicationUrl": "https://www.nm-prc.org/wp-content/uploads/2021/06/NMInterconnectionManual2008.pdf",
  "ieee1547Compliant": true,
  "ul1741Compliant": true,
  "ruleReferences": [
    { "rule": "NMPRC Rule 17.9.568", "description": "Net metering interconnection rules", "requirement": "Must comply with NM PRC interconnection standards" },
    { "rule": "NEC Article 445.18", "description": "Generator interconnection", "requirement": "Battery/generator systems must comply" }
  ],
  "disconnectRequirements": {
    "acDisconnect": true,
    "acDisconnectVisible": true,
    "acDisconnectLockable": true,
    "utilityAccessible": true,
    "notes": "SWEC requires utility-accessible disconnect at service entrance"
  },
  "labelingRequirements": [
    "NEC 705.10 — Identification of power sources",
    "NEC 690.54 — Equipment identification"
  ],
  "notes": "SWEC serves SW Illinois. Application fee: $50 for ≤10kW, $50 + $1/kW above 10kW. Excess energy credited at SWEC Avoided Cost Rate."
}
```

### Phase 2: API Integration (Week 2–3)
Create `lib/utility-lookup.ts`:

```typescript
export async function lookupUtilityByZip(zipCode: string): Promise<UtilityInfo | null> {
  // 1. Try OpenEI first (has zip→utility mapping)
  const nrelKey = process.env.NREL_API_KEY;
  if (nrelKey) {
    const res = await fetch(
      `https://developer.nrel.gov/api/utility_rates/v3.json?api_key=${nrelKey}&address=${zipCode}&radius=0`
    );
    const data = await res.json();
    if (data.outputs?.utility_name) {
      return matchUtilityByName(data.outputs.utility_name);
    }
  }
  // 2. Fall back to state-based lookup
  return null;
}
```

### Phase 3: National Expansion (Week 4+)
Priority states to add next:
1. Texas (ERCOT) — Oncor, AEP Texas, CenterPoint
2. Arizona — APS, SRP, TEP
3. Colorado — Xcel Energy, Black Hills
4. New York — ConEd, NYSEG, National Grid
5. Massachusetts — Eversource, National Grid
6. New Jersey — JCP&L, Atlantic City Electric

---

## Database Schema Update

Add to utility JSON schema:
```typescript
interface UtilityRecord {
  id: string;
  name: string;
  type: 'iou' | 'cooperative' | 'municipal' | 'pud';  // NEW
  eiaId?: string;                                        // NEW — EIA utility ID
  states: string[];
  serviceZipCodes?: string[];                            // NEW — for precise lookup
  applicationFeeBase?: number;                           // NEW
  applicationFeePerKw?: number;                          // NEW
  applicationFeeThresholdKw?: number;                    // NEW
  // ... existing fields
}
```