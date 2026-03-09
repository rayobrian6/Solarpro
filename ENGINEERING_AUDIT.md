# Engineering Automation System — Architecture Audit

## Data Pipeline Map

### 1. Design Engine (Single Source of Truth)
- **Component**: `components/3d/SolarEngine3D.tsx`
- **Outputs via `onPanelsChange(panels: PlacedPanel[])`**:
  - `panels[]` — array of PlacedPanel with lat/lng/tilt/azimuth/systemType/orientation
  - `panelCount` — total panels placed
  - `systemSizeKw` — calculated as panelCount × 0.4 kW
- **Roof segments**: `seg.azimuthDegrees`, `seg.pitchDegrees`, `seg.heightAboveGround`
- **Panel orientation**: `panelOrientationRef.current` (portrait/landscape)

### 2. Design Studio State (`components/design/DesignStudio.tsx`)
- `panels: PlacedPanel[]` — live panel array from SolarEngine3D
- `selectedPanel: SolarPanel` — chosen panel model (from equipment-db)
- `selectedInverter: Inverter | null` — chosen inverter model
- `fireSetbacks: FireSetbackConfig` — edge/ridge/pathway setbacks
- `tilt`, `azimuth` — roof orientation
- `systemSizeKw` — calculated from panels
- **Auto-saves to**: `POST /api/projects/[id]/layout` every 3 seconds

### 3. Layout API (`app/api/projects/[id]/layout/route.ts`)
- **Saves**: panels[], systemType, roofPlanes, groundTilt/Azimuth, rowSpacing, etc.
- **Also saves**: `project_versions` snapshot (via `saveProjectVersion()`)
- **DB tables**: `layouts`, `project_versions`

### 4. Project Type (`types/index.ts`)
```typescript
interface Project {
  id, userId, clientId, name, status, systemType
  address, lat, lng, stateCode, city, county, zip
  utilityName, utilityRatePerKwh
  systemSizeKw
  layout?: Layout          // panels, roofPlanes, systemType
  selectedPanel?: SolarPanel
  selectedInverter?: Inverter
  selectedMounting?: MountingSystem
  selectedBatteries?: Battery[]
  batteryCount?: number
}
```

### 5. Existing Engineering Page (`app/engineering/page.tsx`)
- **Standalone** — does NOT read from design engine
- User manually enters: panel count, inverter model, system size, etc.
- Calls: `POST /api/engineering/calculate` for electrical calcs
- Calls: `POST /api/engineering/sld` for SLD generation
- **Problem**: Completely disconnected from design engine

### 6. Engineering API Routes (existing)
- `POST /api/engineering/calculate` — electrical + structural calcs
- `POST /api/engineering/sld` — SLD generation
- `POST /api/engineering/bom` — Bill of Materials
- `POST /api/engineering/structural` — structural analysis
- `POST /api/engineering/permit` — permit package

## Key Findings

### What Needs to Be Built
1. **`engineering_reports` DB table** — stores generated reports linked to project+layout
2. **`/lib/engineering/` module** — derives all data from design engine
3. **`/api/engineering/generate` route** — triggers generation from project data
4. **`/api/engineering/[projectId]` route** — fetches latest report
5. **Engineering tab in project dashboard** — shows report, download button
6. **Auto-trigger on layout save** — when layout is saved, trigger engineering generation
7. **Design version tracking** — `design_version_id` in engineering_reports

### Data Flow (Target Architecture)
```
Design Engine (SolarEngine3D)
  ↓ onPanelsChange()
DesignStudio.tsx
  ↓ POST /api/projects/[id]/layout (auto-save every 3s)
layouts table + project_versions table
  ↓ TRIGGER: layout saved
POST /api/engineering/generate
  ↓ reads project + layout + selectedPanel + selectedInverter
Engineering Module (/lib/engineering/)
  ↓ generateEngineeringReport()
engineering_reports table
  ↓ GET /api/engineering/[projectId]
Engineering Tab (project dashboard)
```

### Panel Data Available for Engineering
From `PlacedPanel`:
- `lat`, `lng` — GPS coordinates
- `tilt` — degrees from horizontal
- `azimuth` — compass direction
- `systemType` — roof/ground/fence
- `orientation` — portrait/landscape
- `wattage` — panel wattage (from selectedPanel)
- `row`, `col` — grid position

From `Project`:
- `selectedPanel` — full panel specs (wattage, Voc, Vmp, Isc, Imp, etc.)
- `selectedInverter` — full inverter specs (type, capacity, mpptChannels, etc.)
- `selectedMounting` — mounting system specs
- `stateCode`, `utilityName` — for AHJ/jurisdiction lookup
- `address` — for wind/snow load lookup