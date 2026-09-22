// ═══════════════════════════════════════════════════════════════════════════
// THE "PRODUCTION METER" CONTROL REACHED NOTHING — THREE KEY NAMES.
//
//   app/engineering/page.tsx            posts `productionMeter`
//   app/api/engineering/sld/route.ts    read  `body.hasProductionMeter`
//   app/api/engineering/bom/route.ts    read  `body.requiresProductionMeter`
//
// Neither key was ever sent, so `body.hasProductionMeter !== false` was TRUE on
// every SLD request and `body.requiresProductionMeter ?? false` was FALSE on
// every BOM request. The toggle was inert in BOTH directions and the two routes
// hard-wired OPPOSITE answers to the same question.
//
// These are source-contract assertions on purpose. The defect was never in a
// function's behaviour — it was in which key a route reached for, and only
// reading the routes can prove that key is the one the UI sends.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRODUCTION_METER_KEY } from '@/lib/equipment/currentTransformers';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

const PAGE = 'app/engineering/page.tsx';
const SLD_ROUTE = 'app/api/engineering/sld/route.ts';
const BOM_ROUTE = 'app/api/engineering/bom/route.ts';
const PDF_ROUTE = 'app/api/engineering/sld/pdf/route.ts';
const RENDERER = 'lib/sld-professional-renderer.ts';

describe('the production-meter control has ONE key name, end to end', () => {
  it('the UI still posts the canonical key (this is the fixed point)', () => {
    const page = read(PAGE);
    expect(PRODUCTION_METER_KEY).toBe('productionMeter');
    expect(page).toContain(`{ key: '${PRODUCTION_METER_KEY}', label: 'Production Meter'`);
    expect(page).toContain(`${PRODUCTION_METER_KEY}: config.${PRODUCTION_METER_KEY}`);
  });

  for (const [label, path] of [
    ['SLD route', SLD_ROUTE],
    ['BOM route', BOM_ROUTE],
    ['SLD PDF export route', PDF_ROUTE],
  ] as const) {
    it(`the ${label} reads it through the metering authority, not a dead key`, () => {
      const src = read(path);
      expect(src, `${path} must import the shared reader`)
        .toMatch(/readProductionMeterFlag\s*[,}]?.*from '@\/lib\/equipment\/currentTransformers'|readProductionMeterFlag,/);
      expect(src).toContain('readProductionMeterFlag(');
      // the exact dead reads that made the toggle inert
      expect(src, `${path} must not read body.hasProductionMeter directly`)
        .not.toMatch(/body\.hasProductionMeter\s*!==\s*false/);
      expect(src, `${path} must not read buildInput.hasProductionMeter directly`)
        .not.toMatch(/buildInput\.hasProductionMeter\s*!==\s*false/);
      expect(src, `${path} must not read body.requiresProductionMeter directly`)
        .not.toMatch(/body\.requiresProductionMeter\s*\?\?/);
    });
  }

  it('🚨 the renderer READS the flag it has only ever declared', () => {
    const src = read(RENDERER);
    // Before: exactly one occurrence — the interface declaration. Rendering the
    // same design true vs false produced a byte-identical SVG.
    const reads = src.match(/\bi\.hasProductionMeter\b|\binput\.hasProductionMeter\b/g) ?? [];
    expect(reads.length, 'the renderer must consume hasProductionMeter').toBeGreaterThan(0);
  });
});
