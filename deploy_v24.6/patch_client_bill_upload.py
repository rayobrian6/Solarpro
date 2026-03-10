with open('app/clients/new/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── Patch 1: Add Upload icon to imports ─────────────────────────────────────
old_import = "import { ArrowLeft, User, Mail, Phone, MapPin, Zap, DollarSign, Calculator, CheckCircle, Loader, Search, X } from 'lucide-react';"
new_import = "import { ArrowLeft, User, Mail, Phone, MapPin, Zap, DollarSign, Calculator, CheckCircle, Loader, Search, X, Upload, FileText, Sparkles } from 'lucide-react';"

if old_import in content:
    content = content.replace(old_import, new_import)
    print('✅ Added Upload/FileText/Sparkles icons to imports')
else:
    print('❌ Could not find lucide-react import')

# ─── Patch 2: Add bill upload state variables ─────────────────────────────────
# Find the saving/geocoding state declarations
old_state = "  const [step, setStep] = useState(1);\n  const [saving, setSaving] = useState(false);\n  const [geocoding, setGeocoding] = useState(false);"
new_state = """  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  // Bill upload state
  const [billUploading, setBillUploading] = useState(false);
  const [billParseResult, setBillParseResult] = useState<{
    annualKwh: number | null;
    monthlyKwh: number | null;
    electricityRate: number | null;
    utilityName: string | null;
    stateCode: string | null;
    confidence: 'high' | 'medium' | 'low';
    message?: string;
  } | null>(null);
  const [billFileName, setBillFileName] = useState<string | null>(null);
  const billInputRef = useRef<HTMLInputElement>(null);"""

if old_state in content:
    content = content.replace(old_state, new_state)
    print('✅ Added bill upload state variables')
else:
    print('❌ Could not find state declarations')

# ─── Patch 3: Add handleBillUpload function before handleNextFromStep1 ────────
old_handle_next = "  // Auto-geocode when moving from step 1 to step 2\n  const handleNextFromStep1 = async () => {"
new_handle_next = """  // ── Bill PDF upload handler ────────────────────────────────────────────────
  const handleBillUpload = async (file: File) => {
    if (!file) return;
    setBillUploading(true);
    setBillFileName(file.name);
    setBillParseResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/engineering/parse-bill', {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (data.success && data.data) {
        const parsed = data.data;
        setBillParseResult(parsed);
        // Auto-fill form fields from parsed data
        if (parsed.utilityName) set('utilityProvider', parsed.utilityName);
        if (parsed.electricityRate) set('utilityRate', String(parsed.electricityRate));
        if (parsed.monthlyKwh && parsed.monthlyKwh > 0) {
          set('annualKwh', String(parsed.annualKwh || parsed.monthlyKwh * 12));
          set('inputMode', 'average');
        }
        if (parsed.stateCode && !form.state) set('state', parsed.stateCode);
      }
    } catch (err) {
      console.error('[BillUpload] Parse failed:', err);
    } finally {
      setBillUploading(false);
    }
  };

  // Auto-geocode when moving from step 1 to step 2
  const handleNextFromStep1 = async () => {"""

if old_handle_next in content:
    content = content.replace(old_handle_next, new_handle_next)
    print('✅ Added handleBillUpload function')
else:
    print('❌ Could not find handleNextFromStep1')

# ─── Patch 4: Add bill upload UI at the top of Step 2 ────────────────────────
# Find the Step 2 section header
old_step2_header = """        {/* Step 2: Utility Data */}
        {step === 2 && (
          <div className="card p-5 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Utility & Energy Data</h2>
            </div>"""

new_step2_header = """        {/* Step 2: Utility Data */}
        {step === 2 && (
          <div className="card p-5 space-y-5">
            <div className="flex items-center gap-2 mb-1">
              <Zap size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Utility & Energy Data</h2>
            </div>

            {/* Bill Upload Section */}
            <div className="rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                  <FileText size={16} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-white text-sm mb-0.5">Upload Utility Bill (PDF)</div>
                  <div className="text-xs text-slate-400 mb-3">
                    Auto-extract kWh usage, rate, and utility name from your bill PDF
                  </div>
                  <input
                    ref={billInputRef}
                    type="file"
                    accept=".pdf,.txt"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) handleBillUpload(f);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => billInputRef.current?.click()}
                    disabled={billUploading}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400 text-xs font-medium hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {billUploading ? (
                      <><span className="spinner w-3 h-3" /> Parsing bill...</>
                    ) : (
                      <><Upload size={13} /> {billFileName ? 'Replace Bill' : 'Choose PDF'}</>
                    )}
                  </button>
                  {billFileName && !billUploading && (
                    <span className="ml-2 text-xs text-slate-400">{billFileName}</span>
                  )}
                </div>
              </div>

              {/* Parse result banner */}
              {billParseResult && !billUploading && (
                <div className={`mt-3 rounded-lg p-3 border text-xs ${
                  billParseResult.confidence === 'high'
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                    : billParseResult.confidence === 'medium'
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      : 'bg-slate-700/50 border-slate-600 text-slate-400'
                }`}>
                  {billParseResult.message ? (
                    <span>{billParseResult.message}</span>
                  ) : (
                    <div className="flex items-start gap-2">
                      <Sparkles size={13} className="flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">
                          {billParseResult.confidence === 'high' ? '✅ Bill parsed successfully' :
                           billParseResult.confidence === 'medium' ? '⚡ Partial data extracted' :
                           '⚠️ Limited data found'}
                        </span>
                        <div className="mt-1 space-y-0.5 text-slate-300">
                          {billParseResult.utilityName && <div>Utility: {billParseResult.utilityName}</div>}
                          {billParseResult.monthlyKwh && <div>Monthly usage: {billParseResult.monthlyKwh.toLocaleString()} kWh</div>}
                          {billParseResult.electricityRate && <div>Rate: ${billParseResult.electricityRate}/kWh</div>}
                          {billParseResult.stateCode && <div>State: {billParseResult.stateCode}</div>}
                        </div>
                        <div className="mt-1 text-slate-500">Fields auto-filled below — review and adjust as needed.</div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>"""

if old_step2_header in content:
    content = content.replace(old_step2_header, new_step2_header)
    print('✅ Added bill upload UI to Step 2')
else:
    # Try a simpler match
    simple_old = '        {/* Step 2: Utility Data */}\n        {step === 2 && ('
    if simple_old in content:
        print('⚠️ Found step 2 marker but full block did not match — trying simpler approach')
        # Find the exact text
        idx = content.find('        {/* Step 2: Utility Data */}')
        if idx >= 0:
            print(f'  Found at index {idx}')
            print(repr(content[idx:idx+200]))
    else:
        print('❌ Could not find Step 2 section')

with open('app/clients/new/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')