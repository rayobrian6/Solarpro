import { describe, expect, it } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { roofProject } from '../test-fixtures/roofProject';

// Temporary smoke test: does the FULL permit generate end-to-end without throwing
// after this session's roofCAD / arrayPages / sitePlan changes?
describe('permit generation smoke', () => {
  it('generatePermitHTML(roofProject) produces HTML without throwing', () => {
    const html = generatePermitHTML(JSON.parse(JSON.stringify(roofProject)));
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(5000);
    expect(html).toContain('PV-2');
    expect(html).toContain('PV-2B');
  });
});
