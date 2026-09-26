// ============================================================
// /api/engineering/save-outputs
// Called after runCalc() completes in the engineering page.
// Saves live engine outputs to project_files table so they
// appear in the Client Engineering Workspace (Client Files tab).
// Also creates an engineering_run record for reverse hydration.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

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
  } catch (e: unknown) {
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
    } catch (e2: unknown) {
      console.warn('[save-outputs] upsertFile failed:', params.fileName, (e2 as Error).message);
      return false;
    }
  }
}

// ── POST /api/engineering/save-outputs ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    // v48.6: Rate limiting — 10 req / 30s per IP (protects heavy compute + external APIs)
        const _rl = await checkRateLimit('engineering', getClientIp(req));
    if (!_rl.allowed) {
      return NextResponse.json(
        { success: false, error: 'Too many requests. Please slow down.' },
        { status: 429 }
      );
    }

    const user = await getUserFromRequest(req);
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

    const sql = await getDbReady();

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

    // ── Create engineering_run record for reverse hydration ──────────────────
    let engineeringRunId: string | null = null;
    try {
      // Ensure engineering_runs table exists
      await sql`
        CREATE TABLE IF NOT EXISTS engineering_runs (
          id                    VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
          project_id            VARCHAR(36)   NOT NULL,
          user_id               VARCHAR(36)   NOT NULL,
          client_id             VARCHAR(36),
          system_size_kw        DECIMAL(8,2)  NOT NULL DEFAULT 0,
          panel_count           INTEGER       NOT NULL DEFAULT 0,
          annual_production_kwh INTEGER,
          panel_id              VARCHAR(100),
          panel_model           VARCHAR(200),
          panel_wattage         INTEGER,
          inverter_id           VARCHAR(100),
          inverter_model        VARCHAR(200),
          inverter_type         VARCHAR(20),
          inverter_qty          INTEGER       DEFAULT 1,
          mounting_id           VARCHAR(100),
          mount_type            VARCHAR(50),
          main_panel_rating     INTEGER,
          backfeed_breaker      INTEGER,
          interconnection_method VARCHAR(50),
          wire_gauge            VARCHAR(30),
          conduit_type          VARCHAR(30),
          rapid_shutdown        BOOLEAN       DEFAULT true,
          ac_disconnect         BOOLEAN       DEFAULT true,
          dc_disconnect         BOOLEAN       DEFAULT true,
          utility_name          VARCHAR(200),
          utility_id            VARCHAR(100),
          state_code            VARCHAR(2),
          address               TEXT,
          ahj                   VARCHAR(200),
          roof_pitch            INTEGER,
          system_type           VARCHAR(20),
          string_config         JSONB         NOT NULL DEFAULT '[]',
          config_snapshot       JSONB         NOT NULL DEFAULT '{}',
          calc_outputs          JSONB         NOT NULL DEFAULT '{}',
          generated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
          created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS idx_eng_runs_project_id ON engineering_runs(project_id)`;

      // Ensure project_files has engineering_run_id column
      await sql`ALTER TABLE project_files ADD COLUMN IF NOT EXISTS engineering_run_id VARCHAR(36)`;

      // 🚨 THIS SNAPSHOT USED TO THROW THE EQUIPMENT IDENTITY AWAY.
      //
      // It was built from scratch and copied exactly ONE key out of the client's
      // configSnapshot (consumptionCtLocation), discarding the rest — including
      // `inverters`, the array that carries every `inverterId`, its strings and their
      // `panelId`. That is the whole selected-equipment identity of the design, sent by
      // app/engineering/page.tsx and dropped here.
      //
      // What it cost, on the restore path: run-from-file returns `panelId`/`inverterId`
      // from columns this INSERT never wrote, so both were always null, and
      // app/engineering/page.tsx then SUBSTITUTED — `MICROINVERTERS[0]` or
      // `STRING_INVERTERS[0]` for the inverter, `qcells-peak-duo-400` for the panel.
      // Reopening a saved run therefore silently re-equipped the design with catalogue
      // defaults, and every downstream artefact — engineering recalc, SLD, permit,
      // equipment schedule, BOM, pricing — was then computed from equipment nobody chose,
      // beside a stored BOM CSV and SLD that describe the equipment that WAS chosen. Two
      // answers in Client Files, both attached to the same engineering_run.
      //
      // So the client's snapshot is preserved and the structured columns are written
      // below. The client's keys come first and are then overridden by the values this
      // route computes, so a stale key in the payload cannot shadow a resolved one.
      const _clientSnap = (body.configSnapshot && typeof body.configSnapshot === 'object')
        ? body.configSnapshot as Record<string, unknown>
        : {};
      const configSnapshot = {
        ..._clientSnap,
        systemKw, panelCount, panelModel, inverterType, inverterModel,
        annualProductionKwh, mountType, stateCode,
        electrical, structural, compliance, permit, runs,
        // The designer's recorded consumption-CT location — the page's
        // run-from-file restore reads it back from here. Absent ⇒ the key is
        // dropped and the restore keeps the interconnection default.
        consumptionCtLocation: typeof body.configSnapshot?.consumptionCtLocation === 'string'
          && body.configSnapshot.consumptionCtLocation ? body.configSnapshot.consumptionCtLocation : undefined,
      };

      // Extract structured fields
      const elec = electrical || {};
      const firstInv = body.configSnapshot?.inverters?.[0] || null;

      // ── The equipment identity, as structured columns ──────────────────────
      // `firstInv` was already computed here and then USED BY NOTHING — the INSERT below
      // never referenced it, which is how the identity columns came to be created, read
      // and never written. They are written now, from the payload the page already sends.
      //
      // NOT INVENTED: an id that is absent stays NULL. A null identity is recoverable
      // (the restore can say "this run predates identity capture" and refuse to
      // substitute); a guessed identity is not.
      const _invId: string | null = typeof firstInv?.inverterId === 'string' && firstInv.inverterId
        ? firstInv.inverterId : null;
      // The panel is recorded per string — the same place `strings` carries it — so the
      // first string of the first inverter is the design's panel, not a re-derivation.
      const _panelId: string | null = typeof firstInv?.strings?.[0]?.panelId === 'string'
        && firstInv.strings[0].panelId ? firstInv.strings[0].panelId : null;
      // The panel id IS the wattage authority (lib/equipment-db.ts resolves watts from it),
      // so this column is not a second source of truth — it is only the legacy fallback the
      // restore path uses for runs saved before an id existed. Recorded when the caller
      // supplies it, never parsed back out of the `panelModel` display string.
      const _panelWatts: number | null = Number.isFinite(Number(body.panelWattage))
        ? Number(body.panelWattage) : null;
      const _mountingId: string | null = typeof _clientSnap.mountingId === 'string'
        && _clientSnap.mountingId ? _clientSnap.mountingId : null;
      // 🚨 `system_type` was never written, so run-from-file's `system_type || 'grid-tied'`
      // returned 'grid-tied' for EVERY run — a value outside the page's
      // SystemType ('roof' | 'ground' | 'fence'). Restoring any saved design therefore
      // forced it out of its own system type, and the next save wrote
      // `mountType: 'Roof Mount'` for a fence or ground array.
      const _systemType: string | null = typeof _clientSnap.systemType === 'string'
        && _clientSnap.systemType ? _clientSnap.systemType : null;
      const _roofPitch: number | null = Number.isFinite(Number(_clientSnap.roofPitch))
        ? Number(_clientSnap.roofPitch) : null;
      // The three switches are BOOLEAN DEFAULT true in the DDL, so never writing them
      // meant a design with rapid shutdown deliberately off restored as on — and with it
      // the rapid-shutdown devices in the BOM. `undefined` keeps the column NULL rather
      // than asserting either state.
      // 🚨 `inverter_qty INTEGER DEFAULT 1`, AND THE ROUTE NEVER WROTE IT — so every run
      // ever saved stored a 1, and both readers coalesced it to 1 as well. That asserted a
      // single inverter for every multi-inverter design in the product.
      //
      // The device count is NOT written here, and NULL is passed explicitly so the column
      // DEFAULT cannot fill it in. A count does not belong in this row: it is a conclusion
      // of the actual electrical topology read against manufacturer capacity — which is
      // exactly what `config_snapshot.inverters` preserves, one entry per inverter with its
      // own strings. Deriving a second number here from `inverters.length` would be a
      // second equipment-quantity authority, and it would be wrong for microinverters,
      // where one entry stands for many devices. NULL means "ask the authority", which is
      // recoverable; a stored 1 is not.
      const _inverterQty: number | null = null;
      const _bool = (v: unknown): boolean | null => typeof v === 'boolean' ? v : null;
      const _rapidShutdown = _bool(_clientSnap.rapidShutdown);
      const _acDisconnect  = _bool(_clientSnap.acDisconnect);
      const _dcDisconnect  = _bool(_clientSnap.dcDisconnect);

      // Older databases were created before these columns existed on this table; the
      // CREATE TABLE IF NOT EXISTS above only builds a NEW one. Additive and idempotent,
      // exactly like the project_files column guard above.
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS panel_id       VARCHAR(100)`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS panel_wattage  INTEGER`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS inverter_id    VARCHAR(100)`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS mounting_id    VARCHAR(100)`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS system_type    VARCHAR(20)`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS roof_pitch     INTEGER`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS rapid_shutdown BOOLEAN`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS ac_disconnect  BOOLEAN`;
      await sql`ALTER TABLE engineering_runs ADD COLUMN IF NOT EXISTS dc_disconnect  BOOLEAN`;

      const runRows = await sql`
        INSERT INTO engineering_runs (
          project_id, user_id, client_id,
          system_size_kw, panel_count, annual_production_kwh,
          panel_id, panel_model, panel_wattage,
          inverter_id, inverter_model, inverter_type, inverter_qty,
          mounting_id, mount_type, system_type, roof_pitch,
          state_code, address, ahj,
          main_panel_rating, backfeed_breaker, interconnection_method,
          wire_gauge, conduit_type,
          rapid_shutdown, ac_disconnect, dc_disconnect,
          utility_name, utility_id,
          string_config, config_snapshot, calc_outputs
        ) VALUES (
          ${projectId}, ${user.id}, ${resolvedClientId},
          ${systemKw || 0}, ${panelCount || 0}, ${annualProductionKwh || null},
          ${_panelId}, ${panelModel || null}, ${_panelWatts},
          ${_invId}, ${inverterModel || null}, ${inverterType || null}, ${_inverterQty},
          ${_mountingId}, ${mountType || null}, ${_systemType}, ${_roofPitch},
          ${stateCode || null},
          ${body.address || null}, ${permit?.ahj || null},
          ${elec.mainPanelBus || null}, ${elec.backfeedBreaker || null},
          ${elec.interconnection || null},
          ${elec.dcWireGauge || null}, ${body.conduitType || null},
          ${_rapidShutdown}, ${_acDisconnect}, ${_dcDisconnect},
          ${permit?.utility || null}, ${body.utilityId || null},
          ${JSON.stringify(body.strings || [])}::jsonb,
          ${JSON.stringify(configSnapshot)}::jsonb,
          ${JSON.stringify({ electrical: elec, structural, compliance, runs })}::jsonb
        )
        RETURNING id
      `;
      engineeringRunId = runRows[0]?.id || null;

      // Attach run_id to all files saved in this run
      if (engineeringRunId) {
        await sql`
          UPDATE project_files
          SET engineering_run_id = ${engineeringRunId}
          WHERE project_id = ${projectId}
            AND user_id = ${user.id}
            AND file_name IN (
              ${`Engineering_Report_${name}.txt`},
              ${`SLD_${name}.svg`},
              ${`BOM_${name}.csv`},
              ${`Permit_Packet_${name}.txt`},
              ${`System_Estimate_${name}.txt`}
            )
        `;
      }
    } catch (runErr: unknown) {
      // Non-fatal — files are already saved, just log the run creation failure
      console.warn('[save-outputs] engineering_run creation failed (non-fatal):', (runErr as Error).message);
    }

    console.log('[save-outputs] Saved', saved.length, 'files for project', projectId, ':', saved.join(', '));
    if (engineeringRunId) console.log('[save-outputs] Engineering run ID:', engineeringRunId);

    return NextResponse.json({ success: true, saved, engineeringRunId });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/engineering/save-outputs]', err);
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

/**
 * The archived procurement document — `BOM_<project>.csv`, attached to the
 * project in Client Files. This is the file the purchaser actually opens.
 *
 * 🚨 IT HAD NO PART NUMBER AND NO COSTS.
 *
 * The header was `Tag,Description,Manufacturer,Model,Qty,Unit,Notes`, so a row
 * read "IronRidge / XR100 Rail System / 8 / ea" with an empty first column: no
 * SKU, no price. `Tag` was ALWAYS empty because `BOMLineItemV4`
 * (lib/bom-types-v4.ts) has no `tag` field — the engine had already resolved
 * `partNumber`, `unitCost` and `totalCost` for every line and all three were
 * dropped on the way to disk. Nothing could be ordered without looking every
 * part number up by hand, and the priced total the estimator quoted could not be
 * reconciled against the archive.
 *
 * Column names below are the real `BOMLineItemV4` fields. `stageLabel`,
 * `necReference` and the `qty`/`mfr`/`desc` aliases are kept because this
 * builder is also fed looser client-side item shapes.
 */
function buildBomCsv(items: any[]): string {
  const header = 'Stage,Category,Manufacturer,Model,Part Number,Qty,Unit,Unit Cost,Total Cost,NEC Ref,Notes';
  const clean = (v: unknown) => String(v ?? '').replace(/,/g, ';').replace(/[\r\n]+/g, ' ');
  // A cost of 0/undefined prints EMPTY, never "$0.00" — an unpriced line must
  // not read as a free line. applyDistributorPricing leaves both undefined when
  // it could not price a row (and always for suggested tools).
  const money = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
  };
  const rows = items.map((item: any) => {
    const stage  = clean(item.stageLabel ?? item.stage);
    const cat    = clean(item.category);
    const mfr    = clean(item.manufacturer ?? item.mfr);
    const model  = clean(item.model);
    const part   = clean(item.partNumber ?? item.part_number);
    const qty    = clean(item.quantity ?? item.qty);
    const unit   = clean(item.unit || 'ea');
    const uCost  = money(item.unitCost);
    const tCost  = money(item.totalCost ?? (Number(item.unitCost) * Number(item.quantity)));
    const nec    = clean(item.necReference ?? item.necRef);
    const notes  = clean(item.notes ?? item.description ?? item.desc);
    return `${stage},${cat},${mfr},${model},${part},${qty},${unit},${uCost},${tCost},${nec},${notes}`;
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