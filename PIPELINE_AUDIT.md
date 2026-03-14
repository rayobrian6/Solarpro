# SolarPro Permit Planset Pipeline Audit — v47.46

## Pipeline Architecture
```
3D Design Engine (SolarEngine3D.tsx)
  → DesignStudio.tsx (orchestrates, auto-saves)
    → POST /api/projects/[id]/layout
      → lib/db-neon.ts (upsertLayout)
        → DB: layouts table (panels JSONB, roof_planes JSONB) ✅ roofPlanes now saved
  → app/engineering/page.tsx (permit button, payload construction)
    → POST /api/engineering/permit
      → generatePermitHTML() → 13-page HTML
        → wkhtmltopdf → PDF download
```

## Audit Findings & Fixes (v47.46)

### ✅ FIXED: roofPlanes not saved to DB
- **Before**: DesignStudio.tsx saved only `panels` to DB; `roofPlanes` lived only in component state
- **After**: Added `roofPlanesRef` pattern; both regular save and sendBeacon include roofPlanes

### ✅ ADDED: Spec Sheet Database (lib/equipment/specSheets.ts)
- Module specs: REC, LG, SunPower, Jinko, LONGi, Q CELLS, Canadian Solar, Silfab
- Inverter specs: Enphase IQ8, SolarEdge HD-Wave, Fronius Symo, SMA Sunny Boy
- Battery specs: Tesla Powerwall, Enphase IQ Battery, Franklin WH
- Racking specs: IronRidge XR100/XR1000, Unirac SolarMount, QuickMount PV

### ✅ ADDED: 13-Page Planset (was 11)
New pages added:
- **PV-2B** — Array Geometry & String Layout (SVG panel grid, string color-coding, IFC §605.11 setbacks)
- **APP-A** — Equipment Specification Reference (NEC 690.8 calcs, module/inverter/racking specs)

Updated pages:
- **PV-1** — Site Information: replaced placeholder with full SVG schematic site plan
- **PV-0** — Cover Sheet: index updated to list all 13 sheets

## Sheet Index (v47.46)
| Sheet | ID    | Title                                      |
|-------|-------|--------------------------------------------|
| 1     | PV-0  | Cover Sheet, System Summary & Construction Notes |
| 2     | PV-1  | Site Information & Interconnection Details |
| 3     | PV-2A | Aerial Roof Plan with Fire Setbacks        |
| 4     | PV-2B | Array Geometry & String Layout             |
| 5     | PV-3  | Attachment Detail & Bill of Materials      |
| 6     | PV-4A | NEC Compliance Sheet                       |
| 7     | PV-4B | Conductor & Conduit Schedule               |
| 8     | PV-4C | Structural Calculation Sheet (ASCE 7-22)   |
| 9     | PV-5  | Warning Labels & Required Placards         |
| 10    | SCHED | Equipment Schedule                         |
| 11    | APP-A | Equipment Specification Reference          |
| 12    | CERT  | Engineer Certification Block               |
| 13    | E-1   | Single-Line Electrical Diagram (SLD)       |

## Test Results (v47.46)
- **TypeScript**: 0 errors (`tsc --noEmit`)
- **Build**: All routes compile (`npm run build`)
- **Live test**: HTTP 200, 1.58 MB HTML, all 13 pages (1 of 13 … 13 of 13) ✅
- **Sheet IDs**: PV-0 PV-1 PV-2 PV-2B PV-3 PV-4A PV-4B PV-4C PV-5 SCHED APP-A CERT E-1 ✅
- **Deployed**: GitHub master `ae9913c` → Vercel auto-deploy triggered ✅

## Data Flow Verification
| Stage | Status | Notes |
|-------|--------|-------|
| 3D Engine → panels state | ✅ | PlacedPanel[] via onPanelsChange |
| 3D Engine → roofPlanes state | ✅ | RoofPlane[] via onRoofPlanesChange |
| roofPlanes → DB | ✅ FIXED | roofPlanesRef pattern in DesignStudio |
| panels → DB | ✅ | Always worked |
| DB → engineering page | ✅ | GET /api/projects/[id]/layout |
| engineering page → permit API | ✅ | Full payload with roofPlanes, panels |
| permit API → 13-page HTML | ✅ | generatePermitHTML() |
| HTML → PDF | ✅ | wkhtmltopdf |