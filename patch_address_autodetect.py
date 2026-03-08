#!/usr/bin/env python3
"""
Patch app/engineering/page.tsx to:
1. Auto-detect state from address string when address field loses focus (onBlur)
2. Auto-detect utility from state when state changes
"""

ENG_FILE = 'app/engineering/page.tsx'

with open(ENG_FILE, 'r') as f:
    content = f.read()

# ── 1. Add parseStateFromAddress helper after imports ──────────────────────────
# Find a good insertion point — after the last import line
HELPER_CODE = '''
// ── Auto-detect state + utility from address string ──────────────────────────
function parseStateFromAddress(address: string): string | null {
  if (!address) return null;
  // Match "City, ST 12345" or "City, ST" or ", ST " patterns
  const stateAbbrevMatch = address.match(/,\\s*([A-Z]{2})(?:\\s+\\d{5})?(?:\\s*,|\\s*$)/);
  if (stateAbbrevMatch) {
    const code = stateAbbrevMatch[1];
    const validStates = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID',
      'IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV',
      'NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
      'VT','VA','WA','WV','WI','WY','DC'];
    if (validStates.includes(code)) return code;
  }
  // Match full state names
  const stateNames: Record<string, string> = {
    'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
    'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
    'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
    'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
    'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
    'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
    'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
    'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
    'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
    'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
    'district of columbia':'DC','washington dc':'DC','washington d.c.':'DC',
  };
  const lower = address.toLowerCase();
  for (const [name, code] of Object.entries(stateNames)) {
    if (lower.includes(name)) return code;
  }
  return null;
}

function parseCityFromAddress(address: string): string | null {
  if (!address) return null;
  // "123 Main St, Chicago, IL 60601" → "Chicago"
  const parts = address.split(',').map(p => p.trim());
  if (parts.length >= 2) {
    // Second-to-last part before state is usually city
    const cityPart = parts[parts.length - 2];
    if (cityPart && !/^\\d/.test(cityPart)) return cityPart;
  }
  return null;
}
'''

# Insert after the last import statement
last_import_idx = content.rfind('\nimport ')
if last_import_idx == -1:
    print("ERROR: Could not find import statements")
    exit(1)

# Find end of that import line
end_of_import = content.find('\n', last_import_idx + 1)
if end_of_import == -1:
    print("ERROR: Could not find end of last import")
    exit(1)

# Check if helper already exists
if 'parseStateFromAddress' in content:
    print("ℹ️  parseStateFromAddress already exists, skipping helper insertion")
else:
    content = content[:end_of_import + 1] + HELPER_CODE + content[end_of_import + 1:]
    print("✅ Added parseStateFromAddress helper")

# ── 2. Add onBlur handler to address input ────────────────────────────────────
# Find the address input field
OLD_ADDRESS_INPUT = '''{ label: 'Address', key: 'address', placeholder: 'e.g. 123 Main St, Austin, TX 78701' },'''

# We need to find the address input and add onBlur to it
# The address field is rendered in a generic map, so we need to handle it specially
# Find the generic input rendering and add special handling for address field

OLD_GENERIC_INPUT = '''                    <div key={f.key}>
                      <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
                      <input type={f.type || 'text'} value={(config as any)[f.key]} placeholder={f.placeholder || ''}
                        onChange={e => updateConfig({ [f.key]: e.target.value } as any)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                    </div>'''

NEW_GENERIC_INPUT = '''                    <div key={f.key}>
                      <label className="text-xs text-slate-400 mb-1 block">{f.label}</label>
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
                            // Auto-select first utility for detected state
                            const utils = getUtilitiesByStateNational(detectedState);
                            if (utils.length > 0 && !config.utilityId) {
                              updates.utilityId = utils[0].id;
                            }
                            updateConfig(updates);
                          }
                        } : undefined}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500/60" />
                    </div>'''

if OLD_GENERIC_INPUT in content:
    content = content.replace(OLD_GENERIC_INPUT, NEW_GENERIC_INPUT)
    print("✅ Added onBlur address auto-detect to address input")
else:
    print("⚠️  Could not find generic input block — trying alternate approach")
    # Try to find it with different whitespace
    import re
    pattern = r'<div key=\{f\.key\}>\s*<label[^>]*>\{f\.label\}</label>\s*<input[^/]*/>'
    matches = list(re.finditer(pattern, content, re.DOTALL))
    print(f"Found {len(matches)} input blocks")
    if matches:
        print(f"First match: {content[matches[0].start():matches[0].start()+200]}")

# ── 3. Add auto-detect indicator below address field ─────────────────────────
# Find the State selector and add a small "auto-detected" badge when state was auto-set
OLD_STATE_LABEL = '''                    <label className="text-xs text-slate-400 mb-1 block">State / Jurisdiction</label>
                    <select value={config.state} onChange={e => updateConfig({ state: e.target.value })}'''

NEW_STATE_LABEL = '''                    <label className="text-xs text-slate-400 mb-1 block flex items-center gap-2">
                      State / Jurisdiction
                      {config.state && config.address && parseStateFromAddress(config.address) === config.state && (
                        <span className="text-emerald-400 text-xs font-normal">✓ auto-detected</span>
                      )}
                    </label>
                    <select value={config.state} onChange={e => {
                      const newState = e.target.value;
                      const updates: any = { state: newState, utilityId: '' };
                      // Auto-select first utility when state changes
                      const utils = getUtilitiesByStateNational(newState);
                      if (utils.length > 0) updates.utilityId = utils[0].id;
                      updateConfig(updates);
                    }}'''

if OLD_STATE_LABEL in content:
    content = content.replace(OLD_STATE_LABEL, NEW_STATE_LABEL)
    print("✅ Added auto-detect badge + auto-utility-select on state change")
else:
    print("⚠️  Could not find state label block")

with open(ENG_FILE, 'w') as f:
    f.write(content)

print("\n✅ Engineering page patched with address auto-detect")