#!/usr/bin/env python3
"""
Add quick production preview to DesignStudio.tsx:
1. Add quickEstimate useMemo after systemSizeKw
2. Add preview display in System Summary section
"""

with open('/workspace/components/design/DesignStudio.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── 1. Add useMemo import check ─────────────────────────────────────────────
if 'useMemo' not in content:
    content = content.replace(
        "import React, { useEffect, useRef, useState, useCallback } from 'react';",
        "import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';"
    )
    print("✅ Added useMemo to imports")
else:
    print("✅ useMemo already imported")

# ─── 2. Add quickEstimate after systemSizeKw ─────────────────────────────────
ANCHOR_SYSSIZE = "  const systemSizeKw = calculateSystemSize(panels);"

QUICK_ESTIMATE_BLOCK = """  const systemSizeKw = calculateSystemSize(panels);

  // Quick production estimate (shown before full PVWatts calculation)
  const quickEstimate = useMemo(() => {
    if (panels.length === 0 || systemSizeKw === 0) return null;
    // Regional sun-hours lookup by latitude (rough estimate)
    const lat = mapCenter.lat;
    let peakSunHours = 4.5; // national average
    if (lat >= 25 && lat <= 35) peakSunHours = 5.8;       // Southwest (AZ, NM, TX, FL)
    else if (lat > 35 && lat <= 40) peakSunHours = 5.2;   // Mid-South (CA, CO, NC)
    else if (lat > 40 && lat <= 45) peakSunHours = 4.8;   // Mid-North (OH, PA, OR)
    else if (lat > 45) peakSunHours = 4.2;                 // Northwest/Northeast
    else if (lat < 25) peakSunHours = 5.5;                 // Hawaii/Puerto Rico

    // Tilt adjustment factor (optimal ~latitude angle)
    const tiltDiff = Math.abs(tilt - lat);
    const tiltFactor = 1 - (tiltDiff / 180) * 0.15;

    // System losses: ~14% (wiring, inverter, soiling, temp)
    const systemLoss = 0.86;
    const annualKwh = Math.round(systemSizeKw * peakSunHours * 365 * tiltFactor * systemLoss);
    const monthlyAvg = Math.round(annualKwh / 12);

    // Savings estimate at $0.15/kWh average
    const utilityRate = 0.15;
    const annualSavings = Math.round(annualKwh * utilityRate);

    return { annualKwh, monthlyAvg, annualSavings, peakSunHours };
  }, [panels.length, systemSizeKw, mapCenter.lat, tilt]);"""

if ANCHOR_SYSSIZE in content:
    content = content.replace(ANCHOR_SYSSIZE, QUICK_ESTIMATE_BLOCK, 1)
    print("✅ quickEstimate useMemo inserted")
else:
    print("❌ ANCHOR for systemSizeKw not found")

# ─── 3. Add preview display in System Summary section ────────────────────────
# Find the System Summary section and add the quick estimate after the grid
OLD_SUMMARY = """                    <button
                      onClick={calculateProduction}
                      disabled={calculating}
                      className="btn-primary w-full mt-1"
                    >
                      {calculating ? <><Loader size={14} className="animate-spin" /> Calculating...</> : <><Play size={14} /> Calculate Production</>}
                    </button>
                    {calcMessage && (
                      <div className={`text-xs mt-1 px-2 py-1.5 rounded-lg ${
                        calcMessage.startsWith('\u2705')
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {calcMessage}
                      </div>
                    )}
                  </Section>"""

NEW_SUMMARY = """                    {/* Quick production estimate preview */}
                    {quickEstimate && !production && (
                      <div className="bg-slate-800/60 rounded-lg p-2.5 border border-slate-700/50">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Sun size={11} className="text-amber-400" />
                          <span className="text-xs text-slate-400 font-medium">Quick Estimate</span>
                          <span className="text-xs text-slate-600 ml-auto">(pre-calculation)</span>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 text-xs">
                          <div className="text-center">
                            <div className="text-amber-400 font-bold">{quickEstimate.annualKwh.toLocaleString()}</div>
                            <div className="text-slate-500">kWh/yr</div>
                          </div>
                          <div className="text-center">
                            <div className="text-emerald-400 font-bold">${quickEstimate.annualSavings.toLocaleString()}</div>
                            <div className="text-slate-500">est. savings</div>
                          </div>
                          <div className="text-center">
                            <div className="text-blue-400 font-bold">{quickEstimate.peakSunHours}</div>
                            <div className="text-slate-500">sun hrs/day</div>
                          </div>
                        </div>
                        <div className="text-xs text-slate-600 mt-1.5 text-center">Run PVWatts for precise results</div>
                      </div>
                    )}
                    <button
                      onClick={calculateProduction}
                      disabled={calculating}
                      className="btn-primary w-full mt-1"
                    >
                      {calculating ? <><Loader size={14} className="animate-spin" /> Calculating...</> : <><Play size={14} /> Calculate Production</>}
                    </button>
                    {calcMessage && (
                      <div className={`text-xs mt-1 px-2 py-1.5 rounded-lg ${
                        calcMessage.startsWith('\u2705')
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-red-500/10 text-red-400 border border-red-500/20'
                      }`}>
                        {calcMessage}
                      </div>
                    )}
                  </Section>"""

if OLD_SUMMARY in content:
    content = content.replace(OLD_SUMMARY, NEW_SUMMARY, 1)
    print("✅ Quick estimate preview added to System Summary")
else:
    print("❌ ANCHOR for System Summary not found")
    # Debug
    idx = content.find('btn-primary w-full mt-1')
    if idx >= 0:
        print(f"  Found btn-primary at char {idx}")
        print(f"  Context: {repr(content[idx-200:idx+100])}")

with open('/workspace/components/design/DesignStudio.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ File written successfully")