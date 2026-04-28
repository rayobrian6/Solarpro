export const dynamic   = 'force-dynamic';
export const runtime   = 'nodejs';
export const revalidate = 0;

/**
 * POST /api/projects/[id]/repair-system-type
 * Body: { systemType: 'fence' | 'ground' | 'carport' | 'roof' }
 *
 * Atomically repairs system_type in BOTH the projects table AND layouts table
 * for the specified project. This is needed when an existing project was
 * corrupted (e.g., system_type was reset to 'roof' by a stale update call).
 *
 * v47.218: Added as the canonical repair endpoint for the install-type root-cause fix.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDbReady, handleRouteDbError, isValidUUID} from '@/lib/db-neon';

type RouteContext = { params: Promise<{ id: string }> };

const VALID_TYPES = ['roof', 'ground', 'fence', 'carport'] as const;
type SystemType = typeof VALID_TYPES[number];

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { checkRateLimit, getClientIp } = await import('@/lib/rateLimiter');
    const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {{
      return NextResponse.json({{ success: false, error: 'Too many requests. Please slow down.' }}, {{ status: 429 }});
    }}

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const body = await req.json();
    const systemType = body.systemType as string;

    if (!systemType || !VALID_TYPES.includes(systemType as SystemType)) {
      return NextResponse.json({
        success: false,
        error: `systemType must be one of: ${VALID_TYPES.join(', ')}`,
      }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify the project belongs to this user
    const projectRows = await sql`
      SELECT id, name, system_type FROM projects
      WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL
      LIMIT 1
    `;
    if (projectRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const project = projectRows[0];
    const previousType = project.system_type;

    // Fix project system_type
    await sql`
      UPDATE projects
      SET system_type = ${systemType}, updated_at = NOW()
      WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL
    `;

    // Fix layout system_type (if a layout exists for this project)
    const layoutResult = await sql`
      UPDATE layouts
      SET system_type = ${systemType}, updated_at = NOW()
      WHERE project_id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;

    console.log(`[repair-system-type] Project ${id}: ${previousType} → ${systemType}, layouts updated: ${layoutResult.length}`);

    return NextResponse.json({
      success: true,
      projectId: id,
      projectName: project.name,
      previousType,
      newType: systemType,
      layoutsUpdated: layoutResult.length,
      message: `System type repaired: ${previousType} → ${systemType} (${layoutResult.length} layout(s) updated)`,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/projects/[id]/repair-system-type]', err);
  }
}

/**
 * GET /api/projects/[id]/repair-system-type
 * Returns current system_type in both project and layout tables — useful for diagnostics.
 */
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid project ID format.' }, { status: 400 });
    }
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    const sql = await getDbReady();

    const [projectRows, layoutRows] = await Promise.all([
      sql`
        SELECT id, name, system_type, updated_at FROM projects
        WHERE id = ${id} AND user_id = ${user.id} AND deleted_at IS NULL
        LIMIT 1
      `,
      sql`
        SELECT id, system_type, updated_at FROM layouts
        WHERE project_id = ${id} AND user_id = ${user.id}
        ORDER BY updated_at DESC LIMIT 1
      `,
    ]);

    if (projectRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Project not found' }, { status: 404 });
    }

    const project = projectRows[0];
    const layout = layoutRows[0] ?? null;
    const inSync = layout ? project.system_type === layout.system_type : true;

    return NextResponse.json({
      success: true,
      projectId: id,
      project: {
        name: project.name,
        systemType: project.system_type,
        updatedAt: project.updated_at,
      },
      layout: layout ? {
        id: layout.id,
        systemType: layout.system_type,
        updatedAt: layout.updated_at,
      } : null,
      inSync,
      note: inSync
        ? 'Project and layout system types match'
        : `MISMATCH: project=${project.system_type}, layout=${layout?.system_type}`,
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/projects/[id]/repair-system-type]', err);
  }
}