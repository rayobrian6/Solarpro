'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import AppShell from '@/components/ui/AppShell';
import { useRouter } from 'next/navigation';
import { ArrowLeft, User, Mail, Phone, MapPin, Zap, DollarSign, Calculator, CheckCircle, Loader, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ui/Toast';
import { useAppStore } from '@/store/appStore';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface GeocodeSuggestion {
  display_name: string;
  short_name: string;
  lat: number;
  lng: number;
  address: {
    house_number?: string;
    road?: string;
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    postcode?: string;
    suburb?: string;
  };
}

async function geocodeAddress(address: string, city: string, state: string, zip: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = [address, city, state, zip].filter(Boolean).join(', ');
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&mode=search`);
    const data = await res.json();
    if (data.success) {
      return { lat: data.data.lat, lng: data.data.lng };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchSuggestions(query: string): Promise<GeocodeSuggestion[]> {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}&mode=autocomplete`);
    const data = await res.json();
    if (data.success) return data.data;
    return [];
  } catch {
    return [];
  }
}

export default function NewClientPage() {
  const router = useRouter();
  const toast = useToast();
  // ✅ Phase 3: Use global store action — handles API + store update + localStorage mirror
  const addClient = useAppStore(s => s.addClient);

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeResult, setGeocodeResult] = useState<{ lat: number; lng: number } | null>(null);
  const [geocodeError, setGeocodeError] = useState('');
  const [form, setForm] = useState({
    name: '', email: '', phone: '', address: '', city: '', state: '', zip: '',
    utilityProvider: '', utilityRate: '0.13',
    averageMonthlyBill: '', annualKwh: '',
    monthlyKwh: Array(12).fill(''),
    inputMode: 'average' as 'average' | 'monthly',
  });

  // Address autocomplete state
  const [addressQuery, setAddressQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);

  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const setMonthly = (i: number, v: string) => {
    const arr = [...form.monthlyKwh];
    arr[i] = v;
    setForm(prev => ({ ...prev, monthlyKwh: arr }));
  };

  // Debounced address autocomplete
  const handleAddressInput = useCallback((value: string) => {
    setAddressQuery(value);
    setSelectedSuggestion(false);
    // Also update the raw address field
    set('address', value);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (value.length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSuggestionsLoading(true);
      const results = await fetchSuggestions(value);
      setSuggestions(results);
      setShowSuggestions(results.length > 0);
      setSuggestionsLoading(false);
    }, 350);
  }, []);

  // Native input event listener to catch ALL value changes (including programmatic ones)
  useEffect(() => {
    const input = addressInputRef.current;
    if (!input) return;
    const handleNativeInput = (e: Event) => {
      const value = (e.target as HTMLInputElement).value;
      handleAddressInput(value);
    };
    input.addEventListener('input', handleNativeInput);
    return () => input.removeEventListener('input', handleNativeInput);
  }, [handleAddressInput]);

  // Select a suggestion and auto-fill all address fields
  const handleSelectSuggestion = (suggestion: GeocodeSuggestion) => {
    const a = suggestion.address;
    const streetAddress = a.house_number && a.road
      ? `${a.house_number} ${a.road}`
      : a.road || '';
    const city = a.city || a.town || a.village || a.suburb || '';
    const state = a.state || '';
    const zip = a.postcode || '';

    setAddressQuery(streetAddress || suggestion.short_name);
    setForm(prev => ({
      ...prev,
      address: streetAddress || suggestion.short_name,
      city,
      state: state.length > 2 ? stateAbbr(state) : state,
      zip,
    }));
    setGeocodeResult({ lat: suggestion.lat, lng: suggestion.lng });
    setSelectedSuggestion(true);
    setShowSuggestions(false);
    setSuggestions([]);
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node) &&
          addressInputRef.current && !addressInputRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const computedAnnual = form.inputMode === 'monthly'
    ? form.monthlyKwh.reduce((s, v) => s + (parseFloat(v) || 0), 0)
    : parseFloat(form.annualKwh) || (parseFloat(form.averageMonthlyBill) / parseFloat(form.utilityRate) * 12) || 0;
  const computedAvgMonthly = Math.round(computedAnnual / 12);
  const computedRate = parseFloat(form.utilityRate) || 0.13;
  const computedAnnualBill = parseFloat(form.averageMonthlyBill) ? parseFloat(form.averageMonthlyBill) * 12 : Math.round(computedAnnual * computedRate);
  const recommendedKw = Math.ceil((computedAnnual / 1400) * 10) / 10;

  // Auto-geocode when moving from step 1 to step 2
  const handleNextFromStep1 = async () => {
    if (!form.name || !form.email || !form.address) return;

    // If we already have coords from autocomplete selection, skip geocoding
    if (geocodeResult && selectedSuggestion) {
      setStep(2);
      return;
    }

    setGeocoding(true);
    setGeocodeError('');
    const result = await geocodeAddress(form.address, form.city, form.state, form.zip);
    if (result) {
      setGeocodeResult(result);
    } else {
      setGeocodeError('Could not find coordinates for this address. The map will use a default location.');
    }
    setGeocoding(false);
    setStep(2);
  };

  const handleSubmit = async () => {
    setSaving(true);
    const toastId = toast.loading('Saving client...', 'Creating client profile and verifying location');
    try {
      let coords = geocodeResult;
      if (!coords) {
        coords = await geocodeAddress(form.address, form.city, form.state, form.zip);
      }

      const monthlyKwh = form.inputMode === 'monthly'
        ? form.monthlyKwh.map(v => parseFloat(v) || 0)
        : Array(12).fill(0).map((_, i) => {
            const seasonal = [0.85, 0.80, 0.90, 0.95, 1.05, 1.15, 1.25, 1.20, 1.10, 1.00, 0.88, 0.87];
            return Math.round(computedAvgMonthly * seasonal[i]);
          });

      // ✅ Phase 3: addClient() handles POST → DB → store update → localStorage mirror
      // No more direct fetch() + localSaveClient() — the store owns this flow
      const client = await addClient({
        name: form.name,
        email: form.email,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        zip: form.zip,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        utilityProvider: form.utilityProvider,
        utilityRate: computedRate,
        monthlyKwh,
        annualKwh: computedAnnual,
        averageMonthlyKwh: computedAvgMonthly,
        averageMonthlyBill: parseFloat(form.averageMonthlyBill) || Math.round(computedAvgMonthly * computedRate),
        annualBill: computedAnnualBill,
      } as any);

      toast.update(toastId, {
        type: 'success',
        title: `Client "${client.name}" saved!`,
        message: 'Redirecting to client profile...',
      });
      // Small delay so user sees the success toast before navigation
      setTimeout(() => router.push(`/clients/${client.id}`), 800);
    } catch (e: any) {
      toast.update(toastId, {
        type: 'error',
        title: 'Failed to save client',
        message: e?.message || 'Could not connect to server',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/clients" className="btn-ghost p-2 rounded-lg">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white">Add New Client</h1>
            <p className="text-slate-400 text-sm">Enter client information and utility data</p>
          </div>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center gap-2 mb-8">
          {[
            { n: 1, label: 'Contact Info' },
            { n: 2, label: 'Utility Data' },
            { n: 3, label: 'Review' },
          ].map(({ n, label }) => (
            <React.Fragment key={n}>
              <button
                onClick={() => n < step ? setStep(n) : undefined}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  step === n ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                  step > n ? 'text-emerald-400 cursor-pointer hover:bg-emerald-500/10' : 'text-slate-500'
                }`}
              >
                {step > n ? <CheckCircle size={14} /> : <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center text-xs">{n}</span>}
                {label}
              </button>
              {n < 3 && <div className={`flex-1 h-px ${step > n ? 'bg-emerald-500/40' : 'bg-slate-700'}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Contact Info */}
        {step === 1 && (
          <div className="card p-6 space-y-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <User size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Contact Information</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="input-label">Full Name / Company *</label>
                <input className="input" placeholder="John Smith or Acme Corp" value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Email Address *</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="input pl-9" type="email" placeholder="john@example.com" value={form.email} onChange={e => set('email', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="input-label">Phone Number</label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="input pl-9" placeholder="(555) 123-4567" value={form.phone} onChange={e => set('phone', e.target.value)} />
                </div>
              </div>

              {/* Address with Autocomplete */}
              <div className="sm:col-span-2">
                <label className="input-label">Street Address *</label>
                <div className="relative">
                  <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 z-10" />
                  <input
                    ref={addressInputRef}
                    className="input pl-9 pr-9"
                    placeholder="Start typing an address..."
                    value={addressQuery}
                    onChange={e => handleAddressInput(e.target.value)}
                    onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                    autoComplete="off"
                  />
                  {/* Loading / clear indicator */}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    {suggestionsLoading ? (
                      <Loader size={14} className="animate-spin text-slate-400" />
                    ) : addressQuery && (
                      <button
                        onClick={() => { setAddressQuery(''); set('address', ''); setSuggestions([]); setShowSuggestions(false); setGeocodeResult(null); setSelectedSuggestion(false); }}
                        className="text-slate-500 hover:text-slate-300"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {/* Suggestions dropdown */}
                  {showSuggestions && suggestions.length > 0 && (
                    <div
                      ref={suggestionsRef}
                      className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-50 overflow-hidden"
                    >
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          className="w-full text-left px-4 py-3 hover:bg-slate-700 transition-colors border-b border-slate-700/50 last:border-0"
                          onMouseDown={e => { e.preventDefault(); handleSelectSuggestion(s); }}
                        >
                          <div className="flex items-start gap-2">
                            <MapPin size={13} className="text-amber-400 mt-0.5 shrink-0" />
                            <div>
                              <div className="text-sm text-white font-medium">{s.short_name}</div>
                              <div className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{s.display_name}</div>
                            </div>
                          </div>
                        </button>
                      ))}
                      <div className="px-4 py-2 bg-slate-900/50 flex items-center gap-1.5">
                        <span className="text-xs text-slate-500">Powered by</span>
                        <span className="text-xs text-slate-400 font-medium">OpenStreetMap</span>
                      </div>
                    </div>
                  )}
                </div>
                {selectedSuggestion && geocodeResult && (
                  <div className="flex items-center gap-1.5 mt-1.5 text-emerald-400 text-xs">
                    <CheckCircle size={11} />
                    <span>Location verified — coordinates saved</span>
                  </div>
                )}
              </div>

              <div>
                <label className="input-label">City</label>
                <input className="input" placeholder="Phoenix" value={form.city} onChange={e => set('city', e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="input-label">State</label>
                  <input className="input" placeholder="AZ" maxLength={2} value={form.state} onChange={e => set('state', e.target.value.toUpperCase())} />
                </div>
                <div>
                  <label className="input-label">ZIP Code</label>
                  <input className="input" placeholder="85001" value={form.zip} onChange={e => set('zip', e.target.value)} />
                </div>
              </div>
            </div>

            {geocodeError && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-400">
                ⚠️ {geocodeError}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                className="btn-primary"
                disabled={!form.name || !form.email || !form.address || geocoding}
                onClick={handleNextFromStep1}
              >
                {geocoding ? (
                  <><Loader size={14} className="animate-spin" /> Finding location...</>
                ) : (
                  <>Next: Utility Data →</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Utility Data */}
        {step === 2 && (
          <div className="card p-6 space-y-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <Zap size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Utility & Energy Data</h2>
            </div>

            {/* Location confirmed */}
            {geocodeResult && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 flex items-center gap-2 text-xs text-emerald-400">
                <CheckCircle size={14} />
                <span>Location found: {geocodeResult.lat.toFixed(5)}, {geocodeResult.lng.toFixed(5)} — map will open at this address</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="input-label">Utility Provider</label>
                <input className="input" placeholder="e.g. APS, PG&E, Duke Energy" value={form.utilityProvider} onChange={e => set('utilityProvider', e.target.value)} />
              </div>
              <div>
                <label className="input-label">Utility Rate ($/kWh)</label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="input pl-9" type="number" step="0.001" placeholder="0.130" value={form.utilityRate} onChange={e => set('utilityRate', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="input-label">Average Monthly Bill ($)</label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="input pl-9" type="number" placeholder="185" value={form.averageMonthlyBill} onChange={e => set('averageMonthlyBill', e.target.value)} />
                </div>
              </div>
            </div>

            {/* Input Mode Toggle */}
            <div>
              <label className="input-label">Energy Usage Input Method</label>
              <div className="flex gap-2">
                <button
                  onClick={() => set('inputMode', 'average')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.inputMode === 'average'
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  Annual / Average
                </button>
                <button
                  onClick={() => set('inputMode', 'monthly')}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.inputMode === 'monthly'
                      ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                      : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  Monthly Breakdown
                </button>
              </div>
            </div>

            {form.inputMode === 'average' ? (
              <div>
                <label className="input-label">Annual kWh Usage</label>
                <div className="relative">
                  <Zap size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input className="input pl-9" type="number" placeholder="15000" value={form.annualKwh} onChange={e => set('annualKwh', e.target.value)} />
                </div>
                <p className="text-xs text-slate-500 mt-1">Or enter your average monthly bill above and we'll estimate usage</p>
              </div>
            ) : (
              <div>
                <label className="input-label">Monthly kWh Usage</label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {MONTHS.map((month, i) => (
                    <div key={month}>
                      <label className="text-xs text-slate-500 mb-1 block">{month}</label>
                      <input
                        className="input text-center"
                        type="number"
                        placeholder="0"
                        value={form.monthlyKwh[i]}
                        onChange={e => setMonthly(i, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Auto-calculated summary */}
            {computedAnnual > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Calculator size={14} className="text-amber-400" />
                  <span className="text-sm font-semibold text-amber-400">Auto-Calculated Summary</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  {[
                    { label: 'Annual Usage', value: `${computedAnnual.toLocaleString()} kWh` },
                    { label: 'Avg Monthly', value: `${computedAvgMonthly.toLocaleString()} kWh` },
                    { label: 'Annual Bill', value: `$${computedAnnualBill.toLocaleString()}` },
                    { label: 'Recommended Size', value: `${recommendedKw} kW` },
                  ].map(item => (
                    <div key={item.label} className="bg-slate-800/60 rounded-lg p-2">
                      <div className="text-sm font-bold text-white">{item.value}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="btn-primary" onClick={() => setStep(3)}>Next: Review →</button>
            </div>
          </div>
        )}

        {/* Step 3: Review */}
        {step === 3 && (
          <div className="card p-6 space-y-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={16} className="text-emerald-400" />
              <h2 className="font-semibold text-white">Review & Confirm</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-slate-800/60 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Contact</h3>
                <div className="space-y-2 text-sm">
                  <div className="text-white font-medium">{form.name}</div>
                  <div className="text-slate-400">{form.email}</div>
                  <div className="text-slate-400">{form.phone}</div>
                  <div className="text-slate-400">{form.address}, {form.city}, {form.state} {form.zip}</div>
                  {geocodeResult ? (
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs mt-1">
                      <CheckCircle size={12} />
                      <span>Location verified — map will open at this address</span>
                    </div>
                  ) : (
                    <div className="text-amber-400 text-xs mt-1">⚠️ Location not verified — map will use city center</div>
                  )}
                </div>
              </div>
              <div className="bg-slate-800/60 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Energy Profile</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-400">Provider</span><span className="text-white">{form.utilityProvider || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Rate</span><span className="text-white">${computedRate}/kWh</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Annual Usage</span><span className="text-white">{computedAnnual.toLocaleString()} kWh</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Annual Bill</span><span className="text-white">${computedAnnualBill.toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Recommended System</span><span className="text-amber-400 font-semibold">{recommendedKw} kW</span></div>
                </div>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <button className="btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <button className="btn-primary btn-lg" onClick={handleSubmit} disabled={saving}>
                {saving ? <><span className="spinner w-4 h-4" /> Saving...</> : '✓ Create Client'}
              </button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Helper: convert full state name to abbreviation
function stateAbbr(name: string): string {
  const map: Record<string, string> = {
    'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
    'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
    'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
    'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
    'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
    'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
    'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
    'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
    'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
    'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY',
  };
  return map[name] || name.substring(0, 2).toUpperCase();
}