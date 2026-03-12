#!/usr/bin/env python3
"""
Fix project [id] page.tsx:
1. Import BillUploadFlow + add showBillModal state
2. Fix handleUploadBill to set showBillModal = true (not navigate)
3. Add handleBillComplete callback that builds BillAnalysis + calls PUT /api/projects/[id]
4. Add BillUploadFlow modal rendering at bottom of JSX
"""

PAGE_PATH = '/workspace/solarpro/app/projects/[id]/page.tsx'

with open(PAGE_PATH, 'r') as f:
    content = f.read()

# ─── Step 1: Add BillUploadFlow import ───────────────────────────────────────
OLD_IMPORT = "import BillTab from '@/components/project/BillTab';"
NEW_IMPORT = """import BillTab from '@/components/project/BillTab';
import BillUploadFlow from '@/components/onboarding/BillUploadFlow';"""

if OLD_IMPORT in content:
    content = content.replace(OLD_IMPORT, NEW_IMPORT)
    print("✓ Added BillUploadFlow import")
else:
    print("✗ BillTab import not found")

# ─── Step 2: Add showBillModal state after existing state declarations ────────
OLD_STATE = "  const [showAllWarnings, setShowAllWarnings] = useState(false);"
NEW_STATE = """  const [showAllWarnings, setShowAllWarnings] = useState(false);
  const [showBillModal, setShowBillModal] = useState(false);
  const [savingBill, setSavingBill] = useState(false);"""

if OLD_STATE in content:
    content = content.replace(OLD_STATE, NEW_STATE)
    print("✓ Added showBillModal + savingBill state")
else:
    print("✗ showAllWarnings state not found")

# ─── Step 3: Fix handleUploadBill to open modal instead of navigating ─────────
OLD_HANDLE_UPLOAD = """  const handleUploadBill = useCallback(() => {
    // Navigate to bill upload — could be a modal or redirect
    router.push(`/projects/${id}/upload-bill`);
  }, [id, router]);"""

NEW_HANDLE_UPLOAD = """  const handleUploadBill = useCallback(() => {
    setShowBillModal(true);
  }, []);

  // ─── Bill upload complete: build BillAnalysis + persist to project ───────
  const handleBillComplete = useCallback(async (result: {
    billData: {
      monthlyKwh?: number;
      estimatedAnnualKwh?: number;
      electricityRate?: number;
      estimatedMonthlyBill?: number;
      totalAmount?: number;
      utilityProvider?: string;
      monthlyUsageHistory?: number[];
      customerName?: string;
      serviceAddress?: string;
    };
    locationData?: { stateCode?: string; lat?: number; lng?: number; city?: string; state?: string };
    utilityData?: { utilityName?: string; avgRatePerKwh?: number };
    systemSizing?: { recommendedKw?: number };
    systemKw: number;
    offsetPercent: number;
  }) => {
    if (!project) return;
    setSavingBill(true);

    console.log('[BILL_PARSED] Bill data received:', {
      monthlyKwh: result.billData.monthlyKwh,
      annualKwh: result.billData.estimatedAnnualKwh,
      rate: result.billData.electricityRate,
      utility: result.billData.utilityProvider || result.utilityData?.utilityName,
    });

    try {
      // Build 12-month array — use history if available, else fill from monthly avg
      const rawHistory = result.billData.monthlyUsageHistory || [];
      const monthlyKwh: number[] = rawHistory.length >= 12
        ? rawHistory.slice(0, 12)
        : Array(12).fill(result.billData.monthlyKwh || 0);

      const annualKwh = result.billData.estimatedAnnualKwh
        || (result.billData.monthlyKwh ? result.billData.monthlyKwh * 12 : monthlyKwh.reduce((a, b) => a + b, 0));
      const avgMonthlyKwh = annualKwh / 12;
      const utilityRate = result.billData.electricityRate
        || result.utilityData?.avgRatePerKwh
        || 0.13;
      const avgMonthlyBill = result.billData.estimatedMonthlyBill
        || result.billData.totalAmount
        || (avgMonthlyKwh * utilityRate);
      const annualBill = avgMonthlyBill * 12;
      const peakIdx = monthlyKwh.indexOf(Math.max(...monthlyKwh));
      const systemKw = result.systemKw || result.systemSizing?.recommendedKw || 0;
      const panelCount = Math.ceil(systemKw * 1000 / 440);

      // Build typed BillAnalysis
      const billAnalysis = {
        monthlyKwh,
        annualKwh,
        averageMonthlyKwh: avgMonthlyKwh,
        averageMonthlyBill: avgMonthlyBill,
        annualBill,
        utilityRate,
        peakMonthKwh: monthlyKwh[peakIdx] || 0,
        peakMonth: peakIdx,
        recommendedSystemKw: systemKw,
        recommendedPanelCount: panelCount,
        offsetTarget: result.offsetPercent || 100,
      };

      const utilityName = result.billData.utilityProvider
        || result.utilityData?.utilityName
        || undefined;
      const utilityRatePerKwh = utilityRate;
      const stateCode = result.locationData?.stateCode || undefined;

      // Structured bill_data that rowToProject can hydrate
      const billData = {
        _billAnalysis: billAnalysis,
        _utilityName: utilityName,
        _utilityRatePerKwh: utilityRatePerKwh,
        _stateCode: stateCode,
        // Also keep raw fields for engineering engine / proposals
        ...result.billData,
      };

      console.log('[BILL_SAVING] PUT /api/projects/' + project.id, { systemKw, utilityName, annualKwh });

      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billData,
          systemSizeKw: systemKw || undefined,
          // Update lat/lng if we got location from bill
          ...(result.locationData?.lat && result.locationData?.lng ? {
            lat: result.locationData.lat,
            lng: result.locationData.lng,
          } : {}),
        }),
      });

      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to save bill');

      console.log('[BILL_SAVED] Project updated successfully');

      // Hydrate billAnalysis + utilityName on the returned project
      // The server returns the raw project; merge in client-side-hydrated fields
      const updatedProject: Project = {
        ...json.data,
        billAnalysis,
        utilityName: utilityName || json.data.utilityName,
        utilityRatePerKwh: utilityRatePerKwh || json.data.utilityRatePerKwh,
        stateCode: stateCode || json.data.stateCode,
      };

      console.log('[WORKFLOW_UPDATED] billAnalysis set, workflow will recompute');
      setProject(updatedProject);
      setShowBillModal(false);

      // Auto-advance to system size tab
      setActiveTab('system');
      console.log('[PROJECT_REFRESHED] UI updated, navigated to system tab');

    } catch (err) {
      console.error('[BILL_SAVE_ERROR]', err instanceof Error ? err.message : err);
      // Close modal even on error — don't leave user stuck
      setShowBillModal(false);
    } finally {
      setSavingBill(false);
    }
  }, [project]);"""

if OLD_HANDLE_UPLOAD in content:
    content = content.replace(OLD_HANDLE_UPLOAD, NEW_HANDLE_UPLOAD)
    print("✓ handleUploadBill + handleBillComplete added")
else:
    print("✗ handleUploadBill not found exactly")
    # Check partial
    if "router.push(`/projects/${id}/upload-bill`)" in content:
        print("  Found partial match via router.push")

# ─── Step 4: Add modal to JSX just before closing </AppShell> ─────────────────
OLD_CLOSE_APPSHELL = """    </AppShell>
  );
}"""

NEW_CLOSE_APPSHELL = """
      {/* ── Bill Upload Modal ──────────────────────────────────────────── */}
      {showBillModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl">
            <BillUploadFlow
              onComplete={handleBillComplete}
              onClose={() => setShowBillModal(false)}
            />
          </div>
        </div>
      )}

    </AppShell>
  );
}"""

if OLD_CLOSE_APPSHELL in content:
    content = content.replace(OLD_CLOSE_APPSHELL, NEW_CLOSE_APPSHELL)
    print("✓ BillUploadFlow modal added to JSX")
else:
    print("✗ Closing AppShell not found exactly")
    # Try alternate
    if "</AppShell>" in content:
        # Find the last occurrence
        last_idx = content.rfind("    </AppShell>\n  );\n}")
        if last_idx >= 0:
            content = content[:last_idx] + """
      {/* ── Bill Upload Modal ──────────────────────────────────────────── */}
      {showBillModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-8 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-xl">
            <BillUploadFlow
              onComplete={handleBillComplete}
              onClose={() => setShowBillModal(false)}
            />
          </div>
        </div>
      )}

    </AppShell>
  );
}"""
            print("  ✓ Applied alternate AppShell close patch")

# ─── Step 5: Remove unused router import if no longer needed ──────────────────
# Only remove useRouter if it's now only used in handleUploadBill (which we fixed)
# Actually keep it — might be used elsewhere
# Check
if 'router.push' not in content and 'router.' not in content:
    content = content.replace("import { useParams, useRouter } from 'next/navigation';",
                               "import { useParams } from 'next/navigation';")
    content = content.replace("  const router = useRouter();\n", "")
    print("✓ Removed unused router")
else:
    print("✓ router kept (still used elsewhere)")

with open(PAGE_PATH, 'w') as f:
    f.write(content)

print(f"\n✓ Project page written: {PAGE_PATH}")