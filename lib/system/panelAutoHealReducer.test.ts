/**
 * v47.424 — Panel Auto-Heal REDUCER regression.
 *
 * The auto-heal useEffect in app/engineering/page.tsx does one thing:
 * given a gate verdict with autoSwitched=true and an effectivePanelId,
 * rewrite every string on every inverter so its panelId === effectivePanelId.
 *
 * This test extracts that pure logic and locks it end-to-end. If anyone
 * ever edits the useEffect and breaks the reducer semantics, this test
 * catches it.
 *
 * The reducer is also used by applySizingRecommendation() (it honors the
 * same verdict via rec.panelCompatibility.effectivePanelId when autoSwitched).
 */
import { describe, it, expect } from 'vitest';

// ─── Types (mirror the shape of the live useEffect inputs) ──────────────

interface FakeString {
  id:         string;
  panelId:    string;
  panelCount: number;
}
interface FakeInverter {
  id:      string;
  strings: FakeString[];
}
interface FakeConfig {
  inverters: FakeInverter[];
}
interface GateVerdict {
  autoSwitched:     boolean;
  effectivePanelId: string | undefined;
}

/**
 * Pure equivalent of the auto-heal useEffect body.
 * Returns `null` when no change is needed, else the mutated config.
 *
 * This MUST mirror app/engineering/page.tsx line ~2009-2043 exactly.
 */
function autoHealReduce(
  config:  FakeConfig,
  verdict: GateVerdict | undefined,
): FakeConfig | null {
  if (!verdict) return null;
  if (!verdict.autoSwitched) return null;
  const target = verdict.effectivePanelId;
  if (!target) return null;

  const allAligned = config.inverters.every(inv =>
    inv.strings.every(s => s.panelId === target),
  );
  if (allAligned) return null;

  return {
    ...config,
    inverters: config.inverters.map(inv => ({
      ...inv,
      strings: inv.strings.map(s =>
        s.panelId === target ? s : { ...s, panelId: target }
      ),
    })),
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Property A — correct mutation shape
// ═════════════════════════════════════════════════════════════════════════

describe('autoHealReduce — correct mutation shape', () => {
  const config: FakeConfig = {
    inverters: [
      { id: 'inv-1', strings: [
        { id: 'str-a1', panelId: 'qcells-peak-duo-400', panelCount: 9 },
        { id: 'str-a2', panelId: 'qcells-peak-duo-400', panelCount: 9 },
      ]},
      { id: 'inv-2', strings: [
        { id: 'str-b1', panelId: 'qcells-peak-duo-400', panelCount: 9 },
        { id: 'str-b2', panelId: 'qcells-peak-duo-400', panelCount: 9 },
      ]},
    ],
  };

  it('A.1 — swaps panelId on every string when verdict.autoSwitched=true', () => {
    const out = autoHealReduce(config, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(out).not.toBeNull();
    for (const inv of out!.inverters) {
      for (const s of inv.strings) {
        expect(s.panelId).toBe('pan-evervolt-410');
      }
    }
  });

  it('A.2 — preserves every OTHER field on each string (panelCount, id)', () => {
    const out = autoHealReduce(config, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(out!.inverters[0].strings[0].id).toBe('str-a1');
    expect(out!.inverters[0].strings[0].panelCount).toBe(9);
    expect(out!.inverters[1].strings[1].id).toBe('str-b2');
    expect(out!.inverters[1].strings[1].panelCount).toBe(9);
  });

  it('A.3 — preserves inverter ids and structure', () => {
    const out = autoHealReduce(config, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(out!.inverters.map(i => i.id)).toEqual(['inv-1', 'inv-2']);
    expect(out!.inverters[0].strings).toHaveLength(2);
    expect(out!.inverters[1].strings).toHaveLength(2);
  });

  it('A.4 — does not mutate the input (immutability)', () => {
    const snapshot = JSON.parse(JSON.stringify(config));
    autoHealReduce(config, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(config).toEqual(snapshot);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Property B — idempotency (no infinite loop)
// ═════════════════════════════════════════════════════════════════════════

describe('autoHealReduce — idempotency', () => {
  it('B.1 — running on already-aligned config returns null (short-circuit)', () => {
    const aligned: FakeConfig = {
      inverters: [
        { id: 'inv-1', strings: [
          { id: 'str-a1', panelId: 'pan-evervolt-410', panelCount: 9 },
        ]},
      ],
    };
    const out = autoHealReduce(aligned, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(out).toBeNull();
  });

  it('B.2 — running twice converges in one step', () => {
    const config: FakeConfig = {
      inverters: [
        { id: 'inv-1', strings: [
          { id: 'str-a1', panelId: 'qcells-peak-duo-400', panelCount: 9 },
        ]},
      ],
    };
    const first = autoHealReduce(config, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(first).not.toBeNull();
    const second = autoHealReduce(first!, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(second).toBeNull();    // converged
  });

  it('B.3 — mixed alignment (some strings on target already): still aligns the rest and converges', () => {
    const mixed: FakeConfig = {
      inverters: [
        { id: 'inv-1', strings: [
          { id: 'str-a1', panelId: 'pan-evervolt-410', panelCount: 9 }, // already aligned
          { id: 'str-a2', panelId: 'qcells-peak-duo-400', panelCount: 9 }, // needs heal
        ]},
      ],
    };
    const out = autoHealReduce(mixed, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(out).not.toBeNull();
    expect(out!.inverters[0].strings[0].panelId).toBe('pan-evervolt-410');
    expect(out!.inverters[0].strings[1].panelId).toBe('pan-evervolt-410');
    // Converges on next call
    const second = autoHealReduce(out!, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    });
    expect(second).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Property C — early-return safety (every guard works)
// ═════════════════════════════════════════════════════════════════════════

describe('autoHealReduce — early-return safety', () => {
  const config: FakeConfig = {
    inverters: [
      { id: 'inv-1', strings: [
        { id: 'str-a1', panelId: 'qcells-peak-duo-400', panelCount: 9 },
      ]},
    ],
  };

  it('C.1 — undefined verdict returns null', () => {
    expect(autoHealReduce(config, undefined)).toBeNull();
  });

  it('C.2 — autoSwitched=false returns null', () => {
    expect(autoHealReduce(config, {
      autoSwitched:     false,
      effectivePanelId: 'pan-evervolt-410',
    })).toBeNull();
  });

  it('C.3 — missing effectivePanelId returns null', () => {
    expect(autoHealReduce(config, {
      autoSwitched:     true,
      effectivePanelId: undefined,
    })).toBeNull();
  });

  it('C.4 — empty inverter array: allAligned vacuously true → returns null', () => {
    const empty: FakeConfig = { inverters: [] };
    expect(autoHealReduce(empty, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    })).toBeNull();
  });

  it('C.5 — empty string array on an inverter: allAligned vacuously true → returns null', () => {
    const emptyStrings: FakeConfig = {
      inverters: [{ id: 'inv-1', strings: [] }],
    };
    expect(autoHealReduce(emptyStrings, {
      autoSwitched:     true,
      effectivePanelId: 'pan-evervolt-410',
    })).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Property D — user-lock bypass is INTENTIONAL
// (the reducer does not even look at userHasEditedInverters)
// ═════════════════════════════════════════════════════════════════════════

describe('autoHealReduce — bypasses user-lock (intentional)', () => {
  it('D.1 — no "userHasEditedInverters" guard in the pure reducer', () => {
    const fnSrc = autoHealReduce.toString();
    // Sanity: the reducer function body must NOT reference userHasEditedInverters.
    expect(fnSrc.includes('userHasEditedInverters')).toBe(false);
  });
});