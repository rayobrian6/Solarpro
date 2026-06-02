/**
 * Stale-job cleanup for geometry reconstruction jobs.
 *
 * Jobs that have been "running" or "queued" for too long without a heartbeat
 * are considered stale (likely crashed, timed out, or orphaned). This module
 * marks them as "failed" with a descriptive error message so they stop
 * appearing as "in progress" in the UI.
 *
 * NEON DRIVER: Uses getDbReady() for cold-start resilience.
 * REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY
 */

import { getDbReady } from '@/lib/db/core';

/** Job statuses that are considered "active" (could become stale). */
const ACTIVE_STATUSES = ['running', 'queued', 'running_heartbeat'] as const;

/** Default stale threshold: jobs with no heartbeat for 10 minutes are stale. */
const DEFAULT_STALE_THRESHOLD_MINUTES = 10;

/** Default orphan threshold: jobs that have been queued/running for 30+ minutes
 *  with no heartbeat at all are orphans. */
const DEFAULT_ORPHAN_THRESHOLD_MINUTES = 30;

export interface StaleJobCleanupResult {
  /** Number of stale jobs marked as failed */
  staleMarkedFailed: number;
  /** Number of orphan jobs (no heartbeat ever) marked as failed */
  orphanMarkedFailed: number;
  /** IDs of jobs that were marked as failed */
  failedJobIds: string[];
  /** Timestamp of the cleanup run */
  cleanupAt: string;
}

/**
 * Mark stale geometry reconstruction jobs as failed.
 *
 * A job is considered stale if:
 *   1. Its status is 'running' or 'running_heartbeat' AND its last_heartbeat_at
 *      is older than staleThresholdMinutes ago (pipeline crashed mid-execution).
 *   2. Its status is 'queued' AND its created_at is older than
 *      orphanThresholdMinutes ago (job was never picked up).
 *
 * This is safe to run repeatedly — it only updates jobs that are still in an
 * active status, so already-failed/already-completed jobs are never touched.
 *
 * @param staleThresholdMinutes - Minutes without heartbeat before marking as stale (default: 10)
 * @param orphanThresholdMinutes - Minutes a queued job can exist before being marked as orphan (default: 30)
 * @returns Cleanup result with counts and IDs
 */
export async function markStaleJobsAsFailed(
  staleThresholdMinutes: number = DEFAULT_STALE_THRESHOLD_MINUTES,
  orphanThresholdMinutes: number = DEFAULT_ORPHAN_THRESHOLD_MINUTES,
): Promise<StaleJobCleanupResult> {
  const sql = await getDbReady();
  const failedJobIds: string[] = [];
  let staleMarkedFailed = 0;
  let orphanMarkedFailed = 0;

  // 1. Mark running jobs with stale heartbeats as failed
  // NOTE: Neon tagged templates parameterize ${value} interpolations. We cannot
  // embed a parameter inside INTERVAL '...' — it becomes INTERVAL '$1 minutes'
  // which is invalid. Instead, multiply INTERVAL '1 minute' by the parameter.
  const staleResult = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET
      status = 'failed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE status IN (${ACTIVE_STATUSES[0]}, ${ACTIVE_STATUSES[2]})
      AND last_heartbeat_at < NOW() - INTERVAL '1 minute' * ${staleThresholdMinutes}
    RETURNING id
  `;

  staleMarkedFailed = staleResult.length;
  for (const row of staleResult as { id: string }[]) {
    failedJobIds.push(row.id);
  }

  // 2. Mark orphan queued jobs as failed
  // Same INTERVAL pattern as above — multiply INTERVAL '1 minute' by parameter
  const orphanResult = await sql`
    UPDATE site_survey_geometry_reconstruction_jobs
    SET
      status = 'failed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE status = ${ACTIVE_STATUSES[1]}
      AND created_at < NOW() - INTERVAL '1 minute' * ${orphanThresholdMinutes}
    RETURNING id
  `;

  orphanMarkedFailed = orphanResult.length;
  for (const row of orphanResult as { id: string }[]) {
    failedJobIds.push(row.id);
  }

  const result: StaleJobCleanupResult = {
    staleMarkedFailed,
    orphanMarkedFailed,
    failedJobIds,
    cleanupAt: new Date().toISOString(),
  };

  if (failedJobIds.length > 0) {
    console.info(
      `[markStaleJobsAsFailed] Marked ${staleMarkedFailed} stale + ${orphanMarkedFailed} orphan jobs as failed: ${failedJobIds.join(', ')}`,
    );
  }

  return result;
}
