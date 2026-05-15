export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { sendProposalViewedEmail, sendProposalSignedEmail } from '@/lib/email';

type RouteContext = { params: Promise<{id: string}> };


export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }
    const sql = await getDbReady();
    const rows = await sql`
      SELECT * FROM proposals WHERE id = ${id} LIMIT 1
    `;
    if (rows.length === 0) return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });

    const proposal = rows[0];

    // -- View count: only increment for public/unauthenticated requests --------
    // Authenticated installers previewing their own proposals should NOT inflate
    // the count. We check for a valid auth session; if none exists (homeowner
    // following a share link), we increment.
    // Also accept an explicit ?track=1 query param from the public view page as
    // an additional confirmation that this is a real client view.
    const user = getUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const trackParam = searchParams.get('track');
    const shouldTrack = !user || trackParam === '1';

    if (shouldTrack) {
      const dataJson = (proposal.data_json as Record<string, unknown>) || {};
      const prevViewCount = (dataJson.viewCount as number) || 0;
      const updatedDataJson = JSON.stringify({
        ...dataJson,
        viewCount: prevViewCount + 1,
      });
      await sql`
        UPDATE proposals SET data_json = ${updatedDataJson}::jsonb, updated_at = NOW()
        WHERE id = ${id}
      `;

      // Fire "proposal viewed" email to installer on the FIRST view only.
      // We look up the installer's email via the proposals → projects → users join.
      // Fire-and-forget (don't block the response on email delivery).
      if (prevViewCount === 0) {
        try {
          const installerRows = await sql`
            SELECT u.email, u.name AS installer_name
            FROM proposals p
            JOIN projects proj ON proj.id = p.project_id
            JOIN users u ON u.id = proj.user_id
            WHERE p.id = ${id}
            LIMIT 1
          `;
          if (installerRows.length > 0) {
            const installer = installerRows[0];
            const pData = (proposal.data_json as Record<string, unknown>) || {};
            const clientName = (pData.clientName as string) || (proposal.name as string) || 'Your client';
            const proposalTitle = (proposal.name as string) || 'Solar Proposal';
            sendProposalViewedEmail({
              installerEmail: installer.email as string,
              installerName:  installer.installer_name as string,
              clientName,
              proposalTitle,
              proposalId:     id,
            }).catch((e: unknown) => console.warn('[proposal viewed email] failed:', (e as Error)?.message));
          }
        } catch (emailErr: unknown) {
          // Non-fatal — never block the response for an email failure
          console.warn('[proposal viewed email] lookup failed:', (emailErr as Error)?.message);
        }
      }
    }

    // v48.5: read dbUtilityRate from data_json cache (set at POST creation) — no live DB call
    const dataJson2 = (proposal.data_json as Record<string, unknown>) || {};
    const dbUtilityRate = typeof dataJson2.dbUtilityRate === 'number' ? dataJson2.dbUtilityRate : null;

    return NextResponse.json({ success: true, data: { ...proposal, dbUtilityRate } });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/proposals/[id]]', err);
  }
}

export async function PUT(req: NextRequest, context: RouteContext) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    // Require authenticated session
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Invalid proposal ID' }, { status: 400 });
    }

    const sql = await getDbReady();

    // Verify proposal exists AND belongs to the authenticated user (via projects JOIN)
    const owned = await sql`
      SELECT p.id
      FROM proposals p
      JOIN projects proj ON proj.id = p.project_id
      WHERE p.id = ${id}
        AND proj.user_id = ${user.id}
      LIMIT 1
    `;
    if (owned.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Proposal not found or access denied' },
        { status: 403 }
      );
    }

    const body = await req.json() as Record<string, unknown>;

    // SECURITY: field length caps
    if (body.title      && typeof body.title      === 'string' && body.title.length      > 200) return NextResponse.json({ success: false, error: 'title too long (max 200).'      }, { status: 400 });
    if (body.preparedBy && typeof body.preparedBy === 'string' && body.preparedBy.length > 200) return NextResponse.json({ success: false, error: 'preparedBy too long (max 200).' }, { status: 400 });
    if (body.status     && typeof body.status     === 'string' && body.status.length     > 50)  return NextResponse.json({ success: false, error: 'status too long (max 50).'      }, { status: 400 });

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    const currentData = (existing[0].data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...currentData, ...body });

    const rows = await sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${(body.title as string) ?? null}, name),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[PUT /api/proposals/[id]]', err);
  }
}

// PATCH — partial update (status, title rename)
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
        const rl = await checkRateLimit('standard', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    const { id } = await context.params;
    if (!isValidUUID(id)) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const sql = await getDbReady();
    const body = await req.json() as Record<string, unknown>;

    // SECURITY: field length caps (applied to both public and authenticated paths)
    if (body.title      && typeof body.title      === 'string' && body.title.length      > 200) return NextResponse.json({ success: false, error: 'title too long (max 200).'      }, { status: 400 });
    if (body.preparedBy && typeof body.preparedBy === 'string' && body.preparedBy.length > 200) return NextResponse.json({ success: false, error: 'preparedBy too long (max 200).' }, { status: 400 });
    if (body.status     && typeof body.status     === 'string' && body.status.length     > 50)  return NextResponse.json({ success: false, error: 'status too long (max 50).'      }, { status: 400 });

    // Public token-based status update (homeowner view page) — no auth required.
    // Allowed via this path: 'viewed', 'accepted', and digital signature submission.
    // Full edits still require ownership.
    const tokenParam = req.nextUrl.searchParams.get('token');
    const PUBLIC_STATUSES = new Set(['viewed', 'accepted']);
    const isPublicStatusUpdate = !user && tokenParam && typeof body.status === 'string' && PUBLIC_STATUSES.has(body.status);
    const isSignatureSubmission = !user && tokenParam && body.signature !== undefined;

    if (isPublicStatusUpdate || isSignatureSubmission) {
      const rows = await sql`
        SELECT id, share_token FROM proposals WHERE id = ${id} LIMIT 1
      `;
      if (!rows.length) return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
      // SECURITY: Use timingSafeEqual to prevent timing attacks on token comparison
      const { timingSafeEqual } = await import('crypto');
      const expected = Buffer.from(rows[0].share_token as string, 'utf8');
      const actual   = Buffer.from(tokenParam, 'utf8');
      const tokenValid = expected.length === actual.length && timingSafeEqual(expected, actual);
      if (!tokenValid) {
        return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 403 });
      }

      if (isSignatureSubmission) {
        // Digital signature submission
        // Validate fields
        const sigData    = body.signature as string;           // base64 data-URL of drawn signature
        const signerName = (body.signerName  as string) || ''; // typed full name
        const signerEmail= (body.signerEmail as string) || ''; // optional email

        if (!signerName || signerName.length < 2) {
          return NextResponse.json({ success: false, error: 'Full name is required to sign.' }, { status: 400 });
        }
        if (signerName.length > 200) {
          return NextResponse.json({ success: false, error: 'Name too long (max 200 chars).' }, { status: 400 });
        }
        if (signerEmail && signerEmail.length > 200) {
          return NextResponse.json({ success: false, error: 'Email too long (max 200 chars).' }, { status: 400 });
        }
        // Signature data-URL sanity check (must be a data: URL, limit 512KB)
        if (sigData && (!sigData.startsWith('data:image/') || sigData.length > 512 * 1024)) {
          return NextResponse.json({ success: false, error: 'Invalid signature data.' }, { status: 400 });
        }

        // Get client IP
        const signerIp = getClientIp(req);

        // Store signature in data_json (in case signed_at/signer_name columns don't exist yet)
        const existingRow = await sql`SELECT data_json FROM proposals WHERE id = ${id} LIMIT 1`;
        const existingData = (existingRow[0]?.data_json as Record<string, unknown>) || {};
        const updatedData = JSON.stringify({
          ...existingData,
          signature: {
            signedAt:    new Date().toISOString(),
            signerName,
            signerEmail,
            signerIp,
            imageData:   sigData || null,
          },
        });

        // Try to update dedicated columns (if migration 020 has been applied)
        try {
          await sql`
            UPDATE proposals
            SET status      = 'accepted',
                data_json   = ${updatedData}::jsonb,
                signed_at   = NOW(),
                signer_name  = ${signerName},
                signer_email = ${signerEmail || null},
                signer_ip    = ${signerIp || null},
                updated_at  = NOW()
            WHERE id = ${id}
          `;
        } catch {
          // Fallback: columns may not exist yet — store in data_json only
          await sql`
            UPDATE proposals
            SET status     = 'accepted',
                data_json  = ${updatedData}::jsonb,
                updated_at = NOW()
            WHERE id = ${id}
          `;
        }

        // Fire "proposal signed" email to installer — fire-and-forget.
        try {
          const installerRows = await sql`
            SELECT u.email, u.name AS installer_name
            FROM proposals p
            JOIN projects proj ON proj.id = p.project_id
            JOIN users u ON u.id = proj.user_id
            WHERE p.id = ${id}
            LIMIT 1
          `;
          if (installerRows.length > 0) {
            const installer = installerRows[0];
            const pData = existingData as Record<string, unknown>;
            const clientName = (pData.clientName as string) || 'Your client';
            const proposalTitle = (pData.title as string) || 'Solar Proposal';
            sendProposalSignedEmail({
              installerEmail: installer.email as string,
              installerName:  installer.installer_name as string,
              clientName,
              signerName,
              signerEmail:    signerEmail || '',
              proposalTitle,
              proposalId:     id,
              signedAt:       new Date().toISOString(),
            }).catch((e: unknown) => console.warn('[proposal signed email] failed:', (e as Error)?.message));
          }
        } catch (emailErr: unknown) {
          console.warn('[proposal signed email] lookup failed:', (emailErr as Error)?.message);
        }

        // Auto-advance homeowner stage to 'installation' on signature.
        // Only advances if still at 'proposal' — never downgrades.
        try {
          const projIdRows = await sql`SELECT project_id FROM proposals WHERE id = ${id} LIMIT 1`;
          const projectId = projIdRows[0]?.project_id as string | undefined;
          if (projectId) {
            await sql`
              UPDATE projects
              SET homeowner_stage = 'installation', updated_at = NOW()
              WHERE id = ${projectId}
                AND homeowner_stage = 'proposal'
            `;
            try {
              await sql`
                INSERT INTO project_micro_stages (project_id, micro_stage)
                VALUES (${projectId}, 'contract_signed')
                ON CONFLICT (project_id, micro_stage) DO UPDATE SET created_at = NOW()
              `;
            } catch {
              // non-fatal
            }
          }
        } catch {
          // homeowner_stage column may not exist — non-fatal
        }

        return NextResponse.json({ success: true, signed: true });
      }

      // Simple status update (viewed / accepted without signature)
      await sql`
        UPDATE proposals
        SET status = ${body.status as string},
            updated_at = NOW()
        WHERE id = ${id}
      `;
      return NextResponse.json({ success: true });
    }

    // Authenticated path — full update
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    // Ownership check — proposals.user_id
    const owned = await sql`SELECT id FROM proposals WHERE id = ${id} AND user_id = ${user.id} LIMIT 1`;
    if (owned.length === 0) return NextResponse.json({ success: false, error: 'Not found or access denied' }, { status: 403 });

    // v48.8: refresh_snapshot action — re-pull live project data and rebuild the frozen snapshot.
    // Fixes stale utility name / stateCode / client data that was frozen at original proposal creation.
    // The financial figures (production, cost, pricing) are refreshed from the live project.
    if (body.action === 'refresh_snapshot') {
      const existing2 = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
      if (!existing2.length) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
      const currentData2 = (existing2[0].data_json as Record<string, unknown>) || {};
      const projectId2 = existing2[0].project_id as string;

      // Re-fetch live project (with client, layout, production, costEstimate)
      const liveProjectRows = await sql`
        SELECT proj.*,
          row_to_json(c.*) AS client,
          row_to_json(l.*) AS layout,
          row_to_json(pd.*) AS production,
          row_to_json(ce.*) AS "costEstimate"
        FROM projects proj
        LEFT JOIN clients c ON c.id = proj.client_id
        LEFT JOIN project_layouts l ON l.project_id = proj.id
        LEFT JOIN project_productions pd ON pd.project_id = proj.id
        LEFT JOIN project_cost_estimates ce ON ce.project_id = proj.id
        WHERE proj.id = ${projectId2}
        LIMIT 1
      `.catch(() => [] as any[]);

      if (!liveProjectRows.length) {
        return NextResponse.json({ success: false, error: 'Live project not found — cannot refresh snapshot' }, { status: 404 });
      }

      const liveProjectRaw = liveProjectRows[0];

      // v48.10: normalize raw SQL row (snake_case) → typed Project (camelCase) so
      // the proposal view reads utilityName / stateCode correctly after refresh.
      // The JOIN aliases (client, layout, production, costEstimate) are preserved separately
      // because rowToProject only processes the top-level project columns.
      const { rowToProject } = await import('@/lib/db-neon');
      const liveProjectNormalized = rowToProject(liveProjectRaw);

      // Re-attach the JOIN-aliased nested objects (already camelCase from SQL aliases)
      const liveProject = {
        ...liveProjectNormalized,
        client:       liveProjectRaw.client       ?? liveProjectNormalized.client,
        layout:       liveProjectRaw.layout       ?? (liveProjectNormalized as any).layout,
        production:   liveProjectRaw.production   ?? (liveProjectNormalized as any).production,
        costEstimate: liveProjectRaw.costEstimate ?? (liveProjectNormalized as any).costEstimate,
      };

      // Re-fetch dbUtilityRate with current utility name + state
      const { fetchProposalUtilityRate } = await import('@/lib/proposal/buildCanonicalProposal');
      const freshDbRate = await fetchProposalUtilityRate(
        liveProject.utilityName ?? null,
        liveProject.stateCode   ?? null,
      ).catch(() => null);

      const refreshedDataJson = JSON.stringify({
        ...currentData2,
        project: liveProject,           // full live snapshot (camelCase, utility name, state, layout, production)
        snapshotAt: new Date().toISOString(),
        snapshotRefreshedAt: new Date().toISOString(),
        dbUtilityRate: freshDbRate,
      });

      const refreshedRows = await sql`
        UPDATE proposals
        SET data_json = ${refreshedDataJson}::jsonb, updated_at = NOW()
        WHERE id = ${id}
        RETURNING *
      `;

      return NextResponse.json({ success: true, data: refreshedRows[0], refreshed: true });
    }

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
    const currentData = (existing[0].data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...currentData, ...body });

    const rows = await sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${(body.title as string) ?? null}, name),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (err: unknown) {
    return handleRouteDbError('[PATCH /api/proposals/[id]]', err);
  }
}

// DELETE — hard delete, owner only
export async function DELETE(req: NextRequest, context: RouteContext) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { id } = await context.params;
    if (!isValidUUID(id)) return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });

    const sql = await getDbReady();

    // Only delete proposals owned by this user
    const result = await sql`
      DELETE FROM proposals
      WHERE id = ${id} AND user_id = ${user.id}
      RETURNING id
    `;

    if (result.length === 0) {
      return NextResponse.json({ success: false, error: 'Not found or access denied' }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/proposals/[id]]', err);
  }
}