// app/api/admin/document-registry/rt-mini/route.ts
// W4 §9 — RT-MINI structural-source ingestion.
//
// The operator archives the EXACT RT-MINI structural source and connects it to
// every §9 applicability field. This creates a `structural_pe_letter` (or
// `evaluation_report`) registry document whose extracted_claims.structural block
// carries: exact model, fastener model+count, substrate, rafter/deck condition,
// embedment, rail/L-foot assembly, load basis, adjustment factors, jurisdiction,
// and the ASD allowable value. Only when this document is VERIFIED (and covers
// the exact assembly) will lib/permit/snapshot/rackingAssembly clear the two
// RT-MINI blockers.
//
// A generic brochure / flashing report cannot be ingested here as a clearing
// document: this endpoint REQUIRES the structural fields + hasStructuralCapacityClaim,
// the SHA-256, and archived_in_repo — omit any and it is rejected (400) or, if
// forced through as a non-structural class, it will never satisfy the resolver.
//
// GET  — list RT-MINI structural documents
// POST — ingest a structural source

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import { createDocument, listDocuments } from '@/lib/documents/registry';
import type { ExtractedEngineeringClaims } from '@/lib/documents/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

interface RtMiniIngestBody {
  // document identity
  title: string;
  documentClass?: 'structural_pe_letter' | 'evaluation_report';
  manufacturerOrIssuer?: string;
  equipmentId?: string;            // default 'rooftech-mini'
  revision?: string | null;
  documentDate?: string | null;
  source?: string | null;
  // archive integrity (REQUIRED to be a clearing document)
  archivedFileIdentity: string;    // storage key/path of the archived file
  sha256: string;                  // SHA-256 of the archived file
  // §9 applicability
  exactModel: string;
  fastenerModel: string;
  fastenerCount: number;
  substrate: string;
  rafterDeckCondition: string;
  embedmentIn: number;
  railLFootAssembly: string;
  loadBasis: string;               // must be an ASD allowable
  adjustmentFactors: Record<string, unknown>;
  jurisdiction: string;
  asdAllowableLbs: number;
  applicabilityNotes?: string | null;
  // optional: verify immediately (requires reviewer authority)
  verifyNow?: boolean;
  reviewer?: string | null;
}

const REQUIRED_FIELDS: (keyof RtMiniIngestBody)[] = [
  'title', 'archivedFileIdentity', 'sha256', 'exactModel', 'fastenerModel', 'fastenerCount',
  'substrate', 'rafterDeckCondition', 'embedmentIn', 'railLFootAssembly', 'loadBasis',
  'adjustmentFactors', 'jurisdiction', 'asdAllowableLbs',
];

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  try {
    const docs = (await listDocuments({ equipmentId: 'rooftech-mini' }))
      .filter(d => d.documentClass === 'structural_pe_letter' || d.documentClass === 'evaluation_report');
    return NextResponse.json({ success: true, documents: docs, count: docs.length });
  } catch (err) {
    return handleRouteDbError('[admin/document-registry/rt-mini GET]', err);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });

  let body: RtMiniIngestBody;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  // Every §9 field is mandatory — this is what disqualifies a generic brochure.
  const missing = REQUIRED_FIELDS.filter(f => {
    const v = body[f];
    if (f === 'adjustmentFactors') return !v || typeof v !== 'object' || Object.keys(v as object).length === 0;
    if (f === 'fastenerCount' || f === 'embedmentIn' || f === 'asdAllowableLbs') return v == null || !(Number(v) > 0);
    return v == null || String(v).trim() === '';
  });
  if (missing.length) {
    return NextResponse.json({
      success: false,
      error: `RT-MINI structural ingestion requires all §9 fields. Missing/invalid: ${missing.join(', ')}. A generic brochure or flashing report is NOT a structural capacity source.`,
    }, { status: 400 });
  }
  if (!/allowable|asd/i.test(body.loadBasis)) {
    return NextResponse.json({ success: false, error: `loadBasis '${body.loadBasis}' must be an ASD allowable basis` }, { status: 400 });
  }

  const structural: NonNullable<ExtractedEngineeringClaims['structural']> = {
    exactModel: body.exactModel,
    fastenerModel: body.fastenerModel,
    fastenerCount: Number(body.fastenerCount),
    substrate: body.substrate,
    rafterDeckCondition: body.rafterDeckCondition,
    embedmentIn: Number(body.embedmentIn),
    railLFootAssembly: body.railLFootAssembly,
    loadBasis: body.loadBasis,
    adjustmentFactors: body.adjustmentFactors,
    jurisdiction: body.jurisdiction,
    asdAllowableLbs: Number(body.asdAllowableLbs),
    hasStructuralCapacityClaim: true,
  };

  try {
    const doc = await createDocument({
      documentClass: body.documentClass ?? 'structural_pe_letter',
      manufacturerOrIssuer: body.manufacturerOrIssuer ?? 'Roof Tech',
      equipmentId: body.equipmentId ?? 'rooftech-mini',
      equipmentModelApplicability: body.exactModel,
      title: body.title,
      revision: body.revision ?? null,
      documentDate: body.documentDate ?? null,
      archivedFileIdentity: body.archivedFileIdentity,
      archivedInRepo: true,
      sha256: body.sha256,
      source: body.source ?? null,
      jurisdictionBoundary: body.jurisdiction,
      applicabilityNotes: body.applicabilityNotes ?? null,
      status: 'current',
      extractedClaims: { structural },
      // verification is a SEPARATE reviewer action by default; verifyNow only if requested.
      verificationState: body.verifyNow ? 'verified' : 'in_review',
      reviewer: body.reviewer ?? admin.name,
      createdBy: admin.id,
    });
    await logAdminAction({ adminId: admin.id, action: 'rt_mini_structural_ingest', metadata: { id: doc.id, verified: !!body.verifyNow, asdAllowableLbs: structural.asdAllowableLbs } });
    return NextResponse.json({
      success: true,
      document: doc,
      note: doc.verificationState === 'verified'
        ? 'Verified structural document archived. rackingAssembly will clear the RT-MINI blockers when this covers the selected assembly + jurisdiction.'
        : 'Structural document archived and set to in_review. Verify it (PATCH /api/admin/document-registry) before it can clear the RT-MINI blockers.',
    });
  } catch (err: any) {
    if (err instanceof Error && /requires|invalid|sha256/i.test(err.message)) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    return handleRouteDbError('[admin/document-registry/rt-mini POST]', err);
  }
}
