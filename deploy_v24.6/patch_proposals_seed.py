with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# ─── Patch 1: Add seed extraction after layout/production/cost ────────────────
old_data_block = """  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate as any;
  const layout = proj?.layout;"""

new_data_block = """  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate as any;
  const layout = proj?.layout;
  // Engineering seed — tertiary fallback when no layout/production records exist
  const seed = (proj as any)?.engineeringSeed as {
    system_kw: number;
    panel_count: number;
    annual_production_kwh: number;
    annual_kwh: number;
    electricity_rate: number | null;
    cost_low: number;
    cost_high: number;
    production_factor: number;
    state_code: string | null;
    utility: string;
  } | undefined;"""

if old_data_block in content:
    content = content.replace(old_data_block, new_data_block)
    print('✅ Added seed extraction in ProposalPreview')
else:
    print('❌ Could not find data block in ProposalPreview')

# ─── Patch 2: Fix systemSizeKw to use seed as fallback ───────────────────────
old_system_size = "  const systemSizeKw = layout?.systemSizeKw ?? 0;"
new_system_size = """  // System size: layout → seed → 0
  const systemSizeKw = (layout?.systemSizeKw && layout.systemSizeKw > 0)
    ? layout.systemSizeKw
    : (seed?.system_kw ?? 0);"""

if old_system_size in content:
    content = content.replace(old_system_size, new_system_size)
    print('✅ Fixed systemSizeKw with seed fallback')
else:
    print('❌ Could not find systemSizeKw line')

# ─── Patch 3: Fix annualProduction to use seed as fallback ───────────────────
old_annual = "  const annualProduction = production?.annualProductionKwh ?? 0;"
new_annual = """  // Annual production: production record → seed estimate → 0
  const annualProduction = (production?.annualProductionKwh && production.annualProductionKwh > 0)
    ? production.annualProductionKwh
    : (seed?.annual_production_kwh ?? 0);"""

if old_annual in content:
    content = content.replace(old_annual, new_annual)
    print('✅ Fixed annualProduction with seed fallback')
else:
    print('❌ Could not find annualProduction line')

# ─── Patch 4: Fix baseCashPrice to use seed cost range ───────────────────────
old_base_price = "  const baseCashPrice = storedCashPrice > 0 ? storedCashPrice : liveCalculatedPrice;"
new_base_price = """  // Base price: stored → live calc → seed estimate
  const seedMidPrice = seed ? Math.round((seed.cost_low + seed.cost_high) / 2) : 0;
  const baseCashPrice = storedCashPrice > 0
    ? storedCashPrice
    : liveCalculatedPrice > 0
      ? liveCalculatedPrice
      : seedMidPrice;"""

if old_base_price in content:
    content = content.replace(old_base_price, new_base_price)
    print('✅ Fixed baseCashPrice with seed fallback')
else:
    print('❌ Could not find baseCashPrice line')

# ─── Patch 5: Fix the System Size display card to show seed data ─────────────
# The proposal shows "—" when no layout. Fix the display cards.
old_system_card = "                  { label: 'System Size', value: layout ? `${layout.systemSizeKw.toFixed(1)} kW` : '—', icon: <Zap size={16} />, color: 'border-blue-500/30 bg-blue-500/10' },"
new_system_card = "                  { label: 'System Size', value: systemSizeKw > 0 ? `${systemSizeKw.toFixed(1)} kW` : '—', icon: <Zap size={16} />, color: 'border-blue-500/30 bg-blue-500/10' },"

if old_system_card in content:
    content = content.replace(old_system_card, new_system_card)
    print('✅ Fixed System Size display card')
else:
    print('⚠️ Could not find System Size display card (may already be fixed)')

# ─── Patch 6: Fix Annual Production display card ─────────────────────────────
old_prod_card = "                  { label: 'Annual Production', value: production ? `${(production.annualProductionKwh / 1000).toFixed(1)} MWh` : '—', icon: <Sun size={16} />, color: 'border-emerald-500/30 bg-emerald-500/10' },"
new_prod_card = "                  { label: 'Annual Production', value: annualProduction > 0 ? `${(annualProduction / 1000).toFixed(1)} MWh` : '—', icon: <Sun size={16} />, color: 'border-emerald-500/30 bg-emerald-500/10' },"

if old_prod_card in content:
    content = content.replace(old_prod_card, new_prod_card)
    print('✅ Fixed Annual Production display card')
else:
    print('⚠️ Could not find Annual Production display card (may already be fixed)')

# ─── Patch 7: Fix the detailed system info cards (System Size, Panel Count, Annual Production) ──
old_detail_cards = """                { icon: <Zap size={18} />, label: 'System Size', value: layout ? `${layout.systemSizeKw.toFixed(2)} kW` : '—', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                { icon: <Sun size={18} />, label: 'Panel Count', value: layout ? `${layout.totalPanels} panels` : '—', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                { icon: <TrendingUp size={18} />, label: 'Annual Production', value: production ? `${production.annualProductionKwh.toLocaleString()} kWh` : '—', color: 'bg-green-50 text-green-700 border-green-200' },"""

new_detail_cards = """                { icon: <Zap size={18} />, label: 'System Size', value: systemSizeKw > 0 ? `${systemSizeKw.toFixed(2)} kW` : '—', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                { icon: <Sun size={18} />, label: 'Panel Count', value: (layout?.totalPanels ?? seed?.panel_count ?? 0) > 0 ? `${layout?.totalPanels ?? seed?.panel_count} panels` : '—', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                { icon: <TrendingUp size={18} />, label: 'Annual Production', value: annualProduction > 0 ? `${annualProduction.toLocaleString()} kWh` : '—', color: 'bg-green-50 text-green-700 border-green-200' },"""

if old_detail_cards in content:
    content = content.replace(old_detail_cards, new_detail_cards)
    print('✅ Fixed detailed system info cards')
else:
    print('⚠️ Could not find detailed system info cards (may already be fixed)')

# ─── Patch 8: Fix the bottom summary line ────────────────────────────────────
old_summary = "                          {layout?.totalPanels ?? 0} panels · {systemSizeKw.toFixed(1)} kW"
new_summary = "                          {layout?.totalPanels ?? seed?.panel_count ?? 0} panels · {systemSizeKw.toFixed(1)} kW"

if old_summary in content:
    content = content.replace(old_summary, new_summary)
    print('✅ Fixed bottom summary line')
else:
    print('⚠️ Could not find bottom summary line')

# ─── Patch 9: Add seed price range display when no stored cost ────────────────
# Find the price range section and add seed estimate
old_price_note = "                  <div className=&quot;text-xs text-blue-500 mt-1&quot;>{systemSizeKw.toFixed(1)} kW system</div>"
new_price_note = """                  <div className="text-xs text-blue-500 mt-1">{systemSizeKw.toFixed(1)} kW system</div>
                  {seed && !storedCashPrice && (
                    <div className="text-xs text-slate-400 mt-1">
                      Estimate range: ${seed.cost_low.toLocaleString()} – ${seed.cost_high.toLocaleString()}
                    </div>
                  )}"""

if old_price_note in content:
    content = content.replace(old_price_note, new_price_note)
    print('✅ Added seed price range display')
else:
    print('⚠️ Could not find price note line')

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('Done.')