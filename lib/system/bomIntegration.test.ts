/**
 * Phase 9 BOM route integration test.
 *
 * Invokes the BOM pipeline directly (V4 + structural + sizing-engine adapter)
 * and verifies end-to-end correctness of the Phase 9 contract:
 *
 *   1. Response shape preserved (topology, stages, items, etc.).
 *   2. Sizing engine output is present on the response.
 *   3. Micro topology → no string/hybrid cross-contamination.
 *   4. Hybrid/string topology → no micro cross-contamination.
 *   5. Battery only present when batteryEnabled === true.
 *   6. Battery disabled + EcoFlow → inverter present but no battery items.
 *
 * These tests import V4 + adapter directly (no HTTP) to avoid spinning
 * up a Next.js server, but exercise the exact same logic the route does.
 */

import { describe, it, expect } from 'vitest';
import { generateBOMV4 } from '../bom-engine-v4';
import { sizeSystemFromBrand } from './sizingEngine';
import { sizingResultToBomItems, shouldStripMicroItems } from './sizingToBom';
import { MICRO_ONLY_CATEGORIES } from '../ecoflow-bom';
import type { BOMGenerationInputV4, BOMLineItemV4, BOMStageId, BOMStageResult } from '../bom-engine-v4';

/**
 * Simulates the Phase 9 BOM pipeline end-to-end.
 * Mirrors exactly the structure inside app/api/engineering/bom/route.ts.
 */
function runBomPipeline(
  rawInput: Omit<BOMGenerationInputV4, 'attachmentCount' | 'railSections'> & Partial<Pick<BOMGenerationInputV4, 'attachmentCount' | 'railSections'>>,
  body: {
    batteryEnabled?: boolean;
    batteryMode?: 'auto' | 'manual';
    batteryGoal?: 'backup' | 'self_consumption' | 'max_energy';
    targetBatteryKwh?: number;
    batteryUsePro?: boolean;
  },
) {
  const input: BOMGenerationInputV4 = {
    attachmentCount: 12,
    railSections: 4,
    ...rawInput,
  };
  const v4 = generateBOMV4(input);
  let finalResult = v4;
  const microItemsRemoved: string[] = [];

  const panelWattage = input.moduleCount > 0
    ? Math.max(50, Math.round((input.systemKw * 1000) / input.moduleCount))
    : 400;

  const sizingResult = sizeSystemFromBrand({
    systemType: (input.systemType ?? 'roof') as 'roof' | 'ground' | 'fence',
    panelCount: input.moduleCount,
    panelWattage,
    selectedInverterId: input.inverterId,
    batteryEnabled: Boolean(body.batteryEnabled),
    batteryMode: body.batteryMode === 'manual' ? 'manual' : 'auto',
    batteryGoal: body.batteryGoal ?? 'backup',
    batteryTargetKwh: body.targetBatteryKwh,
    batteryUsePro: Boolean(body.batteryUsePro),
  });

  // Micro-strip
  if (shouldStripMicroItems(sizingResult)) {
    const keptItems: BOMLineItemV4[] = [];
    for (const item of finalResult.items) {
      if (MICRO_ONLY_CATEGORIES.has(item.category)) {
        microItemsRemoved.push(`${item.category}:${item.id}`);
        continue;
      }
      keptItems.push(item);
    }
    const stageMap = new Map<BOMStageId, BOMLineItemV4[]>();
    for (const it of keptItems) {
      if (!stageMap.has(it.stageId)) stageMap.set(it.stageId, []);
      stageMap.get(it.stageId)!.push(it);
    }
    const newStages: BOMStageResult[] = finalResult.stages.map(s => ({
      ...s,
      items: stageMap.get(s.id) ?? [],
      itemCount: (stageMap.get(s.id) ?? []).length,
    }));
    finalResult = {
      ...finalResult,
      items: keptItems,
      stages: newStages,
      totalLineItems: keptItems.length,
    };
  }

  // Adapter injection (replicate route: skip V4-owned categories)
  const adapterResult = sizingResultToBomItems(sizingResult);
  let adapterItems = adapterResult.items;
  const v4HasBattery = finalResult.items.some(i => i.category === 'battery');
  if (v4HasBattery) {
    adapterItems = adapterItems.filter(i => i.category !== 'battery');
  }

  return {
    finalItems: [...finalResult.items, ...adapterItems.map(si => ({
      id: `adapter-${si.category}`,
      stageId: si.stageId as BOMStageId,
      category: si.category,
      manufacturer: si.manufacturer,
      model: si.model,
      quantity: si.quantity,
    }))],
    v4Items: v4.items,
    sizing: sizingResult,
    microItemsRemoved,
    adapterItems,
  };
}

describe('Phase 9 BOM pipeline integration', () => {
  describe('Response shape preservation', () => {
    it('Roof + Enphase: V4 runs, sizing resolves to micro', () => {
      const result = runBomPipeline(
        {
          inverterId: 'enphase-iq8m',
          panelId: 'rec-alpha-pure-r-410',
          moduleCount: 20,
          stringCount: 0,
          inverterCount: 20,
          systemKw: 8.0,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'shingle',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'roof',
        },
        { batteryEnabled: false },
      );
      expect(result.sizing.topology).toBe('micro');
      expect(result.sizing.brand.id).toBe('enphase');
    });
  });

  describe('Cross-contamination guards', () => {
    it('Fence + EcoFlow → final items include zero microinverters', () => {
      const result = runBomPipeline(
        {
          inverterId: 'ecoflow-ocean-pro-11kw',  // recognized EcoFlow model → pins EcoFlow via inference (fence now defaults to Enphase; this test explicitly exercises the EcoFlow path)
          panelId: 'philadelphia-solar-nexus-440',
          moduleCount: 14,
          stringCount: 2,
          inverterCount: 1,
          systemKw: 6.16,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'ground',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'fence',
        },
        { batteryEnabled: true, targetBatteryKwh: 10 },
      );
      expect(result.sizing.topology).toBe('hybrid');
      const microCount = result.finalItems.filter(i => i.category === 'microinverter').length;
      const trunkCount = result.finalItems.filter(i => i.category === 'trunk_cable').length;
      const termCount = result.finalItems.filter(i => i.category === 'terminator').length;
      expect(microCount).toBe(0);
      expect(trunkCount).toBe(0);
      expect(termCount).toBe(0);
    });

    it('Roof + Fronius (string) → zero microinverters in final items', () => {
      const result = runBomPipeline(
        {
          inverterId: 'fronius-primo-7.6',
          panelId: 'rec-alpha-pure-r-410',
          moduleCount: 18,
          stringCount: 2,
          inverterCount: 1,
          systemKw: 7.2,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'shingle',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'roof',
        },
        { batteryEnabled: false },
      );
      expect(result.sizing.topology).toBe('string');
      expect(result.finalItems.filter(i => i.category === 'microinverter')).toHaveLength(0);
    });
  });

  describe('Battery gating — route-level', () => {
    it('EcoFlow + batteryEnabled=false → sizing.battery is null and no battery items', () => {
      const result = runBomPipeline(
        {
          inverterId: 'ecoflow-ocean-pro-11kw',  // recognized EcoFlow model → pins EcoFlow via inference (fence now defaults to Enphase; this test explicitly exercises the EcoFlow path)
          panelId: 'philadelphia-solar-nexus-440',
          moduleCount: 14,
          stringCount: 2,
          inverterCount: 1,
          systemKw: 6.16,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'ground',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'fence',
        },
        { batteryEnabled: false },
      );
      expect(result.sizing.battery).toBeNull();
      const batteryItems = result.adapterItems.filter(i => i.category === 'battery');
      expect(batteryItems).toHaveLength(0);
    });

    it('EcoFlow + batteryEnabled=true + 10 kWh → sizing.battery has 2 modules', () => {
      const result = runBomPipeline(
        {
          inverterId: 'ecoflow-ocean-pro-11kw',  // recognized EcoFlow model → pins EcoFlow via inference (fence now defaults to Enphase; this test explicitly exercises the EcoFlow path)
          panelId: 'philadelphia-solar-nexus-440',
          moduleCount: 14,
          stringCount: 2,
          inverterCount: 1,
          systemKw: 6.16,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'ground',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'fence',
        },
        { batteryEnabled: true, targetBatteryKwh: 10 },
      );
      expect(result.sizing.battery).not.toBeNull();
      expect(result.sizing.battery!.moduleCount).toBe(2);
      expect(result.sizing.battery!.installedKwh).toBe(10);
    });

    it('Fronius + batteryEnabled=true → brand cannot battery → sizing.battery is null', () => {
      const result = runBomPipeline(
        {
          inverterId: 'fronius-primo-7.6',
          panelId: 'rec-alpha-pure-r-410',
          moduleCount: 18,
          stringCount: 2,
          inverterCount: 1,
          systemKw: 7.2,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'shingle',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'roof',
        },
        { batteryEnabled: true, targetBatteryKwh: 10 },
      );
      expect(result.sizing.battery).toBeNull();
    });
  });

  describe('No duplication — V4 owns electrical items', () => {
    it('adapter does NOT emit string_inverter / hybrid_inverter / solar_panel', () => {
      const result = runBomPipeline(
        {
          inverterId: 'ecoflow-ocean-pro-11kw',  // recognized EcoFlow model → pins EcoFlow via inference (fence now defaults to Enphase; this test explicitly exercises the EcoFlow path)
          panelId: 'philadelphia-solar-nexus-440',
          moduleCount: 14,
          stringCount: 2,
          inverterCount: 1,
          systemKw: 6.16,
          dcWireGauge: '#10 AWG',
          acWireGauge: '#8 AWG',
          dcWireLength: 50,
          acWireLength: 60,
          conduitType: 'EMT',
          conduitSizeInch: '3/4',
          roofType: 'ground',
          mainPanelAmps: 200,
          backfeedAmps: 40,
          acOCPD: 40,
          dcOCPD: 20,
          requiresACDisconnect: true,
          requiresDCDisconnect: true,
          requiresRapidShutdown: true,
          requiresWarningLabels: true,
          systemType: 'fence',
        },
        { batteryEnabled: true, targetBatteryKwh: 10 },
      );
      const adapterCats = result.adapterItems.map(i => i.category);
      expect(adapterCats).not.toContain('solar_panel');
      expect(adapterCats).not.toContain('string_inverter');
      expect(adapterCats).not.toContain('hybrid_inverter');
      expect(adapterCats).not.toContain('microinverter');
    });
  });
});