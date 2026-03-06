with open('lib/computed-system.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old = """  const backfeedBreakerAmps = acOcpdAmps;

  // NEC 705.12(B) \u2014 120% rule: backfeed + main \u2264 1.2 \u00d7 busRating
  const interconnectionPass = (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);
  if (!interconnectionPass) {
    issues.push({
      severity: 'error',
      code: 'NEC_705_12B_120PCT',
      message: `Interconnection: ${backfeedBreakerAmps}A backfeed + ${input.mainPanelAmps}A main = ${backfeedBreakerAmps + input.mainPanelAmps}A > 120% of ${input.panelBusRating}A bus (${Math.round(input.panelBusRating * 1.2)}A max)`,
      necReference: 'NEC 705.12(B)',
      autoFixed: false,
      suggestion: 'Consider supply-side tap (NEC 705.11) or panel upgrade',
    });
  }"""

new = """  const backfeedBreakerAmps = acOcpdAmps;

  // NEC 705.12(B) \u2014 120% rule applies ONLY to load-side connections
  // NEC 705.11 \u2014 Supply-side tap: 120% rule does NOT apply (connection before main breaker)
  const _interconMethodRaw = String(input.interconnectionMethod ?? 'LOAD_SIDE').toUpperCase();
  const _isSupplySideTap = _interconMethodRaw.includes('SUPPLY') || _interconMethodRaw.includes('LINE_SIDE');
  const interconnectionPass = _isSupplySideTap
    ? true  // NEC 705.11: supply-side tap \u2014 no busbar loading concern
    : (backfeedBreakerAmps + input.mainPanelAmps) <= (input.panelBusRating * 1.2);
  if (!interconnectionPass) {
    // Use correct terminology based on interconnection method
    const _interconLabel = (_interconMethodRaw.includes('BACKFED') || _interconMethodRaw.includes('BREAKER'))
      ? 'backfed breaker'
      : 'load-side breaker';
    issues.push({
      severity: 'error',
      code: 'NEC_705_12B_120PCT',
      message: `Interconnection: ${backfeedBreakerAmps}A ${_interconLabel} + ${input.mainPanelAmps}A main = ${backfeedBreakerAmps + input.mainPanelAmps}A > 120% of ${input.panelBusRating}A bus (${Math.round(input.panelBusRating * 1.2)}A max)`,
      necReference: 'NEC 705.12(B)',
      autoFixed: false,
      suggestion: 'Consider supply-side tap (NEC 705.11) or panel upgrade',
    });
  }"""

if old in content:
    content = content.replace(old, new)
    print("Bug fix applied: interconnection method terminology fix")
else:
    print("ERROR: Pattern not found - checking...")
    idx = content.find("backfeedBreakerAmps + input.mainPanelAmps")
    if idx >= 0:
        print(f"Found at index {idx}: {repr(content[idx-200:idx+200])}")

with open('lib/computed-system.ts', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done.")