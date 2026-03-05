import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db-neon';

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = getDb();
    const results: string[] = [];

    // Migration 003: unique constraint on productions.project_id
    try {
      const exists = await sql`
        SELECT 1 FROM pg_constraint WHERE conname = 'productions_project_id_unique'
      `;
      if (exists.length === 0) {
        // Remove duplicate rows first (keep latest per project)
        await sql`
          DELETE FROM productions p1
          USING productions p2
          WHERE p1.project_id = p2.project_id
            AND p1.calculated_at < p2.calculated_at
        `;
        await sql`
          ALTER TABLE productions
            ADD CONSTRAINT productions_project_id_unique UNIQUE (project_id)
        `;
        results.push('✅ Added UNIQUE constraint on productions.project_id');
      } else {
        results.push('⏭ productions.project_id unique constraint already exists');
      }
    } catch (e: any) {
      results.push(`⚠️ productions unique constraint: ${e.message}`);
    }

    // Migration 003: data_json column on productions
    try {
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'productions' AND column_name = 'data_json'
      `;
      if (exists.length === 0) {
        await sql`ALTER TABLE productions ADD COLUMN data_json JSONB`;
        results.push('✅ Added data_json column to productions');
      } else {
        results.push('⏭ productions.data_json already exists');
      }
    } catch (e: any) {
      results.push(`⚠️ productions.data_json: ${e.message}`);
    }

    // Ensure proposals table has data_json column
    try {
      const exists = await sql`
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'proposals' AND column_name = 'data_json'
      `;
      if (exists.length === 0) {
        await sql`ALTER TABLE proposals ADD COLUMN data_json JSONB`;
        results.push('✅ Added data_json column to proposals');
      } else {
        results.push('⏭ proposals.data_json already exists');
      }
    } catch (e: any) {
      results.push(`⚠️ proposals.data_json: ${e.message}`);
    }

    return NextResponse.json({ success: true, results });
  } catch (error: unknown) {
    console.error('[POST /api/migrate]', error);
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}