import re

with open('app/proposals/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Add new imports after existing imports
old_import = "import Link from 'next/link';"
new_import = """import Link from 'next/link';
import { resolveEquipment, getSystemTypeLabel } from '@/lib/systemEquipmentResolver';"""
content = content.replace(old_import, new_import, 1)

# Fix 2: Add Settings, Percent, Tag to lucide imports
old_lucide = "  ChevronRight, BarChart2, Home, Sprout, Fence, Users\n} from 'lucide-react';"
new_lucide = "  ChevronRight, BarChart2, Home, Sprout, Fence, Users,\n  Settings, Percent, Tag\n} from 'lucide-react';"
content = content.replace(old_lucide, new_lucide, 1)

# Fix 3: Replace the ProposalPreview function header
old_preview_header = """function ProposalPreview({ proposal, onBack, onDownload }: {
  proposal: Proposal; onBack: () => void; onDownload: () => void;
}) {
  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate;
  const layout = proj?.layout;

  const systemTypeLabel = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' }[proj?.systemType || 'roof'] || '\u2014';
  const systemTypeIcon = { roof: <Home size={16} />, ground: <Sprout size={16} />, fence: <Fence size={16} /> }[proj?.systemType || 'roof'];"""

new_preview_header = """function ProposalPreview({ proposal, onBack, onDownload }: {
  proposal: Proposal; onBack: () => void; onDownload: () => void;
}) {
  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate as any;
  const layout = proj?.layout;

  // \u2500\u2500 Sales override state \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const [showOverrides, setShowOverrides] = useState(false);
  const [overridePpw, setOverridePpw]         = useState<string>('');
  const [overrideMargin, setOverrideMargin]   = useState<string>('');
  const [overrideFinal, setOverrideFinal]     = useState<string>('');

  // Compute effective pricing (override takes precedence over stored cost)
  const baseCashPrice   = cost?.cashPrice ?? cost?.grossCost ?? 0;
  const systemSizeKw    = layout?.systemSizeKw ?? 0;
  const systemSizeW     = systemSizeKw * 1000;

  const effectiveFinal  = overrideFinal  ? parseFloat(overrideFinal)  : baseCashPrice;
  const effectivePpw    = overridePpw    ? parseFloat(overridePpw)    : (systemSizeW > 0 ? parseFloat((effectiveFinal / systemSizeW).toFixed(2)) : (cost?.pricePerWatt ?? 0));
  const itcAmount       = Math.round(effectiveFinal * 0.30);
  const effectiveNet    = effectiveFinal - itcAmount;

  // \u2500\u2500 Energy offset \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const annualProduction = production?.annualProductionKwh ?? 0;
  const annualUsage      = client?.annualKwh ?? 0;
  const energyOffset     = annualUsage > 0
    ? Math.min(Math.round((annualProduction / annualUsage) * 100), 100)
    : (production?.offsetPercentage ?? 0);

  // \u2500\u2500 Equipment resolver \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const systemType      = proj?.systemType ?? 'roof';
  const equipment       = resolveEquipment(systemType);
  const racking         = equipment.racking;

  const systemTypeLabel = getSystemTypeLabel(systemType);
  const systemTypeIcon  = { roof: <Home size={16} />, ground: <Sprout size={16} />, fence: <Fence size={16} />, carport: <Sun size={16} /> }[systemType] ?? <Home size={16} />;"""

content = content.replace(old_preview_header, new_preview_header, 1)

with open('app/proposals/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("Done. Checking replacements...")
# Verify
if 'resolveEquipment' in content:
    print("✅ resolveEquipment import added")
if 'showOverrides' in content:
    print("✅ Sales override state added")
if 'energyOffset' in content:
    print("✅ Energy offset calculation added")
if 'racking' in content:
    print("✅ Equipment resolver added")