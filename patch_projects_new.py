with open('app/projects/new/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add new imports after existing imports
old_imports = "import { useAppStore } from '@/store/appStore';"
new_imports = """import { useAppStore } from '@/store/appStore';
import { MapPin, Upload, Zap, Building2, Loader2, CheckCircle } from 'lucide-react';
import BillUploadFlow from '@/components/onboarding/BillUploadFlow';"""
content = content.replace(old_imports, new_imports, 1)

# 2. Add location state after existing state declarations
old_state = "  const [saving, setSaving] = useState(false);"
new_state = """  const [saving, setSaving] = useState(false);
  const [showBillUpload, setShowBillUpload] = useState(false);
  const [address, setAddress] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [locationData, setLocationData] = useState<{
    city: string; county: string; state: string; stateCode: string;
    zip: string; lat: number; lng: number;
  } | null>(null);
  const [utilityData, setUtilityData] = useState<{
    utilityName: string; avgRatePerKwh: number; netMeteringEligible: boolean;
  } | null>(null);
  const [billSystemKw, setBillSystemKw] = useState<number | null>(null);"""
content = content.replace(old_state, new_state, 1)

# 3. Add geocode function after the auto-generate name useEffect
old_effect = "  const handleSubmit = async () => {"
new_geocode = """  // Auto-geocode address and detect utility
  const handleAddressBlur = async () => {
    if (!address.trim() || geocoding) return;
    setGeocoding(true);
    try {
      const res = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });
      const geo = await res.json();
      if (geo.success && geo.location) {
        setLocationData(geo.location);
        // Auto-detect utility
        const uRes = await fetch('/api/utility-detect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: geo.location.lat,
            lng: geo.location.lng,
            stateCode: geo.location.stateCode,
            city: geo.location.city,
          }),
        });
        const uData = await uRes.json();
        if (uData.success && uData.utility) {
          setUtilityData(uData.utility);
        }
      }
    } catch {}
    setGeocoding(false);
  };

  const handleBillUploadComplete = (result: any) => {
    if (result.locationData) setLocationData(result.locationData);
    if (result.utilityData) setUtilityData(result.utilityData);
    if (result.systemKw) setBillSystemKw(result.systemKw);
    if (result.billData?.serviceAddress) setAddress(result.billData.serviceAddress);
    setShowBillUpload(false);
    toast.success('Bill processed!', 'Location, utility, and system size auto-populated');
  };

  const handleSubmit = async () => {"""
content = content.replace(old_effect, new_geocode, 1)

# 4. Pass location data to project creation
old_project_create = """      const project = await addProject({
        clientId: selectedClient,
        name,
        systemType: selectedType,
        notes,"""
new_project_create = """      const project = await addProject({
        clientId: selectedClient,
        name,
        systemType: selectedType,
        notes,
        address: address || undefined,
        lat: locationData?.lat,
        lng: locationData?.lng,
        stateCode: locationData?.stateCode,
        city: locationData?.city,
        county: locationData?.county,
        zip: locationData?.zip,
        utilityName: utilityData?.utilityName,
        utilityRatePerKwh: utilityData?.avgRatePerKwh,"""
content = content.replace(old_project_create, new_project_create, 1)

# 5. Add address field + bill upload button + location display in the form
# Find the notes textarea section and add address before it
old_notes = """              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes (optional)</label>"""
new_address_section = """              {/* Bill Upload shortcut */}
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Upload size={15} className="text-amber-400" />
                    <div>
                      <p className="text-white text-sm font-medium">Upload Electric Bill</p>
                      <p className="text-slate-400 text-xs">Auto-detect utility, location & system size</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowBillUpload(!showBillUpload)}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    {showBillUpload ? 'Hide' : 'Upload Bill'}
                  </button>
                </div>
                {showBillUpload && (
                  <div className="mt-4">
                    <BillUploadFlow
                      onComplete={handleBillUploadComplete}
                      onClose={() => setShowBillUpload(false)}
                    />
                  </div>
                )}
              </div>

              {/* Address field */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  <MapPin size={13} className="inline mr-1 text-slate-400" />
                  Project Address
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    onBlur={handleAddressBlur}
                    placeholder="123 Main St, City, ST 12345"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500/50 pr-10"
                  />
                  {geocoding && (
                    <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 animate-spin" />
                  )}
                  {locationData && !geocoding && (
                    <CheckCircle size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />
                  )}
                </div>
                {locationData && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5 text-xs text-emerald-300">
                      <MapPin size={10} /> {locationData.city}, {locationData.stateCode} {locationData.zip}
                    </span>
                    {utilityData && (
                      <span className="inline-flex items-center gap-1 bg-blue-500/10 border border-blue-500/20 rounded-full px-2 py-0.5 text-xs text-blue-300">
                        <Zap size={10} /> {utilityData.utilityName} · ${utilityData.avgRatePerKwh.toFixed(3)}/kWh
                      </span>
                    )}
                    {utilityData?.netMeteringEligible && (
                      <span className="inline-flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 text-xs text-amber-300">
                        ✓ Net Metering Eligible
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">Notes (optional)</label>"""
content = content.replace(old_notes, new_address_section, 1)

with open('app/projects/new/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done. Lines:", len(content.splitlines()))