import { describe, it, expect } from 'vitest';
import { composePostalAddress } from '@/lib/address/postalAddress';

describe('composePostalAddress', () => {
  it('composes from separate parts', () => {
    expect(composePostalAddress({
      line1: '3 Melvin Dr Apt A', city: 'Granite City', state: 'IL', zip: '62040',
    })).toBe('3 Melvin Dr Apt A, Granite City, IL 62040');
  });

  it('does not duplicate a line1 that is already a full address', () => {
    // THE REGRESSION. The old expression produced
    // "3 MELVIN DR APT A, GRANITE CITY, IL 62040, GRANITE CITY, IL, 62040"
    // and stored it on the project.
    expect(composePostalAddress({
      line1: '3 MELVIN DR APT A, GRANITE CITY, IL 62040',
      city: 'Granite City', state: 'IL', zip: '62040',
    })).toBe('3 MELVIN DR APT A, GRANITE CITY, IL 62040');
  });

  it('is idempotent', () => {
    const parts = { line1: '742 Evergreen Ter', city: 'Springfield', state: 'IL', zip: '62701' };
    const once = composePostalAddress(parts);
    expect(composePostalAddress({ ...parts, line1: once })).toBe(once);
    expect(composePostalAddress({ ...parts, line1: composePostalAddress({ ...parts, line1: once }) })).toBe(once);
  });

  it('still appends a city that only appears inside a STREET name', () => {
    // The substring guard would wrongly drop the city here.
    expect(composePostalAddress({
      line1: '1 Granite City Rd', city: 'Granite City', state: 'IL', zip: '62040',
    })).toBe('1 Granite City Rd, Granite City, IL 62040');
  });

  it('does not mistake a five-digit house number for the ZIP', () => {
    expect(composePostalAddress({
      line1: '62040 Country Club Ln', city: 'Edwardsville', state: 'IL', zip: '62025',
    })).toBe('62040 Country Club Ln, Edwardsville, IL 62025');
  });

  it('adds only the ZIP when the state is already present', () => {
    expect(composePostalAddress({
      line1: '3 Melvin Dr, Granite City, IL', city: 'Granite City', state: 'IL', zip: '62040',
    })).toBe('3 Melvin Dr, Granite City, IL 62040');
  });

  it('joins state and ZIP without a comma (US postal convention)', () => {
    const out = composePostalAddress({ line1: '1 Main St', city: 'Peoria', state: 'IL', zip: '61602' });
    expect(out).toContain('IL 61602');
    expect(out).not.toContain('IL, 61602');
  });

  it('tolerates missing parts', () => {
    expect(composePostalAddress({ line1: '1 Main St' })).toBe('1 Main St');
    expect(composePostalAddress({ city: 'Peoria', state: 'IL', zip: '61602' })).toBe('Peoria, IL 61602');
    expect(composePostalAddress({})).toBe('');
    expect(composePostalAddress({ line1: null, city: null, state: null, zip: null })).toBe('');
  });

  it('matches case- and punctuation-insensitively', () => {
    expect(composePostalAddress({
      line1: '100 N. Main St., ST. LOUIS, MO 63101',
      city: 'St Louis', state: 'mo', zip: '63101',
    })).toBe('100 N. Main St., ST. LOUIS, MO 63101');
  });
});
