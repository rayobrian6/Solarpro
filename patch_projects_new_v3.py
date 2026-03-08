with open('app/projects/new/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Move the bill upload section OUTSIDE the conditional block
# Currently: {selectedClient && selectedType && ( ... bill upload inside ... )}
# Fix: Show bill upload always (before client/type selection), as a standalone card

# Find the conditional wrapper for Project Details
old_conditional = """          {/* Project Name */}
          {selectedClient && selectedType && (
            <div className="card p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen size={16} className="text-amber-400" />
                <h2 className="font-semibold text-white">Project Details</h2>
              </div>
              <div className="space-y-4">
                <div>
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
                </div>"""

new_conditional = """          {/* ── Bill Upload — always visible ── */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <Upload size={16} className="text-amber-400" />
                <div>
                  <h2 className="font-semibold text-white text-sm">Upload Electric Bill</h2>
                  <p className="text-slate-400 text-xs">Auto-detect utility, location &amp; system size from a PDF or photo</p>
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

          {/* Project Name */}
          {selectedClient && selectedType && (
            <div className="card p-5 animate-fade-in">
              <div className="flex items-center gap-2 mb-4">
                <FolderOpen size={16} className="text-amber-400" />
                <h2 className="font-semibold text-white">Project Details</h2>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="input-label">Project Name *</label>
                  <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Smith Residence - Roof Mount" />
                </div>"""

if old_conditional in content:
    content = content.replace(old_conditional, new_conditional, 1)
    print("✓ Moved bill upload outside conditional — now always visible")
else:
    print("✗ Could not find conditional anchor")
    idx = content.find('Bill Upload Shortcut')
    if idx >= 0:
        print(repr(content[max(0,idx-200):idx+100]))

with open('app/projects/new/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Done. Lines: {len(content.splitlines())}")