// ============================================================
// Engineering Automation System — Database Functions
// Neon PostgreSQL operations for engineering_reports table
// ============================================================

import { neon } from '@neondatabase/serverless';
import type { EngineeringReport, EngineeringReportRow, EngineeringStatus } from './types';

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url);
}

// ── Ensure table exists (idempotent) ─────────────────────────────────────────
export async function ensureEngineeringTable(): Promise<void> {
  const sql = getDb();
  await sql`
    CREATE TABLE IF NOT EXISTS engineering_reports (
      id                  VARCHAR(36)   PRIMARY KEY DEFAULT gen_random_uuid()::text,
      project_id          VARCHAR(36)   NOT NULL,
      layout_id           VARCHAR(36),
      design_version_id   VARCHAR(32)   NOT NULL DEFAULT '',
      status              VARCHAR(20)   NOT NULL DEFAULT 'pending',
      panel_count         INTEGER       NOT NULL DEFAULT 0,
      system_kw           DECIMAL(8,2)  NOT NULL DEFAULT 0,
      mount_type          VARCHAR(50)   NOT NULL DEFAULT 'roof',
      inverter_model      VARCHAR(200)  NOT NULL DEFAULT '',
      panel_model         VARCHAR(200)  NOT NULL DEFAULT '',
      roof_segments       JSONB         NOT NULL DEFAULT '[]',
      ground_arrays       JSONB         NOT NULL DEFAULT '[]',
      fence_arrays        JSONB         NOT NULL DEFAULT '[]',
      utility_provider    VARCHAR(200)  NOT NULL DEFAULT '',
      ahj                 VARCHAR(200)  NOT NULL DEFAULT '',
      report_data         JSONB         NOT NULL DEFAULT '{}',
      generated_at        TIMESTAMPTZ,
      generated_by        VARCHAR(20)   NOT NULL DEFAULT 'auto',
      version             VARCHAR(20)   NOT NULL DEFAULT '1.0',
      created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `;
  
  // Create index if not exists
  await sql`
    CREATE INDEX IF NOT EXISTS idx_eng_reports_project_id 
    ON engineering_reports(project_id)
  `;
}

// ── Upsert Engineering Report ─────────────────────────────────────────────────
export async function upsertEngineeringReport(
  report: EngineeringReport,
  projectId: string
): Promise<EngineeringReportRow> {
  const sql = getDb();
  
  // Ensure table exists
  await ensureEngineeringTable();
  
  const { systemSummary, electrical, structural } = report;
  
  // Check if report exists for this project
  const existing = await sql`
    SELECT id FROM engineering_reports WHERE project_id = ${projectId} LIMIT 1
  `;
  
  if (existing.length > 0) {
    // UPDATE existing report
    const rows = await sql`
      UPDATE engineering_reports SET
        layout_id         = ${report.layoutId},
        design_version_id = ${report.designVersionId},
        status            = ${report.status},
        panel_count       = ${systemSummary.panelCount},
        system_kw         = ${systemSummary.systemSizeKw},
        mount_type        = ${systemSummary.mountType},
        inverter_model    = ${systemSummary.inverterModel},
        panel_model       = ${systemSummary.panelModel},
        roof_segments     = ${JSON.stringify(report.panelLayout.roofSegments)}::jsonb,
        ground_arrays     = ${JSON.stringify([])}::jsonb,
        fence_arrays      = ${JSON.stringify([])}::jsonb,
        utility_provider  = ${systemSummary.utilityName},
        ahj               = ${systemSummary.ahj},
        report_data       = ${JSON.stringify(report)}::jsonb,
        generated_at      = ${report.generatedAt},
        generated_by      = ${report.generatedBy},
        version           = ${report.version},
        updated_at        = NOW()
      WHERE project_id = ${projectId}
      RETURNING *
    `;
    return rows[0] as EngineeringReportRow;
  } else {
    // INSERT new report
    const rows = await sql`
      INSERT INTO engineering_reports (
        id, project_id, layout_id, design_version_id, status,
        panel_count, system_kw, mount_type, inverter_model, panel_model,
        roof_segments, ground_arrays, fence_arrays,
        utility_provider, ahj, report_data,
        generated_at, generated_by, version
      ) VALUES (
        ${report.id},
        ${projectId},
        ${report.layoutId},
        ${report.designVersionId},
        ${report.status},
        ${systemSummary.panelCount},
        ${systemSummary.systemSizeKw},
        ${systemSummary.mountType},
        ${systemSummary.inverterModel},
        ${systemSummary.panelModel},
        ${JSON.stringify(report.panelLayout.roofSegments)}::jsonb,
        ${JSON.stringify([])}::jsonb,
        ${JSON.stringify([])}::jsonb,
        ${systemSummary.utilityName},
        ${systemSummary.ahj},
        ${JSON.stringify(report)}::jsonb,
        ${report.generatedAt},
        ${report.generatedBy},
        ${report.version}
      )
      RETURNING *
    `;
    return rows[0] as EngineeringReportRow;
  }
}

// ── Get Latest Engineering Report ────────────────────────────────────────────
export async function getEngineeringReport(
  projectId: string
): Promise<EngineeringReport | null> {
  const sql = getDb();
  
  try {
    await ensureEngineeringTable();
    
    const rows = await sql`
      SELECT report_data, design_version_id, status, updated_at
      FROM engineering_reports
      WHERE project_id = ${projectId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    
    if (rows.length === 0) return null;
    
    const row = rows[0];
    const report = row.report_data as EngineeringReport;
    
    // Inject DB metadata
    report.status = row.status as EngineeringStatus;
    
    return report;
  } catch (err) {
    console.error('[engineering] getEngineeringReport error:', err);
    return null;
  }
}

// ── Check if Report is Stale ──────────────────────────────────────────────────
export async function isEngineeringReportStale(
  projectId: string,
  currentDesignVersionId: string
): Promise<boolean> {
  const sql = getDb();
  
  try {
    await ensureEngineeringTable();
    
    const rows = await sql`
      SELECT design_version_id FROM engineering_reports
      WHERE project_id = ${projectId}
      LIMIT 1
    `;
    
    if (rows.length === 0) return true; // No report = stale
    return rows[0].design_version_id !== currentDesignVersionId;
  } catch {
    return true;
  }
}

// ── Mark Report as Stale ──────────────────────────────────────────────────────
export async function markEngineeringReportStale(projectId: string): Promise<void> {
  const sql = getDb();
  
  try {
    await ensureEngineeringTable();
    await sql`
      UPDATE engineering_reports
      SET status = 'stale', updated_at = NOW()
      WHERE project_id = ${projectId}
    `;
  } catch (err) {
    console.error('[engineering] markStale error:', err);
  }
}

// ── Generate unique report ID ─────────────────────────────────────────────────
export function generateReportId(): string {
  return `eng_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}