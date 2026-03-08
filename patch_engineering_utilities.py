# Step 1: Add getUtilitiesByStateNational() to utilityDetector.ts
with open('lib/utilityDetector.ts', 'r', encoding='utf-8') as f:
    content = f.read()

append_code = """
// ── National utility list by state (for dropdowns) ────────────────────────────
export interface UtilityOption {
  id: string;
  name: string;
  avgRatePerKwh: number;
  netMeteringEligible: boolean;
  netMeteringPolicy: string;
  netMeteringMaxKw: number;
  exportRate: number;
  interconnectionMaxKw: number;
}

export function getUtilitiesByStateNational(stateCode: string): UtilityOption[] {
  const fallback = STATE_UTILITY_FALLBACK[stateCode];
  if (!fallback) return [];
  return fallback.majorUtilities.map((name, i) => ({
    id: `${stateCode.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}`,
    name,
    avgRatePerKwh: fallback.avgRate,
    netMeteringEligible: fallback.netMetering,
    netMeteringPolicy: fallback.netMeteringPolicy,
    netMeteringMaxKw: fallback.netMeteringMaxKw,
    exportRate: fallback.exportRate,
    interconnectionMaxKw: fallback.interconnectionMaxKw,
  }));
}
"""

if 'getUtilitiesByStateNational' not in content:
    content += append_code
    with open('lib/utilityDetector.ts', 'w', encoding='utf-8') as f:
        f.write(content)
    print("✓ Added getUtilitiesByStateNational() to utilityDetector.ts")
else:
    print("✓ getUtilitiesByStateNational() already exists")

# Step 2: Update engineering page to import and use the new function
with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    eng = f.read()

# Add import for getUtilitiesByStateNational
old_import = "import { getUtilitiesByState } from '@/lib/utility-rules';"
new_import = """import { getUtilitiesByState } from '@/lib/utility-rules';
import { getUtilitiesByStateNational, STATE_UTILITY_FALLBACK } from '@/lib/utilityDetector';"""

if old_import in eng:
    eng = eng.replace(old_import, new_import, 1)
    print("✓ Added getUtilitiesByStateNational import to engineering page")
else:
    print("✗ Could not find utility-rules import")

# Replace the utility dropdown to use national data when state is selected
old_utility_dropdown = """                  {/* Utility Selector — filtered by state, persisted to project */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Utility Provider</label>
                    <select
                      value={config.utilityId}
                      onChange={e => updateConfig({ utilityId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
                      <option value="">— Manual / Unknown —</option>
                      {getUtilitiesByState(config.state || '').map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    {config.utilityId && (
                      <div className="text-xs text-slate-500 mt-1">
                        {(() => {
                          const utils = getUtilitiesByState(config.state || '');
                          const u = utils.find(x => x.id === config.utilityId);
                          return u ? `Net metering: ${u.netMeteringProgram || 'Standard'} · ${u.requiresSmartInverter ? 'Smart inverter required' : 'Standard inverter OK'}` : '';
                        })()}
                      </div>
                    )}
                  </div>"""

new_utility_dropdown = """                  {/* Utility Selector — national data from utilityDetector.ts (all 50 states) */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Utility Provider</label>
                    <select
                      value={config.utilityId}
                      onChange={e => updateConfig({ utilityId: e.target.value })}
                      className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                    >
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
                        <div className="text-xs text-slate-400 mt-1.5 space-y-0.5">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-500">Avg Rate:</span>
                            <span className="text-amber-400 font-medium">${stateData.avgRate.toFixed(3)}/kWh</span>
                            <span className="text-slate-500">Net Metering:</span>
                            <span className={stateData.netMetering ? 'text-emerald-400' : 'text-red-400'}>
                              {stateData.netMetering ? '✓ Eligible' : '✗ Not Available'}
                            </span>
                          </div>
                          <div className="text-slate-500 text-xs">{stateData.netMeteringPolicy}</div>
                          <div className="text-slate-500 text-xs">Max system: {stateData.interconnectionMaxKw} kW · Export rate: ${stateData.exportRate.toFixed(3)}/kWh</div>
                        </div>
                      );
                    })()}
                  </div>"""

if old_utility_dropdown in eng:
    eng = eng.replace(old_utility_dropdown, new_utility_dropdown, 1)
    print("✓ Updated utility dropdown to use national data")
else:
    print("✗ Could not find utility dropdown anchor")
    idx = eng.find('Utility Selector')
    if idx >= 0:
        print(repr(eng[idx:idx+400]))

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(eng)

print(f"Done. Engineering page lines: {len(eng.splitlines())}")