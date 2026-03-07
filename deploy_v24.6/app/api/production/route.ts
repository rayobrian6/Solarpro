import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectById, getClientById, getLayoutByProject, upsertLayout, updateProject, upsertProduction } from '@/lib/db-neon';
import { calculateProduction } from '@/lib/pvwatts';
import { calculateFinalPrice, calculateItemizedPrice, loadPricingConfig } from '@/lib/pricingEngine';
import type { Client, Layout } from '@/types';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const { projectId, layout } = body;

    if (!projectId || !layout) {
      return NextResponse.json({ success: false, error: 'projectId and layout are required' }, { status: 400 });
    }

    const project = await getProjectById(projectId, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    // Get client for production calculation
    let client: Client | null = null;
    if (project.clientId) {
      client = await getClientById(project.clientId, user.id);
    }

    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found for this project' }, { status: 404 });
    }

    // Save/update the layout
    const savedLayout = await upsertLayout({
      projectId,
      userId: user.id,
      systemType: layout.systemType || project.systemType || 'roof',
      panels: layout.panels || [],
      roofPlanes: layout.roofPlanes,
      groundTilt: layout.groundTilt ?? 20,
      groundAzimuth: layout.groundAzimuth ?? 180,
      rowSpacing: layout.rowSpacing ?? 1.5,
      groundHeight: layout.groundHeight ?? 0.6,
      fenceAzimuth: layout.fenceAzimuth,
      fenceHeight: layout.fenceHeight,
      fenceLine: layout.fenceLine,
      bifacialOptimized: layout.bifacialOptimized ?? false,
      totalPanels: layout.panels?.length ?? 0,
      systemSizeKw: layout.systemSizeKw ?? (layout.panels?.length ?? 0) * 0.4,
      mapCenter: layout.mapCenter,
      mapZoom: layout.mapZoom,
    });

    const productionData = await calculateProduction(savedLayout, client);
    const production = {
      ...productionData,
      id: `prod-${Date.now()}`,
      projectId,
      calculatedAt: new Date().toISOString(),
    };

    // Load pricing config from DB (admin-configured), fall back to defaults
    const pricingCfg = await loadPricingConfig();

    // ── Itemized pricing: count panels by type, price per panel per type ──
    const panels = savedLayout.panels ?? [];
    const layoutType = savedLayout.systemType ?? project.systemType ?? 'roof';
    const itemized = calculateItemizedPrice(panels, layoutType, pricingCfg);

    // ── Fallback: also compute $/W price for comparison ──
    const salesOverride = body.salesOverride ?? undefined;
    const pricing = calculateFinalPrice(
      savedLayout.systemSizeKw,
      layoutType,
      production.annualProductionKwh,
      client,
      salesOverride,
      pricingCfg
    );

    // Use itemized total as the cash price (primary method)
    const cashPrice = itemized.totalCashPrice;
    const itcAmount = Math.round(cashPrice * (pricingCfg.taxCreditRate / 100));
    const netCost   = cashPrice - itcAmount;
    const utilityRate = client.utilityRate || 0.13;
    const annualSavings = Math.round(production.annualProductionKwh * utilityRate);
    const paybackYears  = annualSavings > 0 ? parseFloat((netCost / annualSavings).toFixed(1)) : 0;
    let lifetimeSavings = 0;
    let rate = utilityRate;
    for (let y = 0; y < pricingCfg.systemLife; y++) {
      lifetimeSavings += production.annualProductionKwh * rate;
      rate *= (1 + pricingCfg.utilityEscalation / 100);
    }
    lifetimeSavings = Math.round(lifetimeSavings);
    const roi = netCost > 0 ? parseFloat((((lifetimeSavings - netCost) / netCost) * 100).toFixed(1)) : 0;

    // Map → CostEstimate shape (backwards-compatible + itemized breakdown)
    const costEstimate = {
      systemSizeKw:        savedLayout.systemSizeKw,
      // Itemized line items (new — shown in proposal breakdown)
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
      pricePerWatt:        savedLayout.systemSizeKw > 0
                             ? parseFloat((cashPrice / (savedLayout.systemSizeKw * 1000)).toFixed(2))
                             : 0,
      cashPrice,
      costAfterIncentives: netCost,
      // Internal profit fields (not shown to customer)
      internalRevenue:     pricing.revenue,
      internalCost:        pricing.estimatedCost,
      internalProfit:      pricing.grossProfit,
      internalMargin:      pricing.marginPercent,
    };

    // Update project status and system size
    await updateProject(projectId, user.id, {
      status: 'design',
      systemSizeKw: savedLayout.systemSizeKw,
    });

    // Persist production + costEstimate to DB so proposals can read them
    await upsertProduction({
      projectId,
      userId: user.id,
      production,
      costEstimate,
      selectedPanel: body.selectedPanel ?? null,
      selectedInverter: body.selectedInverter ?? null,
      systemSizeKw: savedLayout.systemSizeKw,
      panelCount: savedLayout.totalPanels,
    });

    return NextResponse.json({ success: true, data: { layout: savedLayout, production, costEstimate } });
  } catch (error: unknown) {
    console.error('[POST /api/production]', error);
    const message = error instanceof Error ? error.message : 'Failed to calculate production';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

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
    console.error('[GET /api/production]', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch production data' }, { status: 500 });
  }
}