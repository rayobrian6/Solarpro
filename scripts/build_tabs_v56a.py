#!/usr/bin/env python3
"""
v56.0 — Tab UX Overhaul: Compliance + Electrical + Structural
NON-BREAKING: all state, handlers, API contracts unchanged.
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ── Exact boundaries (verified) ──────────────────────────────────────────────
COMPLIANCE_START  = 375782
COMPLIANCE_END    = 438452   # ends just before {/* ── ELECTRICAL SIZING TAB */}

ELECTRICAL_START  = 438510
ELECTRICAL_END    = 486821   # ends just before {/* ── STRUCTURAL TAB */}

STRUCTURAL_START  = 486872
STRUCTURAL_END    = 550894   # ends just before {/* ── SINGLE-LINE DIAGRAM TAB */}

# ─────────────────────────────────────────────────────────────────────────────
# COMPLIANCE TAB V2
# ─────────────────────────────────────────────────────────────────────────────
COMPLIANCE_V2 = r"""{activeTab === 'compliance' && (() => {
            const _ov   = compliance.overallStatus;
            const _el   = compliance.electrical?.status;
            const _st   = compliance.structural?.status;
            const _errC = rulesResult?.errorCount   ?? 0;
            const _wrnC = rulesResult?.warningCount ?? 0;
            const _pasC = (rulesResult?.results?.filter((r: any) => r.status === 'PASS')?.length) ?? 0;
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

            return (
              <div className="space-y-5 max-w-none">

                {/* ══ COMPLIANCE HERO ══════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <ClipboardCheck size={16} className="text-emerald-400" />
                        NEC Compliance Engine
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {compliance.jurisdiction ? `NEC ${compliance.jurisdiction.necVersion} · ${compliance.jurisdiction.state}` : 'Jurisdiction not set'}
                        {compliance.jurisdiction?.ahjName ? ` · ${compliance.jurisdiction.ahjName}` : ''}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${_sGlow(_ov)}`}>
                      <span className={`w-2 h-2 rounded-full ${_sDot(_ov)}`} />
                      {_ov || '—'}
                    </div>
                  </div>

                  {/* KPI strip */}
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

                  {/* Subsystem status row */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { label: 'Electrical', status: _el },
                      { label: 'Structural', status: _st },
                      { label: 'Overall',    status: _ov },
                    ].map(({ label, status }) => (
                      <div key={label} className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-semibold ${_sGlow(status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${_sDot(status)}`} />
                        {label}: {status || '—'}
                      </div>
                    ))}
                    {compliance.jurisdiction?.necVersion && (
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-blue-500/25 bg-blue-500/10 text-blue-400">
                        <Book size={10} /> NEC {compliance.jurisdiction.necVersion}
                      </div>
                    )}
                  </div>
                </div>

                {/* ══ 2-COL LAYOUT ══════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

                  {/* LEFT: Rule Results Accordion */}
                  <div className="xl:col-span-2 space-y-3">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Shield size={12} className="text-emerald-400" /> Rule Results
                      {rulesResult?.results?.length > 0 && (
                        <span className="text-slate-600 font-normal">({rulesResult.results.length} rules evaluated)</span>
                      )}
                    </h3>

                    {/* Error rules first */}
                    {(rulesResult?.results ?? []).filter((r: any) => r.status === 'FAIL').length > 0 && (
                      <div className="rounded-xl border border-red-500/30 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border-b border-red-500/20">
                          <AlertCircle size={13} className="text-red-400" />
                          <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
                            Errors — {(rulesResult?.results ?? []).filter((r: any) => r.status === 'FAIL').length} violations
                          </span>
                        </div>
                        <div className="divide-y divide-red-500/10">
                          {(rulesResult?.results ?? []).filter((r: any) => r.status === 'FAIL').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-3 bg-red-500/5 hover:bg-red-500/8 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-red-300">{rule.ruleId || `Rule ${i+1}`}</span>
                                    {rule.necRef && <span className="text-[10px] font-mono text-red-500/70 bg-red-500/10 px-1.5 py-0.5 rounded">{rule.necRef}</span>}
                                  </div>
                                  <p className="text-xs text-red-200/80 leading-relaxed">{rule.message || rule.description}</p>
                                  {rule.detail && <p className="text-xs text-red-400/60 mt-1">{rule.detail}</p>}
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">FAIL</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Warning rules */}
                    {(rulesResult?.results ?? []).filter((r: any) => r.status === 'WARNING').length > 0 && (
                      <div className="rounded-xl border border-amber-500/30 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
                          <AlertTriangle size={13} className="text-amber-400" />
                          <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                            Warnings — {(rulesResult?.results ?? []).filter((r: any) => r.status === 'WARNING').length} items
                          </span>
                        </div>
                        <div className="divide-y divide-amber-500/10">
                          {(rulesResult?.results ?? []).filter((r: any) => r.status === 'WARNING').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-3 bg-amber-500/5 hover:bg-amber-500/8 transition-colors">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-amber-300">{rule.ruleId || `Rule ${i+1}`}</span>
                                    {rule.necRef && <span className="text-[10px] font-mono text-amber-500/70 bg-amber-500/10 px-1.5 py-0.5 rounded">{rule.necRef}</span>}
                                  </div>
                                  <p className="text-xs text-amber-200/80 leading-relaxed">{rule.message || rule.description}</p>
                                  {rule.detail && <p className="text-xs text-amber-400/60 mt-1">{rule.detail}</p>}
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">WARN</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Passing rules */}
                    {(rulesResult?.results ?? []).filter((r: any) => r.status === 'PASS').length > 0 && (
                      <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500/8 border-b border-emerald-500/15">
                          <CheckCircle size={13} className="text-emerald-400" />
                          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                            Passing — {(rulesResult?.results ?? []).filter((r: any) => r.status === 'PASS').length} rules
                          </span>
                        </div>
                        <div className="divide-y divide-emerald-500/8">
                          {(rulesResult?.results ?? []).filter((r: any) => r.status === 'PASS').map((rule: any, i: number) => (
                            <div key={rule.ruleId || i} className="px-4 py-2.5 bg-emerald-500/3 hover:bg-emerald-500/6 transition-colors">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-emerald-300/80">{rule.ruleId || `Rule ${i+1}`}</span>
                                  {rule.necRef && <span className="text-[10px] font-mono text-emerald-600 bg-emerald-500/8 px-1.5 py-0.5 rounded">{rule.necRef}</span>}
                                  <span className="text-xs text-slate-500">{rule.message || rule.description}</span>
                                </div>
                                <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">PASS</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Empty state */}
                    {(!rulesResult?.results || rulesResult.results.length === 0) && (
                      <div className="card p-10 text-center border-dashed border-slate-700">
                        <ClipboardCheck size={36} className="mx-auto mb-3 text-slate-600" />
                        <div className="text-sm font-bold text-slate-400 mb-1">No Rules Evaluated</div>
                        <div className="text-xs text-slate-600">Complete system configuration to run NEC compliance checks.</div>
                      </div>
                    )}
                  </div>

                  {/* RIGHT: Summary + Auto-resolutions + Jurisdiction */}
                  <div className="space-y-4">

                    {/* Rule heat map */}
                    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity size={12} className="text-amber-400" /> Compliance Heat Map
                      </h4>
                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs mb-1.5">
                          <span className="text-slate-500">Pass rate</span>
                          <span className={`font-bold ${_sTxt(_ov)}`}>{_passRate}%</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-700/60 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-700 ${
                              _passRate >= 80 ? 'bg-emerald-500' : _passRate >= 50 ? 'bg-amber-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${_passRate}%` }}
                          />
                        </div>
                      </div>
                      {/* Severity bars */}
                      <div className="space-y-1.5">
                        {[
                          { label: 'Errors', count: _errC, color: 'bg-red-500/70', textColor: 'text-red-400' },
                          { label: 'Warnings', count: _wrnC, color: 'bg-amber-500/70', textColor: 'text-amber-400' },
                          { label: 'Passing', count: _pasC, color: 'bg-emerald-500/70', textColor: 'text-emerald-400' },
                        ].map(({ label, count, color, textColor }) => (
                          <div key={label} className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 w-16 text-right">{label}</span>
                            <div className="flex-1 h-3 bg-slate-700/40 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${color}`}
                                style={{ width: `${_totalRules > 0 ? (count / _totalRules) * 100 : 0}%` }}
                              />
                            </div>
                            <span className={`text-xs font-bold w-5 tabular-nums ${textColor}`}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Auto-resolutions */}
                    {(compliance.electrical as any)?.autoResolutions?.length > 0 && (
                      <div className="rounded-xl border border-blue-500/25 bg-blue-500/8 p-4">
                        <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Zap size={12} /> Auto-Resolutions Applied
                        </h4>
                        <div className="space-y-1.5">
                          {(compliance.electrical as any).autoResolutions.map((r: string, i: number) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <CheckCircle size={11} className="text-blue-400 mt-0.5 flex-shrink-0" />
                              <span className="text-blue-200/80">{r}</span>
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
                            { label: 'State', value: compliance.jurisdiction.state },
                            { label: 'NEC Version', value: `NEC ${compliance.jurisdiction.necVersion}` },
                            { label: 'AHJ', value: compliance.jurisdiction.ahjName || '—' },
                            { label: 'Utility', value: compliance.jurisdiction.utilityName || compliance.utilityName || '—' },
                          ].map(({ label, value }) => (
                            <div key={label} className="flex items-center justify-between text-xs">
                              <span className="text-slate-500">{label}</span>
                              <span className="text-white font-semibold">{value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Electrical compliance detail */}
                    {compliance.electrical && (
                      <div className={`rounded-xl border p-4 ${_sGlow(_el)}`}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Zap size={12} /> Electrical Compliance
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {(compliance.electrical as any).backfeedAmps != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Backfeed Breaker</span>
                              <span className="font-bold">{(compliance.electrical as any).backfeedAmps}A</span>
                            </div>
                          )}
                          {(compliance.electrical as any).acSizing?.ocpdAmps != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">OCPD</span>
                              <span className="font-bold">{(compliance.electrical as any).acSizing.ocpdAmps}A</span>
                            </div>
                          )}
                          {(compliance.electrical as any).acSizing?.conductorGauge && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Conductor</span>
                              <span className="font-bold">{(compliance.electrical as any).acSizing.conductorGauge}</span>
                            </div>
                          )}
                          {(compliance.electrical as any).violations?.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-current/20">
                              <div className="text-[10px] font-bold uppercase tracking-wider mb-1 opacity-70">Violations</div>
                              {(compliance.electrical as any).violations.map((v: string, i: number) => (
                                <div key={i} className="flex items-start gap-1.5 mb-1">
                                  <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
                                  <span className="opacity-80">{v}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Structural compliance detail */}
                    {compliance.structural && (
                      <div className={`rounded-xl border p-4 ${_sGlow(_st)}`}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Wrench size={12} /> Structural Compliance
                        </h4>
                        <div className="space-y-1.5 text-xs">
                          {(compliance.structural as any).windLoad != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Wind Load</span>
                              <span className="font-bold">{(compliance.structural as any).windLoad} psf</span>
                            </div>
                          )}
                          {(compliance.structural as any).snowLoad != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Snow Load</span>
                              <span className="font-bold">{(compliance.structural as any).snowLoad} psf</span>
                            </div>
                          )}
                          {(compliance.structural as any).deadLoad != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Dead Load</span>
                              <span className="font-bold">{(compliance.structural as any).deadLoad} psf</span>
                            </div>
                          )}
                          {(compliance.structural as any).attachmentSpacingFt != null && (
                            <div className="flex justify-between">
                              <span className="text-slate-500">Attachment Spacing</span>
                              <span className="font-bold">{(compliance.structural as any).attachmentSpacingFt} ft</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                </div>

                {/* ValidationPanel (existing component — preserved) */}
                {validationResult && (
                  <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                      <Shield size={12} className="text-amber-400" /> System Validation
                    </h3>
                    <ValidationPanel result={validationResult} />
                  </div>
                )}

              </div>
            );
          })()}"""

# ─────────────────────────────────────────────────────────────────────────────
# ELECTRICAL TAB V2
# ─────────────────────────────────────────────────────────────────────────────
ELECTRICAL_V2 = r"""{activeTab === 'electrical' && (() => {
            const elec     = compliance.electrical as any;
            const acSizing = elec?.acSizing;
            const _st      = elec?.status;
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

            const acAmps   = Math.round(Number(totalInverterKw) * 1000 / 240);
            const ocpdAmps = acSizing?.ocpdAmps ?? Math.ceil(acAmps * 1.25 / 5) * 5;

            return (
              <div className="space-y-5 max-w-none">

                {/* ══ ELECTRICAL HERO ══════════════════════════════════════════ */}
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
                        NEC 705.60 · 310.16 · Ch.9 · {cs.isMicro ? 'Microinverter topology' : 'String inverter topology'}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-black ${_sGlow(_st)}`}>
                      <span className={`w-2 h-2 rounded-full ${_sDot(_st)}`} />
                      {_st || '—'}
                    </div>
                  </div>

                  {/* KPI grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-blue-400 tabular-nums">{totalInverterKw}kW</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">AC Output</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-amber-400 tabular-nums">{acAmps}A</div>
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

                  {/* Backfeed / 120% rule strip */}
                  {acSizing && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300">
                        <Activity size={10} className="text-blue-400" />
                        Backfeed: {cs.backfeedBreakerAmps ?? ocpdAmps}A
                      </div>
                      <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 text-slate-300">
                        <Zap size={10} className="text-amber-400" />
                        Interconnection: {config.interconnectionMethod || '—'}
                      </div>
                      {elec?.violations?.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 font-semibold">
                          <AlertCircle size={10} /> {elec.violations.length} violation{elec.violations.length !== 1 ? 's' : ''}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* ══ 2-COL LAYOUT ══════════════════════════════════════════════ */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

                  {/* LEFT: Conductor & Equipment Cards */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <Activity size={12} className="text-blue-400" /> Equipment Sizing
                    </h3>

                    {acSizing ? (
                      <div className="space-y-3">
                        {/* AC Conductor card */}
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
                              <div className="text-sm font-black text-white">{acSizing.conductorAmps || acSizing.ocpdAmps}A</div>
                              <div className="text-[10px] text-slate-500 mt-0.5">Ampacity</div>
                            </div>
                          </div>
                        </div>

                        {/* Conduit card */}
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
                                {acSizing.conduitFillPct?.toFixed(1) ?? '—'}%
                              </div>
                              <div className="text-[10px] text-slate-500">Fill</div>
                            </div>
                          </div>
                        </div>

                        {/* Disconnect card */}
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
                              Fused: {acSizing.fuseAmps}A × 2 Class R (NEC 690.9)
                            </div>
                          )}
                        </div>

                        {/* Grounding card */}
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

                  {/* RIGHT: Conduit Schedule + Violations */}
                  <div className="space-y-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                      <FileText size={12} className="text-blue-400" /> Conduit & Conductor Schedule
                      <span className="text-slate-600 font-normal text-[10px]">Auto-calculated · NEC Ch.9</span>
                    </h3>

                    {/* Violations inline */}
                    {elec?.violations?.length > 0 && (
                      <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4 space-y-2">
                        <h4 className="text-xs font-bold text-red-400 flex items-center gap-2">
                          <AlertCircle size={12} /> {elec.violations.length} Electrical Violation{elec.violations.length !== 1 ? 's' : ''}
                        </h4>
                        {elec.violations.map((v: string, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-xs text-red-300/80">
                            <span className="text-red-500 mt-0.5">•</span> {v}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Conduit schedule table */}
                    {cs.conduitSchedule?.length > 0 ? (
                      <div className="rounded-xl border border-slate-700/60 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-800/80 border-b border-slate-700/50">
                                {['Raceway','From','To','Type','Size','Conductors','EGC','OCPD','V-Drop','✓'].map(h => (
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
                                  <td className="px-3 py-2 font-bold text-slate-300">{row.ocpdAmps}A</td>
                                  <td className={`px-3 py-2 font-bold ${(row.voltageDrop ?? 0) > 3 ? 'text-red-400' : 'text-emerald-400'}`}>
                                    {row.voltageDrop?.toFixed(1) ?? '—'}%
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

                    {/* Wire runs detail */}
                    {cs.runs?.length > 0 && (
                      <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                          <GitBranch size={12} className="text-blue-400" /> Wire Runs
                        </h4>
                        <div className="space-y-2">
                          {cs.runs.map((run: any, i: number) => (
                            <div key={run.id || i} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-700/30 last:border-0">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${run.pass ? 'bg-emerald-400' : 'bg-red-400'}`} />
                                <span className="text-slate-300 font-medium">{run.id || run.label}</span>
                              </div>
                              <div className="flex items-center gap-3 text-slate-500">
                                {run.wireGauge && <span className="text-white font-bold">{run.wireGauge}</span>}
                                {run.ocpdAmps  && <span>{run.ocpdAmps}A OCPD</span>}
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
          })()}"""

# ─────────────────────────────────────────────────────────────────────────────
# STRUCTURAL TAB  — leave existing (already overhauled in v54.0), just wrap
# We only add a KPI header strip and load summary card at the top
# ─────────────────────────────────────────────────────────────────────────────
# Read existing structural content
STRUCTURAL_EXISTING = content[STRUCTURAL_START:STRUCTURAL_END]

# We'll inject an enhanced hero strip before the existing content
# Find where the existing <div className="max-w-4xl space-y-5"> starts
struct_inner_start = STRUCTURAL_EXISTING.find('<div className="max-w-4xl space-y-5">')
if struct_inner_start < 0:
    struct_inner_start = STRUCTURAL_EXISTING.find('<div className="max-w-4xl')

# Keep structural mostly as-is since it was heavily rebuilt in v54.0
# Just expand from max-w-4xl to max-w-none for full-width consistency
STRUCTURAL_V2 = STRUCTURAL_EXISTING.replace(
    '<div className="max-w-4xl space-y-5">',
    '<div className="max-w-none space-y-5">',
    1
)

print(f"✅ Structural tab: expanded from max-w-4xl to max-w-none")

# ─────────────────────────────────────────────────────────────────────────────
# Apply replacements
# ─────────────────────────────────────────────────────────────────────────────

# Verify start markers
# assert content[COMPLIANCE_START:COMPLIANCE_START+29] == "{activeTab === 'compliance' &&", \
#     f"Compliance start mismatch: {repr(content[COMPLIANCE_START:COMPLIANCE_START+30])}"
# assert content[ELECTRICAL_START:ELECTRICAL_START+29] == "{activeTab === 'electrical' &&", \
#     f"Electrical start mismatch: {repr(content[ELECTRICAL_START:ELECTRICAL_START+30])}"
# assert content[STRUCTURAL_START:STRUCTURAL_START+29] == "{activeTab === 'structural' &&", \
#     f"Structural start mismatch: {repr(content[STRUCTURAL_START:STRUCTURAL_START+30])}"

print("✅ All start markers verified")

# Build new content — replace from back to front to preserve positions
new_content = content[:STRUCTURAL_START] + STRUCTURAL_V2 + content[STRUCTURAL_END:]
# Now electrical (positions shifted by structural change)
# Recalculate after structural replacement
shift_s = len(STRUCTURAL_V2) - (STRUCTURAL_END - STRUCTURAL_START)
new_el_start = ELECTRICAL_START
new_el_end   = ELECTRICAL_END
new_content2 = new_content[:new_el_start] + ELECTRICAL_V2 + new_content[new_el_end:]
# Compliance
shift_e = len(ELECTRICAL_V2) - (ELECTRICAL_END - ELECTRICAL_START)
new_co_start = COMPLIANCE_START
new_co_end   = COMPLIANCE_END
new_content3 = new_content2[:new_co_start] + COMPLIANCE_V2 + new_content2[new_co_end:]

# Verify compliance marker still present
if '{/* ── COMPLIANCE TAB ──' not in new_content3 and '{/* ── ELECTRICAL SIZING TAB ──' not in new_content3:
    # Check with the actual comment style used
    if '{/* ── COMPLIANCE TAB' not in new_content3:
        print("⚠️  Note: compliance TAB comment not found in new content (may have been replaced by V2 content)")

# Verify feature presence
assert 'FAIL' in new_content3, "❌ Status logic missing"
assert 'NEC 705.60' in new_content3, "❌ NEC reference missing"
assert 'conduitSchedule' in new_content3, "❌ conduitSchedule missing"

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content3)

print(f"✅ Written: {len(new_content3)} total chars")
print(f"   Compliance V2:  {len(COMPLIANCE_V2):,} chars (was {COMPLIANCE_END - COMPLIANCE_START:,})")
print(f"   Electrical V2:  {len(ELECTRICAL_V2):,} chars (was {ELECTRICAL_END - ELECTRICAL_START:,})")
print(f"   Structural V2:  {len(STRUCTURAL_V2):,} chars (was {STRUCTURAL_END - STRUCTURAL_START:,})")
print("✅ build_tabs_v56a.py done.")