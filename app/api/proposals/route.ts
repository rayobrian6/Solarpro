import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb, isValidUUID, getProjectWithDetails } from '@/lib/db-neon';
import { v4 as uuidv4 } from 'uuid';
import type { Proposal } from '@/types';

// ── Map a raw DB row → typed Proposal object ──────────────────────────────
function rowToProposal(row: Record<string, unknown>, project?: import('@/types').Project): Proposal {
  // data_json holds: { status, title, preparedBy, preparedDate, validUntil, viewCount }
  const dj = (row.data_json as Record<string, unknown>) || {};
  return {
    id:           row.id as string,
    projectId:    row.project_id as string,
    project,
    status:       (dj.status as Proposal['status']) || 'draft',
    title:        (dj.title as string) || (row.name as string) || 'Solar Proposal',
    preparedBy:   (dj.preparedBy as string) || 'SolarPro Design Team',
    preparedDate: (dj.preparedDate as string) || (row.created_at as string),
    validUntil:   (dj.validUntil as string) || new Date(Date.now() + 30 * 86400000).toISOString(),
    shareToken:   row.share_token as string | undefined,
    viewCount:    (dj.viewCount as number) || 0,
    createdAt:    row.created_at as string,
    updatedAt:    row.updated_at as string,
  };
}

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const projectId = searchParams.get('projectId');

    const sql = getDb();
    let rows: Record<string, unknown>[];

    if (projectId) {
      if (!isValidUUID(projectId)) {
        return NextResponse.json({ success: true, data: [] });
      }
      rows = await sql`
        SELECT * FROM proposals
        WHERE user_id = ${user.id}
          AND project_id = ${projectId}
        ORDER BY created_at DESC
      `;
    } else {
      rows = await sql`
        SELECT * FROM proposals
        WHERE user_id = ${user.id}
        ORDER BY created_at DESC
      `;
    }

    // For list view, enrich each proposal with full project details
    const proposals = await Promise.all(
      rows.map(async (row) => {
        const pid = row.project_id as string;
        const project = isValidUUID(pid) ? await getProjectWithDetails(pid, user.id) ?? undefined : undefined;
        return rowToProposal(row, project);
      })
    );

    return NextResponse.json({ success: true, data: proposals });
  } catch (error: unknown) {
    console.error('[GET /api/proposals]', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch proposals' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const { projectId, title, preparedBy, validDays = 30 } = body;

    if (!projectId) {
      return NextResponse.json({ success: false, error: 'projectId required' }, { status: 400 });
    }
    if (!isValidUUID(projectId)) {
      return NextResponse.json({ success: false, error: 'Invalid projectId format' }, { status: 400 });
    }

    // Fetch full project with layout + client + production
    const project = await getProjectWithDetails(projectId, user.id);
    if (!project) return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });

    const validUntil = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
    const shareToken = uuidv4().replace(/-/g, '').substring(0, 16);
    const proposalName = title || `Solar Proposal - ${project.name}`;
    const preparedByName = preparedBy || 'SolarPro Design Team';

    const sql = getDb();
    const dataJson = JSON.stringify({
      status: 'draft',
      title: proposalName,
      preparedBy: preparedByName,
      preparedDate: new Date().toISOString(),
      validUntil,
      viewCount: 0,
    });

    const rows = await sql`
      INSERT INTO proposals (user_id, project_id, name, share_token, data_json)
      VALUES (
        ${user.id},
        ${projectId},
        ${proposalName},
        ${shareToken},
        ${dataJson}::jsonb
      )
      RETURNING *
    `;

    // Update project status to proposal
    await sql`
      UPDATE projects SET status = 'proposal', updated_at = NOW()
      WHERE id = ${projectId} AND user_id = ${user.id}
    `;

    const proposal = rowToProposal(rows[0] as Record<string, unknown>, project);

    return NextResponse.json(
      { success: true, data: proposal },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('[POST /api/proposals]', error);
    return NextResponse.json({ success: false, error: 'Failed to create proposal' }, { status: 500 });
  }
}