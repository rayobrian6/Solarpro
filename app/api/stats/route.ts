import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getProjectsByUser, getClientsByUser, getLayoutByProject , handleRouteDbError } from '@/lib/db-neon';

export async function GET(req: NextRequest) {
  try {
    const user = getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });

    // Get user-scoped data from Neon
    const [projects, clients] = await Promise.all([
      getProjectsByUser(user.id),
      getClientsByUser(user.id),
    ]);

    const projectsByStatus = { lead: 0, design: 0, proposal: 0, approved: 0, installed: 0 };
    const projectsByType = { roof: 0, ground: 0, fence: 0 };
    let totalSystemSizeKw = 0;

    for (const p of projects) {
      if (p.status && Object.prototype.hasOwnProperty.call(projectsByStatus, p.status)) {
        (projectsByStatus as Record<string, number>)[p.status]++;
      }
      if (p.systemType && Object.prototype.hasOwnProperty.call(projectsByType, p.systemType)) {
        (projectsByType as Record<string, number>)[p.systemType]++;
      }
      if (p.systemSizeKw) totalSystemSizeKw += p.systemSizeKw;
    }

    return NextResponse.json({
      success: true,
      data: {
        totalProjects: projects.length,
        totalClients: clients.length,
        totalProposals: 0,
        totalSystemSizeKw: Math.round(totalSystemSizeKw * 10) / 10,
        totalAnnualProductionKwh: 0,
        totalRevenue: 0,
        projectsByStatus,
        projectsByType,
        recentProjects: projects.slice(0, 5),
        monthlyRevenue: Array.from({ length: 12 }, (_, i) => ({
          month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i],
          revenue: 0,
        })),
      }
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/s', err);
  }
}