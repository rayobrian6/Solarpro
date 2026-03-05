with open('lib/pricingEngine.ts', 'r', encoding='utf-8') as f:
    lines = f.readlines()

insert_at = 208  # 0-indexed = line 209 (before "Main entry point")

new_code = '''
// ─── Itemized pricing by panel type ──────────────────────────────────────────

/**
 * Calculate itemized price breakdown from a list of placed panels.
 * Groups panels by systemType, applies per-panel price for each type.
 * PRIMARY pricing method: price per panel × count per type + fixed cost.
 */
export function calculateItemizedPrice(
  panels: Array<{ systemType?: string; wattage?: number }>,
  layoutSystemType: string,
  cfg: ResolvedPricingConfig
): {
  lineItems: PricingLineItem[];
  subtotalBeforeFixed: number;
  totalCashPrice: number;
  totalPanels: number;
} {
  const counts: Record<string, number> = {};
  for (const p of panels) {
    const t = (p.systemType || layoutSystemType || 'roof').toLowerCase();
    counts[t] = (counts[t] || 0) + 1;
  }

  const TYPE_LABELS: Record<string, string> = {
    roof:    'Roof-Mounted Solar',
    ground:  'Ground-Mounted Solar',
    fence:   'Sol Fence (Vertical)',
    carport: 'Solar Carport',
  };

  const getPricePerPanel = (type: string): number => {
    switch (type) {
      case 'ground':  return cfg.groundPricePerPanel;
      case 'fence':   return cfg.fencePricePerPanel;
      case 'carport': return Math.round(cfg.carportPricePerWatt * cfg.defaultPanelWattage);
      default:        return cfg.roofPricePerPanel;
    }
  };

  const lineItems: PricingLineItem[] = Object.entries(counts).map(([type, count]) => {
    const pricePerPanel = getPricePerPanel(type);
    return {
      type: type as PricingLineItem['type'],
      label: TYPE_LABELS[type] || type,
      panelCount: count,
      pricePerPanel,
      subtotal: count * pricePerPanel,
    };
  });

  const subtotalBeforeFixed = lineItems.reduce((sum, li) => sum + li.subtotal, 0);
  const totalCashPrice = subtotalBeforeFixed + cfg.fixedCost;
  const totalPanels = panels.length;

  return { lineItems, subtotalBeforeFixed, totalCashPrice, totalPanels };
}

'''

lines.insert(insert_at, new_code)

with open('lib/pricingEngine.ts', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f'✅ Inserted calculateItemizedPrice at line {insert_at+1}')
print(f'Total lines now: {len(lines)}')