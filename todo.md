# Pipeline B SAM 2 Upgrade — Execution Plan

## Phase 1: Deliver Recommendation
- [x] Review current segmentation worker and roofGeometryExtractor code
- [x] Present SAM 2 upgrade recommendation to user for confirmation

## Phase 2: SAM 2 Microservice (Python)
- [ ] Create Python SAM 2 service with FastAPI (auto mask generation endpoint)
- [ ] Dockerfile for GPU deployment on Render
- [ ] Health check + model loading on startup
- [ ] Mask → polygon post-processing (contour extraction from binary mask)
- [ ] Test endpoint with sample images

## Phase 3: Integration Layer (TypeScript)
- [ ] Create SAM2 segmentation client in TS (calls Python service)
- [ ] Update runSegmentationWorker.ts to use SAM2 client when available, fall back to Canny
- [ ] Update worker version and limitations
- [ ] Add SAM2 worker config (service URL, timeout, checkpoint preference)

## Phase 4: API Route + Frontend
- [ ] Wire SAM2 config into geometry reconstruction API route
- [ ] Update RoofGeometrySection UI to show SAM2 status when active
- [ ] Add SAM2 confidence badge vs Canny confidence badge

## Phase 5: Testing + Deploy
- [ ] Unit tests for SAM2 client
- [ ] Integration test with mock SAM2 service
- [ ] Three-check suite (tsc, eslint, vitest)
- [ ] Push to dev
