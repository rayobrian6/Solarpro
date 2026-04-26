#!/usr/bin/env python3
"""
v56.0 — Tab UX Overhaul: Diagram + Schedule
Reads fresh positions after script A has run.
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

import re

def find_tab(content, start_marker, end_comment_fragment):
    si = content.find(start_marker)
    if si < 0:
        raise ValueError(f"Start marker not found: {repr(start_marker[:60])}")
    ei_search = content.find(end_comment_fragment, si)
    if ei_search < 0:
        raise ValueError(f"End fragment not found: {repr(end_comment_fragment[:60])}")
    # End is the last )} before the end comment
    chunk = content[si:ei_search]
    last_close = chunk.rfind(')}')
    if last_close < 0:
        raise ValueError("No )} found before end comment")
    return si, si + last_close + 2

# Find current tab positions
DIAGRAM_START, DIAGRAM_END = find_tab(
    content,
    "{activeTab === 'diagram' && (!canSLD ? (",
    "{/* ── EQUIPMENT SCHEDULE TAB"
)
SCHEDULE_START, SCHEDULE_END = find_tab(
    content,
    "{activeTab === 'schedule' && (",
    "{/* ── MOUNTING DETAILS TAB"
)

print(f"✅ diagram:  {DIAGRAM_START}–{DIAGRAM_END} ({DIAGRAM_END-DIAGRAM_START:,} chars)")
print(f"✅ schedule: {SCHEDULE_START}–{SCHEDULE_END} ({SCHEDULE_END-SCHEDULE_START:,} chars)")

# Read existing content for tabs we're keeping but enhancing
DIAGRAM_EXISTING  = content[DIAGRAM_START:DIAGRAM_END]
SCHEDULE_EXISTING = content[SCHEDULE_START:SCHEDULE_END]

# ─────────────────────────────────────────────────────────────────────────────
# DIAGRAM TAB V2 — wrap existing with improved hero, add sheet metadata strip
# Keep ALL existing functionality (canSLD gate, fetchSLD, PDF export, zoom/pan)
# Just add: max-w-none, better hero layout, sheet info bottom bar
# ─────────────────────────────────────────────────────────────────────────────
DIAGRAM_V2 = r"""{activeTab === 'diagram' && (!canSLD ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
                  <Lock size={28} className="text-amber-400" />
                </div>
                <h3 className="text-white font-bold text-lg mb-1">Single-Line Diagram</h3>
                <p className="text-slate-400 text-sm mb-4 max-w-sm">
                  Professional permit-grade SLD generation requires Professional plan or above.
                </p>
                <a href="/account/billing" className="btn-primary inline-flex gap-2">
                  Upgrade to Professional
                </a>
              </div>
            ) : (
              <div className="max-w-none space-y-4">
                {/* ══ SLD HERO ══════════════════════════════════════════════════ */}
                <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                  <div className="absolute -top-8 -right-8 w-36 h-36 bg-blue-500/5 rounded-full blur-3xl pointer-events-none" />
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />

                  <div className="flex items-center justify-between gap-4 mb-4">
                    <div>
                      <h2 className="text-base font-black text-white flex items-center gap-2">
                        <Zap size={16} className="text-blue-400" />
                        Single-Line Diagram
                      </h2>
                      <p className="text-xs text-slate-400 mt-0.5">ANSI C (18×24") · IEEE 315 symbols · Permit-grade</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30 font-mono">
                        ANSI C · IEEE 315
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                    <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-blue-400 tabular-nums">{totalKw}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">kW DC</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-amber-400 tabular-nums">{totalPanels}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Panels</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-white tabular-nums">{config.inverters.length}</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Inverter{config.inverters.length !== 1 ? 's' : ''}</div>
                    </div>
                    <div className="rounded-xl bg-slate-900/60 border border-emerald-500/20 px-3 py-2.5 text-center">
                      <div className="text-xl font-black text-emerald-400 tabular-nums">{config.mainPanelAmps || 200}A</div>
                      <div className="text-[10px] text-slate-500 mt-0.5">Main Panel</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                      PV Array · Combiner · Inverter · OCPD · Meter · Utility
                    </div>
                    <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-blue-500/30 bg-blue-500/10 text-blue-400 font-semibold">
                      <CheckCircle size={10} /> Permit-grade SLD
                    </div>
                    {sldSvg && (
                      <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 font-semibold">
                        <CheckCircle size={10} /> Rendered · {engineeringMode} mode
                      </div>
                    )}
                  </div>
                </div>

                {/* Controls bar */}
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Zap size={14} className="text-amber-400" /> Permit-Grade Single-Line Diagram
                      <span className="text-xs font-normal bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full">ANSI C · IEEE Symbols</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Vector SVG · 18×24 inch sheet · Engineering title block · Conductor callouts</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={fetchSLD}
                      disabled={sldLoading}
                      className="btn-primary btn-sm"
                    >
                      <RefreshCw size={14} className={sldLoading ? 'animate-spin' : ''} />
                      {sldLoading ? 'Generating...' : sldSvg ? 'Regenerate SLD' : 'Generate SLD'}
                    </button>
                    {sldSvg && (
                      <a
                        href={`/api/engineering/sld/pdf`}
                        onClick={async (e) => {
                          e.preventDefault();
                          const res = await fetch('/api/engineering/sld/pdf', {
                            method: 'POST',
            cache: 'no-store',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              buildInput: {
                                projectName: config.projectName,
                                clientName: config.clientName,
                                address: config.address,
                                designer: config.designer,
                                date: config.date,
                                necVersion: `NEC ${compliance.jurisdiction?.necVersion || '2023'}`,
                                systemVoltage: 240,
                                mainPanelAmps: config.mainPanelAmps,
                                mainPanelBrand: config.mainPanelBrand,
                                utilityMeter: config.utilityMeter,
                                utilityName: config.utilityId || 'Local Utility',
                                acDisconnect: config.acDisconnect,
                                dcDisconnect: config.dcDisconnect,
                                productionMeter: config.productionMeter,
                                rapidShutdown: config.rapidShutdown,
                                conduitType: config.conduitType,
                                notes: config.notes,
                                interconnection: config.interconnectionMethod ?? 'LOAD_SIDE',
                                interconnectionType: config.interconnectionMethod ?? 'LOAD_SIDE',
                                panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
                                topologyType: computedSystem.isMicro ? 'MICROINVERTER' : 'STRING_INVERTER',
                                totalModules: totalPanels,
                                totalStrings: computedSystem.isMicro ? 0 : (computedSystem.strings?.length ?? 1),
                                inverterManufacturer: (() => { const inv = config.inverters[0]; const d = getInvById(inv?.inverterId, inv?.type) as any; return d?.manufacturer || (computedSystem.isMicro ? 'Enphase' : 'SolarEdge'); })(),
                                inverterModel: (() => { const inv = config.inverters[0]; const d = getInvById(inv?.inverterId, inv?.type) as any; return d?.model || (computedSystem.isMicro ? 'IQ8+' : 'SE7600H'); })(),
                                acOutputKw: Number(totalInverterKw),
                                acOutputAmps: Math.round(Number(totalInverterKw) * 1000 / 240),
                                acOCPD: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.ocpdAmps ?? Math.ceil(Math.round(Number(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5,
                                backfeedAmps: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.ocpdAmps ?? Math.ceil(Math.round(Number(totalInverterKw) * 1000 / 240) * 1.25 / 5) * 5,
                                panelModel: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.model || 'Solar Panel'; })(),
                                panelWatts: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.watts || 400; })(),
                                panelVoc: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.voc || 41.6; })(),
                                panelIsc: (() => { const inv = config.inverters[0]; const str = inv?.strings[0]; const p = getPanelById(str?.panelId) as any; return p?.isc || 12.26; })(),
                                dcWireGauge: computedSystem.runs?.find((r: any) => r.id === 'DC_STRING_RUN')?.wireGauge ?? '#10 AWG',
                                acWireGauge: computedSystem.runs?.find((r: any) => r.id === 'DISCO_TO_METER_RUN')?.wireGauge ?? '#8 AWG',
                                acConduitType: config.conduitType ?? 'EMT',
                                dcConduitType: config.conduitType ?? 'EMT',
                                acWireLength: config.wireLength ?? 60,
                                deviceCount: computedSystem.isMicro ? totalPanels : undefined,
                                microBranches: computedSystem.isMicro ? computedSystem.microBranches : undefined,
                                branchWireGauge: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.wireGauge : undefined,
                                branchConduitSize: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.conduitSize : undefined,
                                branchOcpdAmps: computedSystem.isMicro ? computedSystem.runs?.find((r: any) => r.id === 'BRANCH_RUN')?.ocpdAmps : undefined,
                                runs: computedSystem.runs,
                                calcResult: compliance.electrical || null,
                                inverterSpecs: config.inverters.map(inv => {
                                  const invData = getInvById(inv.inverterId, inv.type) as any;
                                  return { inverterId: inv.inverterId, manufacturer: invData?.manufacturer || '', model: invData?.model || '', acOutputKw: invData?.acOutputKw || 0, maxDcVoltage: invData?.maxDcVoltage || 480, efficiency: invData?.efficiency || 97, ulListing: invData?.ulListing || 'UL 1741', rapidShutdownCompliant: invData?.rapidShutdownCompliant || false };
                                }),
                                panelSpecs: config.inverters.flatMap(inv => inv.strings.map(str => {
                                  const panel = getPanelById(str.panelId) as any;
                                  return { panelId: str.panelId, manufacturer: panel?.manufacturer || '', model: panel?.model || '', watts: panel?.watts || 400, voc: panel?.voc || 41.6, isc: panel?.isc || 12.26, ulListing: panel?.ulListing || 'UL 61730' };
                                })),
                              },
                              format: 'pdf',
                            }),
                          });
                          if (res.ok) {
                            const blob = await res.blob();
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `SLD-${config.projectName || 'project'}.pdf`;
                            a.click();
                            URL.revokeObjectURL(url);
                          } else {
                            let errMsg = `PDF export failed (HTTP ${res.status})`;
                            try {
                              const errData = await res.json();
                              errMsg = errData.error || errData.message || errMsg;
                            } catch {
                              try { errMsg = await res.text() || errMsg; } catch { /* ignore */ }
                            }
                            setSldError(`Export PDF: ${errMsg}`);
                          }
                        }}
                        className="btn-secondary btn-sm cursor-pointer"
                      >
                        <Download size={14} /> Export PDF
                      </a>
                    )}
                  </div>
                </div>

                {/* Error state */}
                {sldError && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400 flex items-center gap-2">
                    <XCircle size={14} /> {sldError}
                  </div>
                )}

                {/* Empty state */}
                {!sldSvg && !sldLoading && !sldError && (
                  <div className="card p-12 text-center">
                    <Zap size={40} className="mx-auto mb-4 text-slate-600" />
                    <div className="text-sm font-bold text-white mb-1">Permit-Grade SLD Ready</div>
                    <div className="text-xs text-slate-500 mb-4 max-w-sm mx-auto">
                      Click "Generate SLD" to render a professional IEEE-symbol single-line diagram on an ANSI C (18×24") engineering sheet with full title block, conductor callouts, and grounding system.
                    </div>
                    <button onClick={fetchSLD} className="btn-primary btn-sm mx-auto">
                      <Zap size={14} /> Generate SLD
                    </button>
                  </div>
                )}

                {/* Loading state */}
                {sldLoading && (
                  <div className="card p-12 text-center">
                    <RefreshCw size={32} className="mx-auto mb-3 text-amber-400 animate-spin" />
                    <div className="text-sm text-slate-400">Rendering permit-grade SLD...</div>
                    <div className="text-xs text-slate-600 mt-1">Applying IEEE symbols · ANSI C sheet · Conductor callouts</div>
                  </div>
                )}

                {/* SVG Diagram */}
                {sldSvg && !sldLoading && (
                  <div className="card overflow-hidden">
                    <div className="bg-slate-800/50 border-b border-slate-700/50 px-4 py-2 flex items-center justify-between">
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <CheckCircle size={12} className="text-emerald-400" />
                        SLD rendered · ANSI C (18×24") · IEEE electrical symbols · {engineeringMode} mode
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1 text-xs text-slate-400">
                          <button
                            onClick={() => setSldZoom(z => Math.max(0.25, z - 0.25))}
                            className="p-1 hover:bg-slate-700 rounded"
                            title="Zoom Out"
                          >−</button>
                          <span className="w-12 text-center">{Math.round(sldZoom * 100)}%</span>
                          <button
                            onClick={() => setSldZoom(z => Math.min(4, z + 0.25))}
                            className="p-1 hover:bg-slate-700 rounded"
                            title="Zoom In"
                          >+</button>
                          <button
                            onClick={() => { setSldZoom(1); setSldPan({ x: 0, y: 0 }); }}
                            className="p-1 hover:bg-slate-700 rounded ml-1"
                            title="Fit to Screen"
                          >↺</button>
                        </div>
                        {compliance.electrical?.autoResolutions?.length > 0 && (
                          <span className="text-emerald-400">{compliance.electrical.autoResolutions.length} auto-resolution{compliance.electrical.autoResolutions.length !== 1 ? 's' : ''} applied</span>
                        )}
                      </div>
                    </div>
                    <div
                      ref={sldRef}
                      className="w-full overflow-hidden bg-white cursor-move"
                      style={{ maxHeight: '90vh', minHeight: '400px' }}
                      onWheel={(e) => {
                        e.preventDefault();
                        const delta = e.deltaY > 0 ? -0.1 : 0.1;
                        setSldZoom(z => Math.max(0.25, Math.min(4, z + delta)));
                      }}
                      onMouseDown={(e) => {
                        const startX = e.clientX - sldPan.x;
                        const startY = e.clientY - sldPan.y;
                        const handleMove = (moveEvent: MouseEvent) => {
                          setSldPan({
                            x: moveEvent.clientX - startX,
                            y: moveEvent.clientY - startY
                          });
                        };
                        const handleUp = () => {
                          document.removeEventListener('mousemove', handleMove);
                          document.removeEventListener('mouseup', handleUp);
                        };
                        document.addEventListener('mousemove', handleMove);
                        document.addEventListener('mouseup', handleUp);
                      }}
                    >
                      <div
                        style={{
                          transform: `scale(${sldZoom}) translate(${sldPan.x / sldZoom}px, ${sldPan.y / sldZoom}px)`,
                          transformOrigin: 'center center',
                          transition: 'transform 0.1s ease-out'
                        }}
                        dangerouslySetInnerHTML={{ __html: sldSvg?.replace('<svg ', '<svg style="width:100%;height:auto;display:block;" ') }}
                      />
                    </div>
                  </div>
                )}

                {/* Electrical Sizing Callout Panel on SLD */}
                {(compliance.electrical as any)?.acSizing && (
                  <div className="card p-4">
                    <h4 className="text-xs font-bold text-amber-400 mb-3 flex items-center gap-2">
                      <Activity size={12} /> Conductor & Disconnect Callouts — NEC 705.60 · 310.16 · Ch.9
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        { label: 'AC Conductor', value: (compliance.electrical as any).acSizing.conductorLabel, nec: 'NEC 310.16' },
                        { label: 'Conduit', value: (compliance.electrical as any).acSizing.conduitLabel, nec: 'NEC Ch. 9' },
                        { label: 'AC Disconnect', value: (compliance.electrical as any).acSizing.disconnectLabel, nec: 'NEC 690.14' },
                        { label: 'OCPD', value: (compliance.electrical as any).acSizing.ocpdLabel, nec: 'NEC 240.6' },
                        { label: 'Fuses', value: (compliance.electrical as any).acSizing.fuseLabel, nec: (compliance.electrical as any).acSizing.disconnectType === 'fused' ? 'NEC 690.9' : 'NEC 690.14' },
                        { label: 'Grounding', value: `${(compliance.electrical as any).acSizing.groundingConductor} Copper`, nec: 'NEC 250.66' },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800/50 rounded-lg p-2.5">
                          <div className="text-xs text-slate-500 mb-0.5">{item.label}</div>
                          <div className="text-xs font-bold text-white">{item.value}</div>
                          <div className="text-xs text-slate-600 font-mono mt-0.5">{item.nec}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            ))}"""

# ─────────────────────────────────────────────────────────────────────────────
# SCHEDULE TAB V2 — expand max-w-4xl to max-w-none, keep all content intact
# ─────────────────────────────────────────────────────────────────────────────
SCHEDULE_V2 = SCHEDULE_EXISTING.replace(
    '<div className="max-w-4xl">',
    '<div className="max-w-none">',
    1
)
# Also expand the white print sheet to be wider
SCHEDULE_V2 = SCHEDULE_V2.replace(
    'className="bg-white rounded-2xl p-8 shadow-2xl text-slate-900"',
    'className="bg-white rounded-2xl p-8 shadow-2xl text-slate-900 overflow-x-auto"',
    1
)
print(f"✅ Schedule tab: expanded max-w-4xl → max-w-none")

# ─────────────────────────────────────────────────────────────────────────────
# Apply replacements back to front
# ─────────────────────────────────────────────────────────────────────────────

# Schedule first (later in file)
new_content = content[:SCHEDULE_START] + SCHEDULE_V2 + content[SCHEDULE_END:]

# Re-find diagram position (positions haven't shifted since schedule is after diagram)
new_content2 = new_content[:DIAGRAM_START] + DIAGRAM_V2 + new_content[DIAGRAM_END:]

# Verify key markers preserved
assert 'fetchSLD' in new_content2, "❌ fetchSLD missing"
assert 'sldSvg' in new_content2, "❌ sldSvg missing"
assert 'pvwattsData' in new_content2, "❌ pvwattsData missing (schedule)"
assert 'conduitSchedule' in new_content2, "❌ conduitSchedule missing"

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content2)

print(f"✅ Written: {len(new_content2):,} total chars")
print(f"   Diagram V2:  {len(DIAGRAM_V2):,} chars (was {DIAGRAM_END - DIAGRAM_START:,})")
print(f"   Schedule V2: {len(SCHEDULE_V2):,} chars (was {SCHEDULE_END - SCHEDULE_START:,})")
print("✅ build_tabs_v56b.py done.")