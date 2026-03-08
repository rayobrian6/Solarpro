with open('app/engineering/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add city/county to ProjectConfig interface
old_config_state = "  state: string;          // Explicit state code (e.g. 'CA', 'TX') — overrides address parsing"
new_config_state = """  state: string;          // Explicit state code (e.g. 'CA', 'TX') — overrides address parsing
  city: string;           // City name — used for AHJ city-level overrides
  county: string;         // County name — used for AHJ county-level overrides"""

if old_config_state in content:
    content = content.replace(old_config_state, new_config_state, 1)
    print("✓ Added city/county to ProjectConfig")
else:
    print("✗ Could not find ProjectConfig state field")

# 2. Add city/county to defaultConfig
old_default = "  projectName: 'Solar Installation', clientName: '', address: '', state: '', designer: '',"
new_default = "  projectName: 'Solar Installation', clientName: '', address: '', state: '', city: '', county: '', designer: '',"

if old_default in content:
    content = content.replace(old_default, new_default, 1)
    print("✓ Added city/county to defaultConfig")
else:
    print("✗ Could not find defaultConfig")

# 3. Add lookupAhj import after existing imports
old_import = "import { getUtilitiesByState } from '@/lib/utility-rules';"
new_import = """import { getUtilitiesByState } from '@/lib/utility-rules';
import { lookupAhj } from '@/lib/jurisdictions/ahj';"""

if old_import in content:
    content = content.replace(old_import, new_import, 1)
    print("✓ Added lookupAhj import")
else:
    print("✗ Could not find utility-rules import")

# 4. Add ahjInfo state and useEffect after the compliance state
# Find the compliance state declaration
old_compliance_state = "  const [compliance, setCompliance] = useState<ComplianceResult>({ overallStatus: null });"
new_compliance_state = """  const [compliance, setCompliance] = useState<ComplianceResult>({ overallStatus: null });
  const [ahjInfo, setAhjInfo] = useState<any>(null);

  // Auto-lookup AHJ when state/city/county changes
  useEffect(() => {
    if (!config.state) { setAhjInfo(null); return; }
    const result = lookupAhj(config.state, config.county || '', config.city || '');
    if (result.success && result.ahj) {
      setAhjInfo(result.ahj);
    } else {
      setAhjInfo(null);
    }
  }, [config.state, config.city, config.county]);"""

if old_compliance_state in content:
    content = content.replace(old_compliance_state, new_compliance_state, 1)
    print("✓ Added ahjInfo state + useEffect")
else:
    print("✗ Could not find compliance state")
    # Try to find it
    idx = content.find('useState<ComplianceResult>')
    if idx >= 0:
        print(f"  Found ComplianceResult at {idx}: {repr(content[idx-20:idx+80])}")

# 5. Add city/county fields in the config panel (after the state selector)
old_state_selector_end = """                  {/* Utility Selector — filtered by state, persisted to project */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Utility Provider</label>"""

new_state_selector_end = """                  {/* City + County for AHJ override */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">City</label>
                      <input
                        type="text"
                        value={config.city || ''}
                        onChange={e => updateConfig({ city: e.target.value })}
                        placeholder="e.g. Austin"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400 mb-1 block">County</label>
                      <input
                        type="text"
                        value={config.county || ''}
                        onChange={e => updateConfig({ county: e.target.value })}
                        placeholder="e.g. Travis"
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60"
                      />
                    </div>
                  </div>

                  {/* AHJ Auto-Detected Info */}
                  {ahjInfo && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin size={12} className="text-amber-400" />
                        <span className="text-xs font-bold text-amber-400">{ahjInfo.ahjName}</span>
                        <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded-full">{ahjInfo.necVersion}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-500">Permit Fee:</span>
                          <span className="text-slate-300 ml-1">{ahjInfo.typicalPermitFee}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Permit Days:</span>
                          <span className="text-slate-300 ml-1">{ahjInfo.typicalPermitDays}d</span>
                        </div>
                        <div>
                          <span className="text-slate-500">Rapid Shutdown:</span>
                          <span className={`ml-1 ${ahjInfo.rapidShutdownRequired ? 'text-amber-400' : 'text-emerald-400'}`}>
                            {ahjInfo.rapidShutdownRequired ? 'Required' : 'Not Required'}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500">Roof Setback:</span>
                          <span className="text-slate-300 ml-1">{ahjInfo.roofSetbackInches}"</span>
                        </div>
                      </div>
                      {ahjInfo.localAmendments?.length > 0 && (
                        <div className="mt-2 text-xs text-slate-400">
                          <span className="font-semibold text-slate-300">Local Amendments: </span>
                          {ahjInfo.localAmendments.slice(0, 2).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Utility Selector — filtered by state, persisted to project */}
                  <div>
                    <label className="text-xs text-slate-400 mb-1 block">Utility Provider</label>"""

if old_state_selector_end in content:
    content = content.replace(old_state_selector_end, new_state_selector_end, 1)
    print("✓ Added city/county fields + AHJ info panel")
else:
    print("✗ Could not find state selector end anchor")
    idx = content.find('Utility Selector')
    if idx >= 0:
        print(f"  Found 'Utility Selector' at {idx}: {repr(content[max(0,idx-100):idx+100])}")

with open('app/engineering/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")