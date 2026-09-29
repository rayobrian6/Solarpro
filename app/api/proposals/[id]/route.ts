export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getDbReady, isValidUUID, handleRouteDbError } from '@/lib/db-neon';
import { getUserFromRequest } from '@/lib/auth';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { sendProposalViewedEmail } from '@/lib/email';
import { authorizeProposalRead, checkShareToken, type ProposalSqlExecutor } from '@/lib/proposalAccess';
import { isIssued, isSignatureOnlyStatus, checkNonSignatureWrite, SIGNATURE_ONLY_MESSAGE } from '@/lib/proposal/signatureAuthority';

type RouteContext = { params: Promise<{id: string}> };

// ── Issued-artifact rule ─────────────────────────────────────────────────────
// A signed proposal is an executed contract. Its content, its pricing vintage,
// its signature and its status are frozen from that moment — the same ruling
// this repo already applied to issued permit packages after a GET request
// self-healed and re-dated them.
//
// The in-repo idiom for it is the `signed_at IS NULL` filter that
// app/api/cron/proposal-expiry/route.ts already uses. `status` is checked too
// so a database that predates migration 020 (which added signed_at) is still
// protected, and so the guard holds if only one of the two was written.
// `isIssued` lives in lib/proposal/signatureAuthority.ts with the rule that
// only POST .../sign may PRODUCE that state.

const ISSUED_MESSAGE = 'Proposal has already been signed.';


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

    // ── SECURITY: read authorization ────────────────────────────────────────
    // This row carries pricing, the client's name and the site address. Knowing
    // the UUID is not access. Until this gate existed the only share-token
    // comparison lived in the client component app/proposals/view/[id]/page.tsx,
    // which an attacker calling the API directly never runs.
    // Two ways in and no others: the owning installer's session, or a live share
    // token. See lib/proposalAccess.ts.
    const user = getUserFromRequest(req);
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');

    const access = await authorizeProposalRead({
      sql:        sql as unknown as ProposalSqlExecutor,
      proposalId: id,
      row:        proposal as Record<string, unknown>,
      user,
      token,
    });

    if (!access.ok) {
      console.warn(`[GET /api/proposals/[id]] denied: reason=${access.reason} authed=${!!user}`);
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    // -- View count: only increment for genuine homeowner views ---------------
    // Authenticated installers previewing their own proposals must NOT inflate
    // the count, so the counter follows the access path rather than the caller's
    // ?track= claim: only a share-link read counts as a client view. (Previously
    // ?track=1 was honoured from anyone, so an installer preview inflated it.)
    const shouldTrack = access.via === 'share-token';

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

    // Only POST .../sign may make a proposal signed — not the seller's own PUT.
    const signatureGate = checkNonSignatureWrite(body);
    if (!signatureGate.ok) {
      return NextResponse.json({ success: false, error: signatureGate.error }, { status: signatureGate.status! });
    }

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    // Same issued-artifact freeze as the PATCH merge below: PUT is the other
    // generic merge and it had no guard at all, so an executed contract's
    // status could be walked back through it.
    if (isIssued(existing[0] as Record<string, unknown>) && body.status !== undefined) {
      return NextResponse.json(
        { success: false, error: `${ISSUED_MESSAGE} Its signature and status are frozen.` },
        { status: 409 },
      );
    }

    const currentData = (existing[0].data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...currentData, ...body });

    // Same rule as PATCH below: the `status` COLUMN is the authority, so a
    // writer that only merged `data_json.status` would silently do nothing now
    // that rowToProposal reads the column. No caller in the website PUTs a
    // status today; this exists so one cannot reintroduce the split.
    const nextStatus = typeof body.status === 'string' ? body.status : null;

    const rows = await sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${(body.title as string) ?? null}, name),
          status = COALESCE(${nextStatus}, status),
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

    // Public token-based update (homeowner view page) — no auth required.
    //
    // 🚨 THE SHARE LINK IS NOT A SIGNATURE. This path used to accept
    // { status: 'accepted' } from anyone holding the link, which made the
    // proposal read as an executed contract with no signer, no
    // proposal_signatures row and no pipeline move — and the real e-signature
    // then answered 409 "already signed", so the homeowner could not sign.
    // It also carried a second, unaudited signing branch ({ signature, ... }).
    // POST /api/proposals/[id]/sign is now the only way to sign (see
    // lib/proposal/signatureAuthority.ts); the only status a link holder may
    // write here is the 'viewed' ping the view page sends on load.
    const tokenParam = req.nextUrl.searchParams.get('token');
    const PUBLIC_STATUSES = new Set(['viewed']);

    if (!user && tokenParam && body.signature !== undefined) {
      return NextResponse.json(
        { success: false, error: 'Signing has moved to POST /api/proposals/[id]/sign.' },
        { status: 410 },
      );
    }
    if (tokenParam && isSignatureOnlyStatus(body.status)) {
      return NextResponse.json({ success: false, error: SIGNATURE_ONLY_MESSAGE }, { status: 403 });
    }

    const isPublicStatusUpdate = !user && tokenParam && typeof body.status === 'string' && PUBLIC_STATUSES.has(body.status);

    if (isPublicStatusUpdate) {
      // The terminal state is read alongside the token so the guards below
      // judge the same row the token was verified against. The narrower query
      // is the fallback for a database that predates migration 020: `status`
      // alone is still enough to refuse an executed proposal.
      const rows = await sql`
        SELECT id, share_token, share_expires_at, status, signed_at FROM proposals WHERE id = ${id} LIMIT 1
      `.catch(() => sql`
        SELECT id, share_token, status FROM proposals WHERE id = ${id} LIMIT 1
      `);
      if (!rows.length) return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
      const target = rows[0] as Record<string, unknown>;
      // Same token rule as the read path and /sign — constant-time compare,
      // never-shared refusal, and expiry (which this path used to skip).
      if (!checkShareToken(target, tokenParam).ok) {
        return NextResponse.json({ success: false, error: 'Invalid token' }, { status: 403 });
      }

      // Simple status update ('viewed' only)
      //
      // The homeowner view fires { status: 'viewed' } on EVERY page load, so a
      // returning signer used to walk their own executed contract back from
      // accepted to viewed just by opening the link. Nothing asked for a
      // change here — the page merely loaded — so this answers 200 and says
      // plainly that it changed nothing, rather than showing the homeowner an
      // error for revisiting their own proposal.
      if (isIssued(target)) {
        return NextResponse.json({ success: true, statusChanged: false, reason: 'already-signed' });
      }

      await sql`
        UPDATE proposals
        SET status = ${body.status as string},
            updated_at = NOW()
        WHERE id = ${id}
      `;
      return NextResponse.json({ success: true, statusChanged: true });
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

      // The figures behind a signature are part of the signed document. Once
      // the homeowner has executed it, re-pulling the live project would leave
      // today's system size and production priced against the frozen
      // pricingSnapshot this path never rewrites — a mixed-vintage contract.
      if (isIssued(existing2[0] as Record<string, unknown>)) {
        return NextResponse.json(
          { success: false, error: `${ISSUED_MESSAGE} Its snapshot is frozen and cannot be refreshed.` },
          { status: 409 },
        );
      }

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

    // Only POST .../sign may make a proposal signed — not the seller's own PATCH.
    const signatureGate = checkNonSignatureWrite(body);
    if (!signatureGate.ok) {
      return NextResponse.json({ success: false, error: signatureGate.error }, { status: signatureGate.status! });
    }

    const existing = await sql`SELECT * FROM proposals WHERE id = ${id} LIMIT 1`;
    const currentRow = (existing[0] as Record<string, unknown>) || {};

    // Owning the proposal is not an exemption. This generic merge is where an
    // authenticated caller lands, and it spreads the whole body into data_json
    // — so it could rewrite the signature record or walk the status back on an
    // executed contract. Everything else about the row (its title, its notes)
    // stays editable, because filing a signed proposal is not tampering.
    if (isIssued(currentRow) && (body.signature !== undefined || body.status !== undefined)) {
      return NextResponse.json(
        { success: false, error: `${ISSUED_MESSAGE} Its signature and status are frozen.` },
        { status: 409 },
      );
    }

    const currentData = (currentRow.data_json as Record<string, unknown>) || {};
    const updatedDataJson = JSON.stringify({ ...currentData, ...body });

    // 🚨 THE STATUS COLUMN IS WRITTEN TOO, NOT ONLY data_json.
    //
    // This generic merge was the installer-side status writer and it only ever
    // touched `data_json.status`, while the homeowner-side paths above write the
    // `status` COLUMN. Two homes for one fact: a signed contract read 'accepted'
    // in the column and 'draft' in the json, and the Proposals list believed the
    // json. Now that the list reads the column (see rowToProposal in
    // app/api/proposals/route.ts), this writer has to move with it or an
    // installer's own rename-and-restatus would silently do nothing.
    //
    // `COALESCE` so a PATCH that does not mention status leaves it alone —
    // the same shape used for `name` on the line below.
    //
    // `.catch()` to the json-only write: `body.status` is caller-supplied (capped
    // at 50 chars, not value-checked), and there is no CREATE TABLE for
    // `proposals` anywhere in the repo, so a CHECK constraint on the column
    // cannot be ruled out. Degrading to the statement that shipped before beats
    // turning a display bug into a 500 on rename.
    const nextStatus = typeof body.status === 'string' ? body.status : null;

    const rows = await sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${(body.title as string) ?? null}, name),
          status = COALESCE(${nextStatus}, status),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `.catch(() => sql`
      UPDATE proposals
      SET data_json = ${updatedDataJson}::jsonb,
          name = COALESCE(${(body.title as string) ?? null}, name),
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);

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