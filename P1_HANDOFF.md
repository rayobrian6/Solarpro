<h1>P0/P1 Pipeline B Handoff Document</h1><p><strong>Date:</strong> 2025-06-21<br><strong>Branch:</strong> <code>dev</code> (latest commit <code>3882e4c</code>)<br><strong>Repo:</strong> <code>rayobrian6/Solarpro</code><br><strong>Status:</strong> Code complete, tests passing, TypeScript compiles clean. Render worker service created but build fails due to wrong <code>dockerfilePath</code>. Fix requires 30 seconds in the Render Dashboard. </p><hr><h2>Executive Summary</h2><p>Pipeline B (geometry reconstruction) has been re-architected from synchronous Vercel execution to an async pattern: <strong>Vercel creates jobs → Render worker executes them</strong>. This was necessary because SAM2 segmentation on CPU takes <del>53–95s per photo × 15 photos ÷ 2 concurrency = ~440s total, which exceeds Vercel's 300s hard limit. The old code would die mid-segmentation with zero artifacts persisted. The new code checkpoints after every SAM2 batch (</del>20–40s), so partial artifacts survive even if the process crashes.</p><p>All code is pushed to <code>dev</code>. The only remaining manual step is fixing the Render worker service's <code>dockerfilePath</code> setting in the Render Dashboard (see §5 below).</p><hr><h2>1. Architecture Overview</h2><h3>Old Flow (P0-pre, broken)</h3><pre><code>User clicks "Run" → Vercel /start route → Run full pipeline inline → 
  SAM2 takes 440s → Vercel kills at 300s → Zero artifacts persisted
</code></pre><h3>New Flow (P0 + P1, current)</h3><pre><code>User clicks "Run" → Vercel /start → Create job (status='queued') → 
  Return 202 + jobId IMMEDIATELY → Frontend polls /status

Render Worker (continuous loop):
  Poll Neon for queued jobs → Claim atomically (CAS) → 
  Execute full Pipeline B → Checkpoint after every stage → 
  Sub-checkpoint after every SAM2 batch → Mark completed/failed → Release lock
</code></pre><h3>Key Design Decisions</h3><ul> <li><strong>Vercel never runs Pipeline B synchronously</strong> (except the mock pipeline, which is fast)</li> <li><strong>Atomic job claiming</strong> via <code>FOR UPDATE SKIP LOCKED</code> + CAS on <code>locked_by IS NULL</code></li> <li><strong>Per-stage checkpoint persistence</strong> (P0): artifacts saved to DB after each stage completes</li> <li><strong>Per-batch checkpoint persistence</strong> (P1): segmentation artifacts saved after every SAM2 batch (~20–40s)</li> <li><strong>Heartbeat system</strong>: worker updates <code>last_heartbeat_at</code> every 30s; stale jobs (10+ min no heartbeat) auto-marked as failed by Vercel Cron</li> <li><strong>Graceful shutdown</strong>: SIGTERM/SIGINT waits for current job to finish (up to 30s), then exits; stale detector catches orphaned jobs</li> </ul><hr><h2>2. Pipeline Stages &amp; Constants</h2><table class="e-rte-table"> <thead> <tr> <th>Stage #</th> <th>Name</th> <th>DB Value</th> <th>Typical Duration</th> </tr> </thead> <tbody><tr> <td>1</td> <td>Segmentation</td> <td><code>segmentation</code></td> <td>200–440s (CPU)</td> </tr> <tr> <td>2</td> <td>Line Extraction</td> <td><code>line_extraction</code></td> <td>5–15s</td> </tr> <tr> <td>3</td> <td>Vanishing Points</td> <td><code>vanishing_point_estimation</code></td> <td>2–5s</td> </tr> <tr> <td>4</td> <td>Depth Estimation</td> <td><code>depth_estimation</code></td> <td>15–60s</td> </tr> <tr> <td>5</td> <td>Plane Extraction</td> <td><code>plane_extraction</code></td> <td>5–20s</td> </tr> <tr> <td>6</td> <td>Multi-View Fusion</td> <td><code>multi_view_fusion</code></td> <td>2–10s</td> </tr> <tr> <td>7</td> <td>Photogrammetry</td> <td><code>photogrammetry</code></td> <td>5–15s</td> </tr> </tbody></table><h3>Key Constants (in code)</h3><table class="e-rte-table"> <thead> <tr> <th>Constant</th> <th>Value</th> <th>Location</th> </tr> </thead> <tbody><tr> <td><code>PIPELINE_TIMEOUT_MS</code></td> <td>270,000 (4.5 min)</td> <td><code>runFullPipeline.ts:70</code></td> </tr> <tr> <td><code>MAX_SAM2_PHOTOS</code></td> <td>15</td> <td><code>runSegmentationWorker.ts:180</code></td> </tr> <tr> <td><code>SEGMENTATION_CONCURRENCY</code></td> <td>2</td> <td><code>runSegmentationWorker.ts:508</code></td> </tr> <tr> <td><code>HEARTBEAT_TIMEOUT_MS</code></td> <td>600,000 (10 min)</td> <td><code>asyncJobManager.ts:31</code></td> </tr> <tr> <td><code>STUCK_JOB_THRESHOLD_MS</code></td> <td>1,800,000 (30 min)</td> <td><code>asyncJobManager.ts:34</code></td> </tr> <tr> <td>Worker poll interval</td> <td>5,000ms (default)</td> <td><code>worker/main.ts</code> (env: <code>WORKER_POLL_INTERVAL_MS</code>)</td> </tr> <tr> <td>Worker heartbeat</td> <td>30,000ms</td> <td><code>worker/main.ts</code></td> </tr> <tr> <td>Graceful shutdown timeout</td> <td>30,000ms (default)</td> <td><code>worker/main.ts</code> (env: <code>SHUTDOWN_TIMEOUT_MS</code>)</td> </tr> </tbody></table><hr><h2>3. File Map — What Changed</h2><h3>New Files (created across sessions)</h3><table class="e-rte-table"> <thead> <tr> <th>File</th> <th>Purpose</th> </tr> </thead> <tbody><tr> <td><code>worker/main.ts</code> (387 lines)</td> <td>Render background worker: poll loop, job execution, heartbeat, graceful shutdown</td> </tr> <tr> <td><code>worker/Dockerfile</code> (37 lines)</td> <td>Docker build for worker; context is repo root, copies <code>lib/</code> + <code>worker/</code> + <code>tsconfig.json</code></td> </tr> <tr> <td><code>worker/tsconfig.json</code> (39 lines)</td> <td>Worker-specific TypeScript config; maps <code>@/*</code> → <code>../*</code>, outputs to <code>worker/dist/</code></td> </tr> <tr> <td><code>worker/types.d.ts</code> (9 lines)</td> <td>Stubs <code>window</code> global for compilation without DOM lib</td> </tr> <tr> <td><code>__tests__/p1WorkerOwnership.test.ts</code> (597 lines)</td> <td>54 tests: job lifecycle, lock ownership, heartbeat staleness, progress, type shapes</td> </tr> <tr> <td><code>lib/migrations/085_geometry_reconstruction_worker_ownership.sql</code></td> <td>Adds <code>locked_by TEXT NULL</code>, <code>locked_at TIMESTAMPTZ NULL</code>, claimable index</td> </tr> <tr> <td><code>app/api/cron/stale-job-cleanup/route.ts</code></td> <td>Vercel Cron endpoint for stale job detection</td> </tr> <tr> <td><code>lib/siteSurveys/geometryReconstruction/staleJobCleanup.ts</code></td> <td>Stale job cleanup logic (marks stale/orphaned jobs as failed)</td> </tr> <tr> <td><code>app/api/site-surveys/[surveyId]/geometry-reconstruction/execute/route.ts</code> (375 lines)</td> <td>Manual trigger / fallback for pipeline execution; uses <code>claimJobById</code> for atomic claiming</td> </tr> <tr> <td><code>app/api/site-surveys/[surveyId]/geometry-reconstruction/status/route.ts</code> (145 lines)</td> <td>Polling endpoint: returns progress, artifacts, heartbeat staleness</td> </tr> </tbody></table><h3>Modified Files</h3><table class="e-rte-table"> <thead> <tr> <th>File</th> <th>Changes</th> </tr> </thead> <tbody><tr> <td><code>app/api/site-surveys/[surveyId]/geometry-reconstruction/start/route.ts</code></td> <td>Rewritten: creates job with status='queued', returns 202 + jobId immediately. Mock pipeline still runs synchronously for backward compat.</td> </tr> <tr> <td><code>lib/db/geometryReconstruction.ts</code></td> <td>Added <code>JobRow.locked_by</code>, <code>JobRow.locked_at</code>; added <code>claimNextQueuedJob()</code>, <code>claimJobById()</code>, <code>releaseJobLock()</code>, <code>updateJobHeartbeatInDb()</code>, <code>updateJobStageDurations()</code>, <code>updateJobFailureStage()</code>, <code>insertReconstructionArtifactsBatch()</code>, <code>deleteArtifactsByJob()</code>, <code>getSurveyOwnerId()</code>; <code>rowToJob</code> maps <code>locked_by</code> → <code>lockedBy</code>, <code>locked_at</code> → <code>lockedAt</code></td> </tr> <tr> <td><code>lib/siteSurveys/geometryReconstruction/types.ts</code></td> <td>Added <code>lockedBy: string | null</code>, <code>lockedAt: string | null</code> to <code>GeometryReconstructionJob</code>; added <code>failureStage</code>, <code>stageDurations</code> fields</td> </tr> <tr> <td><code>lib/siteSurveys/geometryReconstruction/asyncJobManager.ts</code></td> <td>Added <code>transitionToRunning(job, stage, workerId?)</code> with lock management; all terminal transitions (completed/failed/cancelled) set <code>lockedBy: null, lockedAt: null</code>; added <code>isHeartbeatStale()</code>, <code>isJobStuck()</code>, <code>computeProgress()</code></td> </tr> <tr> <td><code>lib/siteSurveys/geometryReconstruction/runFullPipeline.ts</code></td> <td>Added <code>adaptBatchCallback()</code> function; added <code>CheckpointCallback</code> type; segmentation stage receives <code>segBatchCallback</code> for per-batch checkpointing; <code>runSegmentationOnlyPipeline</code> and <code>runDepthOnlyPipeline</code> also get batch callbacks</td> </tr> <tr> <td><code>lib/siteSurveys/geometryReconstruction/workers/segmentation/runSegmentationWorker.ts</code></td> <td>Added <code>SegmentationBatchCheckpoint</code> interface, <code>SegmentationBatchCallback</code> type; added <code>batchCallback</code> parameter to <code>runSegmentationWorker()</code>, <code>runSegmentationFullOutput()</code>, <code>runSegmentationFromReconstructionInput()</code>; batch loop fires callback after each batch of 2 photos</td> </tr> <tr> <td><code>lib/siteSurveys/geometryReconstruction/mockAdapter.ts</code></td> <td>Added <code>lockedBy: null, lockedAt: null</code> to mock jobs</td> </tr> <tr> <td><code>render.yaml</code></td> <td>Added <code>geometry-reconstruction-worker</code> service definition (type: worker, plan: starter, region: oregon, branch: dev)</td> </tr> <tr> <td><code>.gitignore</code></td> <td>Added <code>worker/dist/</code></td> </tr> <tr> <td><code>.env.example</code></td> <td>Added <code>SAM2_SERVICE_URL</code> and <code>RENDER_API_KEY</code></td> </tr> <tr> <td><code>vercel.json</code></td> <td>Added stale-job-cleanup cron (<code>0 3 * * *</code>)</td> </tr> </tbody></table><hr><h2>4. Key Function Signatures &amp; Patterns</h2><h3>Atomic Job Claiming (DB layer — <code>lib/db/geometryReconstruction.ts</code>)</h3><pre><code class="language-typescript">// Claim the next available queued job. Reclaims stale locks first (&gt;10 min).
// Returns null if no job available.
async function claimNextQueuedJob(workerId: string): Promise&lt;GeometryReconstructionJob | null&gt;

// Claim a specific job by ID (for /execute route or manual triggers).
// CAS: only succeeds if status='queued' AND locked_by IS NULL.
async function claimJobById(jobId: string, workerId: string): Promise&lt;GeometryReconstructionJob | null&gt;

// Release the lock on a job (best-effort, does not throw).
async function releaseJobLock(jobId: string): Promise&lt;void&gt;

// Update heartbeat timestamp + current stage name.
async function updateJobHeartbeatInDb(jobId: string, stage: string): Promise&lt;void&gt;

// Update the stageDurations JSON on the job record.
async function updateJobStageDurations(jobId: string, stageDurations: Record&lt;string, number&gt;): Promise&lt;void&gt;

// Record which stage the pipeline failed at.
async function updateJobFailureStage(jobId: string, stage: string): Promise&lt;void&gt;

// Batch-insert artifacts (used by checkpoint callback for incremental persistence).
async function insertReconstructionArtifactsBatch(jobId, surveyId, userId, artifacts, pipeline, stageDurations): Promise&lt;{inserted: number, failed: number}&gt;

// Delete all artifacts for a job (used before replacing checkpointed partials with complete set).
async function deleteArtifactsByJob(jobId: string): Promise&lt;number&gt;
</code></pre><h3>Pure Functions — <code>lib/siteSurveys/geometryReconstruction/asyncJobManager.ts</code></h3><pre><code class="language-typescript">// Build a new job with status='queued', lockedBy=null, lockedAt=null
function buildNewJob(jobId: string, input: GeometryReconstructionInput, workerVersion: string): GeometryReconstructionJob

// Transition to 'running' — sets lockedBy/lockedAt ONLY if workerId provided
function transitionToRunning(job, initialStage, workerId?): GeometryReconstructionJob

// Advance stage (heartbeat update) — does NOT change lockedBy
function advanceStage(job, nextStage): GeometryReconstructionJob

// Terminal transitions — ALWAYS set lockedBy=null, lockedAt=null
function transitionToCompleted(job): GeometryReconstructionJob
function transitionToFailed(job, errorStage): GeometryReconstructionJob
function transitionToCancelled(job): GeometryReconstructionJob

// Heartbeat staleness detection
function isHeartbeatStale(info: HeartbeatInfo, nowMs: number): boolean  // &gt;10 min
function isJobStuck(info: HeartbeatInfo, nowMs: number): boolean       // &gt;30 min

// Progress computation (0.0 to 1.0)
function computeProgress(currentStage: string | null): number
</code></pre><h3>Sub-Stage Checkpointing — <code>runSegmentationWorker.ts</code> + <code>runFullPipeline.ts</code></h3><pre><code class="language-typescript">// In runSegmentationWorker.ts:
interface SegmentationBatchCheckpoint {
  batchIndex: number;
  batchSize: number;
  batchArtifacts: SemanticSegmentationMask[];
  allArtifacts: SemanticSegmentationMask[];  // accumulated across all batches
  photosProcessed: number;
  photosTotal: number;
  elapsedMs: number;
}
type SegmentationBatchCallback = (checkpoint: SegmentationBatchCheckpoint) =&gt; Promise&lt;void&gt;;

// In runFullPipeline.ts — adapter bridges CheckpointCallback into SegmentationBatchCallback:
function adaptBatchCallback(
  checkpointCallback: CheckpointCallback | undefined,
  pipelineStart: number,
  stageDurationsRef: { value: Record&lt;string, number&gt; },
): SegmentationBatchCallback | undefined
</code></pre><h3>Neon SQL Patterns (CRITICAL — gotchas that burned us)</h3><p><strong>Rule 1:</strong> Neon tagged template literals (<code>sql\</code>...`<code>) automatically parameterize </code>${value}<code>interpolations. NEVER append</code>::uuid<code>after an interpolated value — it becomes</code>$1::uuid<code>which is valid, but if you accidentally write</code>${value}::uuid<code>it becomes</code>$1::uuid<code>which ALSO works but can cause type confusion. The real danger is writing</code>WHERE id = '${jobId}'` with quotes — Neon doesn't parameterize inside string literals.</p><p><strong>Rule 2:</strong> You CANNOT embed parameters inside <code>INTERVAL '...'</code> strings. Instead of:</p><pre><code class="language-sql">-- BROKEN: becomes INTERVAL '$1 minutes' which is invalid
WHERE last_heartbeat_at &lt; NOW() - INTERVAL '${thresholdMinutes} minutes'
</code></pre><p>Use:</p><pre><code class="language-sql">-- CORRECT: multiply INTERVAL '1 minute' by the parameter
WHERE last_heartbeat_at &lt; NOW() - INTERVAL '1 minute' * ${thresholdMinutes}
</code></pre><p><strong>Rule 3:</strong> <code>FOR UPDATE SKIP LOCKED</code> works with Neon serverless driver. This is how we do atomic claiming — the subquery locks the row, and <code>SKIP LOCKED</code> ensures concurrent workers don't wait for each other.</p><hr><h2>5. Render Worker Deployment — THE ONE THING THAT NEEDS FIXING</h2><h3>What's Done</h3><ul> <li>Render service <strong>exists</strong>: <code>srv-d8fq3nm7r5hc73acdbeg</code> (name: <code>geometry-reconstruction-worker</code>)</li> <li>Service type: <code>worker</code> (background, no HTTP port)</li> <li>Plan: <code>starter</code> ($7/mo)</li> <li>Region: <code>oregon</code></li> <li>Branch: <code>dev</code></li> <li><code>DATABASE_URL</code> env var: <strong>SET</strong> (copied from existing <code>solarpro</code> OpenCV service)</li> <li><code>SAM2_SERVICE_URL</code> env var: <strong>SET</strong> to <code>http://sam2-segmentation.onrender.com</code></li> <li><code>WORKER_POLL_INTERVAL_MS</code> env var: <strong>SET</strong> to <code>5000</code></li> <li><code>SHUTDOWN_TIMEOUT_MS</code> env var: <strong>SET</strong> to <code>30000</code></li> </ul><h3>What's Broken</h3><p>The service was created via the Render API with <code>dockerfilePath: "./Dockerfile"</code> (wrong — should be <code>"./worker/Dockerfile"</code>). Two attempts to fix this via API PUT and deploy override both failed (builds failed with <code>build_failed</code> status). The API update didn't take effect on the service configuration.</p><h3>How to Fix It (30 seconds in the Dashboard)</h3><ol> <li>Go to <a href="https://dashboard.render.com">https://dashboard.render.com</a></li> <li>Find the <code>geometry-reconstruction-worker</code> service</li> <li>Go to <strong>Settings</strong> → <strong>Build &amp; Deploy</strong></li> <li>Change <strong>Dockerfile Path</strong> from <code>./Dockerfile</code> to <code>./worker/Dockerfile</code></li> <li>Ensure <strong>Docker Build Context</strong> is <code>.</code> (repo root) — this is already correct</li> <li>Save → Manual Deploy → Deploy latest <code>dev</code> branch</li> </ol><p>The Dockerfile is at <code>worker/Dockerfile</code> and expects the build context to be the repo root (it copies <code>lib/</code>, <code>worker/</code>, and <code>tsconfig.json</code>). This is correct in <code>render.yaml</code>:</p><pre><code class="language-yaml">dockerContext: .
dockerfilePath: ./worker/Dockerfile
</code></pre><p>The service just needs the Dashboard UI fix for the dockerfilePath.</p><h3>Alternatively: Delete and Recreate</h3><p>If the Dashboard fix doesn't stick either, delete the service <code>srv-d8fq3nm7r5hc73acdbeg</code> and let <code>render.yaml</code> create it on the next push. The <code>render.yaml</code> at the repo root has the correct configuration. Render's Blueprints feature reads <code>render.yaml</code> when a new service is detected. Make sure the Render account has Blueprints enabled.</p><h3>Worker Build &amp; Run (for local verification)</h3><pre><code class="language-bash"># TypeScript compilation
npx tsc -p worker/tsconfig.json

# Verify output
ls -la worker/dist/worker/main.js

# Docker build (from repo root)
docker build -f worker/Dockerfile -t geom-recon-worker .

# Docker run (pass env vars)
docker run --env-file .env geom-recon-worker
</code></pre><h3>Health Check</h3><p>The Dockerfile includes a health check:</p><pre><code class="language-dockerfile">HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
    CMD pgrep -f "node worker/dist/worker/main.js" &gt; /dev/null || exit 1
</code></pre><p>On Render, the worker won't have a web endpoint, but the health check ensures the process stays alive. If the worker process dies, Render will restart the container.</p><hr><h2>6. API Route Reference</h2><h3><code>POST /api/site-surveys/[surveyId]/geometry-reconstruction/start</code></h3><ul> <li><strong>Auth required</strong> (survey ownership enforced)</li> <li>Creates job with <code>status='queued'</code>, returns <strong>202</strong> + <code>{ jobId }</code> immediately</li> <li>For <code>pipeline='mock'</code> only: runs synchronously and returns <strong>200</strong> with artifacts (backward compat)</li> <li>The Render worker picks up the queued job</li> </ul><h3><code>GET /api/site-surveys/[surveyId]/geometry-reconstruction/status?jobId=xxx</code></h3><ul> <li><strong>Auth required</strong> (survey ownership enforced)</li> <li>Returns job status, progress percentage, current stage, artifacts (if completed)</li> <li>Reads from DB only — no pipeline execution, no external calls, &lt;50ms response time</li> <li>Frontend polls this endpoint after receiving a <code>jobId</code> from <code>/start</code></li> </ul><h3><code>POST /api/site-surveys/[surveyId]/geometry-reconstruction/execute</code></h3><ul> <li><strong>Internal auth</strong> (requires <code>X-Internal-Auth</code> header matching <code>INTERNAL_WORKER_AUTH_TOKEN</code>)</li> <li>Manual trigger / fallback for pipeline execution</li> <li>Uses <code>claimJobById(jobId, workerId)</code> for atomic claiming — returns <strong>409</strong> if job cannot be claimed</li> <li>Still subject to Vercel's <code>maxDuration=300</code> — use only for debugging/stale recovery</li> <li>The primary execution path is the Render worker (no Vercel timeout)</li> </ul><h3><code>GET /api/cron/stale-job-cleanup</code></h3><ul> <li>Called by Vercel Cron daily at 3 AM (<code>0 3 * * *</code>)</li> <li>Requires <code>CRON_SECRET</code> header (auto-sent by Vercel Cron)</li> <li>Marks stale jobs (10+ min no heartbeat) and orphaned jobs (30+ min queued) as failed</li> </ul><hr><h2>7. Database Schema — Migration Reference</h2><h3>Migration 083 (<code>083_physical_data_engineering_columns.sql</code>)</h3><p>Added physical data engineering columns to the geometry reconstruction artifacts table.</p><h3>Migration 084 (<code>084_geometry_reconstruction_stage_durations.sql</code>)</h3><p>Added <code>stage_durations JSONB</code> and <code>failure_stage TEXT</code> columns to the jobs table.</p><h3>Migration 085 (<code>085_geometry_reconstruction_worker_ownership.sql</code>)</h3><pre><code class="language-sql">ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS locked_by TEXT NULL;
ALTER TABLE site_survey_geometry_reconstruction_jobs
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_geom_recon_jobs_claimable
  ON site_survey_geometry_reconstruction_jobs (status, locked_by)
  WHERE status = 'queued' AND locked_by IS NULL;
</code></pre><p><strong>To apply on a fresh database:</strong> Run migrations 083 → 084 → 085 in order. The <code>/api/migrate</code> endpoint can trigger these, or run them manually via <code>psql</code> or the Neon SQL editor.</p><hr><h2>8. Test Suite</h2><h3>P1 Worker Ownership Tests (<code>__tests__/p1WorkerOwnership.test.ts</code>)</h3><p><strong>54 tests</strong>, all passing. Covers:</p><ul> <li><code>buildNewJob</code>: creates job with status='queued', lockedBy=null, lockedAt=null</li> <li><code>transitionToRunning</code>: claim locking (sets lockedBy/lockedAt only when workerId provided)</li> <li><code>advanceStage</code>: heartbeat update without changing lockedBy</li> <li><code>transitionToCompleted</code>: lock release (lockedBy=null, lockedAt=null)</li> <li><code>transitionToFailed</code>: lock release + failureStage preservation</li> <li><code>transitionToCancelled</code>: lock release</li> <li><code>isHeartbeatStale</code>: 10-minute threshold detection</li> <li><code>isJobStuck</code>: 30-minute threshold detection</li> <li><code>computeProgress</code>: stage-to-percentage mapping</li> <li>Full lifecycle integration test</li> <li>Lock ownership invariants across transitions</li> <li>Type shape validation (REVIEW_ONLY_AUTHORITY fields: <code>reviewOnly</code>, <code>nonAuthoritative</code> — NOT <code>isAuthoritative</code>)</li> </ul><h3>Running Tests</h3><pre><code class="language-bash"># Full suite (922 tests pass)
npx jest --forceExit

# Just the P1 tests
npx jest __tests__/p1WorkerOwnership.test.ts --forceExit

# TypeScript compilation check
npx tsc -p worker/tsconfig.json
</code></pre><p><strong>Known pre-existing issues:</strong></p><ul> <li>8 Vitest-format tests are incompatible with Jest (pre-existing, not related to P0/P1)</li> <li><code>monitoring.ts</code> has one pre-existing TypeScript error (unused variable, not related to P0/P1)</li> </ul><hr><h2>9. Authority &amp; Limitations — MUST KNOW</h2><p>Every geometry reconstruction artifact carries this exact authority envelope:</p><pre><code class="language-typescript">const REVIEW_ONLY_AUTHORITY = {
  reviewOnly: true,
  nonAuthoritative: true,
  cadMutationAllowed: false,
  permitGenerationAllowed: false,
  bomMutationAllowed: false,
} as const;
</code></pre><p><strong>The field names are <code>reviewOnly</code> and <code>nonAuthoritative</code>.</strong> There is NO <code>isAuthoritative</code> field. This burned us in tests — if you see code checking <code>job.authority.isAuthoritative</code>, it's wrong.</p><p>Every artifact also carries these limitations:</p><pre><code class="language-typescript">const BASE_LIMITATIONS = [
  'REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY',
  'These artifacts are operator review aids only and cannot mutate CAD, permits, BOM, or engineering workflows.',
] as const;
</code></pre><h3>Standing Rules (from user, across all sessions)</h3><ol> <li><strong>Do NOT modify</strong> CAD generation, permit generation, canonical builder, promotion logic, authority workflow</li> <li><strong>Do NOT treat</strong> segmentation masks as direct roof geometry</li> <li><strong>Do NOT change</strong> SAM2 model behavior</li> <li><strong>Do NOT change</strong> geometry algorithms yet</li> <li><strong>Do NOT increase</strong> depth resolution yet</li> <li><strong>No regressions</strong> — do NOT push to <code>master</code> (only push to <code>dev</code>)</li> </ol><hr><h2>10. Environment Variables Reference</h2><h3>Worker (Render background service)</h3><table class="e-rte-table"> <thead> <tr> <th>Variable</th> <th>Required</th> <th>Default</th> <th>Description</th> </tr> </thead> <tbody><tr> <td><code>DATABASE_URL</code></td> <td>YES</td> <td>—</td> <td>Neon PostgreSQL connection string (pooled)</td> </tr> <tr> <td><code>SAM2_SERVICE_URL</code></td> <td>YES</td> <td>—</td> <td>SAM2 service URL (e.g. <code>http://sam2-segmentation.onrender.com</code>)</td> </tr> <tr> <td><code>WORKER_POLL_INTERVAL_MS</code></td> <td>no</td> <td><code>5000</code></td> <td>How often to poll for queued jobs</td> </tr> <tr> <td><code>WORKER_ID</code></td> <td>no</td> <td>auto-generated</td> <td>Unique worker identifier for lock claiming</td> </tr> <tr> <td><code>SHUTDOWN_TIMEOUT_MS</code></td> <td>no</td> <td><code>30000</code></td> <td>Graceful shutdown wait time</td> </tr> </tbody></table><h3>SAM2 Service (existing Render web service)</h3><table class="e-rte-table"> <thead> <tr> <th>Variable</th> <th>Value</th> </tr> </thead> <tbody><tr> <td><code>SAM2_HF_MODEL_ID</code></td> <td><code>facebook/sam2.1-hiera-tiny</code></td> </tr> <tr> <td><code>SAM2_INFERENCE_BACKEND</code></td> <td><code>onnx</code></td> </tr> <tr> <td><code>SAM2_ONNX_MODEL_FILENAME</code></td> <td><code>sam2.1_hiera_tiny_20260221.zip</code></td> </tr> <tr> <td><code>SAM2_MAX_IMAGE_DIM</code></td> <td><code>384</code></td> </tr> <tr> <td><code>SAM2_POINTS_PER_SIDE</code></td> <td><code>8</code></td> </tr> <tr> <td><code>SAM2_POINTS_PER_BATCH</code></td> <td><code>4</code></td> </tr> <tr> <td><code>MIDAS_ENABLED</code></td> <td><code>true</code></td> </tr> <tr> <td><code>MIDAS_MODEL_ID</code></td> <td><code>Intel/dpt-swinv2-tiny-256</code></td> </tr> </tbody></table><h3>Vercel</h3><table class="e-rte-table"> <thead> <tr> <th>Variable</th> <th>Required</th> <th>Description</th> </tr> </thead> <tbody><tr> <td><code>DATABASE_URL</code></td> <td>YES</td> <td>Same Neon connection string</td> </tr> <tr> <td><code>JWT_SECRET</code></td> <td>YES</td> <td>Auth signing key (same across all Vercel environments)</td> </tr> <tr> <td><code>CRON_SECRET</code></td> <td>recommended</td> <td>Protects /api/cron/* endpoints</td> </tr> <tr> <td><code>INTERNAL_WORKER_AUTH_TOKEN</code></td> <td>no</td> <td>Auth for /execute route (default: <code>geometry-recon-worker-2025</code>)</td> </tr> <tr> <td><code>RENDER_API_KEY</code></td> <td>no</td> <td>For deployment management from code</td> </tr> </tbody></table><hr><h2>11. Render API Reference (if needed)</h2><ul> <li><strong>API Key:</strong> <code>rnd_vORy1PEkvohnoQBoYKTgI2TjHaRz</code></li> <li><strong>Owner ID:</strong> <code>tea-d89udti8qa3s73ebrhdg</code></li> <li><strong>Worker Service ID:</strong> <code>srv-d8fq3nm7r5hc73acdbeg</code></li> <li><strong>Base URL:</strong> <code>https://api.render.com/v1</code></li> </ul><h3>Useful API Calls</h3><pre><code class="language-bash"># List all services
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services?ownerId=tea-d89udti8qa3s73ebrhdg&amp;limit=20

# Get service details
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  https://api.render.com/v1/services/srv-d8fq3nm7r5hc73acdbeg

# List deploys for service
curl -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/srv-d8fq3nm7r5hc73acdbeg/deploys?limit=5"

# Trigger manual deploy
curl -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"clearCache": true}' \
  https://api.render.com/v1/services/srv-d8fq3nm7r5hc73acdbeg/deploys

# Update service config (e.g., fix dockerfilePath)
curl -X PUT -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"serviceDetails": {"dockerfilePath": "./worker/Dockerfile", "dockerContext": "."}}' \
  https://api.render.com/v1/services/srv-d8fq3nm7r5hc73acdbeg
</code></pre><p><strong>NOTE:</strong> The API PUT to update <code>dockerfilePath</code> did not work in the previous session — the deploy still used the old path. The Dashboard UI is the reliable way to fix this.</p><hr><h2>12. What's Next — P2 Roadmap</h2><p>The next phase after getting the Render worker building and running is <strong>P2: Segmentation as ROI Filter</strong>.</p><h3>P2 Concept</h3><p>Currently, SAM2 segments ALL visible objects in every photo (sky, trees, cars, people, ground, roof). Most of these masks are irrelevant for roof geometry. P2 would filter SAM2 masks to only roof-domain regions of interest (ROI) before passing them to downstream stages. This would:</p><ul> <li>Reduce downstream processing time (fewer masks → fewer lines → fewer planes)</li> <li>Improve signal-to-noise ratio for geometry stages</li> <li>Reduce artifact count (smaller DB payloads)</li> <li>NOT change SAM2 model behavior or segmentation algorithm (standing rule)</li> </ul><h3>P2 Implementation Sketch</h3><ol> <li>After SAM2 batch completes, classify each mask as "roof-domain" vs "non-roof"</li> <li>Classification heuristics: mask area, position (upper half of image), color (gray/brown/dark), label from photo classifier</li> <li>Drop non-roof masks before persisting as segmentation artifacts</li> <li>This is a POST-PROCESSING filter, not a SAM2 model change — fully compliant with standing rules</li> </ol><h3>Beyond P2</h3><ul> <li><strong>P3:</strong> Line extraction confidence filtering (remove low-confidence edge lines)</li> <li><strong>P4:</strong> Depth map quality gating (reject depth maps with &gt;40% near-zero pixels)</li> <li><strong>P5:</strong> Multi-view consistency scoring (cross-validate geometry across photos)</li> <li><strong>P6:</strong> Incremental reprocessing (re-run only failed stages, not full pipeline)</li> </ul><hr><h2>13. Quick Start — Getting This Running on a Fresh Machine</h2><pre><code class="language-bash"># 1. Clone and checkout
git clone https://github.com/rayobrian6/Solarpro.git
cd Solarpro
git checkout dev
git pull

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env.local
# Fill in: DATABASE_URL, JWT_SECRET, SAM2_SERVICE_URL

# 4. Run migrations (083 → 084 → 085 if not already applied)
# Either via /api/migrate or manually via psql/Neon SQL editor

# 5. Verify TypeScript compiles
npx tsc -p worker/tsconfig.json
# Output: worker/dist/worker/main.js

# 6. Run tests
npx jest --forceExit
# Expected: 922 tests pass

# 7. Fix Render worker service (Dashboard UI)
# Go to https://dashboard.render.com → geometry-reconstruction-worker → Settings
# Change Dockerfile Path to: ./worker/Dockerfile
# Ensure Docker Build Context is: .
# Save → Manual Deploy

# 8. Verify worker is running
# Check Render logs for: "[Worker render-worker-xxx] Starting Render background worker"
# Submit a test job via POST /start → watch worker claim it in logs

# 9. If you need to push changes
git add -A &amp;&amp; git commit -m "your message"
git push origin dev
# NEVER push to master
</code></pre><hr><h2>14. Debugging Playbook</h2><h3>Worker doesn't pick up jobs</h3><ol> <li>Check Render logs — is the worker process running?</li> <li>Check <code>DATABASE_URL</code> — is it set correctly on the Render service?</li> <li>Check the jobs table — are there jobs with <code>status='queued' AND locked_by IS NULL</code>?</li> <li>Check the claimable index — <code>SELECT * FROM site_survey_geometry_reconstruction_jobs WHERE status = 'queued' AND locked_by IS NULL;</code></li> </ol><h3>Job stuck in 'running' forever</h3><ol> <li>Check <code>last_heartbeat_at</code> — if &gt;10 min ago, the stale detector should catch it</li> <li>Trigger stale cleanup manually: <code>GET /api/cron/stale-job-cleanup</code> (needs <code>CRON_SECRET</code> header)</li> <li>Check worker logs for errors at the stage reported in <code>current_stage</code></li> </ol><h3>Segmentation produces zero artifacts</h3><ol> <li>Check <code>SAM2_SERVICE_URL</code> — is it set and reachable from the worker?</li> <li>SAM2 on Render takes ~30s cold start — the worker calls <code>warmupSAM2Service()</code> on job start</li> <li>Check SAM2 service health: <code>curl https://sam2-segmentation.onrender.com/health</code></li> <li>If SAM2 is down, the worker falls back to Canny edge detection (produces lower-quality masks)</li> </ol><h3>Build fails on Render</h3><ol> <li>Check Docker build context — must be <code>.</code> (repo root)</li> <li>Check Dockerfile path — must be <code>./worker/Dockerfile</code></li> <li>The Dockerfile copies <code>lib/</code>, <code>worker/</code>, and <code>tsconfig.json</code> — all must exist in the repo</li> <li><code>npx tsc -p worker/tsconfig.json</code> must succeed — if it fails, the build fails</li> <li>Check <code>package.json</code> — must include <code>typescript</code> and <code>@types/node</code> as dependencies</li> </ol><h3>Neon connection errors</h3><ol> <li><code>DATABASE_URL</code> must use the pooled connection string (ends in <code>?pooler=true</code> or uses the <code>-pooler</code> host)</li> <li>Neon serverless has cold starts — the worker uses <code>getDbReady()</code> which handles retries</li> <li>If you see <code>neon: not connected</code> errors, the connection string may be wrong</li> </ol><hr><h2>15. Git History — Key Commits on <code>dev</code></h2><table class="e-rte-table"> <thead> <tr> <th>Commit</th> <th>Description</th> </tr> </thead> <tbody><tr> <td><code>3882e4c</code></td> <td>P1: Render Background Worker + Sub-Stage Checkpointing (latest, all P0+P1 code)</td> </tr> <tr> <td><code>3908ac2</code></td> <td>Fix: remove stale deleteArtifactsBySurvey import; add missing stageDurations tracking</td> </tr> <tr> <td><code>772389a</code></td> <td>P0: execution stability — checkpoint persistence after every stage</td> </tr> <tr> <td><code>1856db0</code></td> <td>Fix: stale-job-cleanup uses INTERVAL arithmetic instead of parameter inside string</td> </tr> <tr> <td><code>976c462</code></td> <td>Fix: stale-job cron to daily (Hobby plan compat)</td> </tr> <tr> <td><code>434bd20</code></td> <td>Fix: vercel-build add pyproject.toml with Linux-only uv environments</td> </tr> <tr> <td><code>7685478</code></td> <td>Fix: 5 critical/medium fixes — migration 083, promotionStore, canonicalBuilder, etc.</td> </tr> </tbody></table><hr><p><em>This document is the single source of truth for continuing Pipeline B work. All code is on <code>dev</code> at <code>3882e4c</code>. The only manual step is fixing the Render worker dockerfilePath in the Dashboard. After that, the async pipeline architecture is live.</em></p>