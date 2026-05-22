# Topography Map Style Correction

## Diagnose
- [x] Inspect screenshot and confirm desired surface/style.
- [x] Locate any in-repo source for the existing node-and-connector Topography map; none found beyond external TOPO_URL iframe.
- [x] Inspect current /admin/topography wiring after the previous correction.

## Correct Implementation
- [x] Restore the preferred node-and-connector map as the primary map style.
- [x] Add missing audited SolarPro pipelines to that map: intake, bill intelligence, lead ops, marketplace, contractor, portal, core project/CRM, survey, 3D/maps, engineering/docs, equipment/pricing/utility, health/logging, external services.
- [x] Preserve existing pipeline/detail, partner, surveys, and integration panel behavior.

## Validation + Git
- [x] Run TypeScript/lint/build validation.
- [ ] Commit directly on dev and push dev.
- [ ] Report correction and any limitations.
