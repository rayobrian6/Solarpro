# SolarPro Site Survey Objective — Permanent Build Context

## Core Mission

SolarPro is not just a proposal tool. SolarPro is an end-to-end solar workflow platform built to move a project from customer intake → design → engineering → permit plan set → install readiness.

The site survey app exists because SolarPro's engineering engine cannot rely on assumptions.

A customer bill, website intake form, satellite imagery, and basic design can start the process, but they are not enough to create the most accurate CAD model, electrical design, BOM, and permit plan set possible.

The site survey is the bridge between the sales/intake workflow and true engineering.

## Why Site Survey Exists

Someone in the office can handle onboarding:
- customer info
- utility bill upload
- usage/rate data
- initial project profile
- rough system sizing
- basic website-driven design

But before engineering can create a truly accurate CAD representation and permit-ready plan set, SolarPro needs real field data from the property.

The site survey captures the ground truth:
- roof material
- roof pitch
- rafter/structure details
- roof condition
- obstructions
- service panel details
- meter details
- interconnection conditions
- breaker availability
- service entrance type
- photos of all critical field conditions
- notes from the person physically on site

Without this, SolarPro is guessing.

With this, SolarPro can engineer from reality.

## Correct Workflow

The website should initiate the process.

1. A customer/project profile exists in SolarPro.
2. Someone clicks **Start Site Survey** from the project.
3. SolarPro pre-fills every known field:
   - customer name
   - address
   - project name
   - GPS/location
   - system type
   - utility/bill data if available
   - any known design assumptions
4. The site survey tech opens the survey page on site.
5. The tech captures the missing physical-property data.
6. The survey submits back into SolarPro.
7. SolarPro uses that field data to drive:
   - CAD layout
   - electrical engineering
   - BOM
   - permit plan set
   - final stamped engineering package

## North Star

The goal is not simply to "collect a form."

The goal is to create the most accurate field-data pipeline possible so SolarPro can generate the most sophisticated, accurate, permit-ready CAD and plan set output possible.

The site survey app is one of the most important data sources in the platform.

## Build Rules

Before touching survey-related code, remember:

- Do not treat the survey as a standalone form.
- Do not build dead fields that engineering will not use.
- Do not break the connection between project data and survey data.
- Do not make the user re-enter information SolarPro already knows.
- Do not let submitted survey data sit unused.
- Every captured field should have a downstream purpose.

## Product Principle

Website intake starts the project.

Site survey confirms reality.

Engineering turns that reality into CAD, electrical design, BOM, and permit plans.

That is why the survey app exists.

## Data Flow Architecture

```
SolarPro Project
    │
    ├── Pre-fills JWT token with known project data
    │     (name, address, GPS, system type, utility data)
    │
    ▼
/survey/[token]  ←── Field tech on site
    │
    ├── Step 1: Site Overview    (pre-filled from project)
    ├── Step 2: Roof Conditions  (captured on site)
    ├── Step 3: Electrical       (captured on site)
    ├── Step 4: Obstructions     (captured on site)
    ├── Step 5: Photos           (captured on site)
    └── Step 6: Review + Submit
    │
    ▼
POST /api/survey/submit
    │
    ▼
Ingest Pipeline → Project row updated with field data
    │
    ▼
Engineering Engine
    ├── CAD layout (roof material, pitch, obstructions, usable area)
    ├── Electrical SLD (panel brand, rating, slots, interconnection)
    ├── BOM (actual equipment at site)
    └── Permit plan set (all real field conditions)
```

## Field → Engineering Mapping (Every field has a downstream purpose)

| Survey Field | Engineering Use |
|---|---|
| roofMaterial | Mounting system selection, structural calcs |
| roofPitch | Array layout, production modeling, structural loads |
| rafterSpacing | Structural attachment calculations |
| roofCondition | Engineering notes, permit risk flags |
| roofAgeYears | Permit notes, re-roof recommendation flag |
| atticAccess | Wire routing in SLD |
| panelBrand | NEC compliance check, breaker compatibility |
| panelRating | System size limit, backfeed breaker sizing |
| availableBreakerSlots | Load-side vs supply-side interconnection decision |
| meterSocketType | Meter-main vs separate meter + panel design |
| interconnectionPoint | SLD interconnection diagram |
| serviceEntrance | SLD riser diagram, wire routing |
| hasSubPanel | Sub-panel addition to SLD if needed |
| obstructions | CAD exclusion zones, usable roof area |
| estimatedUsableRoofPct | Array sizing constraint |
| photos (panel open/closed) | Engineering verification, permit documentation |
| photos (roof overview) | CAD reference, permit documentation |
| photos (meter) | SLD meter detail, permit documentation |
| photos (service entrance) | SLD riser detail |
| GPS coordinates | Shading analysis, jurisdiction lookup, AHJ routing |