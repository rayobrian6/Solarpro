export const dynamic    = 'force-dynamic';
export const runtime    = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30; // PVWatts API + optional DB calls need headroom

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getProjectById, getClientById, getLayoutByProject,
  upsertLayout, updateProject, upsertProduction, upsertSelectedEquipment,
  handleRouteDbError,
} from '@/lib/db-neon';
import { designEquipmentPatch, type SelectedEquipment } from '@/lib/system/selectedEquipment';
import { designSubSystemBlocks } from '@/lib/system/designToEngineering';
import { calculateProduction, calculateProductionFromDefinition } from '@/lib/pvwatts';
import { calculateFinalPrice, calculateItemizedPrice, loadPricingConfig, type SalesOverride } from '@/lib/pricingEngine';
import { buildArraysFromLayout, buildSystemConfig, buildArrayBreakdown } from '@/lib/multiArrayEngine';
import type { Client, Layout, SystemDefinition, LocationInput } from '@/types';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wave 4A (contract §1.3/§1.4): scope a flat design-equipment patch when the
 * saved layout carries a v2 per-sub electrical split. The design's flat
 * selection IS the primary mirror, so the flat ids are folded into an
 * explicit `subSystems[primaryKey]` entry + schemaVersion 2 — a first-class
 * primary-scoped v2 write (per-key deep merge downstream), not a legacy flat
 * write the storage layer has to re-mirror with an old-client warning.
 * Single-type layouts (no split) return the patch unchanged (byte-identical).
 */
function scopeDesignEquipmentPatch(
  patch: SelectedEquipment,
  layoutDesignElectrical: unknown,
): Record<string, unknown> {
  const blocks = designSubSystemBlocks(
    layoutDesignElectrical as import('@/types').DesignElectrical | undefined,
  );
  if (!blocks) return patch as Record<string, unknown>;
  const primaryKey = blocks[0].key; // fixed roof > ground > fence order (§1.4)
  const entry: Record<string, unknown> = {
    key: primaryKey,
    source: 'design',
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  if (patch.panelId) entry.panelId = patch.panelId;
  if (patch.inverterId) entry.inverterId = patch.inverterId;
  return {
    ...(patch as Record<string, unknown>),
    schemaVersion: 2,
    subSystems: { [primaryKey]: entry },
  };
}

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
    // 🚨 SAY NOTHING RATHER THAN SAY SOMETHING FALSE.
    //
    // This function was written to satisfy `upsertLayout`'s TYPE, not to
    // describe a real layout — and a read-only production CALCULATION is routed
    // through it (the branch below picks it whenever the body carries a
    // systemDefinition and no layout, which is exactly what the studio's
    // Calculate button sends). So every invented value here was persisted as
    // fact about the user's design.
    //
    // The worst was `mapCenter: { lat: 33.4484, lng: -112.074 }` — PHOENIX,
    // hardcoded. `map_center` IS COALESCE'd in upsertLayout, but COALESCE only
    // protects against ABSENCE, and this supplied a confident wrong answer
    // instead, so the column was overwritten with Arizona for every project that
    // ever pressed Calculate. A fabricated value defeats a guard that a missing
    // one would have satisfied.
    //
    // `rowSpacing: 1.5` and `groundHeight: 0.6` were literals with no source at
    // all, overwriting whatever the user had set.
    //
    // These are now `undefined`, which upsertLayout's COALESCE reads as "keep
    // what is stored" — the honest answer for a caller that does not know.
    groundTilt:        systemDef.groundTilt,
    groundAzimuth:     systemDef.groundAzimuth,
    rowSpacing:        undefined,
    groundHeight:      undefined,
    fenceAzimuth:      systemDef.fenceAzimuth,
    fenceHeight:       systemDef.fenceHeight,
    bifacialOptimized: systemDef.bifacialOptimized ?? false,
    totalPanels:       systemDef.panels?.length    ?? 0,
    systemSizeKw:      systemDef.systemSizeKw      ?? (systemDef.panels?.length ?? 0) * 0.4,
    mapCenter:         undefined,
    mapZoom:           undefined,
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

      // 🚨 THE AUTHENTICATED IDENTITY GOES LAST, NOT FIRST.
      // `{ projectId, userId, ...rawLayout }` spread CLIENT JSON over both —
      // `rawLayout` is `body.layout` verbatim on the legacy path — so a request
      // carrying `layout.projectId` or `layout.userId` wrote the row those
      // named, not the one `getProjectById(projectId, user.id)` authorised a
      // moment earlier. The ownership check ran against a value the body then
      // replaced.
      const savedLayout = await upsertLayout({
        ...rawLayout, projectId, userId: user.id,
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
        // Coalesce with the already-persisted (hydrated) project values so a save
        // that omits the selection doesn't wipe it — upsertProduction overwrites
        // data_json wholesale (engineering audit: null-overwrite regression).
        selectedPanel:    body.selectedPanel    ?? project.selectedPanel    ?? null,
        selectedInverter: body.selectedInverter ?? project.selectedInverter ?? null,
        systemSizeKw:     savedLayout.systemSizeKw,
        panelCount:       savedLayout.totalPanels,
      });

      // Design → canonical selected_equipment (migration 101): keep the design a
      // live writer of the store so it isn't shadowed by a stale engineering
      // write-back. Non-fatal. Wave 4A: primary-scoped v2 write when the saved
      // layout carries a per-sub electrical split (see scopeDesignEquipmentPatch).
      try {
        const eqPatch = designEquipmentPatch(
          body.selectedPanel ?? project.selectedPanel ?? null,
          body.selectedInverter ?? project.selectedInverter ?? null,
          new Date().toISOString(),
        );
        if (eqPatch) {
          await upsertSelectedEquipment(
            projectId, user.id,
            scopeDesignEquipmentPatch(eqPatch, (savedLayout as any)?.designElectrical),
          );
        }
      } catch (e: unknown) {
        console.warn('[production] equipment write-back skipped (non-fatal):', (e as Error)?.message);
      }

      return NextResponse.json({ success: true, data: { layout: savedLayout, production, costEstimate } });
    }

    // ── Full project + client path (original behaviour) ───────────────────────
    const savedLayout = await upsertLayout({
      projectId,
      userId:            user.id,
      systemType:        rawLayout.systemType || project.systemType || 'roof',
      panels:            rawLayout.panels     || [],
      roofPlanes:        rawLayout.roofPlanes,
      // 🚨 ABSENCE MUST REACH upsertLayout AS ABSENCE.
      // These read `?? 20 / ?? 180 / ?? 1.5 / ?? 0.6`, which is the same
      // absence-becomes-a-number default as everywhere else in this workstream
      // — and here it actively DEFEATS the protection below it: upsertLayout
      // writes these four with `COALESCE(${'${value ?? null}'}, column)`, so
      // `undefined` deliberately KEEPS what is stored. Fabricating a value
      // turned "this request says nothing about row spacing" into "set row
      // spacing to 1.5", overwriting the user's ground array parameters on
      // every save that did not happen to restate them. The INSERT path already
      // supplies exactly these defaults for a genuinely new row.
      groundTilt:        rawLayout.groundTilt,
      groundAzimuth:     rawLayout.groundAzimuth,
      rowSpacing:        rawLayout.rowSpacing,
      groundHeight:      rawLayout.groundHeight,
      fenceAzimuth:      rawLayout.fenceAzimuth,
      fenceHeight:       rawLayout.fenceHeight,
      fenceLine:         rawLayout.fenceLine,
      bifacialOptimized: rawLayout.bifacialOptimized  ?? false,
      totalPanels:       rawLayout.panels?.length     ?? 0,
      systemSizeKw:      rawLayout.systemSizeKw       ?? (rawLayout.panels?.length ?? 0) * 0.4,
      mapCenter:         rawLayout.mapCenter,
      mapZoom:           rawLayout.mapZoom,
      // 🚨 THE THIRD WRITER TO THE LAYOUT ROW. Design Studio's Save button
      // lands here, not on the layout route, so every site-bound entity has to
      // be forwarded from here too or pressing Save undoes what the autosave
      // stored. These were silently dropped: `undefined` reads as KEEP STORED
      // in upsertLayout, so the row simply kept the older value while the user
      // was told the design was saved.
      obstructions:      rawLayout.obstructions,
      measurements:      rawLayout.measurements,
      siteArchives:      rawLayout.siteArchives,
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
      // Coalesce with the persisted project values so a save without a re-selection
      // can't null out the saved equipment (engineering audit: null-overwrite).
      selectedPanel:    body.selectedPanel    ?? project.selectedPanel    ?? null,
      selectedInverter: body.selectedInverter ?? project.selectedInverter ?? null,
      systemSizeKw:     savedLayout.systemSizeKw,
      panelCount:       savedLayout.totalPanels,
    });

    // Design → canonical selected_equipment (migration 101). Non-fatal.
    // Wave 4A: primary-scoped v2 write when the layout carries a per-sub split.
    try {
      const eqPatch = designEquipmentPatch(
        body.selectedPanel ?? project.selectedPanel ?? null,
        body.selectedInverter ?? project.selectedInverter ?? null,
        new Date().toISOString(),
      );
      if (eqPatch) {
        await upsertSelectedEquipment(
          projectId, user.id,
          scopeDesignEquipmentPatch(eqPatch, (savedLayout as any)?.designElectrical),
        );
      }
    } catch (e: unknown) {
      console.warn('[production] equipment write-back skipped (non-fatal):', (e as Error)?.message);
    }

    return NextResponse.json({ success: true, data: { layout: savedLayout, production, costEstimate } });

  } catch (error: unknown) {
    const errMsg   = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack   : undefined;
    console.error('[PRODUCTION_ERROR] POST /api/production failed:', errMsg, errStack);

    // 🚨 A DELIBERATE REFUSAL MUST NOT BECOME A GENERIC 500 HERE.
    //
    // THE DESIGN STUDIO'S SAVE BUTTON POSTS TO THIS ROUTE, not to the layout
    // route (see the note above `buildLayoutFromDefinition`). WS1-030 moved
    // refusal handling into `handleRouteDbError` so no route could forget it —
    // but this catch only DELEGATES for a `DbConfigError` or one of six network
    // substrings, and a refusal matches none of them. So it fell through to a
    // bare 500 with no `code` and no `refused`, the studio's refusal handling
    // (which keys on `code`) never fired, and the user was told
    // "Production calculation failed" for a save that was deliberately blocked
    // to protect another property's design.
    //
    // Checking first is the whole fix: the refusal is not a database error and
    // must not be classified by a database-error heuristic.
    const { layoutRefusalCode } = await import('@/lib/db/core');
    if (layoutRefusalCode(error)) {
      return handleRouteDbError('[POST /api/production]', error);
    }

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