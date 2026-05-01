/**
 * lib/ui/severityMapper.test.ts — Phase 13.8.1
 *
 * Tests for the UI severity mapping layer.
 * Engine outputs are NEVER mutated — only display severity changes.
 */

import { describe, it, expect } from 'vitest';
import { mapIssueToUI, mapIssuesToUI, mapCodeToUISeverity, type RawIssue } from './severityMapper';

// ─── helpers ─────────────────────────────────────────────────────────────────

function raw(code: string, severity: RawIssue['severity'], message = `msg for ${code}`): RawIssue {
  return { code, severity, message };
}

// ─── TRUE ERRORS: never downgraded ───────────────────────────────────────────

describe('true errors are never downgraded', () => {
  const errorCodes = [
    'E_VOC_EXCEEDED',
    'MPPT_CURRENT_EXCEEDED',
    'MPPT_ALLOCATION_INVALID',
    'E_DC_DISCONNECT',
    'STRING_BELOW_MIN',
    'STRING_ABOVE_MAX',
    'INVERTER_MISSING',
    'PANEL_COUNT_ZERO',
  ];

  for (const code of errorCodes) {
    it(`${code} stays error`, () => {
      const result = mapIssueToUI(raw(code, 'error'));
      expect(result.severity).toBe('error');
      expect(result.engineSeverity).toBe('error');
    });
  }
});

// ─── ADVISORY WARNINGS: stay yellow ──────────────────────────────────────────

describe('advisory warnings stay warning', () => {
  it('DC_AC_RATIO_HIGH stays warning', () => {
    const result = mapIssueToUI(raw('DC_AC_RATIO_HIGH', 'warning'));
    expect(result.severity).toBe('warning');
    expect(result.engineSeverity).toBe('warning');
  });

  it('DC_AC_RATIO_LOW stays warning', () => {
    const result = mapIssueToUI(raw('DC_AC_RATIO_LOW', 'warning'));
    expect(result.severity).toBe('warning');
    expect(result.engineSeverity).toBe('warning');
  });

  it('STRING_IMBALANCE stays warning', () => {
    const result = mapIssueToUI(raw('STRING_IMBALANCE', 'warning'));
    expect(result.severity).toBe('warning');
    expect(result.engineSeverity).toBe('warning');
  });
});

// ─── INFO OVERRIDES: downgraded from warning → info ──────────────────────────

describe('STRING_VOC_VOLTAGE_CLAMP downgraded to info', () => {
  const original =
    'se-11400h: max panels/string reduced from 25 to 10 ' +
    '(voltage-safe ceiling: 10 panels at -10°C cold Voc, inverter max 480V).';

  it('severity is info', () => {
    const result = mapIssueToUI(raw('STRING_VOC_VOLTAGE_CLAMP', 'warning', original));
    expect(result.severity).toBe('info');
    expect(result.engineSeverity).toBe('warning');
  });

  it('message mentions NEC 690.7', () => {
    const result = mapIssueToUI(raw('STRING_VOC_VOLTAGE_CLAMP', 'warning', original));
    expect(result.message).toContain('NEC 690.7');
  });

  it('message mentions panel limit', () => {
    const result = mapIssueToUI(raw('STRING_VOC_VOLTAGE_CLAMP', 'warning', original));
    expect(result.message).toContain('10 panels');
  });

  it('message does NOT contain raw technical jargon "voltage-safe ceiling"', () => {
    const result = mapIssueToUI(raw('STRING_VOC_VOLTAGE_CLAMP', 'warning', original));
    expect(result.message).not.toContain('voltage-safe ceiling');
  });
});

describe('FEASIBILITY_NO_VIABLE_MODEL downgraded to info', () => {
  it('severity is info', () => {
    const result = mapIssueToUI(raw('FEASIBILITY_NO_VIABLE_MODEL', 'warning'));
    expect(result.severity).toBe('info');
    expect(result.engineSeverity).toBe('warning');
  });

  it('message says system was auto-configured', () => {
    const result = mapIssueToUI(raw('FEASIBILITY_NO_VIABLE_MODEL', 'warning'));
    expect(result.message.toLowerCase()).toContain('automatically');
  });
});

// Phase 14.1: FEASIBILITY_CHOSEN_INFEASIBLE must stay 'warning' — NOT demoted to info.
// It is a hard-constraint advisory: the selected config was invalid, system was adjusted.
// Demoting it to info would trigger the green "System Valid" banner incorrectly.
describe('FEASIBILITY_CHOSEN_INFEASIBLE stays warning (Phase 14.1 hard constraint)', () => {
  it('severity is warning (not info)', () => {
    const result = mapIssueToUI(raw('FEASIBILITY_CHOSEN_INFEASIBLE', 'warning'));
    expect(result.severity).toBe('warning');
    expect(result.engineSeverity).toBe('warning');
  });
});

describe('FEASIBILITY_BETTER_CANDIDATE_AVAILABLE downgraded to info', () => {
  const original =
    'A better-scoring inverter is available in the same brand: se-7600h (score 82.0) vs chosen se-6000h.';

  it('severity is info', () => {
    const result = mapIssueToUI(raw('FEASIBILITY_BETTER_CANDIDATE_AVAILABLE', 'info', original));
    expect(result.severity).toBe('info');
  });

  it('message says current config is valid', () => {
    const result = mapIssueToUI(raw('FEASIBILITY_BETTER_CANDIDATE_AVAILABLE', 'info', original));
    expect(result.message.toLowerCase()).toContain('valid');
  });
});

describe('INVERTER_MODEL_NOT_IN_BRAND downgraded to info', () => {
  const original =
    'Selected inverter se-11400h is not part of Enphase IQ8. Using auto-sized default.';

  it('severity is info', () => {
    const result = mapIssueToUI(raw('INVERTER_MODEL_NOT_IN_BRAND', 'warning', original));
    expect(result.severity).toBe('info');
    expect(result.engineSeverity).toBe('warning');
  });
});

describe('INVERTER_UPSIZED stays info (engine already emits info)', () => {
  it('severity is info', () => {
    const result = mapIssueToUI(raw('INVERTER_UPSIZED', 'info'));
    expect(result.severity).toBe('info');
    expect(result.engineSeverity).toBe('info');
  });
});

// ─── ENGINE SEVERITY PRESERVED ───────────────────────────────────────────────

describe('engineSeverity is always preserved unchanged', () => {
  it('error code keeps engineSeverity=error', () => {
    const result = mapIssueToUI(raw('INVERTER_MISSING', 'error'));
    expect(result.engineSeverity).toBe('error');
  });

  it('warning code keeps engineSeverity=warning even when downgraded', () => {
    const result = mapIssueToUI(raw('STRING_VOC_VOLTAGE_CLAMP', 'warning'));
    expect(result.engineSeverity).toBe('warning');
    expect(result.severity).toBe('info'); // downgraded in UI
  });

  it('info code keeps engineSeverity=info', () => {
    const result = mapIssueToUI(raw('INVERTER_UPSIZED', 'info'));
    expect(result.engineSeverity).toBe('info');
  });
});

// ─── mapIssuesToUI ────────────────────────────────────────────────────────────

describe('mapIssuesToUI processes arrays correctly', () => {
  it('maps all issues', () => {
    const issues = [
      raw('INVERTER_MISSING', 'error'),
      raw('DC_AC_RATIO_LOW', 'warning'),
      raw('STRING_VOC_VOLTAGE_CLAMP', 'warning'),
      raw('INVERTER_UPSIZED', 'info'),
    ];
    const mapped = mapIssuesToUI(issues);
    expect(mapped).toHaveLength(4);
    expect(mapped[0].severity).toBe('error');
    expect(mapped[1].severity).toBe('warning');
    expect(mapped[2].severity).toBe('info'); // downgraded
    expect(mapped[3].severity).toBe('info');
  });

  it('preserves order', () => {
    const issues = [
      raw('DC_AC_RATIO_LOW', 'warning'),
      raw('STRING_VOC_VOLTAGE_CLAMP', 'warning'),
      raw('INVERTER_MISSING', 'error'),
    ];
    const mapped = mapIssuesToUI(issues);
    expect(mapped[0].code).toBe('DC_AC_RATIO_LOW');
    expect(mapped[1].code).toBe('STRING_VOC_VOLTAGE_CLAMP');
    expect(mapped[2].code).toBe('INVERTER_MISSING');
  });

  it('empty array returns empty array', () => {
    expect(mapIssuesToUI([])).toEqual([]);
  });
});

// ─── mapCodeToUISeverity ──────────────────────────────────────────────────────

describe('mapCodeToUISeverity convenience function', () => {
  it('STRING_VOC_VOLTAGE_CLAMP → info regardless of engine severity', () => {
    expect(mapCodeToUISeverity('STRING_VOC_VOLTAGE_CLAMP', 'warning')).toBe('info');
  });

  it('INVERTER_MISSING → error', () => {
    expect(mapCodeToUISeverity('INVERTER_MISSING', 'error')).toBe('error');
  });

  it('DC_AC_RATIO_LOW → warning', () => {
    expect(mapCodeToUISeverity('DC_AC_RATIO_LOW', 'warning')).toBe('warning');
  });

  it('FEASIBILITY_NO_VIABLE_MODEL → info', () => {
    expect(mapCodeToUISeverity('FEASIBILITY_NO_VIABLE_MODEL', 'warning')).toBe('info');
  });
});

// ─── NO MUTATION ─────────────────────────────────────────────────────────────

describe('input issues are never mutated', () => {
  it('original severity is unchanged after mapping', () => {
    const issue = raw('STRING_VOC_VOLTAGE_CLAMP', 'warning', 'original message');
    const mapped = mapIssueToUI(issue);
    // Original object untouched
    expect(issue.severity).toBe('warning');
    expect(issue.message).toBe('original message');
    // Mapped object has new severity
    expect(mapped.severity).toBe('info');
  });
});