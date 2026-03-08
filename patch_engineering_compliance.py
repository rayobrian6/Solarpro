#!/usr/bin/env python3
"""
Add compliance explanation panel to engineering page:
1. Enhanced IssueRow with expandable NEC explanation
2. Compliance Action Center panel with grouped issues + suggested fixes
3. AHJ auto-detection status banner
"""

with open('/workspace/app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Replace IssueRow with enhanced version ───────────────────────────────
OLD_ISSUE_ROW = """function IssueRow({ issue }: { issue: any }) {
  const cfg = {
    error:   { icon: <XCircle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />, bg: 'bg-red-500/5 border-red-500/20' },
    warning: { icon: <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />, bg: 'bg-amber-500/5 border-amber-500/20' },
    info:    { icon: <Info size={13} className="text-blue-400 flex-shrink-0 mt-0.5" />, bg: 'bg-blue-500/5 border-blue-500/20' },
  }[issue.severity as string] || { icon: null, bg: '' };
  return (
    <div className={`flex gap-2 p-3 rounded-lg border ${cfg.bg}`}>
      {cfg.icon}
      <div className="flex-1 min-w-0">
        <div className="text-xs text-white">{issue.message}</div>
        {issue.necReference && <div className="text-xs text-slate-500 mt-0.5">{issue.necReference}</div>}
        {issue.suggestion && <div className="text-xs text-amber-400/80 mt-0.5">\ud83d\udca1 {issue.suggestion}</div>}
      </div>
      {issue.code && <div className="text-xs text-slate-600 font-mono flex-shrink-0">{issue.code}</div>}
    </div>
  );
}"""

NEW_ISSUE_ROW = """// NEC code explanations lookup
const NEC_EXPLANATIONS: Record<string, { title: string; plain: string; fix: string; ref: string }> = {
  '690.7':  { title: 'Max DC Voltage', plain: 'The total string voltage at cold temperature exceeds the inverter or system maximum. NEC 690.7 requires the corrected open-circuit voltage (Voc) to stay within rated limits.', fix: 'Reduce panels per string, or choose an inverter with a higher max input voltage. Use the Auto String Config tool to find the correct count.', ref: 'NEC 690.7(A)' },
  '690.8':  { title: 'OCPD Sizing', plain: 'The overcurrent protection device (fuse/breaker) must be rated at 125% of the short-circuit current (Isc). An undersized OCPD can fail to protect wiring during a fault.', fix: 'Increase the OCPD rating to at least 125% × Isc. The system will auto-select the next standard breaker size.', ref: 'NEC 690.8(A)' },
  '690.12': { title: 'Rapid Shutdown', plain: 'NEC 690.12 requires rapid shutdown capability for all rooftop PV systems. Panels must de-energize within 30 seconds of initiating shutdown.', fix: 'Add a rapid shutdown device (RSD) such as SolarEdge P-Series, Tigo CCA, or Enphase IQ8. Module-level power electronics (MLPE) satisfy this requirement.', ref: 'NEC 690.12' },
  '705.12': { title: '120% Busbar Rule', plain: 'The solar breaker + main breaker cannot exceed 120% of the bus bar rating. Exceeding this risks overloading the panel bus bar.', fix: 'Use supply-side tap (NEC 705.11), derate the main breaker, upgrade the panel, or reduce the solar system size.', ref: 'NEC 705.12(B)(2)' },
  '310.15': { title: 'Wire Ampacity', plain: 'The conductor must be rated to carry the maximum current with temperature and conduit fill derating applied. Undersized wire can overheat.', fix: 'Increase wire gauge (lower AWG number). Check conduit fill — more conductors in conduit require larger wire.', ref: 'NEC 310.15' },
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
          {issue.suggestion && <div className="text-xs text-amber-400/80 mt-0.5">\ud83d\udca1 {issue.suggestion}</div>}
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
}"""

if OLD_ISSUE_ROW in content:
    content = content.replace(OLD_ISSUE_ROW, NEW_ISSUE_ROW, 1)
    print("✅ Enhanced IssueRow with NEC explanations")
else:
    print("❌ ANCHOR for IssueRow not found")

# ─── 2. Add Compliance Action Center after the main compliance report card ────
# Find the end of the "Enter project details" empty state block
OLD_COMPLIANCE_EMPTY = """                {!compliance.overallStatus && !calculating && (
                  <div className="text-center py-8 text-slate-500">
                    <Activity size={32} className="mx-auto mb-2 opacity-30" />
                    <div className="text-sm">Enter project details and address to run compliance check</div>
                    <button onClick={runCalc} className="btn-primary btn-sm mt-3">Run Compliance Check</button>
                  </div>
                )}
              </div>"""

NEW_COMPLIANCE_EMPTY = """                {!compliance.overallStatus && !calculating && (
                  <div className="text-center py-8 text-slate-500">
                    <Activity size={32} className="mx-auto mb-2 opacity-30" />
                    <div className="text-sm">Enter project details and address to run compliance check</div>
                    <button onClick={runCalc} className="btn-primary btn-sm mt-3">Run Compliance Check</button>
                  </div>
                )}
              </div>

              {/* \u2500\u2500 AHJ Auto-Detection Status Banner \u2500\u2500 */}
              {compliance.jurisdiction && (
                <div className="card p-4 border-l-4 border-amber-500">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                      <MapPin size={14} className="text-amber-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold text-white">AHJ Auto-Detected</span>
                        <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full">
                          {compliance.jurisdiction.state}
                        </span>
                        <span className="text-xs px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">
                          NEC {compliance.jurisdiction.necVersion}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 mb-2">
                        <span className="font-medium text-slate-300">{compliance.jurisdiction.ahj}</span>
                        {compliance.jurisdiction.necAdoptionYear && (
                          <span className="ml-2 text-slate-500">Adopted {compliance.jurisdiction.necAdoptionYear}</span>
                        )}
                      </div>
                      {compliance.jurisdiction.specialRequirements?.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Special Requirements</div>
                          {compliance.jurisdiction.specialRequirements.map((req: string, i: number) => (
                            <div key={i} className="flex items-start gap-1.5 text-xs text-slate-300">
                              <span className="text-amber-400 flex-shrink-0 mt-0.5">\u2022</span>
                              {req}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-slate-500 flex-shrink-0">
                      {config.address ? 'From address' : 'From state'}
                    </div>
                  </div>
                </div>
              )}

              {/* \u2500\u2500 Compliance Action Center \u2500\u2500 */}
              {compliance.overallStatus && (compliance.electrical?.errors?.length > 0 || compliance.electrical?.warnings?.length > 0) && (
                <div className="card p-5 border-l-4 border-red-500/60">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                      <AlertTriangle size={14} className="text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Compliance Action Center</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {compliance.electrical?.errors?.length ?? 0} error{(compliance.electrical?.errors?.length ?? 0) !== 1 ? 's' : ''} \u00b7{' '}
                        {compliance.electrical?.warnings?.length ?? 0} warning{(compliance.electrical?.warnings?.length ?? 0) !== 1 ? 's' : ''} \u2014 click any issue for NEC explanation + fix
                      </p>
                    </div>
                    <div className="ml-auto">
                      <StatusBadge status={compliance.overallStatus} size="lg" />
                    </div>
                  </div>

                  {/* Priority fixes */}
                  {compliance.electrical?.errors?.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-bold text-red-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <XCircle size={11} /> Must Fix ({compliance.electrical.errors.length})
                      </div>
                      <div className="space-y-2">
                        {compliance.electrical.errors.map((e: any, i: number) => (
                          <IssueRow key={i} issue={e} expanded={i === 0} />
                        ))}
                      </div>
                    </div>
                  )}

                  {compliance.electrical?.warnings?.length > 0 && (
                    <div>
                      <div className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <AlertTriangle size={11} /> Review ({compliance.electrical.warnings.length})
                      </div>
                      <div className="space-y-2">
                        {compliance.electrical.warnings.map((w: any, i: number) => (
                          <IssueRow key={i} issue={w} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Quick fix actions */}
                  {compliance.electrical?.autoResolutions?.length === 0 && compliance.electrical?.errors?.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-700/50">
                      <div className="text-xs text-slate-400 mb-2">Quick Actions</div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => { setEngineeringMode('AUTO'); setTimeout(runCalc, 100); }}
                          className="btn-primary btn-sm text-xs"
                        >
                          \u26a1 Auto-Fix All Issues
                        </button>
                        <button
                          onClick={() => setActiveTab('config')}
                          className="btn-secondary btn-sm text-xs"
                        >
                          \u2699\ufe0f Adjust Config
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* \u2500\u2500 All Clear Banner \u2500\u2500 */}
              {compliance.overallStatus === 'PASS' && (
                <div className="card p-4 border-l-4 border-emerald-500 bg-emerald-500/5">
                  <div className="flex items-center gap-3">
                    <CheckCircle size={20} className="text-emerald-400 flex-shrink-0" />
                    <div>
                      <div className="text-sm font-bold text-emerald-400">All Compliance Checks Passed</div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        System meets NEC {compliance.jurisdiction?.necVersion ?? '2023'} requirements for {compliance.jurisdiction?.state ?? 'this jurisdiction'}.
                        Ready for permit submission.
                      </div>
                    </div>
                  </div>
                </div>
              )}"""

if OLD_COMPLIANCE_EMPTY in content:
    content = content.replace(OLD_COMPLIANCE_EMPTY, NEW_COMPLIANCE_EMPTY, 1)
    print("✅ Compliance Action Center + AHJ banner added")
else:
    print("❌ ANCHOR for compliance empty state not found")
    # Debug
    idx = content.find('Enter project details and address to run compliance check')
    if idx >= 0:
        print(f"  Found at char {idx}")
        print(f"  Context: {repr(content[idx-200:idx+300])}")

with open('/workspace/app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Engineering page written successfully")