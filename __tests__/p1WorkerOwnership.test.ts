/**
 * P1 — Worker Ownership & Job Lifecycle Tests
 *
 * Tests for the P1 Render Background Worker architecture:
 * - Job creation (buildNewJob) includes lockedBy/lockedAt fields
 * - Job state transitions correctly manage lock ownership
 * - Heartbeat staleness detection
 * - Progress computation
 * - Claim locking semantics (transitionToRunning with workerId)
 * - Lock release on completion, failure, cancellation
 * - Failure preservation (failureStage retained on transition)
 * - Authority enforcement across all transitions
 *
 * These are pure-function tests — no DB connection required.
 */

import {
  buildNewJob,
  transitionToRunning,
  advanceStage,
  transitionToCompleted,
  transitionToFailed,
  transitionToCancelled,
  computeProgress,
  isHeartbeatStale,
  isJobStuck,
  type HeartbeatInfo,
} from '@/lib/siteSurveys/geometryReconstruction/asyncJobManager';

import type {
  GeometryReconstructionJob,
  GeometryReconstructionInput,
} from '@/lib/siteSurveys/geometryReconstruction/types';

import { REVIEW_ONLY_AUTHORITY, BASE_LIMITATIONS } from '@/lib/siteSurveys/geometryReconstruction/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_INPUT: GeometryReconstructionInput = {
  surveyId: '00000000-0000-0000-0000-000000000001',
  sourcePhotos: [
    { fileId: 'f1', fileUrl: 'https://example.com/photo1.jpg', filename: 'photo1.jpg' },
    { fileId: 'f2', fileUrl: 'https://example.com/photo2.jpg', filename: 'photo2.jpg' },
  ],
  pipeline: 'full',
};

function makeJob(overrides: Partial<GeometryReconstructionJob> = {}): GeometryReconstructionJob {
  const base = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Job Creation (buildNewJob)
// ---------------------------------------------------------------------------

describe('buildNewJob', () => {
  it('creates a job with status=queued', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.status).toBe('queued');
  });

  it('creates a job with lockedBy=null and lockedAt=null', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.lockedBy).toBeNull();
    expect(job.lockedAt).toBeNull();
  });

  it('creates a job with currentStage=queued', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.currentStage).toBe('queued');
  });

  it('creates a job with stageDurations=null and failureStage=null', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.stageDurations).toBeNull();
    expect(job.failureStage).toBeNull();
  });

  it('sets review-only authority', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('sets base limitations', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.limitations).toEqual(BASE_LIMITATIONS);
  });

  it('preserves input data', () => {
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.surveyId).toBe(VALID_INPUT.surveyId);
    expect(job.pipeline).toBe('full');
    expect(job.input.sourcePhotos).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Claim Locking (transitionToRunning)
// ---------------------------------------------------------------------------

describe('transitionToRunning', () => {
  it('transitions queued → running', () => {
    const job = makeJob({ status: 'queued' });
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.status).toBe('running');
  });

  it('sets currentStage to the initial stage', () => {
    const job = makeJob({ status: 'queued' });
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.currentStage).toBe('segmentation');
  });

  it('sets lockedBy to the workerId', () => {
    const job = makeJob({ status: 'queued', lockedBy: null, lockedAt: null });
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.lockedBy).toBe('render-worker-1');
    expect(running.lockedAt).not.toBeNull();
  });

  it('without workerId preserves existing lock', () => {
    const job = makeJob({ status: 'queued', lockedBy: 'other-worker', lockedAt: '2024-01-01T00:00:00Z' });
    const running = transitionToRunning(job, 'segmentation');
    expect(running.lockedBy).toBe('other-worker'); // preserved
    expect(running.lockedAt).toBe('2024-01-01T00:00:00Z'); // preserved
  });

  it('sets heartbeat timestamp', () => {
    const job = makeJob({ status: 'queued' });
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.lastHeartbeatAt).not.toBeNull();
  });

  it('preserves authority across transition', () => {
    const job = makeJob({ status: 'queued' });
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });
});

// ---------------------------------------------------------------------------
// Stage Advancement (advanceStage)
// ---------------------------------------------------------------------------

describe('advanceStage', () => {
  it('advances currentStage', () => {
    const job = makeJob({ status: 'running', currentStage: 'segmentation' });
    const advanced = advanceStage(job, 'line_extraction');
    expect(advanced.currentStage).toBe('line_extraction');
  });

  it('updates heartbeat on advance', () => {
    const job = makeJob({ status: 'running', currentStage: 'segmentation', lastHeartbeatAt: '2024-01-01T00:00:00Z' });
    const advanced = advanceStage(job, 'line_extraction');
    expect(advanced.lastHeartbeatAt).not.toBe('2024-01-01T00:00:00Z');
  });

  it('preserves lockedBy/lockedAt on stage advance', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const advanced = advanceStage(job, 'line_extraction');
    expect(advanced.lockedBy).toBe('render-worker-1');
    expect(advanced.lockedAt).toBe('2024-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Lock Release on Completion (transitionToCompleted)
// ---------------------------------------------------------------------------

describe('transitionToCompleted', () => {
  it('transitions running → completed', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const completed = transitionToCompleted(job);
    expect(completed.status).toBe('completed');
  });

  it('releases lock on completion (lockedBy=null, lockedAt=null)', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const completed = transitionToCompleted(job);
    expect(completed.lockedBy).toBeNull();
    expect(completed.lockedAt).toBeNull();
  });

  it('sets currentStage=completed', () => {
    const job = makeJob({ status: 'running', currentStage: 'multi_view_fusion' });
    const completed = transitionToCompleted(job);
    expect(completed.currentStage).toBe('completed');
  });

  it('sets completedAt timestamp', () => {
    const job = makeJob({ status: 'running', completedAt: null });
    const completed = transitionToCompleted(job);
    expect(completed.completedAt).not.toBeNull();
  });

  it('preserves stageDurations from running job', () => {
    const durations = { segmentation: 120000, line_extraction: 3000, depth_estimation: 45000 };
    const job = makeJob({ status: 'running', stageDurations: durations });
    const completed = transitionToCompleted(job);
    expect(completed.stageDurations).toEqual(durations);
  });

  it('preserves authority on completion', () => {
    const job = makeJob({ status: 'running' });
    const completed = transitionToCompleted(job);
    expect(completed.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });
});

// ---------------------------------------------------------------------------
// Lock Release on Failure (transitionToFailed)
// ---------------------------------------------------------------------------

describe('transitionToFailed', () => {
  it('transitions running → failed', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const failed = transitionToFailed(job, 'depth_estimation');
    expect(failed.status).toBe('failed');
  });

  it('releases lock on failure (lockedBy=null, lockedAt=null)', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const failed = transitionToFailed(job, 'depth_estimation');
    expect(failed.lockedBy).toBeNull();
    expect(failed.lockedAt).toBeNull();
  });

  it('records the failure stage', () => {
    const job = makeJob({ status: 'running', failureStage: null });
    const failed = transitionToFailed(job, 'plane_extraction');
    expect(failed.currentStage).toBe('plane_extraction');
  });

  it('preserves stageDurations from running job (partial results)', () => {
    const durations = { segmentation: 120000, line_extraction: 3000 };
    const job = makeJob({ status: 'running', stageDurations: durations, lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const failed = transitionToFailed(job, 'depth_estimation');
    // stageDurations should be preserved — this is the key "failure preservation" property
    expect(failed.stageDurations).toEqual(durations);
  });

  it('preserves authority on failure', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const failed = transitionToFailed(job, 'depth_estimation');
    expect(failed.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('sets completedAt on failure', () => {
    const job = makeJob({ status: 'running', completedAt: null, lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const failed = transitionToFailed(job, 'segmentation');
    expect(failed.completedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lock Release on Cancellation (transitionToCancelled)
// ---------------------------------------------------------------------------

describe('transitionToCancelled', () => {
  it('transitions queued → cancelled', () => {
    const job = makeJob({ status: 'queued', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const cancelled = transitionToCancelled(job);
    expect(cancelled.status).toBe('cancelled');
  });

  it('releases lock on cancellation', () => {
    const job = makeJob({ status: 'queued', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const cancelled = transitionToCancelled(job);
    expect(cancelled.lockedBy).toBeNull();
    expect(cancelled.lockedAt).toBeNull();
  });

  it('sets completedAt on cancellation', () => {
    const job = makeJob({ status: 'queued', completedAt: null });
    const cancelled = transitionToCancelled(job);
    expect(cancelled.completedAt).not.toBeNull();
  });

  it('preserves authority on cancellation', () => {
    const job = makeJob({ status: 'queued' });
    const cancelled = transitionToCancelled(job);
    expect(cancelled.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });
});

// ---------------------------------------------------------------------------
// Heartbeat Staleness Detection
// ---------------------------------------------------------------------------

describe('isHeartbeatStale', () => {
  const NOW = 1700000000000; // Fixed timestamp for deterministic tests

  it('returns false for non-running jobs', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'completed',
      lastHeartbeatAt: new Date(NOW - 20 * 60 * 1000).toISOString(),
      status: 'completed',
    };
    expect(isHeartbeatStale(info, NOW)).toBe(false);
  });

  it('returns true for running job with no heartbeat', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'segmentation',
      lastHeartbeatAt: null,
      status: 'running',
    };
    expect(isHeartbeatStale(info, NOW)).toBe(true);
  });

  it('returns false for running job with recent heartbeat', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'segmentation',
      lastHeartbeatAt: new Date(NOW - 30 * 1000).toISOString(), // 30s ago
      status: 'running',
    };
    expect(isHeartbeatStale(info, NOW)).toBe(false);
  });

  it('returns true for running job with stale heartbeat (>10 min)', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'segmentation',
      lastHeartbeatAt: new Date(NOW - 11 * 60 * 1000).toISOString(), // 11 min ago
      status: 'running',
    };
    expect(isHeartbeatStale(info, NOW)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stuck Job Detection
// ---------------------------------------------------------------------------

describe('isJobStuck', () => {
  const NOW = 1700000000000;

  it('returns false for non-running jobs', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'completed',
      lastHeartbeatAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
      status: 'completed',
    };
    expect(isJobStuck(info, NOW)).toBe(false);
  });

  it('returns true for running job with no heartbeat', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'segmentation',
      lastHeartbeatAt: null,
      status: 'running',
    };
    expect(isJobStuck(info, NOW)).toBe(true);
  });

  it('returns false for running job with recent heartbeat', () => {
    const info: HeartbeatInfo = {
      jobId: 'job-001',
      currentStage: 'segmentation',
      lastHeartbeatAt: new Date(NOW - 5 * 60 * 1000).toISOString(), // 5 min ago
      status: 'running',
    };
    expect(isJobStuck(info, NOW)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Progress Computation
// ---------------------------------------------------------------------------

describe('computeProgress', () => {
  it('returns 0 for null stage', () => {
    expect(computeProgress(null)).toBe(0);
  });

  it('returns 0 for unknown stage', () => {
    expect(computeProgress('unknown_stage')).toBe(0);
  });

  it('returns 0 for queued stage', () => {
    expect(computeProgress('queued')).toBe(0);
  });

  it('returns increasing progress for sequential stages', () => {
    const p1 = computeProgress('segmentation');
    const p2 = computeProgress('line_extraction');
    const p3 = computeProgress('depth_estimation');
    const p4 = computeProgress('completed');

    expect(p1).toBeGreaterThan(0);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
    expect(p4).toBeGreaterThan(p3);
    expect(p4).toBeLessThanOrEqual(1);
  });

  it('completed stage returns 1 or near-1', () => {
    const p = computeProgress('completed');
    expect(p).toBeGreaterThanOrEqual(0.9);
  });
});

// ---------------------------------------------------------------------------
// Full Job Lifecycle Integration
// ---------------------------------------------------------------------------

describe('Job lifecycle integration', () => {
  it('queued → claimed → running → completed (happy path)', () => {
    // 1. Create job (queued)
    const job = buildNewJob('job-001', VALID_INPUT, 'worker-v1');
    expect(job.status).toBe('queued');
    expect(job.lockedBy).toBeNull();

    // 2. Worker claims job → running
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.status).toBe('running');
    expect(running.lockedBy).toBe('render-worker-1');
    expect(running.currentStage).toBe('segmentation');

    // 3. Advance through stages
    const afterLines = advanceStage(running, 'line_extraction');
    expect(afterLines.currentStage).toBe('line_extraction');
    expect(afterLines.lockedBy).toBe('render-worker-1'); // lock preserved

    const afterVp = advanceStage(afterLines, 'vanishing_point_estimation');
    const afterDepth = advanceStage(afterVp, 'depth_estimation');
    const afterPlane = advanceStage(afterDepth, 'plane_extraction');
    const afterMvf = advanceStage(afterPlane, 'multi_view_fusion');

    // 4. Complete
    const completed = transitionToCompleted(afterMvf);
    expect(completed.status).toBe('completed');
    expect(completed.lockedBy).toBeNull(); // lock released
    expect(completed.lockedAt).toBeNull();
    expect(completed.completedAt).not.toBeNull();
  });

  it('queued → claimed → running → failed (failure path with partial preservation)', () => {
    // 1. Create and claim
    const job = buildNewJob('job-002', VALID_INPUT, 'worker-v1');
    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');

    // 2. Advance through some stages, accumulating stageDurations
    const withDurations: GeometryReconstructionJob = {
      ...advanceStage(running, 'line_extraction'),
      stageDurations: { segmentation: 120000, line_extraction: 3000 },
    };

    // 3. Fail at depth_estimation
    const failed = transitionToFailed(withDurations, 'depth_estimation');
    expect(failed.status).toBe('failed');
    expect(failed.lockedBy).toBeNull(); // lock released
    expect(failed.lockedAt).toBeNull();
    expect(failed.currentStage).toBe('depth_estimation');
    // Key: stageDurations preserved — partial results available
    expect(failed.stageDurations).toEqual({ segmentation: 120000, line_extraction: 3000 });
  });

  it('queued → cancelled (cancellation path)', () => {
    const job = buildNewJob('job-003', VALID_INPUT, 'worker-v1');
    const cancelled = transitionToCancelled(job);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.lockedBy).toBeNull();
    expect(cancelled.completedAt).not.toBeNull();
  });

  it('authority is review-only across entire lifecycle', () => {
    const job = buildNewJob('job-004', VALID_INPUT, 'worker-v1');
    expect(job.authority.reviewOnly).toBe(true);
    expect(job.authority.nonAuthoritative).toBe(true);

    const running = transitionToRunning(job, 'segmentation', 'render-worker-1');
    expect(running.authority.reviewOnly).toBe(true);
    expect(running.authority.nonAuthoritative).toBe(true);

    const advanced = advanceStage(running, 'line_extraction');
    expect(advanced.authority.reviewOnly).toBe(true);
    expect(advanced.authority.nonAuthoritative).toBe(true);

    const completed = transitionToCompleted(advanced);
    expect(completed.authority.reviewOnly).toBe(true);
    expect(completed.authority.nonAuthoritative).toBe(true);

    // Also check failed path
    const failedJob = buildNewJob('job-005', VALID_INPUT, 'worker-v1');
    const failedRunning = transitionToRunning(failedJob, 'segmentation', 'render-worker-1');
    const failed = transitionToFailed(failedRunning, 'segmentation');
    expect(failed.authority.reviewOnly).toBe(true);
    expect(failed.authority.nonAuthoritative).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lock Ownership Invariants
// ---------------------------------------------------------------------------

describe('Lock ownership invariants', () => {
  it('lockedBy is only set by transitionToRunning with workerId', () => {
    const job = buildNewJob('job-010', VALID_INPUT, 'worker-v1');
    expect(job.lockedBy).toBeNull();

    // advanceStage does NOT change lockedBy
    const running = transitionToRunning(job, 'segmentation', 'worker-A');
    expect(running.lockedBy).toBe('worker-A');

    const advanced = advanceStage(running, 'line_extraction');
    expect(advanced.lockedBy).toBe('worker-A'); // unchanged
  });

  it('lockedBy is always cleared on terminal transitions', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });

    const completed = transitionToCompleted(job);
    expect(completed.lockedBy).toBeNull();

    const failed = transitionToFailed(job, 'segmentation');
    expect(failed.lockedBy).toBeNull();

    const cancelled = transitionToCancelled(job);
    expect(cancelled.lockedBy).toBeNull();
  });

  it('lockedAt is always cleared alongside lockedBy', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });

    const completed = transitionToCompleted(job);
    expect(completed.lockedAt).toBeNull();

    const failed = transitionToFailed(job, 'segmentation');
    expect(failed.lockedAt).toBeNull();

    const cancelled = transitionToCancelled(job);
    expect(cancelled.lockedAt).toBeNull();
  });

  it('double-completion does not corrupt state', () => {
    const job = makeJob({ status: 'running', lockedBy: 'render-worker-1', lockedAt: '2024-01-01T00:00:00Z' });
    const completed = transitionToCompleted(job);
    const completedAgain = transitionToCompleted(completed);
    expect(completedAgain.status).toBe('completed');
    expect(completedAgain.lockedBy).toBeNull();
    expect(completedAgain.lockedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Row Mapper Equivalence (types shape validation)
// ---------------------------------------------------------------------------

describe('GeometryReconstructionJob type shape (P1 fields)', () => {
  it('buildNewJob produces an object satisfying the GeometryReconstructionJob interface', () => {
    const job = buildNewJob('job-020', VALID_INPUT, 'worker-v1');

    // Required fields from pre-P1
    expect(job.id).toBe('job-020');
    expect(job.surveyId).toBe(VALID_INPUT.surveyId);
    expect(job.status).toBe('queued');
    expect(job.pipeline).toBe('full');
    expect(typeof job.createdAt).toBe('string');
    expect(typeof job.updatedAt).toBe('string');
    expect(job.completedAt).toBeNull();
    expect(job.currentStage).toBe('queued');
    expect(job.lastHeartbeatAt).not.toBeNull();
    expect(job.workerVersion).toBe('worker-v1');
    expect(job.stageDurations).toBeNull();
    expect(job.failureStage).toBeNull();
    expect(job.artifacts).toEqual([]);

    // P1 fields
    expect(job.lockedBy).toBeNull();
    expect(job.lockedAt).toBeNull();

    // Authority
    expect(job.authority).toEqual(REVIEW_ONLY_AUTHORITY);
    expect(job.limitations).toEqual(BASE_LIMITATIONS);
  });

  it('lockedBy/lockedAt survive JSON round-trip', () => {
    const job = buildNewJob('job-021', VALID_INPUT, 'worker-v1');
    const claimed = transitionToRunning(job, 'segmentation', 'render-worker-1');

    const json = JSON.stringify(claimed);
    const parsed = JSON.parse(json);

    expect(parsed.lockedBy).toBe('render-worker-1');
    expect(parsed.lockedAt).not.toBeNull();
    expect(parsed.status).toBe('running');
  });
});
