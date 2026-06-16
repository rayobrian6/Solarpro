export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30; // PVWatts API + optional DB calls need headroom

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getProjectById, getClientById, getLayoutByProject,
  upsertLayout, updateProject, upsertProduction,
  handleRouteDbError,
} from '@/lib/db-neon';
import { calculateProduction, calculateProductionFromDefinition } from '@/lib/pvwatts';
import { calculateFinalPrice, calculateItemizedPrice, loadPricingConfig, type SalesOverride } from '@/lib/pricingEngine';
import { buildArraysFromLayout, buildSystemConfig, buildArrayBreakdown } from '@/lib/multiArrayEngine';
import type { Client, Layout, SystemDefinition, LocationInput } from '@/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Validate ephemeral inputs and return structured INSUFFICIENT_INPUT if needed */
function validateEphemeralInputs(
  systemDef: SystemDefinition | undefined,
  location: LocationInput | undefined,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  if (!systemDef || !systemDef.panels || systemDef.panels.length === 0) missing.push('panels');
  if (!location  || location.lat == null || location.lng == null)         missing.push('location');
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}

/** Build a cost estimate from production result, panels and pricing config */
function buildCostEstimate(params: {
  panels: any[];
  systemSizeKw: number;
  layoutType: string;
  annualProductionKwh: number;
  utilityRate: number;
  pricingCfg: any;
  client?: Client | null;
  salesOverride?: SalesOverride;
  solarArrays?: any;
}) {
  const {
    panels, systemSizeKw, layoutType, annualProductionKwh,
    utilityRate, pricingCfg, client, salesOverride, solarArrays,
  } = params;

  const itemized  = calculateItemizedPrice(panels, layoutType, pricingCfg);
  const cashPrice = itemized.totalCashPrice;
  // taxCreditRate is a legacy field hard-coded to 0 — use the real ITC config
  // (matches calculateFinalPrice): commercial §48E = itcRateCommercial (30%),
  // residential §25D = itcRateResidential (0 after the P.L.119-21 repeal).
  const itcPercent = pricingCfg.isCommercial ? pricingCfg.itcRateCommercial : pricingCfg.itcRateResidential;
  const itcAmount = Math.round(cashPrice * ((itcPercent ?? 0) / 100));
  const netCost   = cashPrice - itcAmount;
  const rate      = utilityRate || 0.13;
  const annualSavings  = Math.round(annualProductionKwh * rate);
  const paybackYears   = annualSavings > 0 ? parseFloat((netCost / annualSavings).toFixed(1)) : 0;

  let lifetimeSavings = 0;
  let escalatingRate  = rate;
  for (let y = 0; y < pricingCfg.systemLife; y++) {
    lifetimeSavings += annualProductionKwh * escalatingRate;
    escalatingRate  *= (1 + pricingCfg.utilityEscalation / 100);
  }
  lifetimeSavings = Math.round(lifetimeSavings);
  const roi = netCost > 0 ? parseFloat((((lifetimeSavings - netCost) / netCost) * 100).toFixed(1)) : 0;

  const pricingAlt = client
    ? calculateFinalPrice(systemSizeKw, layoutType, annualProductionKwh, client, salesOverride, pricingCfg)
    : null;

  let arrayBreakdown: any[] | undefined;
  if (solarArrays) {
    const config = buildSystemConfig(solarArrays);
    const bd     = buildArrayBreakdown(config);
    if (bd.length > 1) arrayBreakdown = bd;
  }

  return {
    systemSizeKw,
    lineItems:           itemized.lineItems,
    subtotalBeforeFixed: itemized.subtotalBeforeFixed,
    fixedCosts:          pricingCfg.fixedCost,
    grossCost:           cashPrice,
    totalBeforeCredit:   cashPrice,
    taxCredit:           itcAmount,
    netCost,
    annualSavings,
    paybackYears,
    lifetimeSavings,
    roi,
    pricePerWatt: systemSizeKw > 0
      ? parseFloat((cashPrice / (systemSizeKw * 1000)).toFixed(2))
      : 0,
    cashPrice,
    costAfterIncentives: netCost,
    internalRevenue: pricingAlt?.revenue       ?? 0,
    internalCost:    pricingAlt?.estimatedCost ?? 0,
    internalProfit:  pricingAlt?.grossProfit   ?? 0,
    internalMargin:  pricingAlt?.marginPercent ?? 0,
    arrayBreakdown,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: build SystemDefinition from a saved Layout
// ─────────────────────────────────────────────────────────────────────────────
function layoutToSystemDef(layout: Layout): SystemDefinition {
  return {
    panels:            layout.panels ?? [],
    systemType:        layout.systemType,
    tilt:              layout.groundTilt,
    azimuth:           layout.groundAzimuth,
    groundTilt:        layout.groundTilt,
    groundAzimuth:     layout.groundAzimuth,
    fenceAzimuth:      layout.fenceAzimuth,
    fenceHeight:       layout.fenceHeight,
    bifacialOptimized: layout.bifacialOptimized,
    totalPanels:       layout.totalPanels,
    systemSizeKw:      layout.systemSizeKw,
    roofPlanes:        layout.roofPlanes,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: coerce SystemDefinition into a layout-shaped object for upsertLayout
// ─────────────────────────────────────────────────────────────────────────────
function buildLayoutFromDefinition(
  systemDef: SystemDefinition,
  projectId: string,
  project: any,
): Omit<Layout, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    projectId,
    systemType:        systemDef.systemType || project.systemType || 'roof',
    panels:            systemDef.panels ?? [],
    roofPlanes:        systemDef.roofPlanes,
    groundTilt:        systemDef.groundTilt        ?? 20,
    groundAzimuth:     systemDef.groundAzimuth     ?? 180,
    rowSpacing:        1.5,
    groundHeight:      0.6,
    fenceAzimuth:      systemDef.fenceAzimuth,
    fenceHeight:       systemDef.fenceHeight,
    bifacialOptimized: systemDef.bifacialOptimized ?? false,
    totalPanels:       systemDef.panels?.length    ?? 0,
    systemSizeKw:      systemDef.systemSizeKw      ?? (systemDef.panels?.length ?? 0) * 0.4,
    mapCenter:         { lat: 33.4484, lng: -112.074 },
    mapZoom:           18,
  } as any;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/production
//
// Shape A — Ephemeral (no projectId):
//   { systemDefinition, location, salesOverride? }
//
// Shape B — Project-backed (projectId present, backward-compatible):
//   { projectId, layout, salesOverride? }
//   OR: { projectId, systemDefinition, location, salesOverride? }
// ─────────────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const rl = await checkRateLimit('production', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const body = await req.json();

    const hasProjectId    = !!body.projectId;
    const hasSystemDef    = !!body.systemDefinition;
    const hasLegacyLayout = !!body.layout;

    // ── Shape A: pure ephemeral ───────────────────────────────────────────────
    if (!hasProjectId && !hasLegacyLayout) {
      const systemDef: SystemDefinition | undefined = body.systemDefinition;
      const location:  LocationInput   | undefined  = body.location;

      const validation = validateEphemeralInputs(systemDef, location);
      if (!validation.ok) {
        const missing = (validation as { ok: false; missing: string[] }).missing;
        return NextResponse.json(
          {
            success: false,
            error:   'INSUFFICIENT_INPUT',
            missing,
            message: `Missing required inputs: ${missing.join(', ')}`,
          },
          { status: 400 }
        );
      }

      const productionData = await calculateProductionFromDefinition(systemDef!, location!);
      const production = {
        ...productionData,
        id:           `prod-ephemeral-${Date.now()}`,
        projectId:    null,
        calculatedAt: new Date().toISOString(),
        ephemeral:    true,
      };

      const pricingCfg   = await loadPricingConfig();
      const panels       = systemDef!.panels ?? [];
      const systemSizeKw = systemDef!.systemSizeKw
        ?? Math.max((panels.length * ((panels[0] as any)?.wattage ?? 400)) / 1000, 1.0);
      const layoutType   = systemDef!.systemType ?? 'roof';
      const utilityRate  = location!.utilityRate ?? 0.13;

      const costEstimate = buildCostEstimate({
        panels, systemSizeKw, layoutType,
        annualProductionKwh: production.annualProductionKwh,
        utilityRate,
        pricingCfg,
        client:        null,
        salesOverride: body.salesOverride,
      });

      console.log(
        `[PRODUCTION_EPHEMERAL] userId=${user.id}` +
        ` panels=${panels.length} size=${systemSizeKw.toFixed(2)}kW` +
        ` lat=${location!.lat} lng=${location!.lng}` +
        ` annual=${production.annualProductionKwh}kWh`
      );

      return NextResponse.json({
        success: true,
        data:    { production, costEstimate, layout: null, ephemeral: true },
      });
    }

    // ── Shape B: project-backed ───────────────────────────────────────────────
    const { projectId } = body;

    if (!projectId) {
      return NextResponse.json(
        {
          success: false,
          error:   'INSUFFICIENT_INPUT',
          missing: ['panels', 'location'],
          message: 'Either projectId or (systemDefinition + location) is required',
        },
        { status: 400 }
      );
    }

    const project = await getProjectById(projectId, user.id);

    // ── Fallback: if project lookup failed but we have systemDefinition + location,
    // run ephemeral calculation rather than returning an error.
    // This handles: expired session, auth mismatch, deleted project, etc.
    // Production calculation should ALWAYS succeed when data is present.
    if (!project && hasSystemDef && body.location) {
      const systemDef: SystemDefinition | undefined = body.systemDefinition;
      const location:  LocationInput   | undefined  = body.location;
      const validation = validateEphemeralInputs(systemDef, location);
      if (validation.ok) {
        console.log(`[PRODUCTION_FALLBACK_EPHEMERAL] projectId=${projectId} userId=${user.id} — project not found, falling back to ephemeral calc`);
        const productionData = await calculateProductionFromDefinition(systemDef!, location!);
        const production = {
          ...productionData,
          id:           `prod-ephemeral-${Date.now()}`,
          projectId:    null,
          calculatedAt: new Date().toISOString(),
          ephemeral:    true,
        };
        const pricingCfg   = await loadPricingConfig();
        const panels       = systemDef!.panels ?? [];
        const systemSizeKw = systemDef!.systemSizeKw
          ?? Math.max((panels.length * ((panels[0] as any)?.wattage ?? 400)) / 1000, 1.0);
        const layoutType   = systemDef!.systemType ?? 'roof';
        const utilityRate  = location!.utilityRate ?? 0.13;
        const costEstimate = buildCostEstimate({
          panels, systemSizeKw, layoutType,
          annualProductionKwh: production.annualProductionKwh,
          utilityRate, pricingCfg,
          client: null,
          salesOverride: body.salesOverride,
        });
        return NextResponse.json({
          success: true,
          data:    { production, costEstimate, layout: null, ephemeral: true },
        });
      }
      // systemDef/location present but invalid — fall through to the original 404
    }

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    // Resolve raw layout from request
    const rawLayout: Omit<Layout, 'id' | 'createdAt' | 'updatedAt'> | null =
      hasLegacyLayout ? body.layout
      : hasSystemDef  ? buildLayoutFromDefinition(body.systemDefinition, projectId, project)
      : null;

    if (!rawLayout || !rawLayout.panels?.length) {
      return NextResponse.json(
        {
          success: false,
          error:   'INSUFFICIENT_INPUT',
          missing: ['panels'],
          message: 'Layout with at least one panel is required',
        },
        { status: 400 }
      );
    }

    // Try to get client for enrichment
    let client: Client | null = null;
    if (project.clientId) {
      client = await getClientById(project.clientId, user.id);
    }

    // No client — use project/layout coordinates if available
    if (!client) {
      const lat = (project as any).lat ?? rawLayout.mapCenter?.lat;
      const lng = (project as any).lng ?? rawLayout.mapCenter?.lng;

      if (!lat || !lng) {
        return NextResponse.json(
          {
            success: false,
            error:   'INSUFFICIENT_INPUT',
            missing: ['location'],
            message: 'No client or location data found for this project',
          },
          { status: 400 }
        );
      }

      const syntheticLocation: LocationInput = {
        lat,
        lng,
        annualKwh:   (project as any).annualKwh  ?? 12000,
        utilityRate: (project as any).utilityRate ?? 0.13,
      };

      const savedLayout = await upsertLayout({
        projectId, userId: user.id, ...rawLayout,
      } as any);

      const productionData = await calculateProductionFromDefinition(
        layoutToSystemDef(savedLayout),
        syntheticLocation,
      );
      const production = {
        ...productionData,
        id:           `prod-${Date.now()}`,
        projectId,
        calculatedAt: new Date().toISOString(),
      };

      const pricingCfg = await loadPricingConfig();
      const costEstimate = buildCostEstimate({
        panels:              savedLayout.panels ?? [],
        systemSizeKw:        savedLayout.systemSizeKw,
        layoutType:          savedLayout.systemType ?? 'roof',
        annualProductionKwh: production.annualProductionKwh,
        utilityRate:         syntheticLocation.utilityRate!,
        pricingCfg,
        client:              null,
        salesOverride:       body.salesOverride,
      });

      await updateProject(projectId, user.id, { status: 'design', systemSizeKw: savedLayout.systemSizeKw });
      await upsertProduction({
        projectId, userId: user.id, production, costEstimate,
        selectedPanel:    body.selectedPanel   ?? null,
        selectedInverter: body.selectedInverter ?? null,
        systemSizeKw:     savedLayout.systemSizeKw,
        panelCount:       savedLayout.totalPanels,
      });

      return NextResponse.json({ success: true, data: { layout: savedLayout, production, costEstimate } });
    }

    // ── Full project + client path (original behaviour) ───────────────────────
    const savedLayout = await upsertLayout({
      projectId,
      userId:            user.id,
      systemType:        rawLayout.systemType || project.systemType || 'roof',
      panels:            rawLayout.panels     || [],
      roofPlanes:        rawLayout.roofPlanes,
      groundTilt:        rawLayout.groundTilt        ?? 20,
      groundAzimuth:     rawLayout.groundAzimuth     ?? 180,
      rowSpacing:        rawLayout.rowSpacing         ?? 1.5,
      groundHeight:      rawLayout.groundHeight       ?? 0.6,
      fenceAzimuth:      rawLayout.fenceAzimuth,
      fenceHeight:       rawLayout.fenceHeight,
      fenceLine:         rawLayout.fenceLine,
      bifacialOptimized: rawLayout.bifacialOptimized  ?? false,
      totalPanels:       rawLayout.panels?.length     ?? 0,
      systemSizeKw:      rawLayout.systemSizeKw       ?? (rawLayout.panels?.length ?? 0) * 0.4,
      mapCenter:         rawLayout.mapCenter,
      mapZoom:           rawLayout.mapZoom,
    });

    const productionData = await calculateProduction(savedLayout, client);
    const production = {
      ...productionData,
      id:           `prod-${Date.now()}`,
      projectId,
      calculatedAt: new Date().toISOString(),
    };

    const pricingCfg  = await loadPricingConfig();
    const lat         = client.lat  ?? 33.4484;
    const lng         = client.lng  ?? -112.074;
    const solarArrays = buildArraysFromLayout(savedLayout, lat, lng);
    const layoutType  = savedLayout.systemType ?? project.systemType ?? 'roof';

    const costEstimate = buildCostEstimate({
      panels:              savedLayout.panels ?? [],
      systemSizeKw:        savedLayout.systemSizeKw,
      layoutType,
      annualProductionKwh: production.annualProductionKwh,
      utilityRate:         client.utilityRate || 0.13,
      pricingCfg,
      client,
      salesOverride:       body.salesOverride,
      solarArrays,
    });

    await updateProject(projectId, user.id, { status: 'design', systemSizeKw: savedLayout.systemSizeKw });
    await upsertProduction({
      projectId, userId: user.id, production, costEstimate,
      selectedPanel:    body.selectedPanel   ?? null,
      selectedInverter: body.selectedInverter ?? null,
      systemSizeKw:     savedLayout.systemSizeKw,
      panelCount:       savedLayout.totalPanels,
    });

    return NextResponse.json({ success: true, data: { layout: savedLayout, production, costEstimate } });

  } catch (error: unknown) {
    const errMsg   = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack   : undefined;
    console.error('[PRODUCTION_ERROR] POST /api/production failed:', errMsg, errStack);

    const { DbConfigError } = await import('@/lib/db-ready');
    if (
      error instanceof DbConfigError ||
      (errMsg && (
        errMsg.includes('endpoint is starting') ||
        errMsg.includes('compute is starting')  ||
        errMsg.includes('ECONNRESET')            ||
        errMsg.includes('ECONNREFUSED')          ||
        errMsg.includes('fetch failed')          ||
        errMsg.includes('network error')
      ))
    ) {
      return handleRouteDbError('[POST /api/production]', error);
    }

    return NextResponse.json(
      { success: false, error: errMsg || 'Production calculation failed' },
      { status: 500 }
    );
  }
}

// ─── GET /api/production ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');
    if (!projectId) return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });

    const project = await getProjectById(projectId, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const layout = await getLayoutByProject(projectId, user.id);

    let costEstimate = null;
    if (layout && project.clientId) {
      const client = await getClientById(project.clientId, user.id);
      if (client) {
        const pricingCfg = await loadPricingConfig();
        const pricing = calculateFinalPrice(
          layout.systemSizeKw,
          layout.systemType ?? project.systemType ?? 'roof',
          0,
          client,
          undefined,
          pricingCfg
        );
        costEstimate = {
          systemSizeKw:        layout.systemSizeKw,
          grossCost:           pricing.cashPrice,
          laborCost:           Math.round(layout.systemSizeKw * 1000 * 0.75),
          equipmentCost:       Math.round(layout.systemSizeKw * 1000 * 0.55),
          fixedCosts:          2000,
          totalBeforeCredit:   pricing.cashPrice,
          taxCredit:           pricing.itcAmount,
          netCost:             pricing.costAfterIncentives,
          annualSavings:       pricing.annualSavings,
          paybackYears:        pricing.paybackYears,
          lifetimeSavings:     pricing.lifetimeSavings,
          roi:                 pricing.roi,
          pricePerWatt:        pricing.pricePerWatt,
          cashPrice:           pricing.cashPrice,
          costAfterIncentives: pricing.costAfterIncentives,
          internalRevenue:     pricing.revenue,
          internalCost:        pricing.estimatedCost,
          internalProfit:      pricing.grossProfit,
          internalMargin:      pricing.marginPercent,
        };
      }
    }

    return NextResponse.json({ success: true, data: { production: null, layout, costEstimate } });
  } catch (error: unknown) {
    return handleRouteDbError('[GET /api/production]', error);
  }
}