# SLD Plan-Set Fix — Local Only (no git push, no deploy)

## Root Cause Diagnosis

The E-1 plan-set SLD does NOT match the Design Studio SLD because:

1. `sldSvg` state in `page.tsx` IS saved to `engineeringSeed` in the DB via `save-outputs`
2. BUT when a project is loaded, `sldSvg` is NEVER restored from the seed — it starts as `null`
3. When `handleGeneratePlanSet()` runs, `sldSvg` is `null` unless user clicked "Generate SLD" first
4. With `sldSvg = null`, the plan-set route falls back to `buildSldSvg()` — a simplified internal renderer
5. `buildSldSvg()` uses generic fallback values, NOT the accurate values from `renderSLDProfessional()`

## The Fix — Two-Part Systematic Solution

### Part 1: Restore sldSvg from seed on project load (page.tsx)
- When engineeringSeed is hydrated in page.tsx, also call setSldSvg(seed.sldSvg) if it exists
- This ensures sldSvg is populated before plan-set generation

### Part 2: Auto-fetch fresh SLD before plan-set if sldSvg is null (handleGeneratePlanSet)
- If sldSvg is null when plan-set is triggered, call fetchSLD() first and await the result
- Pass the fresh SVG directly to the plan-set payload
- Ensures E-1 always uses the accurate professional SLD, never the fallback

## Tasks

- [x] Read and understand full code flow
- [x] Part 1: Restore sldSvg from engineeringSeed on project load in page.tsx
- [x] Part 2: Refactored fetchSLD into fetchSLDSvg (returns SVG) + thin fetchSLD wrapper
- [x] Part 2: handleGeneratePlanSet auto-fetches SLD if sldSvg is null; uses activeSldSvg in payload
- [x] TypeScript check — zero errors
- [x] Done — local only, no push, no deploy