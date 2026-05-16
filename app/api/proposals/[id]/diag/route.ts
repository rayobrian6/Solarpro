export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, isValidUUID } from '@/lib/db-neon';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const { id: proposalId } = await params;
    if (!isValidUUID(proposalId)) return NextResponse.json({ error: 'Invalid UUID' }, { status: 400 });
    
    const sql = await getDbReady();
    
    let step = 'start';
    let result: unknown = null;
    
    try {
      step = 'query1_basic';
      const rows1 = await sql`SELECT id, title FROM proposals WHERE id = ${proposalId} LIMIT 1`;
      result = { step, rows: rows1 };
    } catch(e1: unknown) {
      return NextResponse.json({ step, error: (e1 as Error).message });
    }
    
    try {
      step = 'query2_with_join';
      const rows2 = await sql`
        SELECT p.id, p.title, p.share_token, p.sent_at, p.sent_to_email,
               pr.id AS project_id, pr.name AS project_name, pr.user_id,
               pr.client_id
        FROM proposals p
        JOIN projects pr ON pr.id = p.project_id
        WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
        LIMIT 1
      `;
      result = { step, rows: rows2 };
    } catch(e2: unknown) {
      return NextResponse.json({ step, error: (e2 as Error).message });
    }
    
    try {
      step = 'query3_with_clients';
      const rows3 = await sql`
        SELECT p.id, p.title,
               c.id AS client_id, c.name AS client_name, c.email AS client_email
        FROM proposals p
        JOIN projects pr ON pr.id = p.project_id
        JOIN clients c ON c.id = pr.client_id
        WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
        LIMIT 1
      `;
      result = { step, rows: rows3 };
    } catch(e3: unknown) {
      return NextResponse.json({ step, error: (e3 as Error).message });
    }
    
    try {
      step = 'query4_full';
      const rows4 = await sql`
        SELECT p.id, p.title, p.share_token, p.data_json,
               pr.id AS project_id, pr.name AS project_name, pr.user_id,
               c.id AS client_id, c.name AS client_name, c.email AS client_email,
               u.name AS rep_name, o.company_name AS company_name
        FROM proposals p
        JOIN projects pr ON pr.id = p.project_id
        JOIN clients c ON c.id = pr.client_id
        JOIN users u ON u.id = pr.user_id
        LEFT JOIN organizations o ON o.id = u.org_id
        WHERE p.id = ${proposalId} AND pr.user_id = ${user.id}
        LIMIT 1
      `;
      result = { step, rows: rows4 };
    } catch(e4: unknown) {
      return NextResponse.json({ step, error: (e4 as Error).message });
    }
    
    return NextResponse.json({ success: true, user_id: user.id, result });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
