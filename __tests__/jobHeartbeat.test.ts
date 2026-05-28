/**
 * Tests for geometry reconstruction async job heartbeat logic.
 *
 * These tests validate pure functions from asyncJobManager.ts:
 * - Heartbeat staleness detection
 * - Job stuck detection
 * - Progress computation from pipeline stage
 * - Job state transitions (queued → running → completed/failed/cancelled)
 * - Stage advancement
 * - Authority preservation through transitions
 *
 * DB-dependent functions are tested indirectly through the pure function
 * counterparts that mirror the same logic.
 */

import {
  HEARTBEAT_TIMEOUT_MS,
  STUCK_JOB_THRESHOLD_MS,
  PIPELINE_STAGES,
  isHeartbeatStale,
  isJobStuck,
  computeProgress,
  buildNewJob,
  transitionToRunning,
  advanceStage,
  transitionToCompleted,
  transitionToFailed,
  transitionToCancelled,
  type HeartbeatInfo,
  type PipelineStage,
} from '@/lib/siteSurveys/geometryReconstruction/asyncJobManager';
import {
  REVIEW_ONLY_AUTHORITY,
  BASE_LIMITATIONS,
  type GeometryReconstructionInput,
  type GeometryReconstructionJob,
} from '@/lib/siteSurveys/geometryReconstruction/types';

// ── Helpers ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<GeometryReconstructionInput> = {}): GeometryReconstructionInput {
  return {
    surveyId: 'survey-001',
    sourcePhotos: [],
    pipeline: 'mock',
    ...overrides,
  };
}

function makeJob(overrides: Partial<GeometryReconstructionJob> = {}): GeometryReconstructionJob {
  return {
    id: 'job-001',
    surveyId: 'survey-001',
    status: 'queued',
    pipeline: 'mock',
    input: makeInput(),
    artifacts: [],
    createdAt: '2025-01-15T10:00:00Z',
    updatedAt: '2025-01-15T10:00:00Z',
    completedAt: null,
    currentStage: 'queued',
    lastHeartbeatAt: '2025-01-15T10:00:00Z',
    workerVersion: '1.0.0',
    authority: { ...REVIEW_ONLY_AUTHORITY },
    limitations: [...BASE_LIMITATIONS],
    ...overrides,
  };
}

function makeHeartbeat(overrides: Partial<HeartbeatInfo> = {}): HeartbeatInfo {
  return {
    jobId: 'job-001',
    currentStage: 'segmentation',
    lastHeartbeatAt: new Date().toISOString(),
    status: 'running',
    ...overrides,
  };
}

// ── Constants ────────────────────────────────────────────────────────────

describe('heartbeat constants', () => {
  it('HEARTBEAT_TIMEOUT_MS is 10 minutes', () => {
    expect(HEARTBEAT_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it('STUCK_JOB_THRESHOLD_MS is 30 minutes', () => {
    expect(STUCK_JOB_THRESHOLD_MS).toBe(30 * 60 * 1000);
  });

  it('PIPELINE_STAGES has 9 stages', () => {
    expect(PIPELINE_STAGES).toHaveLength(9);
  });

  it('PIPELINE_STAGES starts with queued and ends with completed', () => {
    expect(PIPELINE_STAGES[0]).toBe('queued');
    expect(PIPELINE_STAGES[PIPELINE_STAGES.length - 1]).toBe('completed');
  });

  it('PIPELINE_STAGES contains all expected stages in order', () => {
    expect(PIPELINE_STAGES).toEqual([
      'queued',
      'segmentation',
      'mask_cleanup',
      'line_extraction',
      'vanishing_point_estimation',
      'plane_extraction',
      'depth_estimation',
      'multi_view_fusion',
      'completed',
    ]);
  });
});

// ── Heartbeat staleness detection ────────────────────────────────────────

describe('isHeartbeatStale', () => {
  it('returns false for a completed job', () => {
    const info = makeHeartbeat({ status: 'completed' });
    expect(isHeartbeatStale(info, Date.now())).toBe(false);
  });

  it('returns false for a queued job', () => {
    const info = makeHeartbeat({ status: 'queued' });
    expect(isHeartbeatStale(info, Date.now())).toBe(false);
  });

  it('returns false for a running job with recent heartbeat', () => {
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: new Date().toISOString() });
    expect(isHeartbeatStale(info, Date.now())).toBe(false);
  });

  it('returns true for a running job with no heartbeat', () => {
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: null });
    expect(isHeartbeatStale(info, Date.now())).toBe(true);
  });

  it('returns true for a running job with heartbeat older than timeout', () => {
    const oldTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS - 1000).toISOString();
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: oldTime });
    expect(isHeartbeatStale(info, Date.now())).toBe(true);
  });

  it('returns false for a running job with heartbeat just under timeout', () => {
    const recentTime = new Date(Date.now() - HEARTBEAT_TIMEOUT_MS + 1000).toISOString();
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: recentTime });
    expect(isHeartbeatStale(info, Date.now())).toBe(false);
  });
});

// ── Job stuck detection ──────────────────────────────────────────────────

describe('isJobStuck', () => {
  it('returns false for a completed job', () => {
    const info = makeHeartbeat({ status: 'completed' });
    expect(isJobStuck(info, Date.now())).toBe(false);
  });

  it('returns false for a running job with recent heartbeat', () => {
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: new Date().toISOString() });
    expect(isJobStuck(info, Date.now())).toBe(false);
  });

  it('returns true for a running job with no heartbeat', () => {
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: null });
    expect(isJobStuck(info, Date.now())).toBe(true);
  });

  it('returns true for a running job with heartbeat older than stuck threshold', () => {
    const oldTime = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS - 1000).toISOString();
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: oldTime });
    expect(isJobStuck(info, Date.now())).toBe(true);
  });

  it('returns false for a running job with heartbeat just under stuck threshold', () => {
    const recentTime = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS + 1000).toISOString();
    const info = makeHeartbeat({ status: 'running', lastHeartbeatAt: recentTime });
    expect(isJobStuck(info, Date.now())).toBe(false);
  });
});

// ── Progress computation ─────────────────────────────────────────────────

describe('computeProgress', () => {
  it('returns 0 for null stage', () => {
    expect(computeProgress(null)).toBe(0);
  });

  it('returns 0 for unknown stage', () => {
    expect(computeProgress('unknown_stage')).toBe(0);
  });

  it('returns 0 for queued stage', () => {
    expect(computeProgress('queued')).toBeCloseTo(0);
  });

  it('returns 1 for completed stage', () => {
    expect(computeProgress('completed')).toBeCloseTo(1);
  });

  it('returns 0.5 for middle stage (depth_estimation = index 6 of 9)', () => {
    const progress = computeProgress('depth_estimation');
    // depth_estimation is index 6, total 9 stages, progress = 6/8 = 0.75
    expect(progress).toBeCloseTo(6 / 8);
  });

  it('progress increases monotonically through stages', () => {
    let prev = 0;
    for (const stage of PIPELINE_STAGES) {
      const p = computeProgress(stage);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});

// ── buildNewJob ──────────────────────────────────────────────────────────

describe('buildNewJob', () => {
  it('creates a job with status queued', () => {
    const job = buildNewJob('job-001', makeInput(), '1.0.0');
    expect(job.status).toBe('queued');
  });

  it('creates a job with currentStage queued', () => {
    const job = buildNewJob('job-001', makeInput(), '1.0.0');
    expect(job.currentStage).toBe('queued');
  });

  it('creates a job with the given workerVersion', () => {
    const job = buildNewJob('job-001', makeInput(), '2.3.4');
    expect(job.workerVersion).toBe('2.3.4');
  });

  it('creates a job with review-only authority', () => {
    const job = buildNewJob('job-001', makeInput(), '1.0.0');
    expect(job.authority.cadMutationAllowed).toBe(false);
    expect(job.authority.reviewOnly).toBe(true);
  });

  it('creates a job with base limitations', () => {
    const job = buildNewJob('job-001', makeInput(), '1.0.0');
    expect(job.limitations.length).toBeGreaterThan(0);
    expect(job.limitations.some(l => l.includes('REVIEW-ONLY'))).toBe(true);
  });

  it('sets lastHeartbeatAt to now', () => {
    const before = new Date().getTime();
    const job = buildNewJob('job-001', makeInput(), '1.0.0');
    const after = new Date(job.lastHeartbeatAt!).getTime();
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('sets completedAt to null', () => {
    const job = buildNewJob('job-001', makeInput(), '1.0.0');
    expect(job.completedAt).toBeNull();
  });

  it('preserves the input pipeline', () => {
    const input = makeInput({ pipeline: 'full' });
    const job = buildNewJob('job-001', input, '1.0.0');
    expect(job.pipeline).toBe('full');
  });
});

// ── transitionToRunning ──────────────────────────────────────────────────

describe('transitionToRunning', () => {
  it('transitions from queued to running', () => {
    const job = makeJob({ status: 'queued' });
    const updated = transitionToRunning(job, 'segmentation');
    expect(updated.status).toBe('running');
  });

  it('sets the initial stage', () => {
    const job = makeJob({ status: 'queued' });
    const updated = transitionToRunning(job, 'segmentation');
    expect(updated.currentStage).toBe('segmentation');
  });

  it('updates lastHeartbeatAt', () => {
    const job = makeJob({ status: 'queued', lastHeartbeatAt: '2025-01-01T00:00:00Z' });
    const updated = transitionToRunning(job, 'segmentation');
    expect(new Date(updated.lastHeartbeatAt!).getTime()).toBeGreaterThan(
      new Date('2025-01-01T00:00:00Z').getTime()
    );
  });

  it('preserves authority', () => {
    const job = makeJob({ status: 'queued' });
    const updated = transitionToRunning(job, 'segmentation');
    expect(updated.authority.cadMutationAllowed).toBe(false);
    expect(updated.authority.reviewOnly).toBe(true);
  });
});

// ── advanceStage ─────────────────────────────────────────────────────────

describe('advanceStage', () => {
  it('advances from segmentation to mask_cleanup', () => {
    const job = makeJob({ status: 'running', currentStage: 'segmentation' });
    const updated = advanceStage(job, 'mask_cleanup');
    expect(updated.currentStage).toBe('mask_cleanup');
  });

  it('updates lastHeartbeatAt on advance', () => {
    const oldTime = '2025-01-01T00:00:00Z';
    const job = makeJob({ status: 'running', currentStage: 'segmentation', lastHeartbeatAt: oldTime });
    const updated = advanceStage(job, 'mask_cleanup');
    expect(updated.lastHeartbeatAt).not.toBe(oldTime);
  });

  it('preserves status as running', () => {
    const job = makeJob({ status: 'running', currentStage: 'segmentation' });
    const updated = advanceStage(job, 'mask_cleanup');
    expect(updated.status).toBe('running');
  });

  it('preserves authority through stage advance', () => {
    const job = makeJob({ status: 'running', currentStage: 'segmentation' });
    const updated = advanceStage(job, 'plane_extraction');
    expect(updated.authority.cadMutationAllowed).toBe(false);
    expect(updated.authority.reviewOnly).toBe(true);
  });

  it('can advance through all pipeline stages', () => {
    let job = makeJob({ status: 'running', currentStage: 'queued' });
    for (let i = 1; i < PIPELINE_STAGES.length; i++) {
      job = advanceStage(job, PIPELINE_STAGES[i]);
      expect(job.currentStage).toBe(PIPELINE_STAGES[i]);
    }
  });
});

// ── transitionToCompleted ────────────────────────────────────────────────

describe('transitionToCompleted', () => {
  it('transitions from running to completed', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToCompleted(job);
    expect(updated.status).toBe('completed');
  });

  it('sets currentStage to completed', () => {
    const job = makeJob({ status: 'running', currentStage: 'multi_view_fusion' });
    const updated = transitionToCompleted(job);
    expect(updated.currentStage).toBe('completed');
  });

  it('sets completedAt', () => {
    const job = makeJob({ status: 'running', completedAt: null });
    const updated = transitionToCompleted(job);
    expect(updated.completedAt).not.toBeNull();
  });

  it('updates lastHeartbeatAt', () => {
    const job = makeJob({ status: 'running', lastHeartbeatAt: '2025-01-01T00:00:00Z' });
    const updated = transitionToCompleted(job);
    expect(new Date(updated.lastHeartbeatAt!)?.getTime()).toBeGreaterThan(
      new Date('2025-01-01T00:00:00Z').getTime()
    );
  });

  it('preserves authority', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToCompleted(job);
    expect(updated.authority.cadMutationAllowed).toBe(false);
  });
});

// ── transitionToFailed ───────────────────────────────────────────────────

describe('transitionToFailed', () => {
  it('transitions from running to failed', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToFailed(job, 'depth_estimation');
    expect(updated.status).toBe('failed');
  });

  it('sets currentStage to the error stage', () => {
    const job = makeJob({ status: 'running', currentStage: 'depth_estimation' });
    const updated = transitionToFailed(job, 'depth_estimation');
    expect(updated.currentStage).toBe('depth_estimation');
  });

  it('sets completedAt on failure', () => {
    const job = makeJob({ status: 'running', completedAt: null });
    const updated = transitionToFailed(job, 'segmentation');
    expect(updated.completedAt).not.toBeNull();
  });

  it('preserves authority on failure', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToFailed(job, 'segmentation');
    expect(updated.authority.cadMutationAllowed).toBe(false);
  });
});

// ── transitionToCancelled ────────────────────────────────────────────────

describe('transitionToCancelled', () => {
  it('transitions from running to cancelled', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToCancelled(job);
    expect(updated.status).toBe('cancelled');
  });

  it('sets completedAt on cancellation', () => {
    const job = makeJob({ status: 'running', completedAt: null });
    const updated = transitionToCancelled(job);
    expect(updated.completedAt).not.toBeNull();
  });

  it('preserves authority on cancellation', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToCancelled(job);
    expect(updated.authority.cadMutationAllowed).toBe(false);
  });
});

// ── Full pipeline progression ────────────────────────────────────────────

describe('full pipeline progression', () => {
  it('progresses through all stages from queued to completed', () => {
    const input = makeInput({ pipeline: 'full' });
    let job = buildNewJob('job-001', input, '1.0.0');

    // Start running
    job = transitionToRunning(job, 'segmentation');
    expect(job.status).toBe('running');
    expect(job.currentStage).toBe('segmentation');

    // Advance through each stage
    const remainingStages: PipelineStage[] = [
      'mask_cleanup',
      'line_extraction',
      'vanishing_point_estimation',
      'plane_extraction',
      'depth_estimation',
      'multi_view_fusion',
    ];
    for (const stage of remainingStages) {
      job = advanceStage(job, stage);
      expect(job.currentStage).toBe(stage);
      expect(job.status).toBe('running');
    }

    // Complete
    job = transitionToCompleted(job);
    expect(job.status).toBe('completed');
    expect(job.currentStage).toBe('completed');
    expect(job.completedAt).not.toBeNull();
  });

  it('can fail at any stage', () => {
    const input = makeInput({ pipeline: 'full' });
    let job = buildNewJob('job-002', input, '1.0.0');
    job = transitionToRunning(job, 'segmentation');
    job = advanceStage(job, 'mask_cleanup');

    // Fail at mask_cleanup
    const failed = transitionToFailed(job, 'mask_cleanup');
    expect(failed.status).toBe('failed');
    expect(failed.currentStage).toBe('mask_cleanup');
    expect(failed.completedAt).not.toBeNull();
  });

  it('preserves worker version through all transitions', () => {
    const input = makeInput({ pipeline: 'full' });
    let job = buildNewJob('job-003', input, '2.5.0');
    expect(job.workerVersion).toBe('2.5.0');

    job = transitionToRunning(job, 'segmentation');
    expect(job.workerVersion).toBe('2.5.0');

    job = advanceStage(job, 'line_extraction');
    expect(job.workerVersion).toBe('2.5.0');

    job = transitionToCompleted(job);
    expect(job.workerVersion).toBe('2.5.0');
  });
});

// ── Authority preservation ───────────────────────────────────────────────

describe('authority preservation through transitions', () => {
  it('authority remains review-only after buildNewJob', () => {
    const job = buildNewJob('job-auth-1', makeInput(), '1.0.0');
    expect(job.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('authority remains review-only after transitionToRunning', () => {
    const job = makeJob({ status: 'queued' });
    const updated = transitionToRunning(job, 'segmentation');
    expect(updated.authority.cadMutationAllowed).toBe(false);
    expect(updated.authority.permitGenerationAllowed).toBe(false);
    expect(updated.authority.bomMutationAllowed).toBe(false);
    expect(updated.authority.reviewOnly).toBe(true);
    expect(updated.authority.nonAuthoritative).toBe(true);
  });

  it('authority remains review-only after advanceStage', () => {
    const job = makeJob({ status: 'running' });
    const updated = advanceStage(job, 'depth_estimation');
    expect(updated.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('authority remains review-only after transitionToCompleted', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToCompleted(job);
    expect(updated.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('authority remains review-only after transitionToFailed', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToFailed(job, 'segmentation');
    expect(updated.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });

  it('authority remains review-only after transitionToCancelled', () => {
    const job = makeJob({ status: 'running' });
    const updated = transitionToCancelled(job);
    expect(updated.authority).toEqual(REVIEW_ONLY_AUTHORITY);
  });
});
