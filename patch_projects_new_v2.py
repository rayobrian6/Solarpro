with open('app/projects/new/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Insert bill upload + address section INSIDE the Project Details card, after Project Name, before Notes
old_details = """                <div>
                  <label className="input-label">Project Name *</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smith Residence - Roof Mount" />
                </div>
                <div>
                  <label className="input-label">Notes (optional)</label>
                  <textarea className="input resize-none" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requirements or notes..." />
                </div>"""

new_details = """                <div>
                  <label className="input-label">Project Name *</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smith Residence - Roof Mount" />
                </div>

                {/* ── Bill Upload Shortcut ── */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Upload size={15} className="text-amber-400" />
                      <div>
                        <p className="text-white text-sm font-medium">Upload Electric Bill</p>
                        <p className="text-slate-400 text-xs">Auto-detect utility, location &amp; system size</p>
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

                {/* ── Project Address ── */}
                <div>
                  <label className="input-label flex items-center gap-1">
                    <MapPin size={12} className="text-slate-400" /> Project Address
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      onBlur={handleAddressBlur}
                      placeholder="123 Main St, City, ST 12345"
                      className="input pr-8"
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
                  <label className="input-label">Notes (optional)</label>
                  <textarea className="input resize-none" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special requirements or notes..." />
                </div>"""

if old_details in content:
    content = content.replace(old_details, new_details, 1)
    print("✓ Inserted bill upload + address section into Project Details card")
else:
    print("✗ Could not find Project Details anchor")
    idx = content.find('Project Name *')
    if idx >= 0:
        print(repr(content[max(0,idx-100):idx+300]))

with open('app/projects/new/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")