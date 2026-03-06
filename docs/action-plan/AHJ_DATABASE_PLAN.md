# AHJ (Authority Having Jurisdiction) Database Plan
**Priority:** P2 — Feature Enhancement  
**Estimated Effort:** 4–6 days

---

## Overview

An AHJ database enables the application to auto-populate permit requirements, inspection procedures, and local amendments based on the project location. This is critical for permit package generation.

---

## What AHJ Data Is Needed

For each AHJ (city, county, or state building department), we need:

```typescript
interface AHJRecord {
  id: string;
  name: string;                          // "City of Chicago Building Dept"
  type: 'city' | 'county' | 'state';
  state: string;                         // "IL"
  county?: string;                       // "Cook"
  city?: string;                         // "Chicago"
  zipCodes?: string[];                   // Service zip codes
  
  // NEC Version
  necVersion: '2017' | '2020' | '2023';
  localAmendments?: string[];            // Local code amendments
  
  // Permit Requirements
  permitRequired: boolean;
  permitFeeStructure?: string;           // "Flat $150" or "$2/watt"
  planReviewRequired: boolean;
  planReviewTurnaround?: string;         // "10 business days"
  inspectionRequired: boolean;
  inspectionTypes?: string[];            // ["rough", "final", "utility"]
  
  // Solar-Specific
  requiresStructuralCalcs: boolean;
  requiresElectricalCalcs: boolean;
  requiresEnergyStorage: boolean;        // Battery permit separate?
  requiresFireMarshalApproval: boolean;
  requiresUtilityApproval: boolean;
  
  // Rapid Shutdown
  rsdRequired: boolean;
  rsdNecReference: string;              // "NEC 690.12 (2020)"
  
  // Contact
  phone?: string;
  email?: string;
  website?: string;
  portalUrl?: string;                   // Online permit portal
  
  // Metadata
  lastVerified: string;                 // ISO date
  source: string;                       // Data source
}
```

---

## Public API Sources for AHJ Data

### 1. ICC (International Code Council) — iccsafe.org
**URL:** `https://www.iccsafe.org/`  
**API:** No public API — manual research required  
**Data Available:** NEC adoption by jurisdiction, local amendments  
**Access:** ICC membership or manual lookup

### 2. Solar ABCs / IREC Permit Database
**URL:** `https://irecusa.org/`  
**Data Available:** Permit requirements by jurisdiction  
**Access:** Some data publicly available

### 3. SolarAPP+ (DOE-funded)
**URL:** `https://solarapp.nrel.gov/`  
**API:** Yes — REST API for automated permit approval  
**Key Feature:** Instant permit approval for qualifying systems  
**Integration Value:** HIGH — can auto-submit permits for qualifying jobs

```typescript
// SolarAPP+ API integration
const SOLARAPP_BASE = 'https://api.solarapp.nrel.gov/v1';

export async function checkSolarAppEligibility(
  address: string,
  systemKw: number
): Promise<SolarAppResult> {
  const res = await fetch(`${SOLARAPP_BASE}/eligibility`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.SOLARAPP_KEY}` },
    body: JSON.stringify({ address, system_size_kw: systemKw })
  });
  return res.json();
}
```

### 4. OpenAddresses / Census TIGER
**URL:** `https://openaddresses.io/`  
**Data Available:** Address → jurisdiction mapping  
**Access:** Free, open data

### 5. DSIRE (Database of State Incentives for Renewables & Efficiency)
**URL:** `https://www.dsireusa.org/`  
**API:** Yes (limited)  
**Data Available:** State/local incentives, interconnection rules  
**Best Use:** Incentive lookup by state

---

## Implementation Plan

### Phase 1: Static AHJ Data (Priority States)

Start with the most common states for solar installations:

**Illinois AHJs to add first:**
- City of Chicago (Cook County)
- City of Naperville
- City of Aurora
- City of Rockford
- City of Springfield
- Cook County (unincorporated)
- DuPage County
- Lake County
- Will County

**California AHJs (high volume):**
- Los Angeles County
- City of Los Angeles
- San Diego County
- Orange County
- Sacramento County

**Florida AHJs:**
- Miami-Dade County
- Broward County
- Palm Beach County
- Hillsborough County

### Phase 2: SolarAPP+ Integration

SolarAPP+ is a DOE-funded platform that provides instant permit approval for residential solar systems meeting specific criteria. Integration would allow:

1. Auto-check if project qualifies for instant permit
2. Submit permit application directly from the app
3. Receive instant approval for qualifying systems

**Qualifying Criteria (typical):**
- Residential rooftop solar
- System ≤ 10 kW AC
- Standard roof types (comp shingle, standing seam metal)
- No battery storage (or separate battery permit)
- Standard interconnection (load-side tap)

### Phase 3: Geocoding Integration

Use existing geocoding infrastructure to auto-detect AHJ:

```typescript
// In lib/jurisdiction.ts — enhance existing function
export async function detectAHJ(lat: number, lng: number): Promise<AHJRecord | null> {
  // 1. Reverse geocode to get city/county/state
  const geo = await reverseGeocode(lat, lng);
  
  // 2. Look up AHJ by city first, then county, then state
  return findAHJ(geo.city, geo.county, geo.state);
}
```

---

## Data Files Structure

```
data/
  ahj/
    IL/
      cook-county.json
      chicago.json
      naperville.json
    CA/
      los-angeles-county.json
      san-diego-county.json
    FL/
      miami-dade.json
    default.json    ← fallback for unknown AHJs
```

---

## Sample AHJ Record

```json
{
  "id": "il-chicago",
  "name": "City of Chicago Department of Buildings",
  "type": "city",
  "state": "IL",
  "county": "Cook",
  "city": "Chicago",
  "necVersion": "2020",
  "localAmendments": [
    "Chicago Electrical Code — local amendments to NEC 2020",
    "Chicago Building Code Title 14E"
  ],
  "permitRequired": true,
  "permitFeeStructure": "Based on project valuation — see Chicago fee schedule",
  "planReviewRequired": true,
  "planReviewTurnaround": "10-15 business days (standard), 5 days (expedited)",
  "inspectionRequired": true,
  "inspectionTypes": ["rough-in", "final", "utility-witness"],
  "requiresStructuralCalcs": true,
  "requiresElectricalCalcs": true,
  "requiresEnergyStorage": false,
  "requiresFireMarshalApproval": false,
  "requiresUtilityApproval": true,
  "rsdRequired": true,
  "rsdNecReference": "NEC 690.12 (2020)",
  "phone": "312-744-5000",
  "website": "https://www.chicago.gov/city/en/depts/bldgs.html",
  "portalUrl": "https://permits.chicago.gov/",
  "lastVerified": "2024-01-15",
  "source": "Chicago DOB website"
}
```