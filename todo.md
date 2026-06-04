# SolarPro — Pass 3C: Geometry Fidelity & Roof Penetrations

## Pass 3A/3A.1/3B — ✅ ALL DEPLOYED

## Pass 3C: Geometry Fidelity & Roof Penetrations

### Python (sam2-service/main.py) — ✅ DONE
- [x] Roof penetration classes (chimney, vent_pipe, skylight) added to classifier
- [x] `mask_to_polygon_v2()` with contour-aware corner snapping added
- [x] `MIN_MASK_AREA_FRACTION` lowered from 0.005 to 0.002
- [x] `DOUGLAS_PEUCKER_EPSILON` lowered from 0.7 to 0.5
- [x] `MAX_POLYGON_EDGE_LENGTH` lowered from 35 to 25
- [x] Both `mask_to_polygon()` call sites updated to `mask_to_polygon_v2()`

### TypeScript Updates — ✅ DONE
- [x] Add chimney, vent_pipe, skylight to SegmentationClass in types.ts
- [x] Add chimney, vent_pipe, skylight to validation in schemas.ts
- [x] Add chimney, vent_pipe, skylight to sam2Client.ts class maps
- [x] Add chimney, vent_pipe to STRUCTURE_QUALIFIED_CLASSES in runLineExtractionWorker.ts

### Wall Foundation Line Detection — ✅ DONE
- [x] Add occluder-aware wall boundary inference to line extraction worker

### Deploy — NOT STARTED
- [ ] Commit and push Pass 3C to dev branch
- [ ] Deploy SAM2 service on Render
- [ ] Deploy geometry worker on Render
- [ ] Update Render env vars (DOUGLAS_PEUCKER_EPSILON=0.5, MAX_POLYGON_EDGE_LENGTH=25, MIN_MASK_AREA_FRACTION=0.002)
- [ ] Verify results
