#!/usr/bin/env python3
"""
v56.0 Fix — Complete rewrite of compliance + electrical tabs
with 100% correct field names against actual TypeScript interfaces.
"""

with open('app/engineering/page.tsx', 'r') as f:
    content = f.read()

original_len = len(content)

lines = content.split('\n')

def line_to_char(line_no):
    return sum(len(l)+1 for l in lines[:line_no-1])

compliance_line  = 6595
electrical_line  = 6977
structural_line  = 7277

compliance_start = line_to_char(compliance_line)
electrical_start = line_to_char(electrical_line)
structural_start = line_to_char(structural_line)

assert "'compliance'" in content[compliance_start:compliance_start+80], \
    f"Compliance marker not found: {repr(content[compliance_start:compliance_start+80])}"
assert 'ELECTRICAL SIZING TAB' in content[electrical_start:electrical_start+80], \
    f"Electrical marker not found: {repr(content[electrical_start:electrical_start+80])}"
assert "'structural'" in content[structural_start:structural_start+80], \
    f"Structural marker not found: {repr(content[structural_start:structural_start+80])}"

NEW_COMPLIANCE = r"""          {activeTab === 'compliance' && (() => {
            const _ov   = compliance.overallStatus;
            const _el   = compliance.electrical?.status;
            const _st   = compliance.structural?.status;
            const _errC = rulesResult?.errorCount   ?? 0;
            const _wrnC = rulesResult?.warningCount ?? 0;
            const _pasC = (rulesResult?.rules?.filter((r: any) => r.severity === 'pass')?.length) ?? 0;
            const _totalRules = (_errC + _wrnC + _pasC) || 1;
            const _passRate   = Math.round((_pasC / _totalRules) * 100);

            const _sGlow = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'border-red-500/50 bg-red-500/10 text-red-400';
              if (s === 'WARNING') return 'border-amber-500/50 bg-amber-500/10 text-amber-400';
              if (s === 'PASS')    return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400';
              return 'border-slate-700/50 bg-slate-800/40 text-slate-500';
            };
            const _sDot = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]';
              if (s === 'WARNING') return 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]';
              if (s === 'PASS')    return 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]';
              return 'bg-slate-600';
            };
            const _sTxt = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'text-red-400';
              if (s === 'WARNING') return 'text-amber-400';
              if (s === 'PASS')    return 'text-emerald-400';
              return 'text-slate-500';
            };
            const _msg = (v: any): string =>
              typeof v === 'string' ? v : (v?.message || v?.description || v?.reason || String(v));

            return (
              <div className="space-y-5 max-w-none">

                {/* COMPLIANCE HERO */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <ClipboardCheck size={16} className="text-emerald-400" />
                        NEC Compliance Engine
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {compliance.jurisdiction ? `NEC ${compliance.jurisdiction.necVersion} \u00b7 ${compliance.jurisdiction.state}` : 'Jurisdiction not set'}
                        {compliance.jurisdiction?.ahjName ? ` \u00b7 ${compliance.jurisdiction.ahjName}` : ''}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${_sGlow(_ov)}`}>
                      <span className={`w-2 h-2 rounded-full ${_sDot(_ov)}`} />
                      {_ov || '\u2014'}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
                    <div className={`rounded-xl border px-3 py-2.5 text-center ${_sGlow(_ov)}`}>
                      <div className="text-2xl font-black tabular-nums">{_passRate}%</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Pass Rate</div>
                    </div>
                    <div className="rounded-xl bg-red-500/10 border border-red-500/25 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-red-400 tabular-nums">{_errC}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Errors</div>
                    </div>
                    <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-amber-400 tabular-nums">{_wrnC}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Warnings</div>
                    </div>
                    <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-emerald-400 tabular-nums">{_pasC}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Passing</div>
                    </div>
                    <div className="rounded-xl bg-slate-800/60 border border-slate-700/50 px-3 py-2.5 text-center">
                      <div className="text-2xl font-black text-white tabular-nums">{_totalRules}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Total Rules</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Electrical', status: _el },
                      { label: 'Structural', status: _st },
                      { label: 'Overall',    status: _ov },
                    ].map(({ label, status }) => (
                      <div key={label} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold ${_sGlow(status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${_sDot(status)}`} />
                        {label}: {status || '\u2014'}
                      </div>
                    ))}
                    {compliance.jurisdiction?.necVersion && (
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
                        <Book size={10} /> NEC {compliance.jurisdiction.necVersion}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2-COL LAYOUT */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

                  {/* LEFT: Rule Results — RuleResult[] from rulesResult.rules */}
                  <div className="xl:col-span-2 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Shield size={12} className="text-emerald-400" /> Rule Results
                      {(rulesResult?.rules?.length ?? 0) > 0 && (
                        <span className="text-slate-600 font-normal">({rulesResult.rules.length} rules evaluated)</span>
                      )}
                    </h3>

                    {/* Error rules — severity === 'error' */}
                    {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'error').length > 0 && (
                      <div className="rounded-xl border border-red-500/30 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
                          <AlertCircle size={13} className="text-red-400" />
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                            Errors \u2014 {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'error').length} violations
                          </span>
                        </div>
                        <div className="divide-y divide-red-500/10">
                          {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'error').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-3 bg-red-500/5 hover:bg-red-500/8 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-red-300">{rule.ruleId || `Rule ${i+1}`}</span>
                                    {rule.necReference && <span className="text-[10px] font-mono text-red-500/70 bg-red-500/10 px-1.5 py-0.5 rounded">{rule.necReference}</span>}
                                  </div>
                                  <p className="text-xs text-red-200/80 leading-relaxed">{rule.message}</p>
                                  {rule.autoFixDescription && <p className="text-xs text-red-400/60 mt-1">\u21b3 {rule.autoFixDescription}</p>}
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warning rules — severity === 'warning' */}
                    {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'warning').length > 0 && (
                      <div className="rounded-xl border border-amber-500/30 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                          <AlertTriangle size={13} className="text-amber-400" />
                          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                            Warnings \u2014 {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'warning').length} items
                          </span>
                        </div>
                        <div className="divide-y divide-amber-500/10">
                          {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'warning').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-3 bg-amber-500/5 hover:bg-amber-500/8 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-amber-300">{rule.ruleId || `Rule ${i+1}`}</span>
                                    {rule.necReference && <span className="text-[10px] font-mono text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">{rule.necReference}</span>}
                                  </div>
                                  <p className="text-xs text-amber-200/80 leading-relaxed">{rule.message}</p>
                                  {rule.autoFixDescription && <p className="text-xs text-amber-400/60 mt-1">\u21b3 {rule.autoFixDescription}</p>}
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">WARN</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Passing rules — severity === 'pass' */}
                    {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'pass').length > 0 && (
                      <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/8 border-b border-emerald-500/15">
                          <CheckCircle size={13} className="text-emerald-400" />
                          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                            Passing \u2014 {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'pass').length} rules
                          </span>
                        </div>
                        <div className="divide-y divide-emerald-500/8">
                          {(rulesResult?.rules ?? []).filter((r: any) => r.severity === 'pass').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-2.5 bg-emerald-500/3 hover:bg-emerald-500/6 transition-colors">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-emerald-300/80">{rule.ruleId || `Rule ${i+1}`}</span>
                                  {rule.necReference && <span className="text-[10px] font-mono text-emerald-600 bg-emerald-500/8 px-1.5 py-0.5 rounded">{rule.necReference}</span>}
                                  <span className="text-xs text-slate-500">{rule.message}</span>
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">PASS</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {(!rulesResult?.rules || rulesResult.rules.length === 0) && (
                      <div className="card p-10 text-center border-dashed border-slate-700">
                        <ClipboardCheck size={36} className="mx-auto mb-3 text-slate-600" />
                        <div className="text-sm font-bold text-slate-400 mb-1">No Rules Evaluated</div>
                        <div className="text-xs text-slate-600">Complete system configuration to run NEC compliance checks.</div>
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Heat map + auto-resolutions + jurisdiction + subsystem detail */}
                  <div className="space-y-4">

                    {/* Compliance heat map */}
                    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity size={12} className="text-amber-400" /> Compliance Heat Map
                      </h4>
                      <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-500">Pass rate</span>
                          <span className={`font-bold ${_sTxt(_ov)}`}>{_passRate}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${_passRate >= 80 ? 'bg-emerald-500' : _passRate >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                            style={{ width: `${_passRate}%` }}
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        {[
                          { label: 'Errors',   count: _errC, color: 'bg-red-500/70',     textColor: 'text-red-400' },
                          { label: 'Warnings', count: _wrnC, color: 'bg-amber-500/70',   textColor: 'text-amber-400' },
                          { label: 'Passing',  count: _pasC, color: 'bg-emerald-500/70', textColor: 'text-emerald-400' },
                        ].map(({ label, count, color, textColor }) => (
                          <div key={label} className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 w-16 text-right">{label}</span>
                            <div className="flex-1 h-3 bg-slate-700/40 rounded-full overflow-hidden">
                              <div className={`h-full rounded-full ${color}`} style={{ width: `${_totalRules > 0 ? (count / _totalRules) * 100 : 0}%` }} />
                            </div>
                            <span className={`text-xs font-bold w-5 tabular-nums ${textColor}`}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Electrical auto-resolutions — AutoResolutionLog[] {field,type,originalValue,resolvedValue,necReference,reason} */}
                    {(compliance.electrical as any)?.autoResolutions?.length > 0 && (
                      <div className="rounded-xl border border-blue-500/25 bg-blue-500/8 p-4">
                        <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Zap size={12} /> Auto-Resolutions Applied
                        </h4>
                        <div className="space-y-1.5">
                          {(compliance.electrical as any).autoResolutions.map((r: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <CheckCircle size={11} className="text-blue-400 mt-0.5 flex-shrink-0" />
                              <span className="text-blue-200/80">
                                {typeof r === 'string' ? r : `${r.field}: ${r.originalValue} \u2192 ${r.resolvedValue}${r.necReference ? ` [${r.necReference}]` : ''}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Jurisdiction panel */}
                    {compliance.jurisdiction && (
                      <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <MapPin size={12} className="text-amber-400" /> Jurisdiction
                        </h4>
                        <div className="space-y-2">
                          {[
                            { label: 'State',       value: compliance.jurisdiction.state },
                            { label: 'NEC Version', value: `NEC ${compliance.jurisdiction.necVersion}` },
                            { label: 'AHJ',         value: compliance.jurisdiction.ahjName || '\u2014' },
                            { label: 'Utility',     value: compliance.jurisdiction.utilityName || compliance.utilityName || '\u2014' },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex items-center justify-between text-xs">
                              <span className="text-slate-500">{label}</span>
                              <span className="text-white font-semibold">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Electrical compliance detail — ElectricalCalcResult */}
                    {compliance.electrical && (
                      <div className={`rounded-xl border p-4 ${_sGlow(_el)}`}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Zap size={12} /> Electrical Compliance
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {(compliance.electrical as any).acSizing?.ocpdAmps != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Backfeed OCPD</span>
                              <span className="font-bold">{(compliance.electrical as any).acSizing.ocpdAmps}A</span>
                            </div>
                          )}
                          {(compliance.electrical as any).acSizing?.conductorLabel && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">AC Conductor</span>
                              <span className="font-bold">{(compliance.electrical as any).acSizing.conductorLabel}</span>
                            </div>
                          )}
                          {(compliance.electrical as any).acSizing?.disconnectAmps && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Disconnect</span>
                              <span className="font-bold">{(compliance.electrical as any).acSizing.disconnectAmps}A {(compliance.electrical as any).acSizing.disconnectType}</span>
                            </div>
                          )}
                          {((compliance.electrical as any).errors?.length > 0 || (compliance.electrical as any).warnings?.length > 0) && (
                            <div className="mt-2 pt-2 border-t border-current/20">
                              <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70">Issues</div>
                              {[...((compliance.electrical as any).errors ?? []), ...((compliance.electrical as any).warnings ?? [])].map((v: any, i: number) => (
                                <div key={i} className="flex items-start gap-1.5 mb-1">
                                  <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
                                  <span className="opacity-80">{_msg(v)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Structural compliance detail — StructuralResultV4 */}
                    {compliance.structural && (
                      <div className={`rounded-xl border p-4 ${_sGlow(_st)}`}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Shield size={12} /> Structural Compliance
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {(compliance.structural as any).wind?.netUpliftPressurePsf != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Wind Uplift</span>
                              <span className="font-bold">{(compliance.structural as any).wind.netUpliftPressurePsf.toFixed(1)} psf</span>
                            </div>
                          )}
                          {(compliance.structural as any).snow?.roofSnowLoadPsf != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Roof Snow Load</span>
                              <span className="font-bold">{(compliance.structural as any).snow.roofSnowLoadPsf.toFixed(1)} psf</span>
                            </div>
                          )}
                          {(compliance.structural as any).addedDeadLoadPsf != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Added Dead Load</span>
                              <span className="font-bold">{(compliance.structural as any).addedDeadLoadPsf.toFixed(2)} psf</span>
                            </div>
                          )}
                          {(compliance.structural as any).mountLayout?.mountSpacingIn != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Mount Spacing</span>
                              <span className="font-bold">{((compliance.structural as any).mountLayout.mountSpacingIn / 12).toFixed(1)} ft</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Structural auto-resolutions — StructuralAutoResolution[] {field,originalValue,resolvedValue,reason,necReference} */}
                    {rulesResult?.structuralAutoResolutions?.length > 0 && (
                      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <CheckCircle size={12} /> Structural Auto-Resolutions
                        </h4>
                        <div className="space-y-1.5">
                          {rulesResult.structuralAutoResolutions.map((r: any, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="text-emerald-400 font-mono mt-0.5 flex-shrink-0">\u2713</span>
                              <span className="text-emerald-200/80">
                                {r.field}: {r.originalValue} \u2192 {r.resolvedValue}{r.necReference ? ` [${r.necReference}]` : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>

              </div>
            );
          })()}

"""

NEW_ELECTRICAL = r"""          {/* \u2500\u2500 ELECTRICAL SIZING TAB \u2500\u2500 */}
          {activeTab === 'electrical' && (() => {
            const elec     = compliance.electrical as any;  // ElectricalCalcResult
            const acSizing = elec?.acSizing;                // ACSizingResult
            const _st      = elec?.status;                  // 'PASS'|'WARNING'|'FAIL'

            const _sGlow = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'border-red-500/50 bg-red-500/10 text-red-400';
              if (s === 'WARNING') return 'border-amber-500/50 bg-amber-500/10 text-amber-400';
              if (s === 'PASS')    return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400';
              return 'border-slate-700/50 bg-slate-800/40 text-slate-500';
            };
            const _sDot = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]';
              if (s === 'WARNING') return 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]';
              if (s === 'PASS')    return 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]';
              return 'bg-slate-600';
            };

            // Safe message extractor for CalcIssue {code, severity, message, ...}
            const _msg = (v: any): string =>
              typeof v === 'string' ? v : (v?.message || v?.description || v?.reason || String(v));

            // Combined issues from ElectricalCalcResult.errors[] + .warnings[]
            const _issues: any[] = [...(elec?.errors ?? []), ...(elec?.warnings ?? [])];

            // Fallback derived values when acSizing not yet available
            const acAmps   = Math.round(Number(totalInverterKw) * 1000 / 240);
            const ocpdAmps = acSizing?.ocpdAmps ?? Math.ceil(acAmps * 1.25 / 5) * 5;

            return (
              <div className="space-y-5 max-w-none">

                {/* ELECTRICAL HERO */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <Zap size={16} className="text-blue-400" />
                        Electrical Sizing
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        NEC 705.60 \u00b7 310.16 \u00b7 Ch.9 \u00b7 {cs.isMicro ? 'Microinverter topology' : 'String inverter topology'}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${_sGlow(_st)}`}>
                      <span className={`w-2 h-2 rounded-full ${_sDot(_st)}`} />
                      {_st || '\u2014'}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-blue-400 tabular-nums">{totalInverterKw}kW</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">AC Output</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-amber-400 tabular-nums">{acSizing?.acCurrentAmps ?? acAmps}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">AC Current</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-white tabular-nums">{ocpdAmps}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">OCPD</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-emerald-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-emerald-400 tabular-nums">{config.mainPanelAmps || 200}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Main Panel</div>
                    </div>
                  </div>

                  {acSizing && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300">
                        <Activity size={10} className="text-blue-400" />
                        Backfeed: {cs.backfeedBreakerAmps ?? ocpdAmps}A
                      </div>
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300">
                        <Zap size={10} className="text-amber-400" />
                        Interconnection: {config.interconnectionMethod || '\u2014'}
                      </div>
                      {_issues.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 font-semibold">
                          <AlertCircle size={10} /> {_issues.length} issue{_issues.length !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2-COL LAYOUT */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

                  {/* LEFT: Conductor & Equipment Cards — ACSizingResult */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Activity size={12} className="text-blue-400" /> Equipment Sizing
                    </h3>

                    {acSizing ? (
                      <div className="space-y-3">

                        {/* AC Conductor — conductorLabel, conductorGauge, conductorAmpacity */}
                        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-blue-400 flex items-center gap-2">
                              <GitBranch size={12} /> AC Conductors
                            </h4>
                            <span className="text-[10px] font-mono text-blue-500/70 bg-blue-500/10 px-2 py-0.5 rounded">NEC 310.16</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conductorLabel || acSizing.conductorGauge}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Conductor</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conductorAmpacity || acSizing.ocpdAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Ampacity</div>
                            </div>
                          </div>
                        </div>

                        {/* Conduit — conduitSize, conduitType, conduitFillPct */}
                        <div className="rounded-xl border border-slate-700/50 bg-slate-800/40 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-2">
                              <Wrench size={12} /> Conduit
                            </h4>
                            <span className="text-[10px] font-mono text-slate-500 bg-slate-700/40 px-2 py-0.5 rounded">NEC Ch.9</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conduitSize}"</div>
                              <div className="text-[10px] text-slate-500">Size</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                              <div className="text-sm font-black text-white">{acSizing.conduitType || config.conduitType || 'EMT'}</div>
                              <div className="text-[10px] text-slate-500">Type</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2 text-center">
                              <div className={`text-sm font-black ${(acSizing.conduitFillPct ?? 0) > 40 ? 'text-red-400' : 'text-emerald-400'}`}>
                                {acSizing.conduitFillPct?.toFixed(1) ?? '\u2014'}%
                              </div>
                              <div className="text-[10px] text-slate-500">Fill</div>
                            </div>
                          </div>
                        </div>

                        {/* Disconnect & OCPD — disconnectAmps, disconnectType, fuseAmps, ocpdAmps */}
                        <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-amber-400 flex items-center gap-2">
                              <Power size={12} /> Disconnect & OCPD
                            </h4>
                            <span className="text-[10px] font-mono text-amber-500/70 bg-amber-500/10 px-2 py-0.5 rounded">NEC 690.14</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-amber-400">{acSizing.disconnectAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">{acSizing.disconnectType === 'fused' ? 'Fusible Disconnect' : 'Non-Fused Disconnect'}</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-amber-400">{acSizing.ocpdAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Backfeed OCPD</div>
                            </div>
                          </div>
                          {acSizing.disconnectType === 'fused' && acSizing.fuseAmps && (
                            <div className="mt-2 p-2 bg-amber-500/8 rounded-lg text-xs text-amber-300 flex items-center gap-2">
                              <AlertTriangle size={10} />
                              Fused: {acSizing.fuseAmps}A \u00d7 2 Class R (NEC 690.9)
                            </div>
                          )}
                        </div>

                        {/* Grounding — groundingConductor from ACSizingResult */}
                        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-2">
                              <Shield size={12} /> Grounding
                            </h4>
                            <span className="text-[10px] font-mono text-emerald-600 bg-emerald-500/8 px-2 py-0.5 rounded">NEC 250.66</span>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-emerald-400">{acSizing.groundingConductor}</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">EGC</div>
                            </div>
                            <div className="bg-slate-900/50 rounded-lg p-2.5 text-center">
                              <div className="text-sm font-black text-white">Bare Copper</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Material</div>
                            </div>
                          </div>
                        </div>

                      </div>
                    ) : (
                      <div className="card p-10 text-center border-dashed border-slate-700">
                        <Zap size={36} className="mx-auto mb-3 text-slate-600" />
                        <div className="text-sm font-bold text-slate-400 mb-1">Electrical sizing not computed</div>
                        <div className="text-xs text-slate-600">Complete system configuration to generate conductor sizing.</div>
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Issues + Conduit Schedule + Wire Runs */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <FileText size={12} className="text-blue-400" /> Conduit & Conductor Schedule
                      <span className="text-slate-600 font-normal text-[10px]">Auto-calculated \u00b7 NEC Ch.9</span>
                    </h3>

                    {/* Issues — CalcIssue[] from ElectricalCalcResult.errors + .warnings */}
                    {_issues.length > 0 && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4 space-y-2">
                        <h4 className="text-xs font-bold text-red-400 flex items-center gap-2">
                          <AlertCircle size={12} /> {_issues.length} Electrical Issue{_issues.length !== 1 ? 's' : ''}
                        </h4>
                        {_issues.map((v: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-red-300/80">
                            <span className="text-red-500 mt-0.5">\u2022</span> {_msg(v)}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Conduit schedule — ConduitScheduleRow[] from cs.conduitSchedule */}
                    {/* Fields: raceway,from,to,conduitType,conduitSize,conductors,egc,neutral,lengthFt,fillPct,ampacity(str),ocpd(str),voltageDrop(str),pass */}
                    {cs.conduitSchedule?.length > 0 ? (
                      <div className="rounded-xl border border-slate-700/60 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-800/80 border-b border-slate-700/50">
                                {['Raceway','From','To','Type','Size','Conductors','EGC','OCPD','V-Drop','\u2713'].map(h => (
                                  <th key={h} className="text-left text-slate-500 px-3 py-2 font-semibold whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-700/30">
                              {cs.conduitSchedule.map((row: any, idx: number) => (
                                <tr key={row.raceway || idx} className="hover:bg-slate-800/30 transition-colors">
                                  <td className="px-3 py-2 font-semibold text-white whitespace-nowrap">{row.raceway}</td>
                                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.from}</td>
                                  <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.to}</td>
                                  <td className="px-3 py-2 text-slate-300">{row.conduitType}</td>
                                  <td className="px-3 py-2 font-bold text-amber-400">{row.conduitSize}"</td>
                                  <td className="px-3 py-2 font-mono text-slate-300">{row.conductors}</td>
                                  <td className="px-3 py-2 text-slate-400">{row.egc}</td>
                                  <td className="px-3 py-2 font-bold text-slate-300">{row.ocpd ?? '\u2014'}</td>
                                  <td className={`px-3 py-2 font-bold ${row.voltageDrop && parseFloat(row.voltageDrop) > 3 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {row.voltageDrop ?? '\u2014'}
                                  </td>
                                  <td className="px-3 py-2">
                                    {row.pass
                                      ? <CheckCircle size={12} className="text-emerald-400" />
                                      : <AlertCircle size={12} className="text-red-400" />
                                    }
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <div className="card p-8 text-center border-dashed border-slate-700">
                        <Activity size={28} className="mx-auto mb-2 text-slate-600" />
                        <div className="text-xs text-slate-500">No conduit schedule computed yet.</div>
                      </div>
                    )}

                    {/* Wire runs — RunSegment[] from cs.runs */}
                    {/* Fields: id,label,from,to,wireGauge,conduitType,conduitSize,ocpdAmps,voltageDropPct,overallPass (NOT .pass) */}
                    {cs.runs?.length > 0 && (
                      <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <GitBranch size={12} className="text-blue-400" /> Wire Runs
                        </h4>
                        <div className="space-y-2">
                          {cs.runs.map((run: any, i: number) => (
                            <div key={run.id || i} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-700/30 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${run.overallPass ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                <span className="text-slate-300 font-medium">{run.label || run.id}</span>
                              </div>
                              <div className="flex items-center gap-3 text-slate-500">
                                {run.wireGauge   && <span className="text-white font-bold">{run.wireGauge}</span>}
                                {run.ocpdAmps    && <span>{run.ocpdAmps}A OCPD</span>}
                                {run.conduitSize && <span>{run.conduitSize}" {run.conduitType}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>
                </div>

              </div>
            );
          })()}

"""

# Replace electrical block first (higher position), then compliance
new_content = (
    content[:electrical_start]
    + NEW_ELECTRICAL
    + content[structural_start:]
)

# Find new positions for compliance in the rebuilt content
compliance_start2 = new_content.find("          {activeTab === 'compliance' && (() => {")
electrical_start2 = new_content.find("          {/* \u2500\u2500 ELECTRICAL SIZING TAB \u2500\u2500 */}")

assert compliance_start2 != -1, "Compliance marker missing after electrical replacement"
assert electrical_start2 != -1, "Electrical marker missing after replacement"
assert compliance_start2 < electrical_start2, \
    f"Order wrong: compliance={compliance_start2} electrical={electrical_start2}"

final_content = (
    new_content[:compliance_start2]
    + NEW_COMPLIANCE
    + new_content[electrical_start2:]
)

print(f"Original:   {original_len:,} chars")
print(f"Final:      {len(final_content):,} chars")

assert "activeTab === 'compliance'" in final_content
assert "activeTab === 'electrical'" in final_content
assert "activeTab === 'structural'" in final_content
print("All tab markers verified OK")

with open('app/engineering/page.tsx', 'w') as f:
    f.write(final_content)
print("Written successfully")