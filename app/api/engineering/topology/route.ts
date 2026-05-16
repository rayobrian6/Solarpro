// ============================================================
// POST /api/engineering/topology
// Registry-driven topology detection — V4
// Uses topology-manager.ts — NO brand conditionals
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
import { resolveTopology, TopologyManagerContext } from '@/lib/topology-manager';
import { TOPOLOGY_LABELS_V4 } from '@/lib/equipment-registry-v4';
import { requireAuth } from '@/lib/security';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export async function POST(req: NextRequest) {
  // SECURITY: Require authenticated user
  const _auth = await requireAuth(req); if (_auth.response) return _auth.response;

  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const body = await req.json();

    const ctx: TopologyManagerContext = {
      inverterId:    body.inverterId    ?? body.newInverterId ?? 'fronius-primo-8.2',
      optimizerId:   body.optimizerId   ?? body.newOptimizerId,
      rackingId:     body.rackingId     ?? body.mountingId,
      batteryId:     body.batteryId,
      moduleCount:   Number(body.moduleCount   ?? body.totalModules)  || 20,
      stringCount:   Number(body.stringCount   ?? body.totalStrings)  || 2,
      inverterCount: Number(body.inverterCount ?? body.inverters?.length) || 1,
      roofType:      body.roofType,
      systemType:    body.systemType,
    };

    const result = resolveTopology(ctx);

    return NextResponse.json({
      success: true,
      topology:      result.topology,
      topologyLabel: result.label,
      mountTopology: result.mountTopology,
      confidence:    result.confidence,
      reason:        result.reason,

      // Accessory resolution
      resolvedAccessories:       result.resolvedAccessories,
      missingRequiredCategories: result.missingRequiredCategories,

      // SLD + BOM structure
      sldStages: result.sldStages,
      bomStages: result.bomStages,

      // Compliance
      complianceFlags: result.complianceFlags,

      // Rule set summary
      ruleSet: {
        label:                    result.ruleSet.label,
        description:              result.ruleSet.description,
        requiredAccessoryClasses: result.ruleSet.requiredAccessoryClasses,
        optionalAccessoryClasses: result.ruleSet.optionalAccessoryClasses,
      },

      // All topology labels for UI dropdowns
      topologyLabels: TOPOLOGY_LABELS_V4,
    });

  } catch (err: unknown) {
    return handleRouteDbError('[app/api/engineering/topology/route.ts]', err);
  }
}