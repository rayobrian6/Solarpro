/**
 * v61.8 — Hydration Gate Tests
 *
 * Tests the expectedHydrationPanelCount logic and [HYDRATION STALE CONFIG DISCARD] guard.
 *
 * Scenario A: Stale 1×10 config (from newString() default) is discarded when CAD has 23 panels
 * Scenario B: Correct saved config (1×23 matching CAD 23) is preserved
 * Scenario E: Micro inverter config is NOT affected by the 1×N corruption detector
 *
 * These tests exercise the pure logic of the hydration gate, isolated from React.
 */

// ---------------------------------------------------------------------------
// Helper: simulate the hydration gate logic from page.tsx
// ---------------------------------------------------------------------------

interface StringConfig {
  panelCount: number;
}

interface InverterConfig {
  type?: string;
  strings: StringConfig[];
}

interface SavedConfig {
  inverters?: InverterConfig[];
  isUserControlled?: boolean;
  defaultsApplied?: boolean;
  [key: string]: any;
}

/**
 * Pure function extracted from the Phase 1 hydration gate logic in page.tsx.
 * Returns { discarded: boolean, config: SavedConfig } where discarded=true means
 * the inverter layout was stripped from the savedConfig.
 */
function applyHydrationGate(
  savedConfig: SavedConfig | null,
  layoutPanelCount: number,
  seedPanelCount: number
): { discarded: boolean; config: SavedConfig | null } {
  if (!savedConfig) return { discarded: false, config: null };

  // Phase 1a — compute expectedHydrationPanelCount
  const _hydLayoutPanelCount: number = layoutPanelCount;
  const _hydSeedPanelCount: number = seedPanelCount;
  const expectedHydrationPanelCount: number =
    _hydLayoutPanelCount > 0 ? _hydLayoutPanelCount : _hydSeedPanelCount;

  // Phase 1b — stale gate check
  if (
    savedConfig &&
    Array.isArray(savedConfig.inverters) &&
    expectedHydrationPanelCount > 0
  ) {
    const _savedInvTotal: number = (savedConfig.inverters as InverterConfig[]).reduce(
      (s: number, inv: InverterConfig) =>
        s + ((inv.strings ?? []) as StringConfig[]).reduce(
          (s2: number, str: StringConfig) => s2 + (str.panelCount ?? 0), 0
        ),
      0
    );
    if (_savedInvTotal > 0 && _savedInvTotal !== expectedHydrationPanelCount) {
      const discardedConfig = { ...savedConfig };
      delete discardedConfig.inverters;
      delete discardedConfig.isUserControlled;
      delete discardedConfig.defaultsApplied;
      return { discarded: true, config: discardedConfig };
    }
  }

  return { discarded: false, config: savedConfig };
}

/**
 * Phase 2 — semantic corruption detector (replaces > 20 threshold).
 * Returns true if the single-string config is a stale placeholder.
 */
function isCorruptSavedConfig(
  inverters: InverterConfig[],
  expectedPanelCount: number,
  inverterType: string = 'string'
): boolean {
  const _allStrings = inverters.flatMap(inv => inv.strings ?? []);
  const _savedSinglePc = _allStrings.length === 1 ? (_allStrings[0]?.panelCount ?? 0) : 0;
  const _is1xNCorrupt =
    inverterType !== 'micro' &&
    _allStrings.length === 1 &&
    _savedSinglePc > 1 &&
    (
      expectedPanelCount > 0
        ? _savedSinglePc !== expectedPanelCount  // semantic mismatch (preferred)
        : _savedSinglePc > 20                    // fallback when no reference count yet
    );
  return _is1xNCorrupt;
}

// ---------------------------------------------------------------------------
// SCENARIO A: Stale 1×10 config discarded when CAD has 23 panels
// ---------------------------------------------------------------------------
describe('Scenario A — Stale 1×10 config is discarded', () => {
  const staleConfig: SavedConfig = {
    inverters: [
      { type: 'string', strings: [{ panelCount: 10 }] }
    ],
    isUserControlled: true,
    defaultsApplied: true,
    someOtherField: 'preserved',
  };

  it('discards inverter layout when savedConfig total (10) !== CAD count (23)', () => {
    const result = applyHydrationGate(staleConfig, 23, 0);
    expect(result.discarded).toBe(true);
  });

  it('removes inverters key from config after discard', () => {
    const result = applyHydrationGate(staleConfig, 23, 0);
    expect(result.config).not.toBeNull();
    expect(result.config!.inverters).toBeUndefined();
  });

  it('removes isUserControlled key after discard (so auto-fix can run)', () => {
    const result = applyHydrationGate(staleConfig, 23, 0);
    expect(result.config!.isUserControlled).toBeUndefined();
  });

  it('removes defaultsApplied key after discard', () => {
    const result = applyHydrationGate(staleConfig, 23, 0);
    expect(result.config!.defaultsApplied).toBeUndefined();
  });

  it('preserves other non-inverter fields after discard', () => {
    const result = applyHydrationGate(staleConfig, 23, 0);
    expect(result.config!.someOtherField).toBe('preserved');
  });

  it('Phase 2: semantic detector flags 1×10 as corrupt when expected=23', () => {
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 10 }] }];
    expect(isCorruptSavedConfig(inverters, 23, 'string')).toBe(true);
  });

  it('Phase 2: semantic detector flags 1×10 as corrupt even without > 20 (old threshold missed this)', () => {
    // This is the KEY regression: old code used > 20, which missed panelCount=10
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 10 }] }];
    // Old logic: panelCount > 20 → false (BUG — would NOT flag this as corrupt)
    expect(10 > 20).toBe(false); // confirms old logic was broken
    // New logic: semantic mismatch → true (FIXED)
    expect(isCorruptSavedConfig(inverters, 23, 'string')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO B: Correct saved config (1×23 matching CAD 23) is preserved
// ---------------------------------------------------------------------------
describe('Scenario B — Correct saved config matching CAD is preserved', () => {
  const correctConfig: SavedConfig = {
    inverters: [
      { type: 'string', strings: [{ panelCount: 12 }, { panelCount: 11 }] }
    ],
    isUserControlled: true,
    defaultsApplied: true,
  };

  it('preserves config when saved total (23) === CAD count (23)', () => {
    const result = applyHydrationGate(correctConfig, 23, 0);
    expect(result.discarded).toBe(false);
  });

  it('keeps inverters intact when config matches', () => {
    const result = applyHydrationGate(correctConfig, 23, 0);
    expect(result.config!.inverters).toBeDefined();
    expect(result.config!.inverters!.length).toBe(1);
  });

  it('keeps isUserControlled intact when config matches', () => {
    const result = applyHydrationGate(correctConfig, 23, 0);
    expect(result.config!.isUserControlled).toBe(true);
  });

  it('preserves a multi-string config that sums to CAD count', () => {
    const multiString: SavedConfig = {
      inverters: [
        { type: 'string', strings: [{ panelCount: 8 }, { panelCount: 8 }, { panelCount: 7 }] }
      ],
      isUserControlled: true,
    };
    const result = applyHydrationGate(multiString, 23, 0);
    expect(result.discarded).toBe(false);
    expect(result.config!.inverters).toBeDefined();
  });

  it('preserves a multi-inverter config that sums to CAD count', () => {
    const multiInverter: SavedConfig = {
      inverters: [
        { type: 'string', strings: [{ panelCount: 12 }] },
        { type: 'string', strings: [{ panelCount: 11 }] },
      ],
      isUserControlled: true,
    };
    const result = applyHydrationGate(multiInverter, 23, 0);
    expect(result.discarded).toBe(false);
  });

  it('Phase 2: semantic detector does NOT flag correct 1×23 layout', () => {
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 23 }] }];
    expect(isCorruptSavedConfig(inverters, 23, 'string')).toBe(false);
  });

  it('uses seed panelCount as fallback when layout count is 0', () => {
    const result = applyHydrationGate(correctConfig, 0, 23);
    expect(result.discarded).toBe(false);
  });

  it('does not discard when expectedHydrationPanelCount is 0 (no info yet)', () => {
    const result = applyHydrationGate(correctConfig, 0, 0);
    expect(result.discarded).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO E: Micro inverter config is NOT flagged as corrupt
// ---------------------------------------------------------------------------
describe('Scenario E — Micro inverter config is not affected', () => {
  it('Phase 2: micro inverter with 1×10 is NOT flagged as corrupt', () => {
    const inverters: InverterConfig[] = [{ type: 'micro', strings: [{ panelCount: 10 }] }];
    expect(isCorruptSavedConfig(inverters, 23, 'micro')).toBe(false);
  });

  it('Phase 2: micro inverter with 1×1 layout is NOT flagged', () => {
    // Micro inverters legitimately have 1 panel per string
    const inverters: InverterConfig[] = [
      { type: 'micro', strings: [{ panelCount: 1 }] },
      { type: 'micro', strings: [{ panelCount: 1 }] },
    ];
    // Each inverter evaluated individually — single string of 1 panel, panelCount not > 1
    expect(isCorruptSavedConfig([inverters[0]], 23, 'micro')).toBe(false);
  });

  it('hydration gate: micro 1×10 config is preserved (gate does not know type, relies on Phase 2)', () => {
    // The hydration gate (Phase 1) checks total mismatch regardless of type.
    // Micro systems typically have many inverters each with 1 panel — the total would match.
    // Test that a micro config where total=23 is preserved.
    const microConfig: SavedConfig = {
      inverters: Array.from({ length: 23 }, (_, i) => ({
        type: 'micro',
        strings: [{ panelCount: 1 }],
      })),
      isUserControlled: true,
    };
    const result = applyHydrationGate(microConfig, 23, 0);
    expect(result.discarded).toBe(false);
  });

  it('Phase 2: string inverter with 1×panelCount matching expected is not corrupt', () => {
    // Exactly 1 string, exactly matching expected count — NOT corrupt
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 15 }] }];
    expect(isCorruptSavedConfig(inverters, 15, 'string')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EDGE CASES
// ---------------------------------------------------------------------------
describe('Edge cases — hydration gate boundary conditions', () => {
  it('returns null config unchanged when savedConfig is null', () => {
    const result = applyHydrationGate(null, 23, 0);
    expect(result.discarded).toBe(false);
    expect(result.config).toBeNull();
  });

  it('does not discard config with no inverters key', () => {
    const configNoInverters: SavedConfig = { someField: 'value' };
    const result = applyHydrationGate(configNoInverters, 23, 0);
    expect(result.discarded).toBe(false);
  });

  it('does not discard when saved total is 0 (empty inverter arrays)', () => {
    const emptyInverters: SavedConfig = {
      inverters: [{ strings: [] }],
    };
    const result = applyHydrationGate(emptyInverters, 23, 0);
    expect(result.discarded).toBe(false);
  });

  it('Phase 2: single string with panelCount=1 is not flagged (too small, > 1 guard)', () => {
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 1 }] }];
    expect(isCorruptSavedConfig(inverters, 23, 'string')).toBe(false);
  });

  it('Phase 2: old > 20 threshold: 1×21 caught by both old and new logic', () => {
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 21 }] }];
    // Old: > 20 → true; New: mismatch (21 !== 23) → true. Both agree.
    expect(isCorruptSavedConfig(inverters, 23, 'string')).toBe(true);
  });

  it('Phase 2: 1×10 with expected=10 is NOT corrupt (valid single-string system)', () => {
    // Small system with exactly 10 panels legitimately configured as 1 string
    const inverters: InverterConfig[] = [{ type: 'string', strings: [{ panelCount: 10 }] }];
    expect(isCorruptSavedConfig(inverters, 10, 'string')).toBe(false);
  });

  it('Phase 2: multi-string config is not affected (only single-string check)', () => {
    const inverters: InverterConfig[] = [
      { type: 'string', strings: [{ panelCount: 10 }, { panelCount: 10 }] }
    ];
    // _allStrings.length === 2, so _savedSinglePc = 0 → not corrupt
    expect(isCorruptSavedConfig(inverters, 23, 'string')).toBe(false);
  });
});