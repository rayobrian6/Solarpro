// ═══════════════════════════════════════════════════════════════════════════
// EQUIPMENT DATASHEET APPENDIX (DS-n) — full-page real manufacturer cut sheets.
// Standard permit practice: the package embeds the actual module / inverter /
// battery datasheets as their own pages. Sourced from the manufacturer_assets
// library (getManufacturerAsset) and keyed to the job's selected equipment ids.
// Rendered only for equipment that has a real image on file; otherwise omitted.
// ═══════════════════════════════════════════════════════════════════════════

import type { CADModel } from '@/lib/cad/types';
import type { PermitInput } from '../types';
import { titleBlock } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { SOLAR_PANELS, STRING_INVERTERS, MICROINVERTERS, BATTERIES } from '@/lib/equipment-db';
import { getManufacturerAsset, getManufacturerAssetsByCategory, type ManufacturerAsset } from '@/lib/manufacturer-assets-db';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';

interface DatasheetEntry { label: string; asset: ManufacturerAsset; }

function fuzz<T extends { model: string; id: string }>(list: T[], model?: string): T | undefined {
  const m = (model || '').toLowerCase().trim();
  if (!m) return undefined;
  return list.find(e => e.model.toLowerCase() === m)
    ?? list.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
}

/** Resolve the real manufacturer datasheet images for the job's selected equipment. */
export function resolveEquipmentDatasheets(input: PermitInput): DatasheetEntry[] {
  const { project, system } = input;
  const out: DatasheetEntry[] = [];
  const seen = new Set<string>();
  const push = (label: string, a: ManufacturerAsset | null) => {
    if (a && a.imageUrl && !seen.has(a.id)) { seen.add(a.id); out.push({ label, asset: a }); }
  };

  // PV module(s) — one datasheet per DISTINCT panel model across ALL
  // inverters' strings (Wave 5B: a hybrid's roof/ground/fence subs each carry
  // their own tagged fleet + panel model — every distinct module gets its
  // page). Single-type sets have one model, so output is unchanged; the
  // `seen` set dedupes models that fuzz to the same catalog entry.
  const panelModels: string[] = [];
  for (const inv of system.inverters ?? []) {
    for (const str of inv.strings ?? []) {
      const m = str?.panelModel;
      if (m && !panelModels.includes(m)) panelModels.push(m);
    }
  }
  if (panelModels.length === 0) panelModels.push(system.inverters?.[0]?.strings?.[0]?.panelModel ?? '');
  for (const m of panelModels) {
    const dbPanel = fuzz(SOLAR_PANELS, m);
    push('PV MODULE', getManufacturerAsset(dbPanel?.id, 'module_spec'));
  }

  // Inverter(s) / microinverter(s) — one datasheet per distinct model
  for (const inv of system.inverters ?? []) {
    const id = fuzz(STRING_INVERTERS, inv.model)?.id ?? fuzz(MICROINVERTERS, inv.model)?.id;
    const a = getManufacturerAsset(id, 'inverter_spec')
      || getManufacturerAsset(id, 'microinverter_spec')
      || getManufacturerAsset(id, 'optimizer_spec');
    push(inv.type === 'micro' ? 'MICROINVERTER' : 'INVERTER', a);
  }

  // Battery (best-effort model resolution across the shapes it can arrive in)
  const p = project as { batteryModel?: string; _canonical?: { battery?: { model?: string } } };
  const s = system as { battery?: { model?: string } };
  const batModel = s.battery?.model || p._canonical?.battery?.model || p.batteryModel;
  const batId = fuzz(BATTERIES, batModel)?.id;
  push('BATTERY', getManufacturerAsset(batId, 'battery_spec'));

  // Racking RAIL system (Ray 2026-07-20: the IronRidge visual was MIA) —
  // rail-paired mounts (e.g. RT-MINI pad + IronRidge XR rail) bill a rail the
  // BOM resolves from the equipment-registry rail accessory, but only the
  // MOUNT's manual page ever rendered (PV-3, keyed on mountingSystemId).
  // The rail's page resolves from the SAME registry accessory the BOM bills —
  // never a hardcoded brand — against the RAIL-PRODUCT assets ('rail_spec').
  // NEVER 'racking_detail': those are ATTACHMENT pages, and showing e.g. the
  // IronRidge FlashFoot2 attachment instructions on a RT-MINI-pad job
  // misstates the attachment product (Ray caught exactly this, 2026-07-20).
  // No matching asset → no page.
  const mountReg = (() => {
    const mountId = (project as { mountingSystemId?: string }).mountingSystemId;
    return mountId ? getRegistryEntryV4(mountId) : undefined;
  })();
  const railAcc = mountReg?.requiredAccessories?.find(a => a.category === 'rail');
  if (railAcc?.defaultManufacturer && railAcc?.defaultModel) {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const accBrand = norm(railAcc.defaultManufacturer);
    const accModel = norm(railAcc.defaultModel);
    // Cross-brand pairings only (Roof Tech pad + IronRidge rail): when the
    // rail is the mount's own brand (ironridge-xr100 primary), PV-3's
    // manufacturer manual already covers the system.
    if (accBrand !== norm(mountReg?.manufacturer ?? '')) {
      // Longest asset-model match wins ('XR1000 Rail' must not lose to 'XR100 Rail').
      const railAsset = getManufacturerAssetsByCategory('rail_spec')
        .filter(a => norm(a.brand) === accBrand
          && accModel.includes(norm(a.model).replace(/rail$/, '')))
        .sort((a, b) => b.model.length - a.model.length)[0] ?? null;
      push('RACKING RAIL', railAsset);
    }
  }

  return out;
}

function datasheetPage(input: PermitInput, sheetId: string, entry: DatasheetEntry, n: number, t: number): string {
  const a = entry.asset;
  const host = a.sourceUrl
    ? (() => { try { return new URL(a.sourceUrl!).hostname.replace(/^www\./, ''); } catch { return ''; } })()
    : '';
  const cite = [a.docTitle, a.pageRef, host].filter(Boolean).join(' · ');
  const title = escapeH(`MANUFACTURER DATASHEET — ${entry.label} · ${a.brand} ${a.model}`.toUpperCase());
  return `
  <div class="page" data-sheet-id="${sheetId}">
    ${titleBlock(input, sheetId, title, n, t)}
    <div style="height:calc(100% - 150px);padding:10px 14px;display:flex;flex-direction:column;">
      <div style="flex:1;min-height:0;display:flex;align-items:center;justify-content:center;border:var(--border);background:#fff;overflow:hidden;padding:8px;">
        <img src="${a.imageUrl}" alt="${escapeH(a.brand + ' ' + a.model + ' datasheet')}" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" />
      </div>
      <div style="border:var(--border);border-top:none;font-size:8px;padding:5px 8px;color:#111;background:#fff;line-height:1.4;">
        <strong>SOURCE:</strong> ${escapeH(cite || 'Manufacturer datasheet')} — manufacturer-published; field-verify against current revision. Full copy available upon AHJ request.
      </div>
    </div>
  </div>`;
}

/**
 * Page-fn array for the equipment datasheet appendix. Insert into the permit
 * page list after APP-A so numbering (pageNum/TOTAL) stays derived from the list.
 * Returns [] when no equipment has a datasheet image on file.
 */
export function equipmentDatasheetPageFns(
  input: PermitInput,
  _cad: CADModel,
): Array<(n: number, t: number) => string> {
  const entries = resolveEquipmentDatasheets(input);
  return entries.map((entry, i) => (n: number, t: number) => datasheetPage(input, `DS-${i + 1}`, entry, n, t));
}

/**
 * Cover SHEET INDEX rows for the datasheet appendix — MUST mirror
 * equipmentDatasheetPageFns() order/count so the cover index matches the set.
 */
export function equipmentDatasheetIndexRows(input: PermitInput): Array<{ id: string; title: string }> {
  return resolveEquipmentDatasheets(input).map((entry, i) => ({
    id: `DS-${i + 1}`,
    title: `MANUFACTURER DATASHEET — ${entry.label} (${entry.asset.brand} ${entry.asset.model})`.toUpperCase(),
  }));
}
