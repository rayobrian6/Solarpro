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
import { getManufacturerAsset, type ManufacturerAsset } from '@/lib/manufacturer-assets-db';

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

  // PV module
  const panelModel = system.inverters?.[0]?.strings?.[0]?.panelModel;
  const dbPanel = fuzz(SOLAR_PANELS, panelModel);
  push('PV MODULE', getManufacturerAsset(dbPanel?.id, 'module_spec'));

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
