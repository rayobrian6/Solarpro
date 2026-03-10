// ============================================================
// /api/engineering/save-outputs
// Called after runCalc() completes in the engineering page.
// Saves live engine outputs to project_files table so they
// appear in the Client Engineering Workspace (Client Files tab).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export const dynamic = 'force-dynamic';

// ── helpers ──────────────────────────────────────────────────────────────────

function buf(text: string): Buffer {
  return Buffer.from(text, 'utf8');
}

async function upsertFile(sql: any, params: {
  projectId: string;
  clientId:  string | null;
  userId:    string;
  fileName:  string;
  fileType:  string;
  mimeType:  string;
  content:   string;
  notes:     string;
}) {
  try {
    const b = buf(params.content);
    // Atomic upsert — unique on (project_id, user_id, file_name)
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
    return true;
  } catch (e: any) {
    // Fallback: if unique constraint does not exist yet, use DELETE+INSERT
    try {
      const b2 = buf(params.content);
      await sql`
        DELETE FROM project_files
        WHERE project_id = ${params.projectId}
          AND user_id    = ${params.userId}
          AND file_name  = ${params.fileName}
      `;
      await sql`
        INSERT INTO project_files
          (project_id, client_id, user_id, file_name, file_type, file_size, mime_type, file_data, notes)
        VALUES
          (${params.projectId}, ${params.clientId}, ${params.userId},
           ${params.fileName}, ${params.fileType}, ${b2.length},
           ${params.mimeType}, ${b2}, ${params.notes})
      `;
      return true;
    } catch (e2: any) {
      console.warn('[save-outputs] upsertFile failed:', params.fileName, e2.message);
      return false;
    }
  }
}

// ── POST /api/engineering/save-outputs ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const {
      projectId,
      clientId,
      clientName,
      // System summary
      systemKw,
      panelCount,
      panelModel,
      inverterType,
      inverterModel,
      annualProductionKwh,
      mountType,
      stateCode,
      // Electrical
      electrical,
      // Structural
      structural,
      // Compliance
      compliance,
      // BOM items array
      bomItems,
      // SLD svg string
      sldSvg,
      // Permit data
      permit,
      // Runs (wire schedule)
      runs,
    } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }

    const sql = getDb();

    // Verify ownership
    const projectCheck = await sql`
      SELECT id, client_id FROM projects
      WHERE id = ${projectId} AND user_id = ${user.id} AND deleted_at IS NULL
    `;
    if (projectCheck.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const resolvedClientId = clientId || projectCheck[0].client_id || null;
    const name = (clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
    const reportDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const saved: string[] = [];

    // ── 1. Engineering Report ─────────────────────────────────────────────────
    const engReport = buildEngineeringReport({
      clientName: clientName || 'Client',
      reportDate,
      systemKw,
      panelCount,
      panelModel,
      inverterType,
      inverterModel,
      annualProductionKwh,
      mountType,
      stateCode,
      electrical,
      structural,
      compliance,
      runs,
    });
    const r1 = await upsertFile(sql, {
      projectId,
      clientId: resolvedClientId,
      userId:   user.id,
      fileName: `Engineering_Report_${name}.txt`,
      fileType: 'engineering',
      mimeType: 'text/plain',
      content:  engReport,
      notes:    'Live engineering report — auto-generated after calc',
    });
    if (r1) saved.push('engineering_report');

    // ── 2. Single-Line Diagram (SVG) ──────────────────────────────────────────
    if (sldSvg) {
      const r2 = await upsertFile(sql, {
        projectId,
        clientId: resolvedClientId,
        userId:   user.id,
        fileName: `SLD_${name}.svg`,
        fileType: 'engineering',
        mimeType: 'image/svg+xml',
        content:  sldSvg,
        notes:    'Single-line diagram — auto-generated after calc',
      });
      if (r2) saved.push('sld');
    }

    // ── 3. Bill of Materials (CSV) ────────────────────────────────────────────
    if (bomItems && bomItems.length > 0) {
      const bomCsv = buildBomCsv(bomItems);
      const r3 = await upsertFile(sql, {
        projectId,
        clientId: resolvedClientId,
        userId:   user.id,
        fileName: `BOM_${name}.csv`,
        fileType: 'engineering',
        mimeType: 'text/csv',
        content:  bomCsv,
        notes:    'Bill of materials — auto-generated after calc',
      });
      if (r3) saved.push('bom');
    }

    // ── 4. Permit Packet ──────────────────────────────────────────────────────
    const permitText = buildPermitPacket({
      clientName: clientName || 'Client',
      reportDate,
      systemKw,
      panelCount,
      panelModel,
      inverterType,
      inverterModel,
      stateCode,
      electrical,
      structural,
      permit,
      compliance,
    });
    const r4 = await upsertFile(sql, {
      projectId,
      clientId: resolvedClientId,
      userId:   user.id,
      fileName: `Permit_Packet_${name}.txt`,
      fileType: 'engineering',
      mimeType: 'text/plain',
      content:  permitText,
      notes:    'Permit packet — auto-generated after calc',
    });
    if (r4) saved.push('permit_packet');

    // ── 5. System Estimate ────────────────────────────────────────────────────
    const estimateText = buildSystemEstimate({
      clientName: clientName || 'Client',
      reportDate,
      systemKw,
      panelCount,
      annualProductionKwh,
      stateCode,
    });
    const r5 = await upsertFile(sql, {
      projectId,
      clientId: resolvedClientId,
      userId:   user.id,
      fileName: `System_Estimate_${name}.txt`,
      fileType: 'engineering',
      mimeType: 'text/plain',
      content:  estimateText,
      notes:    'System estimate — auto-generated after calc',
    });
    if (r5) saved.push('system_estimate');

    console.log('[save-outputs] Saved', saved.length, 'files for project', projectId, ':', saved.join(', '));

    return NextResponse.json({ success: true, saved });
  } catch (err: any) {
    console.error('[save-outputs] Error:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// ── Content builders ──────────────────────────────────────────────────────────

function buildEngineeringReport(p: any): string {
  const elec = p.electrical || {};
  const struct = p.structural || {};
  const comp = p.compliance || {};
  const runs = p.runs || [];

  const lines = [
    '═══════════════════════════════════════════════════════════════',
    '  ENGINEERING REPORT',
    `  ${p.clientName}`,
    `  Generated: ${p.reportDate}`,
    '═══════════════════════════════════════════════════════════════',
    '',
    '── SYSTEM SUMMARY ──────────────────────────────────────────────',
    `  System Size (DC):       ${p.systemKw ?? 'N/A'} kW`,
    `  Panel Count:            ${p.panelCount ?? 'N/A'}`,
    `  Panel Model:            ${p.panelModel ?? 'Generic 400W Monocrystalline'}`,
    `  Inverter Type:          ${p.inverterType ?? 'String'}`,
    `  Inverter Model:         ${p.inverterModel ?? 'TBD'}`,
    `  Est. Annual Production: ${p.annualProductionKwh ? p.annualProductionKwh.toLocaleString() + ' kWh' : 'N/A'}`,
    `  Mount Type:             ${p.mountType ?? 'Roof Mount'}`,
    `  State:                  ${p.stateCode ?? 'N/A'}`,
    '',
    '── ELECTRICAL ENGINEERING ──────────────────────────────────────',
    `  DC System Size:         ${elec.dcSystemKw ?? p.systemKw ?? 'N/A'} kW`,
    `  AC System Size:         ${elec.acSystemKw ?? 'N/A'} kW`,
    `  String Count:           ${elec.stringCount ?? 'N/A'}`,
    `  Panels per String:      ${elec.panelsPerString ?? 'N/A'}`,
    `  String Voc:             ${elec.stringVoc ?? 'N/A'} V`,
    `  String Isc:             ${elec.stringIsc ?? 'N/A'} A`,
    `  DC Wire:                ${elec.dcWireGauge ?? '#10 AWG'}`,
    `  DC Conduit:             ${elec.dcConduitSize ?? '3/4" EMT'}`,
    `  DC Disconnect:          ${elec.dcDisconnect ?? '15A, 600VDC'}`,
    `  AC Wire:                ${elec.acWireGauge ?? '#8 AWG'}`,
    `  AC Conduit:             ${elec.acConduitSize ?? '1" EMT'}`,
    `  AC Breaker:             ${elec.acBreaker ?? 'N/A'} A`,
    `  Main Panel Bus:         ${elec.mainPanelBus ?? 'N/A'} A`,
    `  Backfeed Breaker:       ${elec.backfeedBreaker ?? 'N/A'} A`,
    `  Interconnection:        ${elec.interconnection ?? 'Supply-Side Tap'}`,
    '',
    '── COMPLIANCE ──────────────────────────────────────────────────',
    `  NEC Version:            ${comp.necVersion ?? 'NEC 2020'}`,
    `  Electrical Status:      ${comp.electricalStatus ?? 'N/A'}`,
    `  Structural Status:      ${comp.structuralStatus ?? 'N/A'}`,
    `  Rapid Shutdown:         ${comp.rapidShutdown ?? 'Required'}`,
    '',
  ];

  if (runs.length > 0) {
    lines.push('── WIRE SCHEDULE ───────────────────────────────────────────────');
    for (const run of runs) {
      lines.push(`  ${run.id ?? run.label ?? 'Run'}: ${run.wireGauge ?? ''} ${run.conduitSize ?? ''} ${run.ocpdAmps ? run.ocpdAmps + 'A OCPD' : ''}`);
    }
    lines.push('');
  }

  if (struct && struct.rafter) {
    lines.push('── STRUCTURAL ENGINEERING ──────────────────────────────────────');
    lines.push(`  Roof Type:              ${struct.roofType ?? 'Asphalt Shingle'}`);
    lines.push(`  Rafter Size:            ${struct.rafter?.rafterSize ?? '2×6'}`);
    lines.push(`  Rafter Spacing:         ${struct.rafter?.rafterSpacing ?? '24"'} O.C.`);
    lines.push(`  Wind Speed:             ${struct.wind?.designWindSpeed ?? 'N/A'} mph`);
    lines.push(`  Snow Load:              ${struct.snow?.groundSnowLoad ?? 0} psf`);
    lines.push(`  Attachment Type:        ${struct.attachment ? 'Lag Bolt to Rafter' : 'N/A'}`);
    lines.push(`  Attachment Spacing:     ${struct.attachment?.attachmentSpacing ?? 'N/A'} O.C.`);
    lines.push(`  Structural Status:      ${struct.status ?? 'N/A'}`);
    lines.push('');
  }

  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  This report was auto-generated by SolarPro Engineering Engine.');
  lines.push('  For permit submission, obtain engineer stamp as required by AHJ.');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

function buildBomCsv(items: any[]): string {
  const header = 'Tag,Description,Manufacturer,Model,Qty,Unit,Notes';
  const rows = items.map((item: any) => {
    const tag   = (item.tag   || '').replace(/,/g, ';');
    const desc  = (item.description || item.desc || '').replace(/,/g, ';');
    const mfr   = (item.manufacturer || item.mfr || '').replace(/,/g, ';');
    const model = (item.model || '').replace(/,/g, ';');
    const qty   = item.qty ?? item.quantity ?? '';
    const unit  = (item.unit || 'EA').replace(/,/g, ';');
    const notes = (item.notes || item.source || '').replace(/,/g, ';');
    return `${tag},${desc},${mfr},${model},${qty},${unit},${notes}`;
  });
  return [header, ...rows].join('\n');
}

function buildPermitPacket(p: any): string {
  const elec   = p.electrical || {};
  const struct = p.structural || {};
  const permit = p.permit || {};
  const comp   = p.compliance || {};

  return [
    '═══════════════════════════════════════════════════════════════',
    '  PERMIT PACKAGE',
    `  ${p.clientName}`,
    `  Generated: ${p.reportDate}`,
    '═══════════════════════════════════════════════════════════════',
    '',
    '── PROJECT INFORMATION ─────────────────────────────────────────',
    `  Client:                 ${p.clientName}`,
    `  System Size:            ${p.systemKw ?? 'N/A'} kW DC`,
    `  Panel Count:            ${p.panelCount ?? 'N/A'}`,
    `  Panel Model:            ${p.panelModel ?? 'Generic 400W Monocrystalline'}`,
    `  Inverter Type:          ${p.inverterType ?? 'String'}`,
    `  Inverter Model:         ${p.inverterModel ?? 'TBD'}`,
    `  State:                  ${p.stateCode ?? 'N/A'}`,
    '',
    '── AHJ & CODE COMPLIANCE ───────────────────────────────────────',
    `  AHJ:                    ${permit.ahj ?? 'Unknown AHJ'}`,
    `  NEC Version:            ${comp.necVersion ?? 'NEC 2020'}`,
    `  Utility:                ${permit.utility ?? 'Unknown Utility'}`,
    `  Interconnection:        ${elec.interconnection ?? 'Supply-Side Tap'}`,
    `  Est. Permit Fee:        ${permit.estimatedFee ? '$' + permit.estimatedFee : 'N/A'}`,
    `  Prepared Date:          ${p.reportDate}`,
    '',
    '── REQUIRED DOCUMENTS ──────────────────────────────────────────',
    '  ☐ Site Plan (roof layout with setbacks)',
    '  ☐ Single-Line Diagram (NEC compliant)',
    '  ☐ Equipment Cut Sheets (panels, inverter, mounting)',
    '  ☐ Structural Analysis (roof loading)',
    '  ☐ Electrical Calculations',
    '  ☐ Utility Interconnection Application',
    '',
    '── ELECTRICAL SUMMARY ──────────────────────────────────────────',
    `  DC System Size:         ${elec.dcSystemKw ?? p.systemKw ?? 'N/A'} kW`,
    `  AC System Size:         ${elec.acSystemKw ?? 'N/A'} kW`,
    `  AC Breaker:             ${elec.acBreaker ?? 'N/A'} A`,
    `  Main Panel Bus:         ${elec.mainPanelBus ?? 'N/A'} A`,
    `  Backfeed Breaker:       ${elec.backfeedBreaker ?? 'N/A'} A`,
    `  Rapid Shutdown:         ${comp.rapidShutdown ?? 'Required — NEC 690.12'}`,
    '',
    '── STRUCTURAL SUMMARY ──────────────────────────────────────────',
    `  Roof Type:              ${struct.roofType ?? 'Asphalt Shingle'}`,
    `  Wind Speed:             ${struct.wind?.designWindSpeed ?? 'N/A'} mph (ASCE 7-22)`,
    `  Snow Load:              ${struct.snow?.groundSnowLoad ?? 0} psf`,
    `  Attachment:             Lag Bolt to Rafter`,
    `  Structural Status:      ${struct.status ?? comp.structuralStatus ?? 'N/A'}`,
    '',
    '═══════════════════════════════════════════════════════════════',
    '  Auto-generated by SolarPro. Obtain engineer stamp as required.',
    '═══════════════════════════════════════════════════════════════',
  ].join('\n');
}

function buildSystemEstimate(p: any): string {
  return [
    '═══════════════════════════════════════════════════════════════',
    '  SYSTEM ESTIMATE',
    `  ${p.clientName}`,
    `  Generated: ${p.reportDate}`,
    '═══════════════════════════════════════════════════════════════',
    '',
    '── SYSTEM SPECIFICATIONS ───────────────────────────────────────',
    `  System Size:            ${p.systemKw ?? 'N/A'} kW DC`,
    `  Panel Count:            ${p.panelCount ?? 'N/A'} panels`,
    `  Est. Annual Production: ${p.annualProductionKwh ? p.annualProductionKwh.toLocaleString() + ' kWh' : 'N/A'}`,
    `  State:                  ${p.stateCode ?? 'N/A'}`,
    '',
    '── NOTES ───────────────────────────────────────────────────────',
    '  This estimate is based on live engineering engine calculations.',
    '  Final pricing subject to site assessment and equipment availability.',
    '',
    '═══════════════════════════════════════════════════════════════',
    '  Auto-generated by SolarPro Engineering Engine v39.1',
    '═══════════════════════════════════════════════════════════════',
  ].join('\n');
}