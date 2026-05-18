/**
 * lib/db/clients.ts
 * Client DB operations — extracted from lib/db-neon.ts.
 *
 * Do not import directly in application code. Import from '@/lib/db-neon'
 * which re-exports everything here, preserving all existing import paths.
 */

import { Client } from '@/types';
import { getDbReady, isValidUUID, assertUUID, rowToClient } from './core';

// ============================================================
// CLIENTS
// ============================================================

export async function getClientsByUser(userId: string): Promise<Client[]> {
  assertUUID(userId, 'userId');
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM clients
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY created_at DESC
  `;
  return rows.map(rowToClient);
}

export async function getClientById(id: string, userId: string): Promise<Client | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const rows = await sql`
    SELECT * FROM clients
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows.length > 0 ? rowToClient(rows[0]) : null;
}

export async function createClient(data: {
  userId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  utilityProvider?: string;
  monthlyKwh?: number[];
  annualKwh?: number;
  averageMonthlyKwh?: number;
  averageMonthlyBill?: number;
  annualBill?: number;
  utilityRate?: number;
}): Promise<Client> {
  assertUUID(data.userId, 'userId');
  const sql = await getDbReady();
  const monthlyKwhJson = JSON.stringify(data.monthlyKwh || []);
  const rows = await sql`
    INSERT INTO clients (
      user_id, name, email, phone, address, city, state, zip,
      lat, lng, utility_provider, monthly_kwh,
      annual_kwh, average_monthly_kwh, average_monthly_bill,
      annual_bill, utility_rate
    ) VALUES (
      ${data.userId},
      ${data.name},
      ${data.email},
      ${data.phone || ''},
      ${data.address || ''},
      ${data.city || ''},
      ${data.state || ''},
      ${data.zip || ''},
      ${data.lat ?? null},
      ${data.lng ?? null},
      ${data.utilityProvider || ''},
      ${monthlyKwhJson}::jsonb,
      ${data.annualKwh || 0},
      ${data.averageMonthlyKwh || 0},
      ${data.averageMonthlyBill || 0},
      ${data.annualBill || 0},
      ${data.utilityRate || 0.13}
    )
    RETURNING *
  `;
  return rowToClient(rows[0]);
}

export async function updateClient(
  id: string,
  userId: string,
  data: Partial<Omit<Client, 'id' | 'userId' | 'createdAt' | 'updatedAt'>>
): Promise<Client | null> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return null;
  const sql = await getDbReady();
  const current = await getClientById(id, userId);
  if (!current) return null;

  const merged = { ...current, ...data };
  const monthlyKwhJson = JSON.stringify(merged.monthlyKwh || []);

  const rows = await sql`
    UPDATE clients SET
      name                = ${merged.name},
      email               = ${merged.email},
      phone               = ${merged.phone || ''},
      address             = ${merged.address || ''},
      city                = ${merged.city || ''},
      state               = ${merged.state || ''},
      zip                 = ${merged.zip || ''},
      lat                 = ${merged.lat ?? null},
      lng                 = ${merged.lng ?? null},
      utility_provider    = ${merged.utilityProvider || ''},
      monthly_kwh         = ${monthlyKwhJson}::jsonb,
      annual_kwh          = ${merged.annualKwh || 0},
      average_monthly_kwh = ${merged.averageMonthlyKwh || 0},
      average_monthly_bill= ${merged.averageMonthlyBill || 0},
      annual_bill         = ${merged.annualBill || 0},
      utility_rate        = ${merged.utilityRate || 0.13},
      updated_at          = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING *
  `;
  return rows.length > 0 ? rowToClient(rows[0]) : null;
}

export async function softDeleteClient(id: string, userId: string): Promise<boolean> {
  if (!isValidUUID(id) || !isValidUUID(userId)) return false;
  const sql = await getDbReady();
  const rows = await sql`
    UPDATE clients
    SET deleted_at = NOW(), updated_at = NOW()
    WHERE id = ${id}
      AND user_id = ${userId}
      AND deleted_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

