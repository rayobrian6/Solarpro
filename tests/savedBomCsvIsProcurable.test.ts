/**
 * tests/savedBomCsvIsProcurable.test.ts
 *
 * THE ARCHIVED BOM THE PURCHASER OPENS HAD NO PART NUMBER AND NO PRICES.
 *
 * `/api/engineering/save-outputs` writes `BOM_<project>.csv` into `project_files`,
 * and that is the procurement document attached to the project in Client Files.
 * Its header was `Tag,Description,Manufacturer,Model,Qty,Unit,Notes`, so a line
 * read "IronRidge / XR100 Rail System / 8 / ea" with an EMPTY first column: no
 * SKU, no unit price, no extended price. The `Tag` column was always empty
 * because `BOMLineItemV4` has no `tag` field at all.
 *
 * Meanwhile the engine had already resolved `partNumber`, `unitCost` and
 * `totalCost` on every one of those rows — all three were dropped on the way to
 * disk. Nothing could be ordered without looking every part number up by hand,
 * and the priced total the estimator quoted could not be reconciled against the
 * archived file.
 *
 * This test drives the SHIPPED route handler and reads the bytes it actually
 * hands the database, so it measures the archived file, not a helper. The items
 * are priced by the real `applyDistributorPricing`, so the dollar figures are the
 * engine's own.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextResponse, type NextRequest } from 'next/server';
import { applyDistributorPricing } from '../lib/bom/distributorPricing';
import type { BOMLineItemV4 } from '../lib/bom-types-v4';

const USER_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const CLIENT_ID = '66666666-6666-4666-8666-666666666666';

/** Every `INSERT INTO project_files` the route made: file name → decoded text. */
const savedFiles = new Map<string, string>();

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(async () => ({ id: USER_ID, email: 'installer@test' })),
}));
vi.mock('@/lib/rateLimiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));
vi.mock('@/lib/db-neon', () => ({
  getDbReady: vi.fn(async () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (/FROM projects/i.test(text)) return [{ id: PROJECT_ID, client_id: CLIENT_ID }];
    if (/INSERT INTO project_files/i.test(text)) {
      // upsertFile's parameter order: projectId, clientId, userId, fileName,
      // fileType, size, mimeType, <Buffer>, notes.
      const fileName = values[3] as string;
      const blob = values.find(v => Buffer.isBuffer(v)) as Buffer | undefined;
      if (blob) savedFiles.set(fileName, blob.toString('utf8'));
      return [];
    }
    return [];
  }),
  handleRouteDbError: (tag: string, err: unknown) =>
    NextResponse.json({ success: false, error: `${tag} ${(err as Error)?.message}` }, { status: 500 }),
}));

const { POST } = await import('@/app/api/engineering/save-outputs/route');

/** Racking line, with the engine's real stageId/stageLabel for that category. */
function item(over: Partial<BOMLineItemV4>): BOMLineItemV4 {
  return {
    id: 'x', stageId: 'structural', stageLabel: 'Stage 5 — Structural',
    category: 'racking', manufacturer: 'IronRidge', model: 'XR100 Rail System',
    partNumber: 'XR100-168A', description: 'XR100 rail, 168in, mill',
    quantity: 8, unit: 'ea', derivedFrom: 'array geometry', required: true,
    ...over,
  };
}

/** Real engine output: costs stamped by the real pricing resolution. */
const PRICED = applyDistributorPricing([
  item({ id: 'r1' }),
  item({
    id: 'b1', stageId: 'inverter', stageLabel: 'Stage 3 — Inverter / Storage / Combiner',
    category: 'battery', manufacturer: 'Tesla', model: 'Powerwall 3', partNumber: 'PW3-US',
    description: 'Tesla Powerwall 3 (13.5kWh)', quantity: 2,
    necReference: 'NEC 706.7', notes: 'Wall-mounted, garage',
  }),
]).items;

function req(body: unknown): NextRequest {
  return {
    url: 'http://localhost/api/engineering/save-outputs',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as unknown as NextRequest;
}

async function saveAndReadBomCsv(items: unknown[]): Promise<string> {
  savedFiles.clear();
  const res = await POST(req({
    projectId: PROJECT_ID, clientId: CLIENT_ID, clientName: 'Braidon Test',
    systemKw: 10.4, panelCount: 26, bomItems: items,
  }));
  expect(res.status).toBe(200);
  const csv = savedFiles.get('BOM_Braidon_Test.csv');
  expect(csv, 'the route did not archive a BOM csv at all').toBeTruthy();
  return csv!;
}

beforeEach(() => savedFiles.clear());

describe('🚨 the archived BOM_<project>.csv is an orderable document', () => {
  it('its header carries Part Number, Unit Cost and Total Cost — and no Tag', async () => {
    const header = (await saveAndReadBomCsv(PRICED)).split('\n')[0];

    expect(header).toBe(
      'Stage,Category,Manufacturer,Model,Part Number,Qty,Unit,Unit Cost,Total Cost,NEC Ref,Notes',
    );
    // `Tag` was the first column and was ALWAYS empty — BOMLineItemV4 has no
    // such field. It must not come back.
    expect(header).not.toMatch(/\bTag\b/);
  });

  it('every row carries the part number the engine already resolved', async () => {
    const lines = (await saveAndReadBomCsv(PRICED)).split('\n').slice(1);
    expect(lines).toHaveLength(2);

    const rail = lines.find(l => l.includes('XR100'))!;
    const cells = rail.split(',');
    expect(cells[0]).toBe('Stage 5 — Structural');
    expect(cells[2]).toBe('IronRidge');
    expect(cells[4]).toBe('XR100-168A'); // Part Number — was absent entirely
    expect(cells[5]).toBe('8');
  });

  it('the dollar figures are the ENGINE\'s, and Total = Unit × Qty', async () => {
    const lines = (await saveAndReadBomCsv(PRICED)).split('\n').slice(1);
    const battery = lines.find(l => l.includes('PW3-US'))!.split(',');
    const engineRow = PRICED.find(i => i.partNumber === 'PW3-US')!;

    expect(Number(battery[7])).toBeCloseTo(engineRow.unitCost!, 2);
    expect(Number(battery[8])).toBeCloseTo(engineRow.totalCost!, 2);
    expect(Number(battery[8])).toBeCloseTo(Number(battery[7]) * Number(battery[5]), 2);
    // The estimator's quote can now be reconciled against the archive.
    expect(Number(battery[7])).toBeGreaterThan(0);
  });

  it('NEC Ref and Notes land in their own columns', async () => {
    const lines = (await saveAndReadBomCsv(PRICED)).split('\n').slice(1);
    const battery = lines.find(l => l.includes('PW3-US'))!.split(',');
    expect(battery[9]).toBe('NEC 706.7');
    expect(battery[10]).toBe('Wall-mounted; garage');
  });

  it('an UNPRICED line leaves the cost cells empty, never $0.00', async () => {
    // A row the engine could not price must not read as free. `applyDistributorPricing`
    // leaves unitCost/totalCost undefined in that case (and always for tools).
    const unpriced = applyDistributorPricing([
      item({ id: 'u1', category: 'no_such_category', partNumber: 'MYSTERY-PART' }),
    ]).items;
    expect(unpriced[0].unitCost).toBeUndefined();

    const row = (await saveAndReadBomCsv(unpriced)).split('\n')[1].split(',');
    expect(row[4]).toBe('MYSTERY-PART');
    expect(row[7]).toBe('');
    expect(row[8]).toBe('');
  });

  it('a comma or newline in a field cannot shift the columns', async () => {
    const csv = await saveAndReadBomCsv(applyDistributorPricing([
      item({ id: 'c1', model: 'XR100, 168in\nmill finish', notes: 'two, commas, here' }),
    ]).items);
    const lines = csv.split('\n');
    // One header + exactly one data row: the embedded newline did not split it.
    expect(lines).toHaveLength(2);
    expect(lines[1].split(',')).toHaveLength(11);
    expect(lines[1]).toContain('XR100; 168in mill finish');
  });

  it('every line item in the payload reaches the file', async () => {
    const many = applyDistributorPricing(
      Array.from({ length: 12 }, (_, i) => item({ id: `m${i}`, partNumber: `SKU-${i}` })),
    ).items;
    const lines = (await saveAndReadBomCsv(many)).split('\n');
    expect(lines).toHaveLength(13);
    for (let i = 0; i < 12; i++) expect(lines.some(l => l.includes(`SKU-${i}`))).toBe(true);
  });
});
