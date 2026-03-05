#!/usr/bin/env python3
"""
Patch proposals/page.tsx to:
1. Add pricingCfg state + useEffect to fetch /api/pricing
2. Replace the pricing calculation block (lines 184-192) with DB-aware version
3. Fix the annualSavings/paybackYears/lifetimeSavings to use stored or computed values
"""
import re

FILE = 'app/proposals/page.tsx'

with open(FILE, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find key line numbers
line_sales_override = None
line_compute_start = None
line_compute_end = None
line_energy_offset_comment = None

for i, line in enumerate(lines):
    stripped = line.strip()
    if 'Sales override state' in line and line_sales_override is None:
        line_sales_override = i
    if 'Compute effective pricing' in line and line_compute_start is None:
        line_compute_start = i
    if 'effectiveNet    = effectiveFinal - itcAmount' in line and line_compute_end is None:
        line_compute_end = i
    if 'Energy offset' in line and line_energy_offset_comment is None:
        line_energy_offset_comment = i

print(f"line_sales_override={line_sales_override}")
print(f"line_compute_start={line_compute_start}")
print(f"line_compute_end={line_compute_end}")
print(f"line_energy_offset_comment={line_energy_offset_comment}")

# Build the replacement block (lines from line_sales_override to line_compute_end inclusive)
# Insert pricingCfg state BEFORE the sales override state comment
new_block = '''  // Pricing config from DB (fetched on mount)
  const [pricingCfg, setPricingCfg] = useState<any>(null);
  useEffect(() => {
    fetch('/api/pricing')
      .then(r => r.json())
      .then(d => { if (d.success) setPricingCfg(d.data); })
      .catch(() => {});
  }, []);

  // Sales override state
  const [showOverrides, setShowOverrides] = useState(false);
  const [overridePpw, setOverridePpw]         = useState<string>('');
  const [overrideMargin, setOverrideMargin]   = useState<string>('');
  const [overrideFinal, setOverrideFinal]     = useState<string>('');

  // Compute effective pricing — priority: sales override > stored costEstimate > live calc
  const systemSizeKw = layout?.systemSizeKw ?? 0;
  const systemSizeW  = systemSizeKw * 1000;
  const storedCashPrice = cost?.cashPrice ?? cost?.grossCost ?? 0;
  const systemType = proj?.systemType ?? 'roof';

  // Live price-per-watt from admin pricing config
  const livePpw = pricingCfg
    ? (({
        roof:    pricingCfg.roofPricePerWatt    ?? pricingCfg.pricePerWatt ?? 3.10,
        ground:  pricingCfg.groundPricePerWatt  ?? pricingCfg.pricePerWatt ?? 2.35,
        fence:   pricingCfg.fencePricePerWatt   ?? pricingCfg.pricePerWatt ?? 4.25,
        carport: pricingCfg.carportPricePerWatt ?? pricingCfg.pricePerWatt ?? 3.75,
      } as Record<string, number>)[systemType] ?? pricingCfg.pricePerWatt ?? 3.10)
    : 3.10;

  const liveCalculatedPrice = systemSizeW > 0 ? Math.round(systemSizeW * livePpw) : 0;
  const baseCashPrice = storedCashPrice > 0 ? storedCashPrice : liveCalculatedPrice;

  const effectiveFinal = overrideFinal ? parseFloat(overrideFinal) : baseCashPrice;

  // ITC rate from stored data or config
  const itcRate    = (cost?.taxCredit && cost?.totalBeforeCredit && cost.totalBeforeCredit > 0)
    ? Math.round((cost.taxCredit / cost.totalBeforeCredit) * 100)
    : (pricingCfg?.taxCreditRate ?? 30);
  const itcAmount  = Math.round(effectiveFinal * itcRate / 100);
  const effectiveNet = effectiveFinal - itcAmount;

  const effectivePpw = overridePpw
    ? parseFloat(overridePpw)
    : (systemSizeW > 0 ? parseFloat((effectiveFinal / systemSizeW).toFixed(2)) : (cost?.pricePerWatt ?? livePpw));

  // Savings — use stored values or estimate
  const annualSavings   = cost?.annualSavings   ?? Math.round((production?.annualProductionKwh ?? 0) * (client?.utilityRate ?? 0.13));
  const paybackYears    = cost?.paybackYears    ?? (annualSavings > 0 ? parseFloat((effectiveNet / annualSavings).toFixed(1)) : 0);
  const lifetimeSavings = cost?.lifetimeSavings ?? 0;
'''

# Replace lines from line_sales_override to line_compute_end (inclusive)
new_lines = (
    lines[:line_sales_override] +
    [new_block + '\n'] +
    lines[line_compute_end + 1:]
)

with open(FILE, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Done patching proposals/page.tsx")