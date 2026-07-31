// app/api/admin/document-registry/route.ts
// W4 §8 — Admin CRUD + verification for the manufacturer/authority document registry.
//
// GET   ?document_class=&equipment_id=&status=&verification_state=  — list
// POST  create a document (draft/unverified by default)
// PATCH { id, verification_state, notes? }  — set verification state (verify requires archived+sha256)

import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/adminAuth';
import { handleRouteDbError } from '@/lib/db-neon';
import { logAdminAction } from '@/lib/adminActivityLog';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import {
  createDocument,
  listDocuments,
  setVerification,
  validateDocumentInput,
  type DocumentInput,
} from '@/lib/documents/registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { searchParams } = new URL(req.url);
  try {
    const docs = await listDocuments({
      documentClass: searchParams.get('document_class'),
      equipmentId: searchParams.get('equipment_id'),
      status: searchParams.get('status'),
      verificationState: searchParams.get('verification_state'),
    });
    return NextResponse.json({ success: true, documents: docs, count: docs.length });
  } catch (err) {
    return handleRouteDbError('[admin/document-registry GET]', err);
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });

  let body: DocumentInput;
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const v = validateDocumentInput(body);
  if (!v.ok) return NextResponse.json({ success: false, error: v.error }, { status: 400 });

  try {
    const doc = await createDocument({ ...body, createdBy: admin.id });
    await logAdminAction({ adminId: admin.id, action: 'document_registry_create', metadata: { id: doc.id, class: doc.documentClass, title: doc.title } });
    return NextResponse.json({ success: true, document: doc });
  } catch (err) {
    return handleRouteDbError('[admin/document-registry POST]', err);
  }
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const rl = await checkRateLimit('admin', getClientIp(req));
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 });

  let body: { id?: string; verification_state?: string; notes?: string | null };
  try { body = await req.json(); } catch { return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
  if (!body.verification_state) return NextResponse.json({ success: false, error: 'verification_state is required' }, { status: 400 });

  try {
    const doc = await setVerification(body.id, body.verification_state, admin.id, body.notes ?? null);
    if (!doc) return NextResponse.json({ success: false, error: 'Document not found' }, { status: 404 });
    await logAdminAction({ adminId: admin.id, action: 'document_registry_verify', metadata: { id: doc.id, state: doc.verificationState } });
    return NextResponse.json({ success: true, document: doc });
  } catch (err: any) {
    // validation errors (e.g. verifying an un-archived doc) → 400
    if (err instanceof Error && /cannot verify|invalid/i.test(err.message)) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    return handleRouteDbError('[admin/document-registry PATCH]', err);
  }
}
