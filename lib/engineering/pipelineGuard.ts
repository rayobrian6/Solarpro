// ============================================================
// lib/engineering/pipelineGuard.ts
// PIPELINE_NOT_EXECUTED guard — enforces canonical snapshot contract
//
// Any page/route that requires pipeline data MUST call this guard
// before rendering. If canonicalSnapshot is missing or incomplete,
// the guard returns a structured error response that the route
// must return immediately.
//
// Usage:
//   const guard = checkPipelineGuard(project.canonicalSnapshot);
//   if (guard) return guard;
//
// This enforces STEP 5 of the canonical pipeline directive:
//   "DO NOT render planset/proposal/engineering if snapshot is missing"
// ============================================================

import { NextResponse } from 'next/server';
import type { CanonicalSnapshot } from './syncPipeline';

// ── Standard error payload ────────────────────────────────────────────────

export interface PipelineNotExecutedError {
  error:   'PIPELINE_NOT_EXECUTED';
  message: string;
  hint:    string;
}

export const PIPELINE_NOT_EXECUTED_PAYLOAD: PipelineNotExecutedError = {
  error:   'PIPELINE_NOT_EXECUTED',
  message: 'Run syncProjectPipeline before accessing this view',
  hint:    'POST /api/pipeline/run with { projectId } to execute the pipeline',
};

// ── Guard check ───────────────────────────────────────────────────────────

/**
 * Checks whether the canonicalSnapshot is present and minimally valid.
 *
 * Returns a 424 NextResponse if the snapshot is missing/incomplete,
 * or null if the snapshot is valid (caller may proceed).
 *
 * 424 = "Failed Dependency" — semantically correct: this resource
 * cannot be served until the pipeline dependency has been executed.
 */
export function checkPipelineGuard(
  canonicalSnapshot: CanonicalSnapshot | null | undefined,
  projectId?: string,
): NextResponse | null {
  if (!canonicalSnapshot) {
    console.warn('[PIPELINE_GUARD_BLOCKED]', {
      reason:    'canonicalSnapshot is null',
      projectId: projectId ?? 'unknown',
      ts:        new Date().toISOString(),
    });
    return NextResponse.json(
      { ...PIPELINE_NOT_EXECUTED_PAYLOAD, projectId },
      { status: 424 },
    );
  }

  // Minimal completeness check
  const incomplete: string[] = [];
  if (!canonicalSnapshot.engineering?.panelCount) incomplete.push('engineering.panelCount');
  if (!canonicalSnapshot.engineering?.systemSizeKw) incomplete.push('engineering.systemSizeKw');
  if (!canonicalSnapshot.metadata?.timestamp) incomplete.push('metadata.timestamp');

  if (incomplete.length > 0) {
    console.warn('[PIPELINE_GUARD_BLOCKED]', {
      reason:    'canonicalSnapshot incomplete',
      missing:   incomplete,
      projectId: projectId ?? 'unknown',
      ts:        new Date().toISOString(),
    });
    return NextResponse.json(
      {
        ...PIPELINE_NOT_EXECUTED_PAYLOAD,
        projectId,
        message: `canonicalSnapshot is incomplete — missing: ${incomplete.join(', ')}`,
      },
      { status: 424 },
    );
  }

  return null; // ✅ snapshot is valid, caller may proceed
}

/**
 * Read canonicalSnapshot from a raw project DB row.
 * The column may be called canonical_snapshot (snake_case) from Postgres
 * or canonicalSnapshot (camelCase) if already mapped.
 */
export function extractCanonicalSnapshot(
  project: Record<string, unknown>,
): CanonicalSnapshot | null {
  const raw =
    (project.canonicalSnapshot as CanonicalSnapshot | undefined) ??
    (project.canonical_snapshot as CanonicalSnapshot | undefined) ??
    null;
  return raw;
}