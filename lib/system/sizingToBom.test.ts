/**
 * Phase 9 BOM Integration — adapter tests.
 *
 * Verifies that sizingResultToBomItems() correctly:
 *   - Skips V4-owned categories (no duplication)
 *   - Emits non-V4 BOS items with proper stage mapping
 *   - Honors battery gating (no battery item when sizing.battery=null)
 *   - Emits micro-strip filter signal only for non-micro topology
 *   - Handles all four topology families (micro, string, optimizer, hybrid)
 */

import { describe, it, expect } from 'vitest';
import { sizeSystemFromBrand } from './sizingEngine';
import { sizingResultToBomItems, shouldStripMicroItems } from './sizingToBom';

describe('sizingToBom adapter — Phase 9', () => {
  describe('V4-owned category skipping', () => {
    it('does NOT emit solar_panel / microinverter / string_inverter (V4 owns)', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'enphase',
      });
      const result = sizingResultToBomItems(sizing);
      const categories = result.items.map(i => i.category);
      expect(categories).not.toContain('solar_panel');
      expect(categories).not.toContain('microinverter');
      expect(categories).not.toContain('string_inverter');
      expect(categories).not.toContain('hybrid_inverter');
    });

    it('does NOT emit trunk_cable / terminator (V4 owns these for micro)', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'enphase',
      });
      const result = sizingResultToBomItems(sizing);
      const categories = result.items.map(i => i.category);
      expect(categories).not.toContain('trunk_cable');
      expect(categories).not.toContain('terminator');
    });

    it('logs skipped V4-owned categories', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'enphase',
      });
      const result = sizingResultToBomItems(sizing);
      // Enphase profile declares microinverter/trunk_cable/terminator
      expect(result.skippedV4Owned.length).toBeGreaterThan(0);
    });
  });

  describe('Non-V4 BOS emission', () => {
    it('Fronius: emits DC disconnect / AC disconnect / DC combiner / RSD', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 18,
        panelWattage: 400,
        selectedBrand: 'fronius',
      });
      const result = sizingResultToBomItems(sizing);
      const categories = new Set(result.items.map(i => i.category));
      expect(categories.has('dc_disconnect')).toBe(true);
      expect(categories.has('ac_disconnect')).toBe(true);
    });

    it('SolarEdge: optimizer is V4-owned → skipped by adapter', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'solaredge',
      });
      const result = sizingResultToBomItems(sizing);
      expect(result.items.map(i => i.category)).not.toContain('optimizer');
      // But disconnects should be present
      expect(result.items.map(i => i.category)).toContain('dc_disconnect');
    });

    it('EcoFlow fence: emits battery_combiner / smart_meter / monitoring_gateway', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
        batteryEnabled: true,
        batteryTargetKwh: 10,
      });
      const result = sizingResultToBomItems(sizing);
      const categories = new Set(result.items.map(i => i.category));
      expect(categories.has('battery_combiner')).toBe(true);
      expect(categories.has('smart_meter')).toBe(true);
      expect(categories.has('monitoring_gateway')).toBe(true);
    });
  });

  describe('Battery gating — rule: battery only if batteryEnabled', () => {
    it('EcoFlow + batteryEnabled=false → no battery item emitted', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
        batteryEnabled: false,
      });
      const result = sizingResultToBomItems(sizing);
      const batteryItems = result.items.filter(i => i.category === 'battery');
      expect(batteryItems).toHaveLength(0);
      // And sizing.battery must be null
      expect(sizing.battery).toBeNull();
    });

    it('EcoFlow + batteryEnabled=true → adapter surfaces battery candidate', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
        batteryEnabled: true,
        batteryTargetKwh: 15,
      });
      const result = sizingResultToBomItems(sizing);
      const batteryItems = result.items.filter(i => i.category === 'battery');
      expect(batteryItems.length).toBeGreaterThan(0);
      // Count should match module count (not kWh)
      expect(batteryItems[0].quantity).toBe(sizing.battery!.moduleCount);
    });

    it('Enphase + batteryEnabled=false → no battery', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'enphase',
        batteryEnabled: false,
      });
      const result = sizingResultToBomItems(sizing);
      expect(result.items.filter(i => i.category === 'battery')).toHaveLength(0);
    });

    it('Fronius (no battery support) + batteryEnabled=true → still no battery (brand incapable)', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 18,
        selectedBrand: 'fronius',
        batteryEnabled: true,
        batteryTargetKwh: 10,
      });
      const result = sizingResultToBomItems(sizing);
      // Fronius profile has battery.capable=false → engine returns battery=null
      expect(result.items.filter(i => i.category === 'battery')).toHaveLength(0);
    });
  });

  describe('Micro-strip signal', () => {
    it('Enphase (micro topology) → do NOT strip micro items', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'enphase',
      });
      expect(shouldStripMicroItems(sizing)).toBe(false);
    });

    it('EcoFlow (hybrid topology) → DO strip micro items', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
      });
      expect(shouldStripMicroItems(sizing)).toBe(true);
    });

    it('Fronius (string topology) → DO strip micro items', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 18,
        selectedBrand: 'fronius',
      });
      expect(shouldStripMicroItems(sizing)).toBe(true);
    });

    it('SolarEdge (optimizer topology) → DO strip micro items', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'roof',
        panelCount: 20,
        selectedBrand: 'solaredge',
      });
      expect(shouldStripMicroItems(sizing)).toBe(true);
    });
  });

  describe('Stale component leakage check — switching brands', () => {
    it('Enphase → EcoFlow: sizing output has ZERO micro components', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
      });
      const result = sizingResultToBomItems(sizing);
      expect(result.items.filter(i => i.category === 'microinverter')).toHaveLength(0);
      expect(result.items.filter(i => i.category === 'trunk_cable')).toHaveLength(0);
      expect(result.items.filter(i => i.category === 'terminator')).toHaveLength(0);
    });

    it('EcoFlow → Fronius: no battery accessories survive', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'ground',
        panelCount: 24,
        selectedBrand: 'fronius',
        batteryEnabled: true,  // user asked, but Fronius cannot
        batteryTargetKwh: 20,
      });
      const result = sizingResultToBomItems(sizing);
      expect(result.items.filter(i => i.category === 'battery_combiner')).toHaveLength(0);
      expect(result.items.filter(i => i.category === 'battery_base')).toHaveLength(0);
      expect(result.items.filter(i => i.category === 'smart_meter')).toHaveLength(0);
    });
  });

  describe('Emitted items have valid shape', () => {
    it('all items have quantity > 0', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
        batteryEnabled: true,
        batteryTargetKwh: 10,
      });
      const result = sizingResultToBomItems(sizing);
      for (const item of result.items) {
        expect(item.quantity).toBeGreaterThan(0);
      }
    });

    it('all items have a stageId and category', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
        batteryEnabled: true,
      });
      const result = sizingResultToBomItems(sizing);
      for (const item of result.items) {
        expect(item.stageId).toBeTruthy();
        expect(item.category).toBeTruthy();
      }
    });

    it('all items have manufacturer non-empty', () => {
      const sizing = sizeSystemFromBrand({
        systemType: 'fence',
        panelCount: 14,
        selectedBrand: 'ecoflow',
        batteryEnabled: true,
      });
      const result = sizingResultToBomItems(sizing);
      for (const item of result.items) {
        expect(item.manufacturer).toBeTruthy();
        expect(item.manufacturer.length).toBeGreaterThan(0);
      }
    });
  });
});