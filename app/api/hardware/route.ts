export const maxDuration = 30;
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

import { NextRequest, NextResponse } from 'next/server';
import { handleRouteDbError } from '@/lib/db-neon';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';
import db from '@/lib/db';
import { getAllUnifiedPanels, getAllUnifiedInverters } from '@/lib/equipment-library';

// Hardware/equipment data — merges engineering DB + user Equipment Library
// GET returns unified panels (engineering specs + user pricing/dimensions)

// ── SECURITY: the catalog behind POST/PUT/DELETE is PROCESS-GLOBAL ───────────
// `lib/db.ts:915` is `const db = new Database()` at module scope, and its
// `panels`/`inverters`/`batteries`/`mountings` Maps carry NO tenant key. GET
// serves that one merged catalog to every organisation's Design Studio panel
// picker, panel dimensions and per-watt pricing.
//
// So a mutation here is not a per-user edit — it is an edit to the catalog every
// organisation designs with, on this server instance. Gating these three verbs on
// a SESSION alone (the previous behaviour) meant Company B's engineer could PUT
// `{type:'panel', id:'panel-std440', data:{width:9}}` and silently change Company
// A's layouts and cost estimates, or DELETE the panel out of every org's picker.
//
// The only UI that mutates this route is `app/admin/hardware/page.tsx`; every
// other caller (DesignSidebar, DesignStudio, DesignTab) is a GET. So requiring
// admin costs the product nothing and is the same guard `app/api/pricing`
// already applies to the other global row.
//
// 🚨 STILL OPEN, deliberately not papered over here: this makes the catalog
// admin-only, NOT per-organisation, and `savePanel`/`updatePanel`/`deletePanel`
// do not persist (unlike `saveProposal`, they never call `saveToFile`), so an
// admin's change reverts at the next cold start. Durable per-owner storage means
// moving onto the `user_equipment_*` tables from migration 005 — a schema-scoped
// change tracked as a separate finding, not smuggled in behind a security gate.
async function requireCatalogAdmin(req: NextRequest): Promise<NextResponse | null> {
  const { requireAdminApi } = await import('@/lib/adminAuth');
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json(
      { success: false, error: 'Admin role required to modify the shared equipment catalog.' },
      { status: 403 },
    );
  }
  const rl = await checkRateLimit('hardware', getClientIp(req));
  if (!rl.allowed) {
    return NextResponse.json({ success: false, error: 'Too many requests. Please slow down.' }, { status: 429 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const libPanels    = db.getPanels();
    const mountings    = db.getMountings();
    const batteries    = db.getBatteries ? db.getBatteries() : [];

    // Single source of truth = equipment-db. Panels merge the (now id-aligned)
    // curated library with the engineering DB. Inverters are served straight from
    // the engineering DB (getAllUnifiedInverters([])) — its 66 models cover every
    // brand and carry the real MPPT electrical specs the planset/string-sizing
    // need, so a design inverter pick always resolves in Engineering.
    const panels    = getAllUnifiedPanels(libPanels);
    const inverters = getAllUnifiedInverters([]);

    return NextResponse.json({ 
      success: true, 
      data: { panels, inverters, mountings, batteries } 
    });
  } catch (err: unknown) {
    return handleRouteDbError('[GET /api/hardware]', err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireCatalogAdmin(req);
    if (denied) return denied;

    const body = await req.json();
    const { type, data } = body;
    
    if (type === 'panel') {
      const panel = db.savePanel(data);
      return NextResponse.json({ success: true, data: panel }, { status: 201 });
    }
    
    if (type === 'inverter') {
      const inverter = db.saveInverter(data);
      return NextResponse.json({ success: true, data: inverter }, { status: 201 });
    }
    
    if (type === 'mounting') {
      const mounting = db.saveMounting ? db.saveMounting(data) : null;
      if (mounting) {
        return NextResponse.json({ success: true, data: mounting }, { status: 201 });
      }
    }
    
    if (type === 'battery') {
      const battery = db.saveBattery ? db.saveBattery(data) : null;
      if (battery) {
        return NextResponse.json({ success: true, data: battery }, { status: 201 });
      }
    }
    
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err: unknown) {
    return handleRouteDbError('[POST /api/hardware]', err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const denied = await requireCatalogAdmin(req);
    if (denied) return denied;

    const body = await req.json();
    const { type, id, data } = body;
    
    if (type === 'panel') {
      const updated = db.updatePanel(id, data);
      return NextResponse.json({ success: true, data: updated });
    }
    
    if (type === 'inverter') {
      const updated = db.updateInverter ? db.updateInverter(id, data) : null;
      if (updated) {
        return NextResponse.json({ success: true, data: updated });
      }
    }
    
    if (type === 'mounting') {
      const updated = db.updateMounting ? db.updateMounting(id, data) : null;
      if (updated) {
        return NextResponse.json({ success: true, data: updated });
      }
    }
    
    if (type === 'battery') {
      const updated = db.updateBattery ? db.updateBattery(id, data) : null;
      if (updated) {
        return NextResponse.json({ success: true, data: updated });
      }
    }
    
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err: unknown) {
    return handleRouteDbError('[PUT /api/hardware]', err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const denied = await requireCatalogAdmin(req);
    if (denied) return denied;

    const body = await req.json();
    const { type, id } = body;
    
    if (type === 'panel') {
      const deleted = db.deletePanel ? db.deletePanel(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    if (type === 'inverter') {
      const deleted = db.deleteInverter ? db.deleteInverter(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    if (type === 'mounting') {
      const deleted = db.deleteMounting ? db.deleteMounting(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    if (type === 'battery') {
      const deleted = db.deleteBattery ? db.deleteBattery(id) : false;
      return NextResponse.json({ success: deleted });
    }
    
    return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 });
  } catch (err: unknown) {
    return handleRouteDbError('[DELETE /api/hardware]', err);
  }
}