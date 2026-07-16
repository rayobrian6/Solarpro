import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../../test-fixtures/roofProject';

// EL-1: the equipment schedule (SCHED) must be topology-aware. A microinverter
// system has NO 52-module DC series string and NO DC source circuits — modules
// pair 1:1 with microinverters and the field wiring is AC branch circuits.
describe('SCHED equipment schedule topology awareness', () => {
  const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));

  it('renders no fake DC source-circuit rows for a microinverter system', () => {
    expect(html.match(/DC \d+-\d+/g) ?? []).toHaveLength(0);
    expect(html).not.toContain('All DC source circuit conductors');
  });

  it('renders an AC branch circuit schedule instead', () => {
    expect(html).toContain('AC Branch Circuit Schedule');
    expect(html).toContain('WIRE SIZING INTERPRETATION (MICROINVERTER)');
  });

  it('labels the module group honestly (no implied series string)', () => {
    expect(html).toContain('no series DC string');
    expect(html).toContain('<th>Array</th>');
  });
});
