#!/usr/bin/env python3
"""
v55.0 — Config tab full UX overhaul.
NON-BREAKING: all existing state hooks, handlers, and data flows preserved.
Only layout/presentation/interaction layer changes.
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ── Locate the config tab block ──
START_MARKER = "{activeTab === 'config' && ("
END_MARKER   = ")}\n\n          {/* \u2500\u2500 COMPLIANCE TAB \u2500\u2500 */"

start_idx = content.find(START_MARKER)
end_idx   = content.find(END_MARKER)

if start_idx < 0 or end_idx < 0:
    print(f"\u274c Markers not found: start={start_idx} end={end_idx}")
    exit(1)

print(f"\u2705 Config tab found: chars {start_idx}\u2013{end_idx} ({end_idx - start_idx} chars)")

# ── The replacement ──  (indent = 10 spaces, matching existing tabs)
NEW_CONFIG_TAB = r"""{activeTab === 'config' && (() => {
            /* ═══════════════════════════════════════════════════════════
               CONFIG V2 UI  —  v55.0
               Feature flag: ENABLE_CONFIG_V2_UI
               All state hooks / handlers unchanged. Layout only.
            ═══════════════════════════════════════════════════════════ */
            const ENABLE_CONFIG_V2_UI = true;

            /* ── Derived UI-only values (no backend effect) ── */
            const _inv0       = config.inverters[0];
            const _invData0   = getInvById(_inv0?.inverterId ?? '', _inv0?.type ?? 'string') as any;
            const _panel0     = getPanelById(_inv0?.strings[0]?.panelId ?? '') as any;
            const _totalKwNum = parseFloat(totalKw) || 0;
            const _acKwNum    = totalInverterKw || 0;
            const _dcAcRatio  = _acKwNum > 0 ? (_totalKwNum / _acKwNum).toFixed(2) : '—';
            const _branchCount = cs.isMicro ? cs.acBranchCount : config.inverters.reduce((s, i) => s + i.strings.length, 0);
            const _genData    = config.generatorId ? getGeneratorById(config.generatorId) : null;
            const _atsData    = config.atsId ? getATSById(config.atsId) : null;
            const _batData    = config.batteryId ? getBatteryById(config.batteryId) : null;
            const _batTotalKwh = config.batteryCount * config.batteryKwh;
            /* Backup % estimate: battery kWh / (system kW * 4h avg load) — UI only */
            const _backupPct  = _batTotalKwh > 0 && _totalKwNum > 0
              ? Math.min(100, Math.round((_batTotalKwh / Math.max(1, _totalKwNum * 0.3)) * 100))
              : 0;
            const _compStatus = compliance.overallStatus || rulesResult?.overallStatus;
            const _elecStatus = compliance.electrical?.status;
            const _structStatus = compliance.structural?.status;

            /* ── Color helpers ── */
            const statusGlow = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'border-red-500/50 bg-red-500/10 text-red-400';
              if (s === 'WARNING') return 'border-amber-500/50 bg-amber-500/10 text-amber-400';
              if (s === 'PASS')    return 'border-emerald-500/40 bg-emerald-500/8 text-emerald-400';
              return 'border-slate-700/50 bg-slate-800/40 text-slate-500';
            };
            const statusDot = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'bg-red-400 shadow-[0_0_6px_2px_rgba(248,113,113,0.5)]';
              if (s === 'WARNING') return 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.5)]';
              if (s === 'PASS')    return 'bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.5)]';
              return 'bg-slate-600';
            };
            const statusText = (s: string | null | undefined) => {
              if (s === 'FAIL')    return 'text-red-400';
              if (s === 'WARNING') return 'text-amber-400';
              if (s === 'PASS')    return 'text-emerald-400';
              return 'text-slate-500';
            };

            if (!ENABLE_CONFIG_V2_UI) {
              /* ── LEGACY FALLBACK ── */
              return (
                <div className="space-y-6 max-w-5xl">
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs">
                    Config V2 UI disabled via ENABLE_CONFIG_V2_UI flag. Re-enable in build_config_v2.py.
                  </div>
                </div>
              );
            }

            return (
              <div className="space-y-5 max-w-none">

                {/* ══ SYSTEM FLOW BAR ══════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-12 -right-12 w-48 h-48 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-8 -left-8 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />

                  {/* Header */}
                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <Zap size={16} className="text-amber-400" />
                        System Overview
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">{config.address || 'No address set'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-bold">
                        V3 · Permit-Grade
                      </span>
                      <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${
                        engineeringMode === 'AUTO'
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}>
                        {engineeringMode}
                      </span>
                    </div>
                  </div>

                  {/* KPI row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-4 py-3 text-center">
                      <div className="text-2xl font-black text-amber-400 tabular-nums">{totalKw}</div>
                      <div className="text-xs text-slate-500 mt-0.5">kW DC</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-4 py-3 text-center">
                      <div className="text-2xl font-black text-blue-400 tabular-nums">{totalInverterKw || '—'}</div>
                      <div className="text-xs text-slate-500 mt-0.5">kW AC</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-4 py-3 text-center">
                      <div className="text-2xl font-black text-emerald-400 tabular-nums">{totalPanels}</div>
                      <div className="text-xs text-slate-500 mt-0.5">Panels</div>
                    </div>
                    <div className={`rounded-xl border px-4 py-3 text-center ${
                      bomPricing?.pricingApplied
                        ? 'bg-emerald-500/10 border-emerald-500/30'
                        : 'bg-slate-900/60 border-slate-700/50'
                    }`}>
                      <div className={`text-2xl font-black tabular-nums ${bomPricing?.pricingApplied ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {bomPricing?.pricingApplied
                          ? `$${(bomPricing.totalBomCost / 1000).toFixed(1)}k`
                          : '—'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">BOM Cost</div>
                    </div>
                  </div>

                  {/* ── SYSTEM FLOW DIAGRAM ── */}
                  <div className="overflow-x-auto pb-1">
                    <div className="flex items-center gap-0 min-w-max">
                      {/* Node: Array */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${statusGlow(_structStatus)}`}
                        title="Solar Array — click to go to Inverter config">
                        <Sun size={18} className="text-amber-400" />
                        <div className="text-xs font-bold text-white">{totalPanels} Panels</div>
                        <div className="text-[10px] text-slate-400">{totalKw} kW DC</div>
                        <div className={`text-[9px] font-bold uppercase tracking-wide ${statusText(_structStatus)}`}>
                          {_structStatus || 'Struct'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-amber-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-amber-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">DC</div>
                      </div>

                      {/* Node: Inverter */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${
                        _inv0?.type === 'micro' ? 'border-purple-500/40 bg-purple-500/10 text-purple-300' :
                        _inv0?.type === 'optimizer' ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' :
                        'border-amber-500/40 bg-amber-500/10 text-amber-300'
                      }`}
                        title="Inverter — click to expand Inverter config">
                        <Cpu size={18} className={
                          _inv0?.type === 'micro' ? 'text-purple-400' :
                          _inv0?.type === 'optimizer' ? 'text-blue-400' : 'text-amber-400'
                        } />
                        <div className="text-xs font-bold text-white truncate max-w-[80px] text-center">
                          {_invData0?.manufacturer || 'Inverter'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {_inv0?.type === 'micro' ? 'Micro' : _inv0?.type === 'optimizer' ? 'Optimizer' : 'String'}{' '}
                          {_acKwNum > 0 ? `${_acKwNum}kW` : ''}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                          {_branchCount} {cs.isMicro ? 'branches' : 'strings'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-blue-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-blue-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">AC</div>
                      </div>

                      {/* Node: AC Run */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${statusGlow(_elecStatus)}`}
                        title="AC Wiring Run — click to expand Electrical Service">
                        <Activity size={18} className={_elecStatus === 'FAIL' ? 'text-red-400' : _elecStatus === 'WARNING' ? 'text-amber-400' : 'text-blue-400'} />
                        <div className="text-xs font-bold text-white">AC Run</div>
                        <div className="text-[10px] text-slate-400">
                          {(() => {
                            const acRun = cs.runs.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                            return acRun?.wireGauge || config.wireGauge || '—';
                          })()}
                          {' · '}{config.wireLength}ft
                        </div>
                        <div className={`text-[9px] font-bold uppercase tracking-wide ${statusText(_elecStatus)}`}>
                          {_elecStatus || 'Elec'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-blue-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-blue-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">AC</div>
                      </div>

                      {/* Node: Disconnect */}
                      <div className={`flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border cursor-pointer hover:brightness-110 transition-all min-w-[90px] ${
                        config.acDisconnect ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-300' : 'border-slate-700/50 bg-slate-800/40 text-slate-500'
                      }`}
                        title="AC Disconnect (NEC 690.14)">
                        <Power size={18} className={config.acDisconnect ? 'text-emerald-400' : 'text-slate-600'} />
                        <div className="text-xs font-bold text-white">Disconnect</div>
                        <div className="text-[10px] text-slate-400">NEC 690.14</div>
                        <div className={`text-[9px] font-bold uppercase tracking-wide ${config.acDisconnect ? 'text-emerald-400' : 'text-slate-500'}`}>
                          {config.acDisconnect ? 'Installed' : 'Not Set'}
                        </div>
                      </div>

                      {/* Arrow */}
                      <div className="flex flex-col items-center px-1">
                        <div className="flex items-center gap-0.5">
                          <div className="w-6 h-0.5 bg-blue-500/40" />
                          <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-blue-500/60" />
                        </div>
                        <div className="text-[9px] text-slate-600 mt-0.5">AC</div>
                      </div>

                      {/* Node: Main Panel */}
                      <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border border-blue-500/40 bg-blue-500/10 cursor-pointer hover:brightness-110 transition-all min-w-[90px]"
                        title="Main Service Panel — click to expand Electrical Service">
                        <Home size={18} className="text-blue-400" />
                        <div className="text-xs font-bold text-white">Main Panel</div>
                        <div className="text-[10px] text-slate-400">{config.mainPanelAmps}A · {config.mainPanelBrand || '—'}</div>
                        <div className="text-[9px] font-bold uppercase tracking-wide text-blue-400">
                          {(() => {
                            const backfeed = cs.backfeedBreakerAmps || 0;
                            const busRating = config.mainPanelAmps * 1.2;
                            const load = backfeed;
                            if (load > busRating) return 'OVERLOADED';
                            if (backfeed > 0) return `${backfeed}A BF`;
                            return 'Service';
                          })()}
                        </div>
                      </div>

                      {/* Battery (if enabled) */}
                      {config.batteryCount > 0 && _batTotalKwh > 0 && (
                        <>
                          <div className="flex flex-col items-center px-1">
                            <div className="flex items-center gap-0.5">
                              <div className="w-4 h-0.5 bg-emerald-500/40" />
                              <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-emerald-500/60" />
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border border-emerald-500/40 bg-emerald-500/8 min-w-[90px]">
                            <Battery size={18} className="text-emerald-400" />
                            <div className="text-xs font-bold text-white">Battery</div>
                            <div className="text-[10px] text-slate-400">{_batTotalKwh.toFixed(1)} kWh</div>
                            <div className="text-[9px] font-bold text-emerald-400">{_backupPct}% est.</div>
                          </div>
                        </>
                      )}

                      {/* Generator (if set) */}
                      {_genData && (
                        <>
                          <div className="flex flex-col items-center px-1">
                            <div className="flex items-center gap-0.5">
                              <div className="w-4 h-0.5 bg-orange-500/40" />
                              <div className="w-0 h-0 border-t-[3px] border-b-[3px] border-l-[5px] border-transparent border-l-orange-500/60" />
                            </div>
                          </div>
                          <div className="flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl border border-orange-500/40 bg-orange-500/8 min-w-[90px]">
                            <Wrench size={18} className="text-orange-400" />
                            <div className="text-xs font-bold text-white">Generator</div>
                            <div className="text-[10px] text-slate-400">{_genData.ratedOutputKw}kW</div>
                            <div className="text-[9px] font-bold text-orange-400 uppercase">{_genData.fuelType?.replace('_', ' ')}</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status chips row */}
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-700/30">
                    <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border font-medium ${statusGlow(_compStatus)}`}>
                      <ClipboardCheck size={11} />
                      {_compStatus || 'Not checked'}
                    </div>
                    {compliance.jurisdiction && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                        <MapPin size={11} className="text-amber-400" />
                        {compliance.jurisdiction.state} · NEC {compliance.jurisdiction.necVersion}
                      </div>
                    )}
                    {config.systemType && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                        <Cpu size={11} className="text-blue-400" />
                        {config.systemType}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                      <Activity size={11} />
                      DC/AC: {_dcAcRatio}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                      <GitBranch size={11} />
                      {_branchCount} {cs.isMicro ? 'AC Branches' : 'Strings'}
                    </div>
                    {rulesResult && rulesResult.errorCount === 0 && rulesResult.warningCount === 0 && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                        <CheckCircle size={11} /> All rules passed
                      </div>
                    )}
                    {rulesResult && rulesResult.errorCount > 0 && (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/10 text-red-400">
                        <AlertTriangle size={11} /> {rulesResult.errorCount} error{rulesResult.errorCount > 1 ? 's' : ''}
                      </div>
                    )}
                    {engineeringMode === 'AUTO' ? (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                        <Activity size={11} /> ⚡ Auto-resolves violations
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400">
                        <Lock size={11} /> ✏️ Manual override mode
                      </div>
                    )}
                  </div>
                </div>

                {/* ══ 3-COLUMN RESPONSIVE GRID ═══════════════════════════════ */}
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">

                  {/* ─────────────────────────────────────────────────────────
                      LEFT COLUMN: Project Info + Electrical + Battery + Generator
                  ──────────────────────────────────────────────────────────── */}
                  <div className="space-y-5">

                    {/* Project Information */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight">
                        <FileText size={14} className="text-amber-400" /> Project Information
                      </h3>
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { label: 'Project Name', key: 'projectName' },
                          { label: 'Client Name', key: 'clientName' },
                          { label: 'Address', key: 'address', placeholder: 'e.g. 123 Main St, Austin, TX 78701' },
                          { label: 'Designer', key: 'designer' },
                          { label: 'Date', key: 'date', type: 'date' },
                        ] as any[]).map(f => (
                          <div key={f.key} className={f.key === 'address' ? 'col-span-2' : ''}>
                            <label className="eng-label">{f.label}</label>
                            <input type={f.type || 'text'} value={(config as any)[f.key]} placeholder={f.placeholder || ''}
                              onChange={e => updateConfig({ [f.key]: e.target.value } as any)}
                              onBlur={f.key === 'address' ? (e) => {
                                const addr = e.target.value;
                                if (!addr) return;
                                const detectedState = parseStateFromAddress(addr);
                                const detectedCity = parseCityFromAddress(addr);
                                if (detectedState && !config.state) {
                                  const updates: any = { state: detectedState };
                                  if (detectedCity && !config.city) updates.city = detectedCity;
                                  const utils = getUtilitiesByStateNational(detectedState);
                                  if (utils.length > 0 && !config.utilityId) {
                                    updates.utilityId = utils[0].id;
                                  }
                                  updateConfig(updates);
                                }
                              } : undefined}
                              className="eng-input" />
                          </div>
                        ))}

                        {/* State selector */}
                        <div>
                          <label className="eng-label flex items-center gap-2">
                            State
                            {config.state && config.address && parseStateFromAddress(config.address) === config.state && (
                              <span className="text-emerald-400 text-xs font-normal">✓ auto-detected</span>
                            )}
                          </label>
                          <select value={config.state} onChange={e => {
                            const newState = e.target.value;
                            const updates: any = { state: newState, utilityId: '' };
                            const utils = getUtilitiesByStateNational(newState);
                            if (utils.length > 0) updates.utilityId = utils[0].id;
                            updateConfig(updates);
                          }} className="eng-select">
                            <option value="">— Select State —</option>
                            {[
                              ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],
                              ['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],
                              ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],
                              ['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],
                              ['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
                              ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
                              ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
                              ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
                              ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],
                              ['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
                              ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
                              ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],
                              ['WI','Wisconsin'],['WY','Wyoming'],['DC','District of Columbia'],
                            ].map(([code, name]) => (
                              <option key={code} value={code}>{name} ({code})</option>
                            ))}
                          </select>
                        </div>

                        {/* Roof Type */}
                        <div>
                          <label className="eng-label">Roof Type</label>
                          <select value={config.roofType} onChange={e => updateConfig({ roofType: e.target.value as RoofType })}
                            className="eng-select">
                            {Object.entries(ROOF_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                          </select>
                        </div>

                        {/* City + County */}
                        <div>
                          <label className="eng-label">City</label>
                          <input type="text" value={config.city || ''} onChange={e => updateConfig({ city: e.target.value })}
                            placeholder="e.g. Austin" className="eng-input" />
                        </div>
                        <div>
                          <label className="eng-label">County</label>
                          <input type="text" value={config.county || ''} onChange={e => updateConfig({ county: e.target.value })}
                            placeholder="e.g. Travis" className="eng-input" />
                        </div>
                      </div>

                      {/* AHJ Auto-detect banner */}
                      {ahjInfo && (
                        <div className="mt-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <MapPin size={12} className="text-amber-400" />
                            <span className="text-xs font-bold text-amber-400">{ahjInfo.ahjName}</span>
                            <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">{ahjInfo.necVersion}</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div><span className="text-slate-500">Permit Fee:</span><span className="text-slate-300 ml-1">{ahjInfo.typicalPermitFee}</span></div>
                            <div><span className="text-slate-500">Days:</span><span className="text-slate-300 ml-1">{ahjInfo.typicalPermitDays}d</span></div>
                            <div><span className="text-slate-500">Rapid Shutdown:</span><span className={`ml-1 ${ahjInfo.rapidShutdownRequired ? 'text-amber-400' : 'text-emerald-400'}`}>{ahjInfo.rapidShutdownRequired ? 'Required' : 'Not Req.'}</span></div>
                            <div><span className="text-slate-500">Roof Setback:</span><span className="text-slate-300 ml-1">{ahjInfo.roofSetbackInches}"</span></div>
                          </div>
                        </div>
                      )}

                      {/* Utility + AHJ selectors */}
                      <div className="grid grid-cols-1 gap-3 mt-3">
                        <div>
                          <label className="eng-label">Utility Provider</label>
                          <select value={config.utilityId} onChange={e => updateConfig({ utilityId: e.target.value })} className="eng-select">
                            <option value="">— Manual / Unknown —</option>
                            {config.state && getUtilitiesByStateNational(config.state).map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                            {!config.state && getUtilitiesByState('').map(u => (
                              <option key={u.id} value={u.id}>{u.name}</option>
                            ))}
                          </select>
                          {config.utilityId && config.state && (() => {
                            const stateData = STATE_UTILITY_FALLBACK[config.state];
                            if (!stateData) return null;
                            return (
                              <div className="text-xs text-slate-400 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                                <span><span className="text-slate-500">Rate:</span> <span className="text-amber-400 font-medium">${stateData.avgRate.toFixed(3)}/kWh</span></span>
                                <span><span className="text-slate-500">NEM:</span> <span className={stateData.netMetering ? 'text-emerald-400' : 'text-red-400'}>{stateData.netMetering ? '✓ Eligible' : '✗ N/A'}</span></span>
                                <span className="text-slate-500">Max: {stateData.interconnectionMaxKw}kW</span>
                              </div>
                            );
                          })()}
                        </div>
                        <div>
                          <label className="eng-label">Authority Having Jurisdiction (AHJ)</label>
                          <select value={config.ahjId} onChange={e => updateConfig({ ahjId: e.target.value })} className="eng-select">
                            <option value="">— Manual / Unknown —</option>
                            {getAhjsByState(config.state || '').map(a => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                          {config.ahjId && (
                            <div className="text-xs text-slate-500 mt-1">
                              {(() => {
                                const ahjs = getAhjsByState(config.state || '');
                                const a = ahjs.find(x => x.id === config.ahjId);
                                return a ? a.notes : '';
                              })()}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Jurisdiction strip */}
                      {compliance.jurisdiction && (
                        <div className="mt-3 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl flex items-start gap-3">
                          <MapPin size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                          <div>
                            <div className="text-xs font-bold text-amber-400">{compliance.jurisdiction.state} — NEC {compliance.jurisdiction.necVersion} ({compliance.jurisdiction.necAdoptionYear})</div>
                            <div className="text-xs text-slate-400 mt-0.5">{compliance.jurisdiction.ahj}</div>
                            {compliance.jurisdiction.specialRequirements?.slice(0, 2).map((r: string, i: number) => (
                              <div key={i} className="text-xs text-slate-500 mt-0.5">• {r}</div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Electrical Service Card */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-1 flex items-center gap-2 tracking-tight">
                        <Zap size={14} className="text-amber-400" /> Electrical Service
                        {_elecStatus && (
                          <span className={`ml-auto flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full border ${statusGlow(_elecStatus)}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(_elecStatus)}`} />
                            {_elecStatus}
                          </span>
                        )}
                      </h3>

                      {/* Mini summary strip */}
                      <div className="flex flex-wrap gap-2 mb-3 p-2.5 rounded-lg bg-slate-900/50 border border-slate-700/40">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Panel:</span>
                          <span className="text-amber-400 font-bold">{config.mainPanelAmps}A</span>
                          <span className="text-slate-500">{config.mainPanelBrand}</span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Wire:</span>
                          <span className="text-blue-400 font-bold">
                            {(() => {
                              const acRun = cs.runs.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                              return acRun?.wireGauge || config.wireGauge || '—';
                            })()}
                          </span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Run:</span>
                          <span className="text-slate-300 font-bold">{config.wireLength}ft</span>
                        </div>
                        <span className="text-slate-700">·</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-slate-500">Conduit:</span>
                          <span className="text-slate-300">{config.conduitType?.split(' ')[0]}</span>
                        </div>
                        {cs.backfeedBreakerAmps > 0 && (
                          <>
                            <span className="text-slate-700">·</span>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-slate-500">Backfeed:</span>
                              <span className={`font-bold ${cs.backfeedBreakerAmps > config.mainPanelAmps * 0.2 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {cs.backfeedBreakerAmps}A
                              </span>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Inline electrical violation */}
                      {compliance.electrical?.status === 'FAIL' && compliance.electrical?.violations?.length > 0 && (
                        <div className="mb-3 p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                          <div className="font-bold flex items-center gap-1.5 mb-1"><AlertTriangle size={11} /> Electrical Violations</div>
                          {compliance.electrical.violations.slice(0, 3).map((v: any, i: number) => (
                            <div key={i} className="text-red-300/80 ml-4">• {v.message || v}</div>
                          ))}
                        </div>
                      )}
                      {compliance.electrical?.status === 'WARNING' && compliance.electrical?.warnings?.length > 0 && (
                        <div className="mb-3 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-400">
                          <div className="font-bold flex items-center gap-1.5 mb-1"><AlertCircle size={11} /> Electrical Warnings</div>
                          {compliance.electrical.warnings.slice(0, 2).map((w: any, i: number) => (
                            <div key={i} className="text-amber-300/80 ml-4">• {w.message || w}</div>
                          ))}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="eng-label">Main Panel (Amps)</label>
                          <select value={config.mainPanelAmps} onChange={e => updateConfig({ mainPanelAmps: +e.target.value })} className="eng-select">
                            {[100, 150, 200, 225, 320, 400].map(a => <option key={a} value={a}>{a}A</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Panel Brand</label>
                          <select value={config.mainPanelBrand} onChange={e => updateConfig({ mainPanelBrand: e.target.value })} className="eng-select">
                            {['Square D', 'Eaton', 'Siemens', 'Leviton', 'GE', 'Cutler-Hammer', 'Murray'].map(b => <option key={b}>{b}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="eng-label flex items-center gap-1">
                            AC Wire Gauge
                            <span className="text-amber-400 text-xs font-bold ml-1" title="Auto-calculated per NEC 310.16">⚡ Auto</span>
                          </label>
                          <div className="eng-auto-field" title="Auto-calculated from ComputedSystem (NEC 310.16 / NEC 690.8). Not user-editable.">
                            {(() => {
                              const acRun = cs.runs.find((r: any) => r.id === (cs.isMicro ? 'COMBINER_TO_DISCO_RUN' : 'INV_TO_DISCO_RUN'));
                              const gauge = acRun?.wireGauge
                                || (cs.isMicro ? '#6 AWG' : ((compliance.electrical as any)?.acSizing?.conductorGauge || config.wireGauge));
                              return `${gauge} THWN-2`;
                            })()}
                            <span className="text-slate-500 text-xs ml-2 font-sans">NEC 310.16</span>
                          </div>
                        </div>
                        <div>
                          <label className="eng-label">Conduit Type</label>
                          <select value={config.conduitType} onChange={e => updateConfig({ conduitType: e.target.value })} className="eng-select">
                            {['EMT', 'PVC Schedule 40', 'PVC Schedule 80', 'Rigid Metal (RMC)', 'Flexible Metal (FMC)'].map(c => <option key={c}>{c}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="eng-label">AC Wire Run (ft)</label>
                          <input type="number" min={1} value={config.wireLength} onChange={e => updateConfig({ wireLength: +e.target.value })}
                            className="eng-input" />
                        </div>
                      </div>

                      {/* Disconnects & toggles */}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {([
                          { key: 'acDisconnect', label: 'AC Disconnect', sub: 'NEC 690.14' },
                          ...(config.inverters[0]?.type !== 'micro' ? [{ key: 'dcDisconnect', label: 'DC Disconnect', sub: 'NEC 690.15' }] : []),
                          { key: 'productionMeter', label: 'Production Meter', sub: '' },
                          { key: 'rapidShutdown', label: 'Rapid Shutdown', sub: 'NEC 690.12' },
                        ] as any[]).map(item => (
                          <label key={item.key} className="flex items-center gap-2 cursor-pointer p-2 rounded-lg hover:bg-slate-800/40 transition-colors"
                            onClick={() => updateConfig({ [item.key]: !(config as any)[item.key] } as any)}>
                            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${(config as any)[item.key] ? 'bg-amber-500 border-amber-500' : 'border-slate-600'}`}>
                              {(config as any)[item.key] && <CheckCircle size={12} className="text-slate-900" />}
                            </div>
                            <div>
                              <span className="text-xs text-slate-300 block">{item.label}</span>
                              {item.sub && <span className="text-[10px] text-slate-500">{item.sub}</span>}
                            </div>
                          </label>
                        ))}
                        {config.inverters[0]?.type === 'micro' && (
                          <div className="flex items-center gap-2 opacity-40 cursor-not-allowed p-2">
                            <div className="w-5 h-5 rounded border-2 border-slate-700 flex items-center justify-center bg-slate-800">
                              <span className="text-slate-600 text-xs">—</span>
                            </div>
                            <div>
                              <span className="text-xs text-slate-500 line-through block">DC Disconnect</span>
                              <span className="text-[10px] text-purple-400">(N/A — micro)</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Battery Card — Toggleable Module */}
                    <div className="eng-panel">
                      {/* Battery header with ON/OFF toggle */}
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-extrabold text-slate-100 flex items-center gap-2 tracking-tight">
                          <Battery size={14} className="text-emerald-400" /> Battery Storage
                          <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+5 Models</span>
                        </h3>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" checked={batteryEnabled} onChange={e => setBatteryEnabled(e.target.checked)}
                            className="sr-only peer" data-testid="battery-enabled-toggle" />
                          <div className="w-11 h-6 bg-slate-700 rounded-full peer peer-checked:bg-emerald-500 transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5"></div>
                        </label>
                      </div>

                      {!batteryEnabled ? (
                        /* OFF state — collapsed */
                        <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
                          <div className="w-8 h-8 rounded-lg bg-slate-700/60 border border-slate-600/40 flex items-center justify-center">
                            <Battery size={14} className="text-slate-600" />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-slate-500">Battery Disabled</div>
                            <div className="text-xs text-slate-600">No battery in BOM · Toggle to enable</div>
                          </div>
                        </div>
                      ) : (
                        /* ON state — expanded */
                        <div className="space-y-3">
                          {/* kWh summary strip */}
                          {_batTotalKwh > 0 && (
                            <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
                              <div className="text-center">
                                <div className="text-lg font-black text-emerald-400 tabular-nums">{_batTotalKwh.toFixed(1)}</div>
                                <div className="text-[10px] text-slate-500">Total kWh</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg font-black text-emerald-400 tabular-nums">~{_backupPct}%</div>
                                <div className="text-[10px] text-slate-500">Est. Backup</div>
                              </div>
                              <div className="text-center">
                                <div className="text-lg font-black text-emerald-400 tabular-nums">
                                  {_batTotalKwh > 0 ? `~${(_batTotalKwh / Math.max(0.5, _totalKwNum * 0.15)).toFixed(1)}h` : '—'}
                                </div>
                                <div className="text-[10px] text-slate-500">Est. Runtime</div>
                              </div>
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="eng-label">Battery Model</label>
                              <select value={config.batteryId} onChange={e => {
                                const bat = getBatteryById(e.target.value);
                                updateConfig({ batteryId: e.target.value, batteryBrand: bat?.manufacturer ?? '', batteryModel: bat?.model ?? '', batteryKwh: bat?.usableCapacityKwh ?? 0 });
                              }} className="eng-select">
                                <option value="">None</option>
                                {BATTERIES.map(b => (
                                  <option key={b.id} value={b.id}>{b.isNew ? '🆕 ' : ''}{b.manufacturer} {b.model} ({b.usableCapacityKwh} kWh){b.subcategory === 'ac_coupled' ? ` · AC` : ` · DC`}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="eng-label">Units</label>
                              <input type="number" min={0} max={10} value={config.batteryCount} onChange={e => updateConfig({ batteryCount: +e.target.value })} className="eng-input" />
                            </div>
                            <div>
                              <label className="eng-label">kWh / Unit</label>
                              <input type="number" min={0} step={0.1} value={config.batteryKwh} onChange={e => updateConfig({ batteryKwh: +e.target.value })} className="eng-input" />
                            </div>
                          </div>
                          {config.batteryId && (() => {
                            const bat = getBatteryById(config.batteryId);
                            return bat?.backfeedBreakerA ? (
                              <div className="text-xs text-orange-400 text-center">
                                +{bat.backfeedBreakerA}A bus load (NEC 705.12B)
                              </div>
                            ) : null;
                          })()}
                        </div>
                      )}

                      {/* Generator & ATS — inside battery card */}
                      <div className="mt-4 pt-4 border-t border-slate-700/30">
                        <div className="flex items-center gap-2 mb-3">
                          <Wrench size={12} className="text-orange-400" />
                          <span className="text-xs font-bold text-slate-300 uppercase tracking-wide">Generator & Transfer Switch</span>
                          <span className="px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase">+4 Models</span>
                        </div>

                        {/* Generator OFF state */}
                        {!config.generatorId && !config.atsId ? (
                          <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-700/40">
                            <div className="w-7 h-7 rounded-lg bg-slate-700/60 border border-slate-600/40 flex items-center justify-center">
                              <Wrench size={12} className="text-slate-600" />
                            </div>
                            <div className="text-xs text-slate-600">No generator configured — select below to enable</div>
                          </div>
                        ) : (
                          /* Generator ON state */
                          _genData && _atsData && (
                            <div className="p-3 rounded-xl bg-orange-500/5 border border-orange-500/20 mb-3">
                              <div className="flex items-center gap-2">
                                <CheckCircle size={12} className="text-emerald-400" />
                                <span className="text-xs font-bold text-emerald-400">{_genData.ratedOutputKw}kW gen + {_atsData.ampRating}A ATS</span>
                                {_atsData.neutralSwitched ? <span className="text-xs text-emerald-400"> · Neutral switched ✓</span> : <span className="text-xs text-amber-400"> · ⚠ Check neutral bonding</span>}
                              </div>
                            </div>
                          )
                        )}

                        <div className="grid grid-cols-1 gap-3">
                          <div>
                            <label className="eng-label">Generator</label>
                            <select value={config.generatorId} onChange={e => updateConfig({ generatorId: e.target.value })} className="eng-select">
                              <option value="">None</option>
                              {GENERATORS.map(g => (
                                <option key={g.id} value={g.id}>{g.isNew ? '🆕 ' : ''}{g.manufacturer} {g.model} ({g.ratedOutputKw} kW · {g.fuelType.replace('_', ' ')})</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="eng-label">Transfer Switch (ATS)</label>
                            <select value={config.atsId} onChange={e => updateConfig({ atsId: e.target.value })} className="eng-select">
                              <option value="">None</option>
                              {ATS_UNITS.map(a => (
                                <option key={a.id} value={a.id}>{a.isNew ? '🆕 ' : ''}{a.manufacturer} {a.model} ({a.ampRating}A · {a.transferType}{a.serviceEntranceRated ? ' · SE-rated' : ''})</option>
                              ))}
                            </select>
                          </div>
                          {config.generatorId && (
                            <div>
                              <label className="eng-label flex items-center gap-1">Generator → ATS Wire Length <span className="text-slate-500">(ft)</span></label>
                              <input type="number" min={5} max={500} step={5}
                                value={config.generatorWireLength ?? 50}
                                onChange={e => updateConfig({ generatorWireLength: Math.max(5, +e.target.value) })}
                                className="eng-input" />
                              {config.generatorWireLength && (() => {
                                const genRun = cs.runs?.find((r: any) => r.id === 'GENERATOR_TO_ATS_RUN');
                                if (!genRun) return null;
                                return (
                                  <div className="mt-1.5 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-300 flex flex-wrap gap-3">
                                    <span className="font-bold text-amber-400">{genRun.wireGauge}</span>
                                    <span>{genRun.conduitSize} {genRun.conduitType}</span>
                                    <span className="text-slate-500">{config.generatorWireLength}ft · {genRun.ocpdAmps}A OCPD</span>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Notes */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Info size={14} className="text-amber-400" /> Engineering Notes</h3>
                      <textarea value={config.notes} onChange={e => updateConfig({ notes: e.target.value })} rows={4}
                        placeholder="Add engineering notes, special conditions, AHJ requirements, utility interconnection notes..."
                        className="eng-input resize-none" />
                    </div>

                  </div>{/* end left col */}


                  {/* ─────────────────────────────────────────────────────────
                      CENTER COLUMN: Ecosystem Picker + Inverter/Strings
                  ──────────────────────────────────────────────────────────── */}
                  <div className="space-y-5">

                    {/* Ecosystem Picker */}
                    <EcosystemPicker
                      appliedBrand={(config as any).ecosystemBrand}
                      onApply={(payload: EcosystemApplyPayload) => {
                        const updates: any = { ecosystemBrand: payload.brand };
                        if (payload.selections.inverterId) {
                          const invId = payload.selections.inverterId;
                          const isMicro = payload.kit.microinverters.some((m: any) => m.id === invId);
                          const isOptimizer = payload.kit.optimizers.some((o: any) => o.id === invId);
                          const invType: any = isMicro ? 'micro' : isOptimizer ? 'optimizer' : 'string';
                          const existingInverters = config.inverters || [];
                          const firstInv = existingInverters[0];
                          if (firstInv) {
                            const updatedInverters = [...existingInverters];
                            updatedInverters[0] = { ...firstInv, type: invType, inverterId: invId };
                            updates.inverters = updatedInverters;
                          }
                        }
                        if (payload.selections.batteryId) {
                          updates.batteryId = payload.selections.batteryId;
                          if (!config.batteryCount || config.batteryCount < 1) updates.batteryCount = 1;
                        }
                        const wouldClobber: string[] = [];
                        if (payload.selections.inverterId && config.inverters?.[0]?.inverterId &&
                            config.inverters[0].inverterId !== payload.selections.inverterId) {
                          wouldClobber.push(`inverter (currently: ${config.inverters[0].inverterId})`);
                        }
                        if (payload.selections.batteryId && config.batteryId &&
                            config.batteryId !== payload.selections.batteryId) {
                          wouldClobber.push(`battery (currently: ${config.batteryId})`);
                        }
                        if (wouldClobber.length > 0) {
                          const ok = window.confirm(
                            `Apply ${payload.brand.toUpperCase()} ecosystem?\n\n` +
                            `This will replace:\n\u2022 ${wouldClobber.join('\n\u2022 ')}\n\n` +
                            `Click OK to apply, Cancel to keep existing selections.`
                          );
                          if (!ok) return;
                        }
                        updateConfig(updates);
                        const appliedCount = Object.values(payload.selections).filter(Boolean).length;
                        setAutoLoadBanner(
                          `\u2713 Applied ${payload.brand.toUpperCase()} ecosystem \u2014 ` +
                          `${appliedCount} component${appliedCount !== 1 ? 's' : ''} configured. ` +
                          `Manual dropdowns remain editable below.`
                        );
                        setTimeout(() => setAutoLoadBanner(null), 6000);
                      }}
                    />

                    {/* Auto-configured indicator */}
                    {config.defaultsApplied && config.inverters.length > 0 && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs w-fit">
                        <span aria-hidden>⚡</span>
                        <span>Auto-configured system — edit any field to customize.</span>
                      </div>
                    )}

                    {/* Panel Compatibility Banner */}
                    {sizingRecommendation?.panelCompatibility && (
                      <PanelCompatibilityBanner
                        verdict={sizingRecommendation.panelCompatibility}
                        onChangePanel={(newPanelId) => {
                          setConfig(prev => ({
                            ...prev,
                            inverters: prev.inverters.map(inv => ({
                              ...inv,
                              strings: inv.strings.map(s => ({ ...s, panelId: newPanelId })),
                            })),
                            ...LOCK,
                          }));
                        }}
                      />
                    )}

                    {/* Sizing Recommendation */}
                    {sizingRecommendation && !sizingDismissed && (
                      <SizingRecommendation
                        sizing={sizingRecommendation}
                        current={sizingCurrentSnapshot}
                        autoApply={sizingAutoApply}
                        onAutoApplyChange={setSizingAutoApply}
                        onApply={() => {
                          applySizingRecommendation(sizingRecommendation);
                        }}
                        hidden={config.inverters.length === 0}
                        panelCountSource={{
                          value: resolvedPanelCount.value,
                          source: resolvedPanelCount.source,
                          mismatchedWithConfig: resolvedPanelCount.mismatchedWithConfig,
                          configValue: totalPanels,
                        }}
                      />
                    )}

                    {/* Validation Panel */}
                    {validationResult && config.inverters.length > 0 && (
                      <ValidationPanel result={validationResult} />
                    )}

                    {/* Inverters & Strings Card */}
                    <div className="eng-panel">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <Zap size={14} className="text-amber-400" /> Inverters & Strings
                          <span className="ml-1 px-1.5 py-0.5 rounded text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 uppercase tracking-wide">+14 Models</span>
                        </h3>
                        <div className="flex gap-2">
                          {(['string', 'micro', 'optimizer'] as InverterType[]).map(t => {
                            const hasMicro = config.inverters.some(i => i.type === 'micro');
                            if (t === 'micro' && hasMicro) return null;
                            return (
                              <button key={t} onClick={() => addInverter(t)} className="btn-secondary btn-sm text-xs">
                                <Plus size={11} /> {t === 'string' ? 'String Inv.' : t === 'micro' ? 'Microinverter' : 'Optimizer'}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Branch Visualization */}
                      {config.inverters.length > 0 && (
                        <div className="mb-4 p-3 rounded-xl bg-slate-900/60 border border-slate-700/40">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
                            {cs.isMicro ? 'AC Branch Layout' : 'String Layout'}
                          </div>
                          <div className="space-y-1.5">
                            {cs.isMicro ? (
                              /* Micro branch bars */
                              Array.from({ length: Math.min(cs.acBranchCount, 8) }, (_, bi) => {
                                const devPerBranch = cs.microDeviceCount > 0 ? Math.ceil(cs.microDeviceCount / cs.acBranchCount) : 0;
                                const isLast = bi === Math.min(cs.acBranchCount, 8) - 1;
                                const lastCount = cs.microDeviceCount - (Math.min(cs.acBranchCount, 8) - 1) * devPerBranch;
                                const count = isLast ? Math.max(0, lastCount) : devPerBranch;
                                const maxCount = devPerBranch || 1;
                                return (
                                  <div key={bi} className="flex items-center gap-2">
                                    <span className="text-[10px] text-purple-400 font-mono w-14 shrink-0">Branch {bi + 1}</span>
                                    <div className="flex gap-0.5 flex-1">
                                      {Array.from({ length: Math.min(count, 20) }, (_, pi) => (
                                        <div key={pi} className="h-3 flex-1 rounded-sm bg-purple-500/50 border border-purple-500/30 min-w-[4px] max-w-[12px]" />
                                      ))}
                                      {count > 20 && <span className="text-[9px] text-purple-400 ml-1">+{count - 20}</span>}
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-mono w-8 text-right shrink-0">{count}</span>
                                  </div>
                                );
                              })
                            ) : (
                              /* String inverter bars */
                              config.inverters.flatMap(inv =>
                                inv.strings.map((str, si) => {
                                  const panel = getPanelById(str.panelId);
                                  const kw = (str.panelCount * (panel?.watts || 400) / 1000);
                                  const maxPanels = 25;
                                  return (
                                    <div key={str.id} className="flex items-center gap-2">
                                      <span className="text-[10px] text-amber-400 font-mono w-14 shrink-0">{str.label}</span>
                                      <div className="flex gap-0.5 flex-1">
                                        {Array.from({ length: Math.min(str.panelCount, maxPanels) }, (_, pi) => (
                                          <div key={pi} className="h-3 flex-1 rounded-sm bg-amber-500/40 border border-amber-500/20 min-w-[4px] max-w-[14px]" />
                                        ))}
                                        {str.panelCount > maxPanels && <span className="text-[9px] text-amber-400 ml-1">+{str.panelCount - maxPanels}</span>}
                                      </div>
                                      <span className="text-[10px] text-slate-400 font-mono w-16 text-right shrink-0">{str.panelCount}p · {kw.toFixed(1)}kW</span>
                                    </div>
                                  );
                                })
                              )
                            )}
                            {cs.isMicro && cs.acBranchCount > 8 && (
                              <div className="text-[10px] text-slate-500 text-center">+ {cs.acBranchCount - 8} more branches</div>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        {config.inverters.map((inv, invIdx) => {
                          const invData = getInvById(inv.inverterId, inv.type) as any;
                          const invList = inv.type === 'micro'
                            ? MICROINVERTERS
                            : inv.type === 'ecoflow'
                              ? STRING_INVERTERS.filter(i => i.id.startsWith('ecoflow-'))
                              : inv.type === 'hybrid'
                                ? STRING_INVERTERS.filter(i => !i.id.startsWith('ecoflow-'))
                                : STRING_INVERTERS.filter(i => !i.id.startsWith('ecoflow-'));
                          return (
                            <div key={inv.id} className="border border-slate-700/50 rounded-xl overflow-hidden">
                              <div className="flex items-center gap-3 p-4 bg-slate-800/40 cursor-pointer hover:bg-slate-800/60 transition-colors"
                                onClick={() => setExpandedInv(expandedInv === inv.id ? null : inv.id)}>
                                <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-xs flex-shrink-0">{invIdx + 1}</div>
                                <div className="flex-1">
                                  <div className="text-sm font-bold text-white">{invData?.manufacturer} {invData?.model}</div>
                                  <div className="text-xs text-slate-400">
                                    {inv.type === 'micro' ? 'Microinverter' : inv.type === 'hybrid' ? 'Hybrid Inverter' : inv.type === 'optimizer' ? 'String + Optimizer' : 'String Inverter'} ·
                                    {config.inverters.length === 1 && systemPanelCount > 0
                                      ? systemPanelCount
                                      : inv.strings.reduce((s, str) => s + str.panelCount, 0)} panels ·
                                    {(inv.strings.reduce((s, str) => s + str.panelCount * (getPanelById(str.panelId)?.watts || 400), 0) / 1000).toFixed(2)} kW DC
                                    {(inv.type === 'string' || inv.type === 'hybrid' || inv.type === 'ecoflow') && (() => {
                                      const perInvStringCount = inv.strings.length;
                                      const perInvPanelCounts = inv.strings.map(s => s.panelCount);
                                      const allEqual = perInvPanelCounts.every(c => c === perInvPanelCounts[0]);
                                      const pps = allEqual && perInvPanelCounts.length > 0
                                        ? `${perInvPanelCounts[0]}/str`
                                        : perInvPanelCounts.join('/') + ' panels';
                                      return (
                                        <span className="ml-1 text-amber-400 font-semibold">
                                          · {perInvStringCount} string{perInvStringCount === 1 ? '' : 's'} ({pps})
                                        </span>
                                      );
                                    })()}
                                    {inv.type === 'micro' && (
                                      <span className="ml-1 text-purple-400 font-semibold">
                                        · {cs.microDeviceCount} microinverters · {cs.acBranchCount} AC branch{cs.acBranchCount > 1 ? 'es' : ''}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button onClick={e => { e.stopPropagation(); removeInverter(inv.id); }} className="text-slate-600 hover:text-red-400 transition-colors p-1"><Trash2 size={13} /></button>
                                  {expandedInv === inv.id ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                                </div>
                              </div>
                              {expandedInv === inv.id && (
                                <div className="p-4 space-y-4 bg-slate-900/30">
                                  {/* Topology selector — segmented control */}
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Topology</span>
                                    {topologySwitching && <span className="text-xs text-amber-400 animate-pulse">Propagating ecosystem…</span>}
                                  </div>
                                  <div className="flex rounded-xl overflow-hidden border border-slate-700/60 mb-3">
                                    {([
                                      { type: 'string' as InverterType, label: 'String', desc: 'String inverter, no optimizers' },
                                      { type: 'optimizer' as InverterType, label: 'Optimizer', desc: 'String + per-module optimizers' },
                                      { type: 'micro' as InverterType, label: 'Micro', desc: 'Microinverter per module' },
                                      { type: 'ecoflow' as InverterType, label: 'EcoFlow', desc: 'EcoFlow PowerOcean hybrid + LFP battery' },
                                    ]).map(({ type: t, label, desc }, ti) => (
                                      <button
                                        key={t}
                                        onClick={() => {
                                          if (inv.type !== t) {
                                            let defaultId: string;
                                            if (t === 'micro') defaultId = MICROINVERTERS[0]?.id || inv.inverterId;
                                            else if (t === 'ecoflow') defaultId = 'ecoflow-power-ocean-10kw';
                                            else defaultId = STRING_INVERTERS[0]?.id || inv.inverterId;
                                            handleTopologySwitch(inv.id, t, defaultId);
                                          }
                                        }}
                                        title={desc}
                                        className={`flex-1 py-2 px-1 text-xs font-bold transition-all border-r last:border-r-0 border-slate-700/60 ${
                                          inv.type === t
                                            ? (t === 'ecoflow'
                                                ? 'bg-emerald-500/25 text-emerald-300'
                                                : 'bg-amber-500/25 text-amber-300')
                                            : 'bg-slate-800/60 text-slate-500 hover:text-slate-200 hover:bg-slate-700/40'
                                        }`}
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                                    <div className="md:col-span-2">
                                      <label className="eng-label">Inverter Model</label>
                                      <select value={inv.inverterId} onChange={e => updateInverter(inv.id, { inverterId: e.target.value })}
                                        className="eng-select text-xs px-2 py-1.5">
                                        {invList.map(i => <option key={i.id} value={i.id}>{(i as any).isNew ? '🆕 ' : ''}{i.manufacturer} {i.model}{(inv.type === 'string' || inv.type === 'ecoflow' || inv.type === 'hybrid' || inv.type === 'optimizer') ? ` (${(i as any).acOutputKw}kW)` : ` (${(i as any).acOutputW}W)`}</option>)}
                                      </select>
                                    </div>
                                    {invData && (
                                      <div className="bg-slate-800/60 rounded-lg p-2 text-xs space-y-0.5">
                                        <div className="text-slate-400">Max DC: <span className="text-white">{invData.maxDcVoltage}V</span></div>
                                        <div className="text-slate-400">MPPT: <span className="text-white">{invData.mpptVoltageMin}–{invData.mpptVoltageMax}V</span></div>
                                        <div className="text-slate-400">Eff: <span className="text-white">{invData.efficiency}%</span></div>
                                        {(() => {
                                          if (inv.type === 'micro') return null;
                                          const firstStrPanel = getPanelById(inv.strings[0]?.panelId) as any;
                                          if (!firstStrPanel || !invData.maxDcVoltage) return null;
                                          const designTemp = compliance.autoDetected?.designTempMin ?? cs.designTempMin ?? -10;
                                          const tCoeff = firstStrPanel.tempCoeffVoc ?? -0.27;
                                          const vocCorr = firstStrPanel.voc * (1 + (tCoeff / 100) * (designTemp - 25));
                                          const vmpCorr = firstStrPanel.vmp * (1 + (tCoeff / 100) * (designTemp - 25));
                                          const maxPPS = Math.floor((invData.maxDcVoltage || 600) / vocCorr);
                                          const minPPS = Math.ceil((invData.mpptVoltageMin || 100) / vmpCorr);
                                          const recPPS = Math.round(((invData.mpptVoltageMin || 100) + (invData.mpptVoltageMax || 600)) / 2 / (firstStrPanel.vmp || 41.8));
                                          const clampedRec = Math.max(minPPS, Math.min(maxPPS, recPPS));
                                          return (
                                            <div className="mt-1 pt-1 border-t border-slate-700/50">
                                              <div className="text-green-400 font-semibold mb-0.5">String Sizing (NEC 690.7 @ {designTemp}°C)</div>
                                              <div className="text-slate-400">Max/string: <span className="text-white font-bold">{maxPPS}</span></div>
                                              <div className="text-slate-400">Min/string: <span className="text-white font-bold">{minPPS}</span></div>
                                              <div className="text-slate-400">Rec: <span className="text-amber-400 font-bold">{clampedRec}</span></div>
                                              {(() => {
                                                const totalPanelsForInv = inv.strings.reduce((s, str) => s + str.panelCount, 0);
                                                const autoStrings = Math.max(1, Math.round(totalPanelsForInv / clampedRec));
                                                const autoPerStr = Math.ceil(totalPanelsForInv / autoStrings);
                                                const autoLastStr = totalPanelsForInv - (autoStrings - 1) * autoPerStr;
                                                return (
                                                  <div className="mt-1.5 pt-1 border-t border-slate-700/30">
                                                    <div className="text-slate-400 mb-1">
                                                      Auto: <span className="text-amber-300 font-bold">{autoStrings}×{autoPerStr}</span>
                                                      {autoLastStr !== autoPerStr && autoStrings > 1 && <span className="text-slate-500"> (last: {autoLastStr})</span>}
                                                    </div>
                                                    <button
                                                      onClick={() => {
                                                        const newStrings = Array.from({ length: autoStrings }, (_, i) => ({
                                                          ...newString(i, config.systemType),
                                                          panelCount: i === autoStrings - 1 ? autoLastStr : autoPerStr,
                                                          panelId: inv.strings[0]?.panelId ?? defaultPanelForSystemType(config.systemType),
                                                          wireGauge: inv.strings[0]?.wireGauge ?? '#10 AWG',
                                                          wireLength: inv.strings[0]?.wireLength ?? 50,
                                                        }));
                                                        updateInverter(inv.id, { strings: newStrings } as any);
                                                        logDecision('Auto-String Applied', `${autoStrings} strings × ${autoPerStr} panels (NEC 690.7 @ ${designTemp}°C)`, 'auto');
                                                      }}
                                                      className="w-full mt-1 px-2 py-1 bg-green-500/20 border border-green-500/40 rounded text-xs text-green-300 hover:bg-green-500/30 transition-colors font-semibold"
                                                    >
                                                      ⚡ Auto-Apply: {autoStrings}×{autoPerStr}
                                                    </button>
                                                  </div>
                                                );
                                              })()}
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                  {/* Device Ratio Override */}
                                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-3 py-2 mt-1">
                                    {inv.type === 'micro' && (() => {
                                      const regMpd = (getInvById(inv.inverterId, 'micro') as any)?.modulesPerDevice ?? 1;
                                      return (
                                        <div className="flex items-center gap-3">
                                          <div className="flex-1">
                                            <label className="eng-label">Modules per microinverter</label>
                                            <select value={inv.deviceRatioOverride ?? regMpd} onChange={e => updateInverter(inv.id, { deviceRatioOverride: +e.target.value })}
                                              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                              {[1, 2, 3, 4].map(n => (
                                                <option key={n} value={n}>{n} module{n > 1 ? 's' : ''} per device{n === regMpd ? ' (registry default)' : ''}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div className="text-xs text-slate-500 italic pt-4">Changing this will recalculate engineering values.</div>
                                        </div>
                                      );
                                    })()}
                                    {inv.type === 'optimizer' && (
                                      <div className="flex items-center gap-3">
                                        <div className="flex-1">
                                          <label className="eng-label">Optimizers per module</label>
                                          <select value={inv.deviceRatioOverride ?? 1} onChange={e => updateInverter(inv.id, { deviceRatioOverride: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                            {[1, 2].map(n => (
                                              <option key={n} value={n}>{n} optimizer{n > 1 ? 's' : ''} per module{n === 1 ? ' (default)' : ''}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="text-xs text-slate-500 italic pt-4">Changing this will recalculate engineering values.</div>
                                      </div>
                                    )}
                                    {(inv.type === 'string' || inv.type === 'hybrid' || inv.type === 'ecoflow') && (
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="eng-label">Modules per string</label>
                                          <select value={inv.modulesPerString ?? inv.strings[0]?.panelCount ?? 10} onChange={e => updateInverter(inv.id, { modulesPerString: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                            {[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(n => (
                                              <option key={n} value={n}>{n} modules</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div>
                                          <label className="eng-label">Strings per inverter</label>
                                          <select value={inv.stringsPerInverter ?? inv.strings.length} onChange={e => updateInverter(inv.id, { stringsPerInverter: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500/60">
                                            {[1,2,3,4,5,6].map(n => (
                                              <option key={n} value={n}>{n} string{n > 1 ? 's' : ''}</option>
                                            ))}
                                          </select>
                                        </div>
                                        <div className="col-span-2 text-xs text-slate-500 italic">Changing this will recalculate engineering values.</div>
                                      </div>
                                    )}
                                  </div>
                                  {/* MICRO: panel count only */}
                                  {inv.type === 'micro' ? (
                                    <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                                      <div className="text-xs font-bold text-purple-300 mb-2 uppercase tracking-wide">Microinverter Array</div>
                                      <div className="grid grid-cols-2 gap-3">
                                        <div>
                                          <label className="eng-label">Total Panel Count</label>
                                          <input type="number" min={1} max={200} value={inv.strings[0]?.panelCount ?? 10}
                                            onChange={e => updateString(inv.id, inv.strings[0]?.id ?? '', { panelCount: +e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none" />
                                        </div>
                                        <div>
                                          <label className="eng-label">Panel Model</label>
                                          <select value={inv.strings[0]?.panelId ?? 'qcells-peak-duo-400'}
                                            onChange={e => updateString(inv.id, inv.strings[0]?.id ?? '', { panelId: e.target.value })}
                                            className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white focus:outline-none">
                                            {SOLAR_PANELS.map(p => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
                                          </select>
                                        </div>
                                      </div>
                                      {(() => {
                                        const microInvData = getInvById(inv.inverterId, 'micro') as any;
                                        const mpd = microInvData?.modulesPerDevice ?? 1;
                                        const panels = inv.strings[0]?.panelCount ?? 10;
                                        const devices = Math.ceil(panels / mpd);
                                        return (
                                          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                                            <span>Modules/device: <span className="text-purple-300 font-bold">{mpd}</span></span>
                                            <span>Device count: <span className="text-purple-300 font-bold">{devices}</span></span>
                                            <span className="text-purple-400/60 italic">No DC strings · AC output only</span>
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  ) : (
                                    /* STRING/OPTIMIZER: full DC string UI */
                                    <div>
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Strings / Arrays</span>
                                        <button onClick={() => addString(inv.id)} className="btn-ghost text-xs flex items-center gap-1 text-amber-400 hover:text-amber-300">
                                          <Plus size={11} /> Add String
                                        </button>
                                      </div>
                                      <div className="space-y-2">
                                        {inv.strings.map((str) => {
                                          const panel = getPanelById(str.panelId);
                                          return (
                                            <div key={str.id} className="bg-slate-800/60 border border-slate-700/40 rounded-lg p-3">
                                              <div className="flex items-center gap-2 mb-2">
                                                <span className="text-xs font-bold text-amber-400">{str.label}</span>
                                                <span className="text-xs text-slate-500">{str.panelCount} × {panel?.watts || 400}W = {(str.panelCount * (panel?.watts || 400) / 1000).toFixed(2)} kW</span>
                                                <button onClick={() => removeString(inv.id, str.id)} className="ml-auto text-slate-600 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>
                                              </div>
                                              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                                                <div className="md:col-span-2">
                                                  <label className="text-xs text-slate-500 mb-0.5 block">Panel Model</label>
                                                  <select value={str.panelId} onChange={e => updateString(inv.id, str.id, { panelId: e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                                    {SOLAR_PANELS.map(p => <option key={p.id} value={p.id}>{p.manufacturer} {p.model}</option>)}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-xs text-slate-500 mb-0.5 block">Count</label>
                                                  <input type="number" min={1} max={50} value={str.panelCount}
                                                    onChange={e => updateString(inv.id, str.id, { panelCount: +e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                                                </div>
                                                <div>
                                                  <label className="text-xs text-slate-500 mb-0.5 block">DC Wire</label>
                                                  <select value={str.wireGauge} onChange={e => updateString(inv.id, str.id, { wireGauge: e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none">
                                                    {['#14 AWG', '#12 AWG', '#10 AWG', '#8 AWG', '#6 AWG'].map(g => <option key={g}>{g}</option>)}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-xs text-slate-500 mb-0.5 block">Run (ft)</label>
                                                  <input type="number" min={1} value={str.wireLength}
                                                    onChange={e => updateString(inv.id, str.id, { wireLength: +e.target.value })}
                                                    className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                                                </div>
                                              </div>
                                              {/* MANUAL OCPD override */}
                                              {engineeringMode === 'MANUAL' && (
                                                <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <Lock size={10} className="text-amber-400" />
                                                    <span className="text-xs font-bold text-amber-400">MANUAL OCPD Override</span>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <input type="number" min={1} max={100} placeholder="Auto"
                                                      value={str.ocpdOverride ?? ''}
                                                      onChange={e => updateString(inv.id, str.id, { ocpdOverride: e.target.value ? +e.target.value : undefined, ocpdOverrideAcknowledged: false })}
                                                      className="w-20 bg-slate-700 border border-amber-500/40 rounded px-2 py-1 text-xs text-white focus:outline-none" />
                                                    <span className="text-xs text-slate-400">A breaker</span>
                                                    {str.ocpdOverride && panel && str.ocpdOverride > panel.maxSeriesFuseRating && (
                                                      <span className="text-xs text-red-400 font-bold flex items-center gap-1">
                                                        <AlertTriangle size={10} /> Exceeds maxSeriesFuse ({panel.maxSeriesFuseRating}A) — NEC 690.8(B) VIOLATION
                                                      </span>
                                                    )}
                                                    {str.ocpdOverride && panel && str.ocpdOverride <= panel.maxSeriesFuseRating && (
                                                      <span className="text-xs text-amber-400">Override active — verify compliance</span>
                                                    )}
                                                  </div>
                                                </div>
                                              )}
                                              {panel && (
                                                <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                                                  <span>Voc: <span className="text-slate-300">{panel.voc}V</span></span>
                                                  <span>Isc: <span className="text-slate-300">{panel.isc}A</span></span>
                                                  <span>Vmp: <span className="text-slate-300">{panel.vmp}V</span></span>
                                                  <span>Temp Coeff: <span className="text-slate-300">{panel.tempCoeffVoc}%/°C</span></span>
                                                  <span>Max Fuse: <span className="text-slate-300">{panel.maxSeriesFuseRating}A</span></span>
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Ecosystem Propagation Panel */}
                    {ecosystemComponents.length > 0 && (
                      <div className="card p-5 border border-emerald-500/20 bg-emerald-500/5">
                        <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                          <Package size={14} className="text-emerald-400" />
                          Auto-Added Ecosystem Components
                          <span className="ml-auto text-xs text-emerald-400 font-normal">{ecosystemComponents.length} component{ecosystemComponents.length !== 1 ? 's' : ''}</span>
                        </h3>
                        <div className="space-y-2">
                          {ecosystemComponents.map((comp: any, i: number) => (
                            <div key={i} className="flex items-start gap-3 p-2.5 bg-slate-800/40 rounded-lg border border-emerald-500/10">
                              <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <CheckCircle size={12} className="text-emerald-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-bold text-white">{comp.manufacturer} {comp.model}</div>
                                {comp.partNumber && <div className="text-xs text-emerald-400/70 font-mono">{comp.partNumber}</div>}
                                <div className="text-xs text-slate-400 truncate">{comp.reason}</div>
                              </div>
                              <div className="text-xs text-emerald-400 font-bold flex-shrink-0">×{comp.quantity}</div>
                            </div>
                          ))}
                        </div>
                        {ecosystemLog.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-emerald-500/10">
                            <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-1">Propagation Log</div>
                            {ecosystemLog.map((entry: any, i: number) => (
                              <div key={i} className="text-xs text-slate-400 py-0.5">
                                <span className="text-emerald-400 font-mono">{entry.action}</span>: {entry.component} — {entry.reason}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                  </div>{/* end center col */}


                  {/* ─────────────────────────────────────────────────────────
                      RIGHT COLUMN: Engineering Summary + System Config
                  ──────────────────────────────────────────────────────────── */}
                  <div className="space-y-5 lg:col-span-2 xl:col-span-1">

                    {/* Engineering Summary Panel */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight">
                        <Cpu size={14} className="text-amber-400" /> Engineering Summary
                      </h3>
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        {[
                          { label: 'Total Panels', value: totalPanels, color: 'text-amber-400', icon: <Sun size={12} /> },
                          { label: 'System kW DC', value: totalKw, color: 'text-amber-400', icon: <Zap size={12} /> },
                          { label: 'Inverter kW AC', value: totalInverterKw || '—', color: 'text-blue-400', icon: <Cpu size={12} /> },
                          { label: 'DC/AC Ratio', value: _dcAcRatio, color: parseFloat(_dcAcRatio) > 1.35 ? 'text-amber-400' : parseFloat(_dcAcRatio) > 1.5 ? 'text-red-400' : 'text-emerald-400', icon: <Activity size={12} /> },
                          { label: cs.isMicro ? 'AC Branches' : 'String Count', value: _branchCount, color: 'text-purple-400', icon: <GitBranch size={12} /> },
                          { label: 'BOM Cost', value: bomPricing?.pricingApplied ? `$${(bomPricing.totalBomCost / 1000).toFixed(1)}k` : '—', color: 'text-emerald-400', icon: <Package size={12} /> },
                        ].map(item => (
                          <div key={item.label} className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={item.color}>{item.icon}</span>
                              <span className="text-[10px] text-slate-500 uppercase tracking-wide">{item.label}</span>
                            </div>
                            <div className={`text-lg font-black tabular-nums ${item.color}`}>{item.value}</div>
                          </div>
                        ))}
                      </div>

                      {/* System health mini-grid */}
                      <div className="space-y-2">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">System Health</div>
                        {[
                          { label: 'Electrical', status: _elecStatus },
                          { label: 'Structural', status: _structStatus },
                          { label: 'NEC Rules', status: rulesResult?.overallStatus },
                          { label: 'Jurisdiction', status: compliance.jurisdiction ? 'PASS' : null },
                        ].map(item => (
                          <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-slate-700/30 last:border-0">
                            <span className="text-xs text-slate-400">{item.label}</span>
                            <div className="flex items-center gap-1.5">
                              <div className={`w-2 h-2 rounded-full ${statusDot(item.status)}`} />
                              <span className={`text-xs font-bold ${statusText(item.status)}`}>
                                {item.status || '—'}
                              </span>
                            </div>
                          </div>
                        ))}
                        {rulesResult && (rulesResult.errorCount > 0 || rulesResult.warningCount > 0) && (
                          <div className="mt-2 flex gap-3 text-xs">
                            {rulesResult.errorCount > 0 && (
                              <span className="flex items-center gap-1 text-red-400">
                                <AlertTriangle size={10} /> {rulesResult.errorCount} error{rulesResult.errorCount > 1 ? 's' : ''}
                              </span>
                            )}
                            {rulesResult.warningCount > 0 && (
                              <span className="flex items-center gap-1 text-amber-400">
                                <AlertCircle size={10} /> {rulesResult.warningCount} warning{rulesResult.warningCount > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* System Configuration (system type + mounting) */}
                    <div className="eng-panel">
                      <h3 className="text-sm font-extrabold text-slate-100 mb-4 flex items-center gap-2 tracking-tight">
                        <Settings size={14} className="text-amber-400" /> System Configuration
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <label className="eng-label">System Type</label>
                          <select value={config.systemType} onChange={e => updateConfig({ systemType: e.target.value as any })} className="eng-select">
                            <option value="residential">Residential</option>
                            <option value="commercial">Commercial</option>
                            <option value="ground_mount">Ground Mount</option>
                            <option value="carport">Carport</option>
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Mounting System</label>
                          <select value={config.mountingId} onChange={e => updateConfig({ mountingId: e.target.value })} className="eng-select">
                            {ALL_MOUNTING_SYSTEMS.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Interconnection Method</label>
                          <select value={config.interconnectionMethod} onChange={e => updateConfig({ interconnectionMethod: e.target.value as any })} className="eng-select">
                            <option value="supply_side">Supply Side (690.64)</option>
                            <option value="load_side">Load Side / Backfeed (705.12)</option>
                            <option value="net_metering">Net Metering</option>
                            <option value="off_grid">Off Grid</option>
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Utility Meter</label>
                          <select value={config.utilityMeter} onChange={e => updateConfig({ utilityMeter: e.target.value })} className="eng-select">
                            {['Smart Meter', 'Analog Meter', 'Net Meter', 'Production Meter'].map(m => <option key={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="eng-label">Engineering Mode</label>
                          <div className="flex rounded-xl overflow-hidden border border-slate-700/60">
                            {(['AUTO', 'MANUAL'] as const).map((mode, mi) => (
                              <button key={mode}
                                onClick={() => setEngineeringMode(mode)}
                                className={`flex-1 py-2 text-xs font-bold transition-all border-r last:border-r-0 border-slate-700/60 ${
                                  engineeringMode === mode
                                    ? mode === 'AUTO' ? 'bg-emerald-500/25 text-emerald-300' : 'bg-amber-500/25 text-amber-300'
                                    : 'bg-slate-800/60 text-slate-500 hover:text-slate-200 hover:bg-slate-700/40'
                                }`}>
                                {mode === 'AUTO' ? '⚡ AUTO' : '✏️ MANUAL'}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-slate-600 mt-1">
                            {engineeringMode === 'AUTO' ? 'Auto-resolves NEC violations and sizes conductors.' : 'Manual override — all values are user-controlled.'}
                          </p>
                        </div>
                      </div>
                    </div>

                  </div>{/* end right col */}

                </div>{/* end 3-col grid */}

              </div>
            );
          })()}"""

# Now build full replacement
REPLACEMENT = NEW_CONFIG_TAB + "\n\n          {/* \u2500\u2500 COMPLIANCE TAB \u2500\u2500 */"

new_content = content[:start_idx] + REPLACEMENT + content[end_idx + len(END_MARKER):]

# Verify we didn't lose the compliance tab
if '{/* \u2500\u2500 COMPLIANCE TAB \u2500\u2500 */' not in new_content:
    print("\u274c COMPLIANCE TAB MARKER LOST — aborting")
    exit(1)

# Check ENABLE_CONFIG_V2_UI is in the new content
if 'ENABLE_CONFIG_V2_UI' not in new_content:
    print("\u274c Feature flag missing — aborting")
    exit(1)

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content)

print(f"\u2705 Config V2 UI written: {len(new_content)} total chars")
print(f"   Old config tab: {end_idx - start_idx} chars")
print(f"   New config tab: {len(NEW_CONFIG_TAB)} chars")
print("\u2705 Done.")