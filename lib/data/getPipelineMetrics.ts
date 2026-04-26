/**
 * Pipeline Metrics Aggregation — Canonical Source of Truth
 * 
 * ALL dashboard/command-center pipeline values MUST use these functions.
 * Fields match the actual Project type from @/types:
 *   - status (not "stage"): 'lead' | 'design' | 'proposal' | 'approved' | 'installed'
 *   - costEstimate?.netCost (primary cost source)
 */

import type { Project } from '@/types';

export interface PipelineMetrics {
  /** Revenue from projects NOT yet installed */
  activeRevenue: number;
  /** Revenue from 'proposal' + 'approved' status */
  awaitingClose: number;
  /** Revenue from projects stalled >5 days at 'proposal' status */
  stalledRevenue: number;
  /** Total revenue across all projects */
  totalRevenue: number;
  /** Project counts */
  totalProjects: number;
  proposalCount: number;
  approvedCount: number;
  criticalCount: number;
  /** Conversion rate: approved / (proposal + approved + installed) */
  conversionRate: number;
}

function daysSince(dateStr: string | undefined | null): number {
  if (!dateStr) return 0;
  try {
    return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000));
  } catch {
    return 0;
  }
}

/**
 * Multi-source cost resolution — accepts cost from ANY valid source.
 * 
 * Priority chain:
 * 1. costEstimate.netCost (canonical — from productions.data_json)
 * 2. costEstimate.grossCost (fallback if netCost is missing)
 * 3. production as Record with netCost/totalCost/systemCost (edge cases)
 * 4. 0 (no cost data available)
 *
 * This ensures backward compatibility and prevents false $0 for any
 * project that has cost data stored in any recognized format.
 */
function getCost(p: Project): number {
  // Primary: costEstimate.netCost (the canonical field)
  if (p.costEstimate?.netCost && p.costEstimate.netCost > 0) {
    return p.costEstimate.netCost;
  }

  // Fallback: costEstimate.grossCost (if netCost wasn't calculated)
  if (p.costEstimate?.grossCost && p.costEstimate.grossCost > 0) {
    return p.costEstimate.grossCost;
  }

  // Fallback: production record might have cost fields directly
  // (handles legacy or edge-case data shapes)
  if (p.production) {
    const prod = p.production as unknown as Record<string, unknown>;
    const candidates = [
      prod.netCost, prod.net_cost,
      prod.totalCost, prod.total_cost,
      prod.systemCost, prod.system_cost,
    ];
    for (const val of candidates) {
      if (typeof val === 'number' && val > 0) return val;
    }
  }

  // Dev-mode warning: project is past design but has no cost data
  if (p.status === 'proposal' || p.status === 'approved' || p.status === 'installed') {
    console.warn(
      `[PIPELINE] Project "${p.name}" (${p.id}) status="${p.status}" has NO cost data — showing $0`
    );
  }

  return 0;
}

/**
 * Aggregates pipeline metrics from projects list.
 * This is the CANONICAL source of truth for all pipeline data.
 */
export function getPipelineMetrics(projects: Project[] | null | undefined): PipelineMetrics {
  const empty: PipelineMetrics = {
    activeRevenue: 0,
    awaitingClose: 0,
    stalledRevenue: 0,
    totalRevenue: 0,
    totalProjects: 0,
    proposalCount: 0,
    approvedCount: 0,
    criticalCount: 0,
    conversionRate: 0,
  };

  if (!projects || !Array.isArray(projects) || projects.length === 0) {
    if (!projects || !Array.isArray(projects)) {
      console.warn('[PIPELINE] No projects array provided');
    }
    return empty;
  }

  const valid = projects.filter(p => p != null);

  // Active revenue: everything except installed
  const activeRevenue = valid
    .filter(p => p.status !== 'installed')
    .reduce((s, p) => s + getCost(p), 0);

  // Awaiting close: proposal + approved
  const awaitingClose = valid
    .filter(p => p.status === 'proposal' || p.status === 'approved')
    .reduce((s, p) => s + getCost(p), 0);

  // Stalled: proposal with no update in 3+ days OR approved with no update in 5+ days
  // (mirrors the real urgency thresholds used across all UI)
  const stalledRevenue = valid
    .filter(p =>
      (p.status === 'proposal' && daysSince(p.updatedAt) >= 3) ||
      (p.status === 'approved' && daysSince(p.updatedAt) >= 5)
    )
    .reduce((s, p) => s + getCost(p), 0);

  // Total revenue across all
  const totalRevenue = valid.reduce((s, p) => s + getCost(p), 0);

  // Counts
  const proposalCount = valid.filter(p =>
    p.status === 'proposal' || p.status === 'approved' || p.status === 'installed'
  ).length;
  const approvedCount = valid.filter(p =>
    p.status === 'approved' || p.status === 'installed'
  ).length;
  const criticalCount = valid.filter(p =>
    p.status === 'proposal' || p.status === 'approved'
  ).length;
  const conversionRate = proposalCount > 0
    ? Math.round((approvedCount / proposalCount) * 100)
    : 0;

  return {
    activeRevenue,
    awaitingClose,
    stalledRevenue,
    totalRevenue,
    totalProjects: valid.length,
    proposalCount,
    approvedCount,
    criticalCount,
    conversionRate,
  };
}