#!/usr/bin/env python3
"""Replace IssueRow with enhanced version using exact line-based replacement"""

with open('/workspace/app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find IssueRow function start and end
start_line = None
end_line = None
brace_depth = 0
in_function = False

for i, line in enumerate(lines):
    if 'function IssueRow(' in line and start_line is None:
        start_line = i
        in_function = True
    if in_function:
        brace_depth += line.count('{') - line.count('}')
        if brace_depth <= 0 and start_line is not None and i > start_line:
            end_line = i
            break

print(f"IssueRow: lines {start_line+1} to {end_line+1}")

# New IssueRow content
NEW_ISSUE_ROW = '''// NEC code explanations lookup
const NEC_EXPLANATIONS: Record<string, { title: string; plain: string; fix: string; ref: string }> = {
  '690.7':  { title: 'Max DC Voltage', plain: 'The total string voltage at cold temperature exceeds the inverter or system maximum. NEC 690.7 requires the corrected open-circuit voltage (Voc) to stay within rated limits.', fix: 'Reduce panels per string, or choose an inverter with a higher max input voltage. Use the Auto String Config tool to find the correct count.', ref: 'NEC 690.7(A)' },
  '690.8':  { title: 'OCPD Sizing', plain: 'The overcurrent protection device (fuse/breaker) must be rated at 125% of the short-circuit current (Isc). An undersized OCPD can fail to protect wiring during a fault.', fix: 'Increase the OCPD rating to at least 125% \u00d7 Isc. The system will auto-select the next standard breaker size.', ref: 'NEC 690.8(A)' },
  '690.12': { title: 'Rapid Shutdown', plain: 'NEC 690.12 requires rapid shutdown capability for all rooftop PV systems. Panels must de-energize within 30 seconds of initiating shutdown.', fix: 'Add a rapid shutdown device (RSD) such as SolarEdge P-Series, Tigo CCA, or Enphase IQ8. Module-level power electronics (MLPE) satisfy this requirement.', ref: 'NEC 690.12' },
  '705.12': { title: '120% Busbar Rule', plain: 'The solar breaker + main breaker cannot exceed 120% of the bus bar rating. Exceeding this risks overloading the panel bus bar.', fix: 'Use supply-side tap (NEC 705.11), derate the main breaker, upgrade the panel, or reduce the solar system size.', ref: 'NEC 705.12(B)(2)' },
  '310.15': { title: 'Wire Ampacity', plain: 'The conductor must be rated to carry the maximum current with temperature and conduit fill derating applied. Undersized wire can overheat.', fix: 'Increase wire gauge (lower AWG number). Check conduit fill \u2014 more conductors in conduit require larger wire.', ref: 'NEC 310.15' },
  '690.9':  { title: 'Overcurrent Protection', plain: 'Each ungrounded conductor must be protected by an OCPD rated for the circuit. Missing or incorrectly sized protection creates fire risk.', fix: 'Add properly rated fuses or breakers at each source. String combiner boxes typically include fusing.', ref: 'NEC 690.9' },
  '690.47': { title: 'Grounding', plain: 'PV systems require equipment grounding conductors (EGC) sized per NEC 690.47. Improper grounding creates shock and fire hazards.', fix: 'Verify EGC sizing per NEC Table 250.122. Use listed grounding hardware. Ensure all metal parts are bonded.', ref: 'NEC 690.47' },
};

function getNecExplanation(issue: any) {
  if (!issue.necReference && !issue.code) return null;
  const ref = issue.necReference || issue.code || '';
  for (const [key, val] of Object.entries(NEC_EXPLANATIONS)) {
    if (ref.includes(key)) return val;
  }
  return null;
}

function IssueRow({ issue, expanded: defaultExpanded = false }: { issue: any; expanded?: boolean }) {
  const [open, setOpen] = React.useState(defaultExpanded);
  const cfg = {
    error:   { icon: <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />, bg: 'bg-red-500/5 border-red-500/20' },
    warning: { icon: <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />, bg: 'bg-amber-500/5 border-amber-500/20' },
    info:    { icon: <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />, bg: 'bg-blue-500/5 border-blue-500/20' },
  }[issue.severity as string] || { icon: null, bg: '' };
  const explanation = getNecExplanation(issue);
  return (
    <div className={`rounded-lg border ${cfg.bg} overflow-hidden`}>
      <div
        className="flex gap-2 p-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => explanation && setOpen(!open)}
      >
        {cfg.icon}
        <div className="flex-1 min-w-0">
          <div className="text-xs text-white">{issue.message}</div>
          {issue.necReference && <div className="text-xs text-slate-500 mt-0.5">{issue.necReference}</div>}
          {issue.suggestion && <div className="text-xs text-amber-400/80 mt-0.5">\U0001f4a1 {issue.suggestion}</div>}
        </div>
        {issue.code && <div className="text-xs text-slate-600 font-mono flex-shrink-0">{issue.code}</div>}
        {explanation && (
          <div className="text-xs text-slate-600 flex-shrink-0 ml-1">
            {open ? '\u25b2' : '\u25bc'}
          </div>
        )}
      </div>
      {open && explanation && (
        <div className="px-3 pb-3 border-t border-slate-700/50 bg-slate-900/40">
          <div className="pt-2 space-y-2">
            <div className="text-xs font-semibold text-white">{explanation.title} \u2014 {explanation.ref}</div>
            <div className="text-xs text-slate-400 leading-relaxed">{explanation.plain}</div>
            <div className="flex items-start gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
              <span className="text-emerald-400 flex-shrink-0 mt-0.5">\u2192</span>
              <div className="text-xs text-emerald-300"><span className="font-semibold">Suggested Fix:</span> {explanation.fix}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
'''

if start_line is not None and end_line is not None:
    new_lines = lines[:start_line] + [NEW_ISSUE_ROW + '\n'] + lines[end_line+1:]
    with open('/workspace/app/engineering/page.tsx', 'w', encoding='utf-8') as f:
        f.writelines(new_lines)
    print(f"✅ IssueRow replaced (lines {start_line+1}-{end_line+1})")
else:
    print("❌ Could not find IssueRow function boundaries")