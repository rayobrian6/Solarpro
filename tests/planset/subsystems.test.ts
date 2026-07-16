import { describe, it, expect } from 'vitest';
import { partitionSubSystems, classifyPanel, isHybrid } from '../../lib/permit/utils/subSystems';

// Phase 1 foundation of hybrid support: partition panels by per-panel
// systemType instead of the legacy single-winner vote.
describe('partitionSubSystems', () => {
  const p = (st: string, arrayId?: string): any => ({ systemType: st, arrayId });

  it('partitions a hybrid into stable roof→ground→fence order with counts', () => {
    const panels = [
      p('roof', 'A'), p('roof', 'A'), p('roof', 'B'),
      p('ground', 'G1'), p('ground', 'G1'),
      p('fence', 'F1'),
    ];
    const subs = partitionSubSystems(panels);
    expect(subs.map(s => s.key)).toEqual(['roof', 'ground', 'fence']);
    expect(subs[0].panelCount).toBe(3);
    expect(subs[0].arrayCount).toBe(2);      // A + B
    expect(subs[1].systemType).toBe('ground_mount');
    expect(subs[2].systemType).toBe('solar_fence');
    expect(isHybrid(panels)).toBe(true);
  });

  it('single-system and empty inputs stay legacy-safe', () => {
    const roofOnly = partitionSubSystems([p('roof'), p('roof')]);
    expect(roofOnly.length).toBe(1);
    expect(roofOnly[0].systemType).toBe('roof');
    expect(isHybrid([p('roof')])).toBe(false);
    // Empty → one roof sub-system (legacy callers stay valid).
    const empty = partitionSubSystems([]);
    expect(empty.length).toBe(1);
    expect(empty[0].key).toBe('roof');
  });

  it('classifies by placementType and systemType variants', () => {
    expect(classifyPanel({ placementType: 'FENCE' })).toBe('fence');
    expect(classifyPanel({ systemType: 'ground_mount' })).toBe('ground');
    expect(classifyPanel({ systemType: 'solar_fence' })).toBe('fence');
    expect(classifyPanel({})).toBe('roof'); // default
  });
});
