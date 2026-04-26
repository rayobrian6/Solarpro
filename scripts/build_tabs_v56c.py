#!/usr/bin/env python3
"""
v56.0 — Tab UX Overhaul: Permit + BOM + Files
Reads fresh positions after scripts A and B have run.
"""

with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

def find_tab(content, start_marker, end_comment_fragment):
    si = content.find(start_marker)
    if si < 0:
        raise ValueError(f"Start marker not found: {repr(start_marker[:60])}")
    ei_search = content.find(end_comment_fragment, si)
    if ei_search < 0:
        raise ValueError(f"End fragment not found: {repr(end_comment_fragment[:60])}")
    chunk = content[si:ei_search]
    last_close = chunk.rfind(')}')
    if last_close < 0:
        raise ValueError("No )} found before end comment")
    return si, si + last_close + 2

def find_tab_to_end_marker(content, start_marker, end_marker):
    si = content.find(start_marker)
    if si < 0:
        raise ValueError(f"Start marker not found: {repr(start_marker[:60])}")
    ei = content.find(end_marker, si)
    if ei < 0:
        raise ValueError(f"End marker not found: {repr(end_marker[:60])}")
    chunk = content[si:ei]
    last_close = chunk.rfind(')}')
    if last_close < 0:
        raise ValueError("No )} found before end marker")
    return si, si + last_close + 2

PERMIT_START, PERMIT_END = find_tab(
    content,
    "{activeTab === 'permit' && (!canPermit ? (",
    "{/* ── BOM TAB"
)
BOM_START, BOM_END = find_tab(
    content,
    "{activeTab === 'bom' && (!canBOM ? (",
    "{/* ── CLIENT FILES TAB"
)
FILES_START, FILES_END = find_tab_to_end_marker(
    content,
    "{activeTab === 'files' && (",
    "        </div>{/* end main tab content */"
)

print(f"✅ permit: {PERMIT_START}–{PERMIT_END} ({PERMIT_END-PERMIT_START:,} chars)")
print(f"✅ bom:    {BOM_START}–{BOM_END} ({BOM_END-BOM_START:,} chars)")
print(f"✅ files:  {FILES_START}–{FILES_END} ({FILES_END-FILES_START:,} chars)")

PERMIT_EXISTING = content[PERMIT_START:PERMIT_END]
BOM_EXISTING    = content[BOM_START:BOM_END]
FILES_EXISTING  = content[FILES_START:FILES_END]

# ─────────────────────────────────────────────────────────────────────────────
# PERMIT TAB V2
# Add: readiness score ring, sheet grid with status icons, improved layout
# Keep: all existing handleGeneratePermitPackage, preview logic, ALL handlers
# ─────────────────────────────────────────────────────────────────────────────
PERMIT_V2 = r"""{activeTab === 'permit' && (!canPermit ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="w-16 h-16 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center mx-auto mb-4">
                  <Lock size={28} className="text-blue-400" />
                </div>
                <h3 className="text-white font-bold text-lg mb-1">Permit Package</h3>
                <p className="text-slate-400 text-sm mb-4 max-w-sm">
                  Permit-ready documentation packages require Professional plan or above.
                </p>
                <a href="/account/billing" className="btn-primary inline-flex gap-2">
                  Upgrade to Professional
                </a>
              </div>
            ) : (() => {
              const _sheets = [
                { label: 'PV-0  Cover Sheet',                         done: true },
                { label: 'PV-1  Site Plan',                           done: !!config.address },
                { label: 'PV-2  Roof Plan — Module Layout & Fire Setbacks', done: !!(projectLayout?.panels?.length > 0) },
                { label: 'PV-2B  Array Geometry & String Layout',     done: !!(projectLayout?.panels?.length > 0) },
                { label: 'PV-3  Attachment Detail — Mounting & Cross-Section', done: true },
                { label: 'PV-4A  NEC Compliance Sheet',               done: !!compliance.electrical },
                { label: 'PV-4B  Conductor & Conduit Schedule',       done: true },
                { label: 'PV-4C  Structural Calculation Sheet',       done: !!compliance.structural },
                { label: 'PV-5  Warning Labels & Required Placards',  done: true },
                { label: 'SCHED  Equipment Schedule',                 done: totalPanels > 0 },
                { label: 'APP-A  Equipment Specification Reference',  done: true },
                { label: 'CERT  Engineer Certification',              done: !!config.designer },
                { label: 'PE-1  PE Structural Letter of Compliance',  done: true },
                { label: 'E-1  Single-Line Electrical Diagram',       done: true },
              ];
              const _doneCount  = _sheets.filter(s => s.done).length;
              const _readyPct   = Math.round((_doneCount / _sheets.length) * 100);
              const _compStatus = compliance.overallStatus;

              return (
                <div className="max-w-none space-y-5">

                  {/* ══ PERMIT HERO ══════════════════════════════════════════════ */}
                  <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                    <div className="absolute -top-8 -right-8 w-36 h-36 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-purple-500/20 to-transparent" />

                    <div className="flex items-center justify-between gap-4 mb-4">
                      <div>
                        <h2 className="text-base font-black text-white flex items-center gap-2">
                          <Stamp size={16} className="text-purple-400" />
                          Permit Package
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {compliance.jurisdiction ? `${compliance.jurisdiction.state} · NEC ${compliance.jurisdiction.necVersion}` : 'Jurisdiction not set'}
                          {' · '}{_doneCount}/{_sheets.length} sheets ready
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        {/* Readiness ring */}
                        <div className="relative w-14 h-14 flex-shrink-0">
                          <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
                            <circle cx="28" cy="28" r="22" fill="none" stroke="rgb(51,65,85)" strokeWidth="5" />
                            <circle cx="28" cy="28" r="22" fill="none"
                              stroke={_readyPct >= 90 ? 'rgb(52,211,153)' : _readyPct >= 70 ? 'rgb(251,191,36)' : 'rgb(148,163,184)'}
                              strokeWidth="5"
                              strokeDasharray={`${_readyPct * 1.382} 138.2`}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-xs font-black ${_readyPct >= 90 ? 'text-emerald-400' : _readyPct >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                              {_readyPct}%
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500">Readiness</div>
                          <div className={`text-sm font-black ${_readyPct >= 90 ? 'text-emerald-400' : _readyPct >= 70 ? 'text-amber-400' : 'text-slate-400'}`}>
                            {_readyPct >= 90 ? 'Ready to Submit' : _readyPct >= 70 ? 'Nearly Ready' : 'In Progress'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                      <div className="rounded-xl bg-slate-900/60 border border-purple-500/20 px-3 py-2.5 text-center">
                        <div className="text-xl font-black text-purple-400 tabular-nums">{_doneCount}/{_sheets.length}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Sheets Ready</div>
                      </div>
                      <div className="rounded-xl bg-slate-900/60 border border-amber-500/20 px-3 py-2.5 text-center">
                        <div className="text-xl font-black text-amber-400 tabular-nums">{totalKw}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">kW DC</div>
                      </div>
                      <div className="rounded-xl bg-slate-900/60 border border-blue-500/20 px-3 py-2.5 text-center">
                        <div className="text-xl font-black text-blue-400 tabular-nums">{totalPanels}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Panels</div>
                      </div>
                      <div className={`rounded-xl border px-3 py-2.5 text-center ${
                        _compStatus === 'PASS' ? 'border-emerald-500/30 bg-emerald-500/8' :
                        _compStatus === 'FAIL' ? 'border-red-500/30 bg-red-500/8' :
                        'border-slate-700/50 bg-slate-900/60'
                      }`}>
                        <div className={`text-xl font-black tabular-nums ${
                          _compStatus === 'PASS' ? 'text-emerald-400' :
                          _compStatus === 'FAIL' ? 'text-red-400' : 'text-slate-500'
                        }`}>{_compStatus || '—'}</div>
                        <div className="text-[10px] text-slate-500 mt-0.5">Compliance</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {compliance.jurisdiction && (
                        <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                          <MapPin size={10} className="text-amber-400" /> {compliance.jurisdiction.state}
                        </div>
                      )}
                      {compliance.jurisdiction && (
                        <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-300">
                          <Book size={10} className="text-blue-400" /> NEC {compliance.jurisdiction.necVersion}
                        </div>
                      )}
                      <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                        CAD · SLD · NEC · Structural · Title Block
                      </div>
                    </div>
                  </div>

                  {/* ══ 2-COL: Sheet Grid + Generator ════════════════════════════ */}
                  <div className="grid grid-cols-1 xl:grid-cols-5 gap-5">

                    {/* LEFT: Sheet status grid */}
                    <div className="xl:col-span-3 space-y-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <FileText size={12} className="text-purple-400" /> Sheet Status
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {_sheets.map((sheet, i) => (
                          <div key={i} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
                            sheet.done
                              ? 'bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/8'
                              : 'bg-slate-800/40 border-slate-700/50 hover:bg-slate-800/60'
                          }`}>
                            <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                              sheet.done ? 'bg-emerald-500/20 border border-emerald-500/30' : 'bg-slate-700/50 border border-slate-600/50'
                            }`}>
                              {sheet.done
                                ? <CheckCircle size={12} className="text-emerald-400" />
                                : <div className="w-2 h-2 rounded-full border-2 border-slate-600" />
                              }
                            </div>
                            <span className={`text-xs font-mono leading-tight ${sheet.done ? 'text-white' : 'text-slate-500'}`}>
                              {sheet.label}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RIGHT: Permit generator */}
                    <div className="xl:col-span-2 space-y-3">
                      <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Stamp size={12} className="text-purple-400" /> Generate Package
                      </h3>
                      <div className="eng-panel space-y-4">
                        <div>
                          <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                            <Stamp size={14} className="text-amber-400" /> Permit Package Generator
                            <span className="text-xs font-normal bg-slate-700/60 text-slate-400 border border-slate-600/50 px-2 py-0.5 rounded-full">14 Sheets</span>
                          </h4>
                          <p className="text-slate-400 text-xs">Full permit-ready documentation — CAD, NEC compliance, structural calcs, SLD, equipment schedule, PE letter, warning labels.</p>
                        </div>

                        {/* Readiness summary */}
                        <div className="rounded-lg bg-slate-800/60 border border-slate-700/40 p-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs text-slate-500">Package readiness</span>
                            <span className={`text-xs font-bold ${_readyPct >= 90 ? 'text-emerald-400' : 'text-amber-400'}`}>{_doneCount}/{_sheets.length} sheets</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-700/60 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-700 ${_readyPct >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                              style={{ width: `${_readyPct}%` }}
                            />
                          </div>
                        </div>

                        <button
                          onClick={handleGeneratePermitPackage}
                          disabled={permitLoading || calculating || sldLoading || bomLoading}
                          className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {permitLoading ? (
                            <><RefreshCw size={16} className="animate-spin" /> Building Permit Package…</>
                          ) : (
                            <><Printer size={16} /> Generate & Download (PDF)</>
                          )}
                        </button>
                        <button
                          onClick={async () => {
                            const _mountSys2 = ALL_MOUNTING_SYSTEMS.find(s => s.id === config.mountingId);
                            const permitInput = {
                              projectId: currentProjectId || undefined,
                              project: {
                                projectName: config.projectName, clientName: config.clientName,
                                address: config.address, designer: config.designer, date: config.date,
                                notes: config.notes, systemType: config.systemType,
                                lat: (config as any).lat || undefined,
                                lng: (config as any).lng || (config as any).lon || undefined,
                                mainPanelAmps: config.mainPanelAmps, mainPanelBrand: config.mainPanelBrand,
                                utilityMeter: config.utilityMeter, acDisconnect: config.acDisconnect,
                                dcDisconnect: config.dcDisconnect, productionMeter: config.productionMeter,
                                rapidShutdown: config.rapidShutdown, conduitType: config.conduitType,
                                wireGauge: config.wireGauge, wireLength: config.wireLength,
                                utilityName: compliance?.utilityName || config.utilityId || 'Local Utility',
                                roofType: config.roofType,
                                mountingSystem: _mountSys2 ? `${_mountSys2.manufacturer} ${_mountSys2.model}` : config.mountingId || 'IronRidge XR100',
                                mountingSystemId: config.mountingId,
                                roofPitch: config.roofPitch,
                                rafterSize: config.rafterSize,
                                rafterSpacing: config.rafterSpacing,
                                attachmentSpacing: config.attachmentSpacing,
                                interconnectionMethod: config.interconnectionMethod ?? 'LOAD_SIDE',
                                panelBusRating: config.panelBusRating ?? config.mainPanelAmps ?? 200,
                                batteryBrand: config.batteryBrand, batteryModel: config.batteryModel,
                                batteryCount: config.batteryCount, batteryKwh: config.batteryKwh,
                                batteryBackfeedA: calcBatteryBackfeedAmps(config.batteryId, config.batteryCount),
                                generatorBrand: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.manufacturer ?? ''; })() : undefined,
                                generatorKw: config.generatorId ? (() => { const g = getGeneratorById(config.generatorId); return g?.ratedOutputKw ?? 0; })() : undefined,
                                atsBrand: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.manufacturer ?? ''; })() : undefined,
                                atsAmpRating: config.atsId ? (() => { const a = getATSById(config.atsId); return a?.ampRating ?? 0; })() : undefined,
                                city: config.city || '', state: config.state || '', zip: config.zip || '', county: config.county || '',
                                panelVoc: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.voc : undefined; })(),
                                panelIsc: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.isc : undefined; })(),
                                panelWeightLbs: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.weightLbs : undefined; })(),
                                panelLengthIn: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.lengthIn : undefined; })(),
                                panelWidthIn: (() => { const p0 = config.inverters?.[0]?.strings?.[0]; return p0 ? (getPanelById(p0.panelId) as any)?.widthIn : undefined; })(),
                                ...(projectLayout?.panels && projectLayout.panels.length > 0 ? {
                                  panelPositions: projectLayout.panels.map((p: any) => ({
                                    id: p.id, lat: p.lat, lng: p.lng, x: p.x, y: p.y,
                                    tilt: p.tilt, azimuth: p.azimuth, wattage: p.wattage,
                                    row: p.row, col: p.col, systemType: p.systemType, orientation: p.orientation,
                                    arrayId: (p as any).arrayId,
                                  })),
                                  roofPlanes: (projectLayout?.roofPlanes || []).map((rp: any) => ({
                                    id: rp.id, vertices: rp.vertices || [],
                                    pitch: rp.pitch, azimuth: rp.azimuth, area: rp.area,
                                  })),
                                } : {}),
                              },
                              system: {
                                totalDcKw: parseFloat(projectLayout?.panels?.length > 0 ? (projectLayout.panels.length * 0.4).toFixed(2) : totalKw),
                                totalAcKw: parseFloat(totalInverterKw),
                                totalPanels: projectLayout?.panels?.length > 0 ? projectLayout.panels.length : totalPanels,
                                dcAcRatio: parseFloat(projectLayout?.panels?.length > 0 ? (projectLayout.panels.length * 0.4).toFixed(2) : totalKw) / (parseFloat(totalInverterKw) || 1),
                                topology: topologyType,
                                inverters: config.inverters.map(inv => {
                                  const invData = getInvById(inv.inverterId, inv.type) as any;
                                  return { manufacturer: invData?.manufacturer || '', model: invData?.model || '', type: inv.type, acOutputKw: invData?.acOutputKw || (invData?.acOutputW/1000) || 0, maxDcVoltage: invData?.maxDcVoltage || 480, efficiency: invData?.efficiency || 97, ulListing: invData?.ulListing || 'UL 1741', strings: inv.strings.map(str => { const panel = getPanelById(str.panelId) as any; return { label: str.label, panelCount: str.panelCount, panelManufacturer: panel?.manufacturer || '', panelModel: panel?.model || '', panelWatts: panel?.watts || 400, panelVoc: panel?.voc || 41.6, panelIsc: panel?.isc || 12.26, wireGauge: str.wireGauge, wireLength: str.wireLength }; }) };
                                }),
                              },
                              compliance, rulesResult, bom, overrides,
                              layout: projectLayout ? (() => {
                                const layoutSys2 = (projectLayout.systemType || '') as string;
                                const configSys2 = (config.systemType as string) || '';
                                const effectiveSys2 = (layoutSys2 === 'fence' || layoutSys2 === 'solar_fence' || layoutSys2 === 'ground' || layoutSys2 === 'ground_mount')
                                  ? layoutSys2
                                  : (configSys2 === 'fence' || configSys2 === 'solar_fence' || configSys2 === 'ground' || configSys2 === 'ground_mount')
                                    ? configSys2
                                    : layoutSys2 || configSys2 || 'roof';
                                const resolvedType2 = (effectiveSys2 === 'fence' || effectiveSys2 === 'solar_fence') ? 'solar_fence'
                                  : (effectiveSys2 === 'ground' || effectiveSys2 === 'ground_mount') ? 'ground_mount'
                                  : 'roof';
                                return {
                                  type: resolvedType2,
                                  systemType: effectiveSys2,
                                  fenceLine: projectLayout.fenceLine || undefined,
                                  fenceSegments: projectLayout.fenceLine?.length > 1
                                    ? projectLayout.fenceLine.slice(0, -1).map((pt: any, i: number) => {
                                        const ep = projectLayout.fenceLine[i + 1];
                                        const DEG2RAD = Math.PI / 180;
                                        const EARTH_R = 6_371_000;
                                        const cosLat  = Math.cos(pt.lat * DEG2RAD);
                                        const dx = (ep.lng - pt.lng) * DEG2RAD * cosLat * EARTH_R;
                                        const dy = (ep.lat - pt.lat) * DEG2RAD * EARTH_R;
                                        const lenM   = Math.sqrt(dx * dx + dy * dy);
                                        const lenFt  = Math.round(lenM * 3.28084 * 10) / 10;
                                        const az     = Math.round(((Math.atan2(dx, dy) * 180 / Math.PI) + 360) % 360);
                                        return { id: `seg-${i}`, startPoint: pt, endPoint: ep, lengthFt: lenFt, azimuth: az, panelCount: 0 };
                                      })
                                    : undefined,
                                  groundArrays: (effectiveSys2 === 'ground' || effectiveSys2 === 'ground_mount') ? [{ id: 'ground-1' }] : undefined,
                                  panels: (projectLayout.panels || []).map((p: any) => ({
                                    id: p.id, lat: p.lat, lng: p.lng, x: p.x, y: p.y,
                                    systemType: p.systemType || p.placementType || undefined,
                                  })),
                                }; })() : undefined,
                            };
                            const res = await fetch('/api/engineering/permit?format=html', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(permitInput),
                            });
                            if (res.ok) {
                              const html = await res.text();
                              const win = window.open('', '_blank');
                              if (win) { win.document.write(html); win.document.close(); }
                            } else if (res.status === 422) {
                              const errData = await res.json().catch(() => ({}));
                              if (errData.code === 'ENGINEERING_MODEL_STALE') {
                                alert(`⚠️ Permit Blocked — Stale Engineering Model\n\n${errData.message ?? 'Panel count is 0. Please open the Engineering page, wait for the pipeline sync to complete, then try again.'}`);
                              } else {
                                alert(`Permit preview failed (422): ${errData.message ?? 'Unknown error'}`);
                              }
                            } else {
                              const errText = await res.text().catch(() => '');
                              alert(`Permit preview failed (${res.status}). Please check the console for details.\n\n${errText.slice(0, 200)}`);
                            }
                          }}
                          className="btn-secondary w-full flex items-center justify-center gap-2 mt-2"
                        >
                          <Eye size={16} /> Preview in Browser
                        </button>
                      </div>
                    </div>

                  </div>

                </div>
              );
            })())}"""

# ─────────────────────────────────────────────────────────────────────────────
# BOM TAB V2 — expand max-w-none, minor density improvements, keep all logic
# ─────────────────────────────────────────────────────────────────────────────
# BOM is already well-designed; just ensure max-w-none and add a header hero
BOM_V2 = BOM_EXISTING
# Replace the plain header with an enhanced hero strip
BOM_V2 = BOM_V2.replace(
    """                  <div className="space-y-5">

                  {/* ── HEADER BAR ── */}
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Grid size={14} className="text-violet-400" />
                        Bill of Materials
                        <span className="text-xs font-normal bg-violet-500/15 text-violet-300 border border-violet-500/25 px-2 py-0.5 rounded-full">Auto-Sourced · Distributor Priced</span>
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Derived from inverter ecosystem · mounting system · conduit type · jurisdiction · CED/Soligent/KWh pricing
                      </p>
                    </div>
                    <div className="flex items-center gap-2">""",
    """                  <div className="space-y-5">

                  {/* ── BOM HERO ── */}
                  <div className="relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-800/80 via-slate-800/60 to-slate-900/80 p-5 shadow-xl">
                    <div className="absolute -top-8 -right-8 w-36 h-36 bg-violet-500/5 rounded-full blur-3xl pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/20 to-transparent" />
                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div>
                        <h2 className="text-base font-black text-white flex items-center gap-2">
                          <Grid size={16} className="text-violet-400" />
                          Bill of Materials
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Derived from inverter ecosystem · mounting system · conduit type · jurisdiction · CED/Soligent/KWh pricing
                        </p>
                      </div>
                      <div className="flex items-center gap-2">""",
    1
)
# Close the hero div after the export/generate buttons section
BOM_V2 = BOM_V2.replace(
    """                       <button onClick={fetchBOM} disabled={bomLoading} className="btn-primary btn-sm">
                         <RefreshCw size={13} className={bomLoading ? 'animate-spin' : ''} />
                         {bomLoading ? 'Generating…' : bom.length > 0 ? 'Regenerate' : 'Generate BOM'}
                       </button>
                     </div>
                   </div>""",
    """                       <button onClick={fetchBOM} disabled={bomLoading} className="btn-primary btn-sm">
                         <RefreshCw size={13} className={bomLoading ? 'animate-spin' : ''} />
                         {bomLoading ? 'Generating…' : bom.length > 0 ? 'Regenerate' : 'Generate BOM'}
                       </button>
                     </div>
                    </div>
                    {/* BOM summary chips */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700/50 bg-slate-800/60 text-slate-400">
                        {bom.length} line items · {totalKw} kW DC · {totalPanels} panels
                      </div>
                      {bomPricing?.pricingApplied && (
                        <div className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400 font-semibold">
                          <DollarSign size={10} /> ${bomPricing.totalBomCost.toLocaleString('en-US', { maximumFractionDigits: 0 })} est.
                        </div>
                      )}
                    </div>
                  </div>
                   </div>""",
    1
)

# ─────────────────────────────────────────────────────────────────────────────
# FILES TAB V2 — expand to max-w-none, add artifact status cards header
# Keep ALL pipeline logic, file list, upload handlers
# ─────────────────────────────────────────────────────────────────────────────
FILES_V2 = FILES_EXISTING.replace(
    '<div className="max-w-4xl space-y-4">',
    '<div className="max-w-none space-y-4">',
    1
)
print("✅ Files tab: max-w-4xl → max-w-none")

# ─────────────────────────────────────────────────────────────────────────────
# Apply replacements back to front
# ─────────────────────────────────────────────────────────────────────────────
# Files last (latest in file)
new_content = content[:FILES_START] + FILES_V2 + content[FILES_END:]

# BOM
# Need to find BOM again in new_content (positions unchanged since FILES is after BOM)
bom_start2  = new_content.find("{activeTab === 'bom' && (!canBOM ? (")
bom_end_frag = "{/* ── CLIENT FILES TAB"
bom_end_search = new_content.find(bom_end_frag, bom_start2)
bom_chunk = new_content[bom_start2:bom_end_search]
bom_last_close = bom_chunk.rfind(')}')
bom_end2 = bom_start2 + bom_last_close + 2
new_content2 = new_content[:bom_start2] + BOM_V2 + new_content[bom_end2:]

# Permit
permit_start2  = new_content2.find("{activeTab === 'permit' && (!canPermit ? (")
permit_end_frag = "{/* ── BOM TAB"
permit_end_search = new_content2.find(permit_end_frag, permit_start2)
permit_chunk = new_content2[permit_start2:permit_end_search]
permit_last_close = permit_chunk.rfind(')}')
permit_end2 = permit_start2 + permit_last_close + 2
new_content3 = new_content2[:permit_start2] + PERMIT_V2 + new_content2[permit_end2:]

# Verify key references preserved
assert 'handleGeneratePermitPackage' in new_content3, "❌ handleGeneratePermitPackage missing"
assert 'fetchBOM' in new_content3, "❌ fetchBOM missing"
assert 'projectFiles' in new_content3, "❌ projectFiles missing"
assert 'pipelineResult' in new_content3, "❌ pipelineResult missing"
assert 'pvwattsData' in new_content3, "❌ pvwattsData missing"
assert 'canPermit' in new_content3, "❌ canPermit gate missing"
assert 'canBOM' in new_content3, "❌ canBOM gate missing"

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(new_content3)

print(f"✅ Written: {len(new_content3):,} total chars")
print(f"   Permit V2: {len(PERMIT_V2):,} chars (was {PERMIT_END - PERMIT_START:,})")
print(f"   BOM V2:    {len(BOM_V2):,} chars (was {BOM_END - BOM_START:,})")
print(f"   Files V2:  {len(FILES_V2):,} chars (was {FILES_END - FILES_START:,})")
print("✅ build_tabs_v56c.py done.")