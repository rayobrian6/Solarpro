# Task 4 Deliverables: Fix Generate Roof Geometry Vercel 504 Timeout

**Commit:** `39e8ec8` on branch `dev`
**Date:** 2025-06-02

---

## 1. Root Cause

The `POST /api/site-surveys/[surveyId]/geometry-reconstruction/start` route ran Pipeline B **inline** within the Vercel serverless function request lifecycle. With `maxDuration = 300` (Vercel Pro plan maximum), the full pipeline — SAM2 segmentation (~250s for 10 photos), line extraction, vanishing point estimation, depth estimation, plane extraction, and multi-view fusion — could exceed the 300-second hard timeout. When it did, Vercel killed the function and returned a **504 Gateway Timeout** with `Vercel Runtime Timeout Error: Task timed out after 300 seconds`. The client never received a response, and the job state was left in limbo.

The pipeline's own soft timeout (`PIPELINE_TIMEOUT_MS = 270_000`) attempted to skip remaining stages gracefully, but this was insufficient because: (a) SAM2 segmentation alone can take ~250s, leaving almost no budget for downstream stages + DB writes, and (b) even if the soft timeout triggered, the function still needed time to persist partial artifacts and return a response before the 300s hard limit.

## 2. Exact Route

`POST /api/site-surveys/[surveyId]/geometry-reconstruction/start` — this is the route the frontend calls when the user clicks "Generate Roof Geometry".

## 3. Files Changed

| File | Change |
|------|--------|
| `app/api/site-surveys/[surveyId]/geometry-reconstruction/start/route.ts` | Rewritten: creates job → returns 202 → uses `waitUntil(fetch('/execute'))` to trigger background execution. `maxDuration` reduced from 300 to 60. Mock pipeline still runs synchronously. |
| `app/api/site-surveys/[surveyId]/geometry-reconstruction/execute/route.ts` | Rewritten: marks job running → returns 200 immediately → uses `waitUntil()` for pipeline execution with full 300s timeout. Adds heartbeat protocol: initial stage='segmentation', periodic heartbeat timer every 30s, stage updated after pipeline completes. |
| `components/RoofGeometrySection.tsx` | Updated: 202/polling is the primary flow. Polls `GET /status` every 3s with 10-minute timeout. Shows real-time stage name and progress percentage. Handles completed, failed, and timeout states. 200 inline completion preserved for backward compat (mock pipeline). |
| `lib/db/geometryReconstruction.ts` | Added `updateJobHeartbeatInDb(jobId, currentStage)` — best-effort heartbeat update that sets `current_stage` and `last_heartbeat_at` without changing job status. Failures are logged, not thrown. |
| `package.json` | Added `@vercel/functions` dependency (provides `waitUntil()` for Node.js runtime) |
| `package-lock.json` | Lockfile updated for `@vercel/functions` |

## 4. Async Job Flow

### Before (synchronous — caused 504)

```
Client POST /start
  → /start runs Pipeline B inline (SAM2 + lines + depth + planes + fusion)
  → If pipeline > 300s: Vercel kills function → 504 (client gets nothing)
  → If pipeline < 300s: returns 200 with results
```

### After (async — never 504s)

```
Client POST /start
  → /start creates job row (status='queued')
  → /start uses waitUntil(fetch('/execute')) to trigger background
  → /start returns 202 immediately with { jobId, status: 'queued', pollUrl }
     (maxDuration=60, returns in <5 seconds)

POST /execute (triggered by /start's waitUntil)
  → /execute marks job as 'running', sets currentStage='segmentation'
  → /execute returns 200 immediately
     (this causes /start's waitUntil to resolve quickly)
  → /execute uses waitUntil() to run Pipeline B in background
     (maxDuration=300, full 5-minute timeout for pipeline)
  → Periodic heartbeat timer fires every 30s (prevents staleness)
  → On completion: persist artifacts, mark job 'completed'
  → On failure: mark job 'failed', partial artifacts preserved

Client polls GET /status?jobId=xxx (every 3s)
  → Reads DB only (<50ms response)
  → Returns { status, currentStage, progress, artifacts (when completed) }
  → Client shows stage name + progress percentage
  → Client handles completed / failed / timeout states
```

### Why `waitUntil()` instead of fire-and-forget?

The previous fire-and-forget pattern (return 202, then call `fetch('/execute')` without waiting) was unreliable on Vercel. After returning the response, the serverless function could freeze or terminate before the background fetch was even sent. Jobs would get stuck at `queued` forever.

`waitUntil()` from `@vercel/functions` guarantees that the given promise completes before the function is suspended. The key architectural insight is that `/execute` returns 200 quickly (after marking the job as running), so `/start`'s `waitUntil(fetch('/execute'))` resolves fast. The pipeline then runs in `/execute`'s own `waitUntil()` with the full 300s timeout.

## 5. Status/Polling Behavior

| Job Status | Client Behavior | User Sees |
|-----------|----------------|-----------|
| `queued` | Polling begins, waiting for execution to start | "Pipeline B queued — waiting for execution to start…" |
| `running` | Polling every 3s, shows `currentStage` and `progress` | "Pipeline B running — stage: segmentation (12%)…" |
| `completed` | Stops polling, loads artifacts, calls `fetchBundle()` | "Pipeline B completed with N artifacts, M segmentation masks, K roof lines" |
| `failed` | Stops polling, shows error message | "Pipeline B execution failed. Check the job for partial results." |
| Poll timeout (10 min) | Stops polling, shows timeout message | "Pipeline B did not complete within 10 minutes. The job may still be running — refresh the page to check." |

### Heartbeat staleness detection

- If a running job's `last_heartbeat_at` is >10 minutes old, `GET /status` includes a `warning` field
- The periodic heartbeat timer in `/execute` fires every 30s, preventing false staleness during long-running stages
- If `/execute` crashes or times out, the heartbeat goes stale, and the next `GET /status` call will include the staleness warning

### Progress mapping

The `computeProgress()` function maps `currentStage` to a 0-1 fraction:

| Stage | Progress |
|-------|----------|
| queued | 0.00 |
| segmentation | 0.12 |
| mask_cleanup | 0.25 |
| line_extraction | 0.37 |
| vanishing_point_estimation | 0.50 |
| plane_extraction | 0.62 |
| depth_estimation | 0.75 |
| multi_view_fusion | 0.87 |
| completed | 1.00 |

## 6. Confirmation: Render Workers Not Modified

The following files were NOT modified:
- `lib/siteSurveys/geometryReconstruction/workers/segmentation/*` (SAM2 client, segmentation worker)
- `lib/siteSurveys/geometryReconstruction/workers/lineExtraction/*` (line extraction worker)
- `lib/siteSurveys/geometryReconstruction/workers/depth/*` (depth worker)
- `lib/siteSurveys/geometryReconstruction/workers/planeExtraction/*` (plane extraction worker)
- `lib/siteSurveys/geometryReconstruction/workers/multiViewFusion/*` (fusion worker)
- `lib/siteSurveys/geometryReconstruction/workers/perspective/*` (vanishing points)
- `lib/siteSurveys/geometryReconstruction/workers/photogrammetry/*` (photogrammetry)
- `lib/siteSurveys/geometryReconstruction/runFullPipeline.ts` (pipeline orchestration)
- No CAD, permit, canonical model, or promotion logic was touched

Only Vercel-facing files were modified:
- API routes (`/start`, `/execute`)
- Frontend component (`RoofGeometrySection.tsx`)
- DB helper (`geometryReconstruction.ts` — added heartbeat function only)
- Package manifest (`@vercel/functions` dependency)

## 7. Rollback Plan

If the async conversion causes issues, rollback is straightforward:

```bash
git revert 39e8ec8
git push origin dev
```

This restores the synchronous inline execution in `/start`. The 504 will return for surveys that take >300s, but the flow will work for smaller surveys and mock pipelines.

### Partial rollback options

- **If only the heartbeat causes issues**: Remove the `startHeartbeatTimer()` and `updateJobHeartbeatInDb()` calls from `/execute`, leaving the async flow intact. The pipeline will still run async, but `currentStage` won't update during execution (reverts to showing just `running` with no stage detail).
- **If only the polling causes issues**: The frontend already handles 200 inline completion (backward compat for mock pipeline). If 202 handling is broken, temporarily revert `RoofGeometrySection.tsx` to treat 202 as an error and force mock-only operation.

### Environment variables

The async flow uses `INTERNAL_WORKER_AUTH_TOKEN` (defaults to `geometry-recon-worker-2025`) for internal auth between `/start` and `/execute`. If this token needs to be changed, set the env var on Vercel. No other new environment variables are required.

### Monitoring after deploy

After deploying to Vercel, monitor:
1. `/start` should return 202 in <5 seconds (never 504)
2. `/execute` should be triggered within seconds of job creation
3. `GET /status` should show `currentStage` advancing through pipeline stages
4. If jobs get stuck at `queued`, check Vercel logs for `/execute` call failures
5. If jobs get stuck at `running`, check heartbeat staleness warnings in `/status` responses
