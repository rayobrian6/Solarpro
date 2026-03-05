#!/usr/bin/env python3
"""
UI patch for app/engineering/page.tsx
Fixes:
  1. AC Wire Gauge field → read-only auto-calculated display (not user-editable select)
  2. Step 6 formula → use OCPD rating (not continuous current) per NEC 310.16
  3. Step 7 formula → show 3 CC + 1 EGC conductors
  4. Decision log → inject NEC step-by-step entries after compliance run
  5. Decision log display → show all entries (remove slice(0,10) cap)
"""

FILE = 'app/engineering/page.tsx'

with open(FILE, 'r', encoding='utf-8') as f:
    src = f.read()

original = src

# ─────────────────────────────────────────────────────────────────────────────
# FIX UI-1: AC Wire Gauge field → read-only auto-calculated display
# Replace the user-editable <select> with a read-only display showing the
# auto-calculated value from acSizing.conductorGauge
# ─────────────────────────────────────────────────────────────────────────────
OLD_WIRE_GAUGE_FIELD = '''                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">AC Wire Gauge</label>
                    <select value={config.wireGauge} onChange={e => updateConfig({ wireGauge: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60">
                      {['#10 AWG THWN-2', '#8 AWG THWN-2', '#6 AWG THWN-2', '#4 AWG THWN-2', '#2 AWG THWN-2', '#1/0 AWG THWN-2'].map(w => <option key={w}>{w}</option>)}
                    </select>
                  </div>'''

NEW_WIRE_GAUGE_FIELD = '''                  <div>
                    <label className="text-xs text-slate-400 mb-1 block flex items-center gap-1">
                      AC Wire Gauge
                      <span className="text-amber-400 text-xs font-bold ml-1" title="Auto-calculated per NEC 310.16 — not user-editable">⚡ Auto</span>
                    </label>
                    <div className="w-full bg-slate-800/50 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-300 font-mono cursor-not-allowed"
                      title="Auto-calculated from OCPD rating per NEC 310.16 (75°C column). Not user-editable.">
                      {(compliance.electrical as any)?.acSizing?.conductorGauge
                        ? `${(compliance.electrical as any).acSizing.conductorGauge} THWN-2`
                        : config.wireGauge}
                      <span className="text-slate-500 text-xs ml-2 font-sans">NEC 310.16</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">Auto-sized from OCPD rating — run compliance to update</p>
                  </div>'''

if OLD_WIRE_GAUGE_FIELD in src:
    src = src.replace(OLD_WIRE_GAUGE_FIELD, NEW_WIRE_GAUGE_FIELD, 1)
    print('✅ FIX UI-1 applied: AC Wire Gauge field → read-only auto-calculated display')
else:
    print('❌ FIX UI-1 NOT FOUND')
    idx = src.find('AC Wire Gauge')
    if idx >= 0:
        print('  Context:', repr(src[idx-50:idx+300]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX UI-2: Step 6 formula — use OCPD rating (not continuous current)
# NEC 310.16: conductor ampacity must be >= OCPD rating
# ─────────────────────────────────────────────────────────────────────────────
OLD_STEP6_FORMULA = "                    formula: `75°C ampacity ≥ ${ac.continuousCurrentAmps}A continuous`,"
NEW_STEP6_FORMULA = "                    formula: `75°C ampacity ≥ ${ac.ocpdAmps}A OCPD rating (NEC 310.16)`,"

if OLD_STEP6_FORMULA in src:
    src = src.replace(OLD_STEP6_FORMULA, NEW_STEP6_FORMULA, 1)
    print('✅ FIX UI-2 applied: Step 6 formula uses OCPD rating (NEC 310.16)')
else:
    print('❌ FIX UI-2 NOT FOUND')
    idx = src.find('75°C ampacity')
    if idx >= 0:
        print('  Context:', repr(src[idx-50:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX UI-3: Step 7 formula — show 3 CC + 1 EGC conductors
# NEC Ch.9 Note 1: EGC must be counted in conduit fill
# ─────────────────────────────────────────────────────────────────────────────
OLD_STEP7_FORMULA = "                    formula: `3 conductors × ${ac.conductorGauge} THWN-2 → ≤40% fill`,"
NEW_STEP7_FORMULA = "                    formula: `3 CC + 1 EGC × ${ac.conductorGauge} THWN-2 → ≤40% fill (NEC Ch.9 Note 1)`,"

if OLD_STEP7_FORMULA in src:
    src = src.replace(OLD_STEP7_FORMULA, NEW_STEP7_FORMULA, 1)
    print('✅ FIX UI-3 applied: Step 7 formula shows 3 CC + 1 EGC (NEC Ch.9 Note 1)')
else:
    print('❌ FIX UI-3 NOT FOUND')
    idx = src.find('3 conductors')
    if idx >= 0:
        print('  Context:', repr(src[idx-50:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX UI-4: Decision log — inject NEC step-by-step entries after compliance run
# After `if (calcData.success) setCompliance(calcData);` add logDecision calls
# ─────────────────────────────────────────────────────────────────────────────
OLD_CALC_SUCCESS = "      const calcData = await calcRes.json();\n      if (calcData.success) setCompliance(calcData);\n      else setCalcError(calcData.error || 'Calculation failed');"

NEW_CALC_SUCCESS = """      const calcData = await calcRes.json();
      if (calcData.success) {
        setCompliance(calcData);
        // Inject NEC step-by-step calculation entries into decision log
        const ac = calcData?.acSizing;
        if (ac) {
          const sysV = calcData?.summary?.systemVoltage ?? 240;
          const totalAcKw = calcData?.summary?.totalAcKw ?? 0;
          logDecision('NEC Step 1', `Inverter Output: (${totalAcKw.toFixed(2)}kW × 1000) ÷ ${sysV}V = ${ac.acCurrentAmps}A`, 'info');
          logDecision('NEC Step 2', `Continuous Load (NEC 705.60): ${ac.acCurrentAmps}A × 1.25 = ${ac.continuousCurrentAmps}A`, 'info');
          logDecision('NEC Step 3', `OCPD (NEC 240.6): next standard ≥ ${ac.continuousCurrentAmps}A → ${ac.ocpdAmps}A breaker`, 'auto');
          logDecision('NEC Step 4', `AC Disconnect (NEC 690.14): rated ≥ OCPD → ${ac.disconnectLabel}`, 'auto');
          logDecision('NEC Step 5', `Fuse: ${ac.fuseLabel}`, ac.disconnectType === 'fused' ? 'auto' : 'info');
          logDecision('NEC Step 6', `Conductor (NEC 310.16 75°C): ampacity ≥ ${ac.ocpdAmps}A OCPD → ${ac.conductorLabel}`, 'auto');
          logDecision('NEC Step 7', `Conduit (NEC Ch.9): 3 CC + 1 EGC → ${ac.conduitLabel}`, 'auto');
          if (calcData?.interconnection) {
            const ic = calcData.interconnection;
            logDecision('Interconnection', `${ic.methodLabel}: ${ic.passes ? 'PASS' : 'FAIL'} — ${ic.message}`, ic.passes ? 'auto' : 'manual');
          }
        }
      } else {
        setCalcError(calcData.error || 'Calculation failed');
      }"""

if OLD_CALC_SUCCESS in src:
    src = src.replace(OLD_CALC_SUCCESS, NEW_CALC_SUCCESS, 1)
    print('✅ FIX UI-4 applied: NEC step-by-step entries injected into decision log')
else:
    print('❌ FIX UI-4 NOT FOUND')
    idx = src.find('if (calcData.success) setCompliance')
    if idx >= 0:
        print('  Context:', repr(src[idx-50:idx+200]))

# ─────────────────────────────────────────────────────────────────────────────
# FIX UI-5: Decision log display — show all entries (remove slice(0,10) cap)
# Also increase max-h to show more entries
# ─────────────────────────────────────────────────────────────────────────────
OLD_DECISION_LOG_DISPLAY = '                      decisionLog.slice(0, 10).map((entry, i) => ('
NEW_DECISION_LOG_DISPLAY = '                      decisionLog.map((entry, i) => ('

if OLD_DECISION_LOG_DISPLAY in src:
    src = src.replace(OLD_DECISION_LOG_DISPLAY, NEW_DECISION_LOG_DISPLAY, 1)
    print('✅ FIX UI-5a applied: Decision log shows all entries (removed slice cap)')
else:
    print('❌ FIX UI-5a NOT FOUND')

OLD_DECISION_LOG_HEIGHT = '                  <div className="space-y-1 max-h-36 overflow-y-auto">'
NEW_DECISION_LOG_HEIGHT = '                  <div className="space-y-1 max-h-64 overflow-y-auto">'

if OLD_DECISION_LOG_HEIGHT in src:
    src = src.replace(OLD_DECISION_LOG_HEIGHT, NEW_DECISION_LOG_HEIGHT, 1)
    print('✅ FIX UI-5b applied: Decision log height increased to max-h-64')
else:
    print('❌ FIX UI-5b NOT FOUND')

# ─────────────────────────────────────────────────────────────────────────────
# Write patched file
# ─────────────────────────────────────────────────────────────────────────────
if src != original:
    with open(FILE, 'w', encoding='utf-8') as f:
        f.write(src)
    print(f'\n✅ Patched file written: {FILE}')
    orig_lines = original.count('\n')
    new_lines = src.count('\n')
    print(f'   Lines: {orig_lines} → {new_lines} (+{new_lines - orig_lines})')
else:
    print('\n⚠️  No changes made')