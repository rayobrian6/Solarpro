/**
 * lib/db/bills.ts
 * Bill DB operations — extracted from lib/db-neon.ts.
 */

import { getDbReady, isValidUUID } from './core';

// BILLS — persistent bill storage per project
// ============================================================

export interface DbBill {
  id: string;
  projectId: string;
  userId: string;
  utilityName: string | null;
  monthlyKwh: number | null;
  annualKwh: number | null;
  electricRate: number | null;
  fileUrl: string | null;
  parsedJson: Record<string, unknown> | null;
  createdAt: string;
}

function rowToBill(row: Record<string, unknown>): DbBill {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    userId: row.user_id as string,
    utilityName: (row.utility_name as string) || null,
    monthlyKwh: (row.monthly_kwh as number) || null,
    annualKwh: (row.annual_kwh as number) || null,
    electricRate: (row.electric_rate as number) || null,
    fileUrl: (row.file_url as string) || null,
    parsedJson: (row.parsed_json as Record<string, unknown>) || null,
    createdAt: row.created_at as string,
  };
}

export async function saveBill(data: {
  projectId: string;
  userId: string;
  utilityName?: string | null;
  monthlyKwh?: number | null;
  annualKwh?: number | null;
  electricRate?: number | null;
  fileUrl?: string | null;
  parsedJson?: Record<string, unknown> | null;
}): Promise<DbBill | null> {
  if (!isValidUUID(data.projectId) || !isValidUUID(data.userId)) return null;
  try {
    const sql = await getDbReady();
    const parsedJsonStr = data.parsedJson
      ? JSON.stringify(data.parsedJson).replace(/\u0000/g, '')
      : null;
    // Neon tagged template: pass JSON as a string, cast to JSONB in the static part
    const rows = parsedJsonStr
      ? await sql`
          INSERT INTO bills (
            project_id, user_id, utility_name,
            monthly_kwh, annual_kwh, electric_rate,
            file_url, parsed_json
          ) VALUES (
            ${data.projectId},
            ${data.userId},
            ${data.utilityName ?? null},
            ${data.monthlyKwh ?? null},
            ${data.annualKwh ?? null},
            ${data.electricRate ?? null},
            ${data.fileUrl ?? null},
            ${parsedJsonStr}::jsonb
          )
          RETURNING *
        `
      : await sql`
          INSERT INTO bills (
            project_id, user_id, utility_name,
            monthly_kwh, annual_kwh, electric_rate,
            file_url, parsed_json
          ) VALUES (
            ${data.projectId},
            ${data.userId},
            ${data.utilityName ?? null},
            ${data.monthlyKwh ?? null},
            ${data.annualKwh ?? null},
            ${data.electricRate ?? null},
            ${data.fileUrl ?? null},
            NULL
          )
          RETURNING *
        `;
    return rows.length > 0 ? rowToBill(rows[0]) : null;
  } catch (e) {
    console.warn('[saveBill] failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function getBillsByProject(projectId: string, userId: string): Promise<DbBill[]> {
  if (!isValidUUID(projectId) || !isValidUUID(userId)) return [];
  try {
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM bills
      WHERE project_id = ${projectId}
        AND user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return rows.map(r => rowToBill(r as Record<string, unknown>));
  } catch (e) {
    console.warn('[getBillsByProject] failed:', e instanceof Error ? e.message : e);
    return [];
  }
}

