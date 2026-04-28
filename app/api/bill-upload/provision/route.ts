// ============================================================
// POST /api/bill-upload/provision
//
// Omnidirectional pipeline entry point.
// Takes parsed bill data and atomically:
//   1. Creates (or finds existing) client from bill data
//   2. Creates project linked to client
//   3. Saves bill record to bills table
//   4. Writes bill data file to project_files hub
//   5. Returns { clientId, projectId } so UI navigates to /design
//
// This is the HUB ACTIVATION endpoint. After this call, every
// downstream engine (design, engineering, permit) can read from
// the project_files hub for this client/project.
// ============================================================

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, createClient, createProject, saveBill, handleRouteDbError, isValidUUID } from '@/lib/db-neon';
import { validateAndCorrectUtilityRate } from '@/lib/utility-rules';
import { syncProjectPipeline } from '@/lib/engineering/syncPipeline';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BillData {
  customerName?: string;
  serviceAddress?: string;
  utilityProvider?: string;
  accountNumber?: string;
  monthlyKwh?: number;
  annualKwh?: number;
  estimatedAnnualKwh?: number;
  electricityRate?: number;
  totalAmount?: number;
  estimatedMonthlyBill?: number;
  monthlyUsageHistory?: number[];
  confidence?: string;
  extractedFields?: string[];
  rawText?: string;
  [key: string]: unknown;
}

interface LocationData {
  city?: string;
  state?: string;
  stateCode?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  county?: string;
}

interface UtilityData {
  utilityName?: string;
  avgRatePerKwh?: number;
  netMeteringEligible?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveClientName(bill: BillData): string {
  if (bill.customerName?.trim()) return bill.customerName.trim();
  // Fall back to address-based name
  if (bill.serviceAddress?.trim()) {
    const parts = bill.serviceAddress.split(',');
    return parts[0].trim() || 'New Client';
  }
  return 'New Client';
}

function deriveClientEmail(name: string): string {
  // Generate a placeholder email from the name — user can update later
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '.');
  return `${slug}.solar@placeholder.solarpro`;
}

function deriveAnnualKwh(bill: BillData): number {
  if (bill.annualKwh && bill.annualKwh > 0) return Math.round(bill.annualKwh);
  if (bill.estimatedAnnualKwh && bill.estimatedAnnualKwh > 0) return Math.round(bill.estimatedAnnualKwh);
  if (bill.monthlyUsageHistory && bill.monthlyUsageHistory.length > 0) {
    const sum = bill.monthlyUsageHistory.reduce((a, b) => a + b, 0);
    const avg = sum / bill.monthlyUsageHistory.length;
    return Math.round(avg * 12);
  }
  if (bill.monthlyKwh && bill.monthlyKwh > 0) return Math.round(bill.monthlyKwh * 12);
  return 12000; // Conservative default
}

function deriveSystemSizeKw(annualKwh: number, lat?: number): number {
  const sunHours = (lat && lat > 0)
    ? (lat < 25 ? 5.5 : lat < 30 ? 5.2 : lat < 35 ? 4.8 : lat < 40 ? 4.4 : lat < 45 ? 4.0 : 3.6)
    : 4.5; // Default mid-lat
  const kwhPerKwPerYear = sunHours * 365 * 0.80;
  return Math.round((annualKwh / kwhPerKwPerYear) * 10) / 10;
}

// ── upsertFile (mirrors pipeline/run pattern) ─────────────────────────────────

async function upsertHubFile(sql: ReturnType<typeof getDbReady> extends Promise<infer T> ? T : never, params: {
  projectId: string;
  clientId: string | null;
  userId: string;
  fileName: string;
  fileType: string;
  mimeType: string;
  content: string;
  notes: string;
}): Promise<void> {
  const b = Buffer.from(params.content, 'utf8');
  try {
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${params.projectId}, ${params.clientId}, ${params.userId},
         ${params.fileName}, ${params.fileType}, ${b.length},
         ${params.mimeType}, ${b}, ${params.notes})
      ON CONFLICT (project_id, user_id, file_name)
      DO UPDATE SET
        client_id   = EXCLUDED.client_id,
        file_type   = EXCLUDED.file_type,
        file_size   = EXCLUDED.file_size,
        mime_type   = EXCLUDED.mime_type,
        file_data   = EXCLUDED.file_data,
        notes       = EXCLUDED.notes,
        upload_date = NOW()
    `;
  } catch {
    // Fallback: DELETE + INSERT if ON CONFLICT not available
    const b2 = Buffer.from(params.content, 'utf8');
    await sql`DELETE FROM project_files WHERE project_id = ${params.projectId} AND user_id = ${params.userId} AND file_name = ${params.fileName}`;
    await sql`
      INSERT INTO project_files
        (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
      VALUES
        (${params.projectId}, ${params.clientId}, ${params.userId},
         ${params.fileName}, ${params.fileType}, ${b2.length},
         ${params.mimeType}, ${b2}, ${params.notes})
    `;
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('bill-upload', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json() as {
      billData: BillData;
      locationData?: LocationData;
      utilityData?: UtilityData;
      systemKw?: number;
      systemType?: 'roof' | 'ground' | 'fence';
    };

    const { billData, locationData, utilityData, systemKw, systemType: bodySystemType } = body;

    if (!billData) {
      return NextResponse.json({ success: false, error: 'billData required' }, { status: 400 });
    }

    console.log('[PROVISION_STARTED]', {
      userId: user.id,
      confidence: billData.confidence,
    });

    // ── Step 1: Derive client fields from bill data ───────────────────────────
    const clientName  = deriveClientName(billData);
    const clientEmail = deriveClientEmail(clientName);
    const annualKwh   = deriveAnnualKwh(billData);
    const avgMonthly  = Math.round(annualKwh / 12);
    // Always use validated retail rate — OCR often extracts supply-only component (e.g. CMP $0.069)
    // instead of all-in retail ($0.265). validateAndCorrectUtilityRate uses the authoritative
    // utility DB rate when the extracted rate is missing, suspect, or unreasonably low.
    const utilityName_raw = billData.utilityProvider ?? utilityData?.utilityName ?? null;
    const rateValidation = validateAndCorrectUtilityRate(
      billData.electricityRate ?? utilityData?.avgRatePerKwh ?? null,
      utilityName_raw,
    );
    const utilityRate = rateValidation.rate;
    console.log(`[PROVISION_RATE] extracted=${billData.electricityRate ?? 'none'} validated=${utilityRate} source=${rateValidation.source} corrected=${rateValidation.corrected} utility=${utilityName_raw ?? 'unknown'}`);
    const systemSizeKw = systemKw ?? deriveSystemSizeKw(annualKwh, locationData?.lat);

    // Parse address components
    const address  = billData.serviceAddress?.trim() || '';
    const city     = locationData?.city     || '';
    const state    = locationData?.state    || locationData?.stateCode || '';
    const zip      = locationData?.zip      || '';
    const lat      = locationData?.lat;
    const lng      = locationData?.lng;

    const monthlyHistory = billData.monthlyUsageHistory?.filter(v => v > 0) || [];

    // ── Step 2: Create client ─────────────────────────────────────────────────
    const client = await createClient({
      userId:             user.id,
      name:               clientName,
      email:              clientEmail,
      address,
      city,
      state,
      zip,
      lat,
      lng,
      utilityProvider:    billData.utilityProvider ?? utilityData?.utilityName ?? '',
      monthlyKwh:         monthlyHistory.length > 0 ? monthlyHistory : undefined,
      annualKwh,
      averageMonthlyKwh:  avgMonthly,
      averageMonthlyBill: billData.estimatedMonthlyBill ?? billData.totalAmount ?? avgMonthly * utilityRate,
      annualBill:         (billData.estimatedMonthlyBill ?? billData.totalAmount ?? avgMonthly * utilityRate) * 12,
      utilityRate,
    });

    console.log('[PROVISION_CLIENT_CREATED]', { clientId: client.id, userId: user.id });

    // ── Step 3: Create project linked to client ───────────────────────────────
    const projectName = `${clientName} — Solar`;
    const project = await createProject({
      userId:           user.id,
      clientId:         client.id,
      name:             projectName,
      systemType:       (bodySystemType && ['roof','ground','fence'].includes(bodySystemType)) ? bodySystemType : 'roof',
      address,
      lat,
      lng,
      stateCode:        locationData?.stateCode || state,
      city,
      county:           locationData?.county || '',
      zip,
      utilityName:      billData.utilityProvider ?? utilityData?.utilityName ?? '',
      utilityRatePerKwh: utilityRate,
      systemSizeKw,
      billData: {
        ...billData,
        rawText: undefined, // Don't store full OCR text in project record
      } as Record<string, unknown>,
    });

    console.log('[PROVISION_PROJECT_CREATED]', { projectId: project.id, clientId: client.id });

    // ── Step 4: Save bill record ──────────────────────────────────────────────
    await saveBill({
      projectId:  project.id,
      userId:     user.id,
      utilityName: billData.utilityProvider ?? utilityData?.utilityName ?? null,
      monthlyKwh:  billData.monthlyKwh ?? avgMonthly,
      annualKwh,
      electricRate: utilityRate,
      parsedJson: billData as Record<string, unknown>,
    });

    console.log('[PROVISION_BILL_SAVED]', { projectId: project.id });

    // ── Step 5: Write hub files to project_files ──────────────────────────────
    // This activates the client's engineering hub slot so all downstream
    // engines (design, engineering, permit) can read from it.
    const sql = await getDbReady();
    const now  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // File 1: Client Profile (JSON — all engines can read this)
    const clientProfile = {
      clientId:           client.id,
      projectId:          project.id,
      clientName,
      serviceAddress:     address,
      city, state, zip,
      lat, lng,
      utilityProvider:    billData.utilityProvider ?? utilityData?.utilityName ?? '',
      utilityRate,
      annualKwh,
      averageMonthlyKwh:  avgMonthly,
      monthlyHistory,
      systemSizeKw,
      netMeteringEligible: utilityData?.netMeteringEligible ?? false,
      provisionedAt:      new Date().toISOString(),
    };

    await upsertHubFile(sql, {
      projectId: project.id,
      clientId:  client.id,
      userId:    user.id,
      fileName:  'Client_Profile.json',
      fileType:  'client_profile',
      mimeType:  'application/json',
      content:   JSON.stringify(clientProfile, null, 2),
      notes:     'Auto-generated from utility bill upload. Contains client energy profile for all downstream engines.',
    });

    // File 2: Utility Bill Summary (human-readable text)
    const billSummary = [
      `UTILITY BILL SUMMARY`,
      `Generated: ${now}`,
      ``,
      `CLIENT INFORMATION`,
      `  Name:              ${clientName}`,
      `  Service Address:   ${address}`,
      `  City/State/ZIP:    ${city}, ${state} ${zip}`,
      `  Account Number:    ${billData.accountNumber ?? 'N/A'}`,
      ``,
      `UTILITY DATA`,
      `  Provider:          ${billData.utilityProvider ?? utilityData?.utilityName ?? 'N/A'}`,
      `  Rate:              $${utilityRate.toFixed(4)}/kWh`,
      `  Net Metering:      ${utilityData?.netMeteringEligible ? 'Eligible' : 'Check AHJ'}`,
      ``,
      `ENERGY USAGE`,
      `  Monthly kWh:       ${billData.monthlyKwh ?? avgMonthly} kWh`,
      `  Annual kWh:        ${annualKwh.toLocaleString()} kWh`,
      `  Avg Monthly Bill:  $${(billData.estimatedMonthlyBill ?? billData.totalAmount ?? avgMonthly * utilityRate).toFixed(2)}`,
      monthlyHistory.length > 0
        ? `  Monthly History:   ${monthlyHistory.join(', ')} kWh`
        : `  Monthly History:   Not available`,
      ``,
      `SYSTEM SIZING (ESTIMATED)`,
      `  Recommended Size:  ${systemSizeKw} kW DC`,
      `  Based On:          ${annualKwh.toLocaleString()} kWh/yr @ ${locationData?.lat ? locationData.lat.toFixed(2) + '° lat' : 'avg sun hours'}`,
      ``,
      `EXTRACTION CONFIDENCE`,
      `  Confidence:        ${billData.confidence ?? 'N/A'}`,
      `  Fields Extracted:  ${(billData.extractedFields ?? []).join(', ') || 'N/A'}`,
    ].join('\n');

    await upsertHubFile(sql, {
      projectId: project.id,
      clientId:  client.id,
      userId:    user.id,
      fileName:  'Utility_Bill_Summary.txt',
      fileType:  'utility_bill',
      mimeType:  'text/plain',
      content:   billSummary,
      notes:     'Utility bill data extracted via OCR/AI. Used by engineering engine for system sizing and permit documents.',
    });

    console.log('[PROVISION_HUB_ACTIVATED]', {
      projectId: project.id,
      clientId:  client.id,
      filesWritten: ['Client_Profile.json', 'Utility_Bill_Summary.txt'],
    });

    // ── Trigger pipeline (non-fatal best-effort) ───────────────────────
    // Bill upload is a PIPELINE TRIGGER EVENT per canonical directive.
    // Pipeline will be a no-op now (no layout yet) but warms the project.
    // It WILL succeed after layout save (triggered again by layout route).
    try {
      console.log('[PIPELINE_TRIGGER] bill-upload/provision → syncProjectPipeline', { projectId: project.id });
      syncProjectPipeline(project.id, user.id).catch((pipeErr: any) => {
        console.warn('[PIPELINE_TRIGGER_SKIPPED] no layout yet — expected:', pipeErr?.message ?? String(pipeErr));
      });
    } catch (pipeStartErr: unknown) {
      console.warn('[PIPELINE_TRIGGER_ERROR] bill-upload/provision:', (pipeStartErr as Error)?.message ?? String(pipeStartErr));
    }

    // ── Response ──────────────────────────────────────────────────────────────
    return NextResponse.json({
      success:    true,
      clientId:   client.id,
      projectId:  project.id,
      clientName,
      projectName,
      systemSizeKw,
      annualKwh,
      hubFiles:   ['Client_Profile.json', 'Utility_Bill_Summary.txt'],
      message:    'Client and project created. Hub activated. Navigate to design studio.',
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error).message : String(err);
    console.error('[PROVISION_ERROR]', msg);
    return handleRouteDbError('[POST /api/bill-upload/provision]', err);
  }
}