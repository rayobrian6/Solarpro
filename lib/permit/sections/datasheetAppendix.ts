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
import { getManufacturerAsset, getManufacturerAssetsByCategory, evaluateDocumentApplicability, type ManufacturerAsset, type DocumentApplicability } from '@/lib/manufacturer-assets-db';
import { getRegistryEntryV4 } from '@/lib/equipment-registry-v4';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { resolveModuleDatasheetExactness, type ModuleDatasheetExactness } from '../snapshot/equipmentProjection';
import { projectStructuralFromInput } from '../snapshot/structuralProjection';

interface DatasheetEntry { label: string; asset: ManufacturerAsset; moduleExactness?: ModuleDatasheetExactness; railPending?: boolean; docApplicability?: DocumentApplicability; }

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
  const push = (label: string, a: ManufacturerAsset | null, extra?: { moduleExactness?: ModuleDatasheetExactness; railPending?: boolean; docApplicability?: DocumentApplicability }) => {
    if (a && a.imageUrl && !seen.has(a.id)) { seen.add(a.id); out.push({ label, asset: a, moduleExactness: extra?.moduleExactness, railPending: extra?.railPending, docApplicability: extra?.docApplicability }); }
  };
  // W6 — canonical racking-assembly rail SKU pinned-state (structuralProjection).
  // The RACKING RAIL datasheet page must NOT imply a rail is specified while the
  // assembly's rail SKU is unpinned (RT-MINI: railSku=null → pending).
  const _railPending = !projectStructuralFromInput(input).rackingAssembly?.railSku;

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
    // W5 §3 — flag whether the on-file document is the EXACT selected-wattage
    // module sheet or only a family/range page (rendered as PENDING, not exact).
    const exact = resolveModuleDatasheetExactness(m, (dbPanel as { watts?: number } | undefined)?.watts ?? null);
    push('PV MODULE', getManufacturerAsset(dbPanel?.id, 'module_spec'), { moduleExactness: exact });
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

  // Racking pages (Ray 2026-07-20): ALL full-page manufacturer documents live
  // together in the DS appendix — PV-3 stays a DRAWING sheet that cites them.
  //
  // 1. The MOUNT's manufacturer page (attachment/install cross-section doc),
  //    keyed on mountingSystemId — the page PV-3 formerly reprinted inline.
  const mountId = (project as { mountingSystemId?: string }).mountingSystemId;
  // §12 — the DS-3 mount page must state whether the on-file document is
  // APPLICABLE to the SELECTED mount version. The `rooftech-mini` asset carries
  // the "RT-MINI II Installation Manual" while the selected mount is RT-MINI —
  // a product-version mismatch with no verified alias evidence. Label the page
  // non-authoritative (label-not-omit: the mount IS selected and the doc is
  // probably applicable but unproven). No alias is fabricated.
  const _mountAsset = getManufacturerAsset(mountId, 'racking_detail');
  const _mountSys = mountId ? getMountingSystemById(mountId) : undefined;
  const _mountAppl = evaluateDocumentApplicability(_mountSys?.model ?? _mountAsset?.model, _mountAsset, null);
  push('RACKING MOUNT', _mountAsset, { docApplicability: _mountAppl });

  // 2. The RAIL product datasheet for rail-paired mounts (e.g. RT-MINI pad +
  //    IronRidge XR rail): resolved from the SAME equipment-registry rail
  //    accessory the BOM bills — never a hardcoded brand — against the
  //    RAIL-PRODUCT assets ('rail_spec'). NEVER 'racking_detail': those are
  //    ATTACHMENT pages, and showing e.g. the IronRidge FlashFoot2 attachment
  //    instructions on a RT-MINI-pad job misstates the attachment product
  //    (Ray caught exactly this, 2026-07-20). No matching asset → no page.
  // §10 (Ray: "preferably omit") — a rail datasheet is an AUTHORITATIVE appendix
  // page only when a rail SKU is SELECTED + verified into the racking assembly.
  // While the rail is pending (railSku unpinned), the registry-default rail
  // (e.g. IronRidge XR100 for RT-MINI) is NOT the specified rail, so the page is
  // OMITTED entirely — never shown as a reference that reads as authoritative,
  // and its values feed no calc/BOM. The page returns automatically once a rail
  // is genuinely pinned (railSku present ⇒ _railPending false).
  const railAcc = (mountId ? getRegistryEntryV4(mountId) : undefined)
    ?.requiredAccessories?.find(a => a.category === 'rail');
  if (!_railPending && railAcc?.defaultManufacturer && railAcc?.defaultModel) {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const accBrand = norm(railAcc.defaultManufacturer);
    const accModel = norm(railAcc.defaultModel);
    // Longest asset-model match wins ('XR1000 Rail' must not lose to 'XR100 Rail').
    const railAsset = getManufacturerAssetsByCategory('rail_spec')
      .filter(a => norm(a.brand) === accBrand
        && accModel.includes(norm(a.model).replace(/rail$/, '')))
      .sort((a, b) => b.model.length - a.model.length)[0] ?? null;
    push('RACKING RAIL', railAsset);
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
  // W5 §3 — a module document that is only a family/range sheet must be labelled
  // PENDING (never presented as the exact selected-wattage datasheet).
  const _ex = entry.moduleExactness;
  const _familyPending = !!_ex && _ex.stateLabel === 'FAMILY-DATASHEET-PENDING';
  // W6 — the rail datasheet is shown for reference while the rail SKU is unpinned;
  // it must NOT imply the shown rail is the specified rail.
  const _railPending = entry.label === 'RACKING RAIL' && !!entry.railPending;
  // §12 — product-version applicability. When the on-file document covers a
  // different product version than the selected mount and no verified alias
  // evidence exists, DS-3 is NON-AUTHORITATIVE (label-not-omit).
  // ECD §8 — the applicability verdict is a 7-state document state; the banner
  // fires whenever applicability is NOT established (never on availability).
  const _applUnverified = !!entry.docApplicability && !entry.docApplicability.applicabilityVerified;
  const _applBanner = _applUnverified ? `
      <div data-ds-state="document-applicability-unverified" style="border:2px solid #b00;background:#fff5f5;color:#b00;font-weight:700;font-size:8.5px;padding:5px 8px;margin-bottom:6px;line-height:1.4;">
        DOCUMENT APPLICABILITY UNVERIFIED &mdash; ${escapeH(String(entry.docApplicability!.documentProduct ?? a.docTitle ?? (a.brand + ' ' + a.model)))} manual, selected mount ${escapeH(String(entry.docApplicability!.selectedModel ?? a.model))}.
        This document covers a different product version than the selected mount and no verified cross-reference/alias evidence establishes applicability (EQUIPMENT-DOCUMENT-APPLICABILITY). Shown for reference; NOT an authoritative attachment specification. Provide the version-exact document before permit submission.
      </div>` : '';
  const _pendingBanner = _familyPending ? `
      <div data-ds-state="family-datasheet-pending" style="border:2px solid #b00;background:#fff5f5;color:#b00;font-weight:700;font-size:8.5px;padding:5px 8px;margin-bottom:6px;line-height:1.4;">
        EXACT MODULE DOCUMENT PENDING — family datasheet shown for reference.
        On file: ${escapeH(String(_ex!.familyRange?.[0]))}–${escapeH(String(_ex!.familyRange?.[1]))} W family sheet; selected module is ${escapeH(String(_ex!.selectedWatts ?? '?'))} W.
        Attach the exact ${escapeH(String(_ex!.selectedWatts ?? ''))} W datasheet before permit submission.
      </div>`
    : _railPending ? `
      <div data-ds-state="rail-not-selected" style="border:2px solid #b00;background:#fff5f5;color:#b00;font-weight:700;font-size:8.5px;padding:5px 8px;margin-bottom:6px;line-height:1.4;">
        RAIL NOT YET SELECTED — datasheet shown for reference only, not a specification.
        No rail SKU is pinned to this racking assembly (PENDING RACKING ASSEMBLY SELECTION); ${escapeH(a.brand + ' ' + a.model)} is NOT the specified rail. Confirm and pin the rail before permit submission.
      </div>` : '';
  return `
  <div class="page" data-sheet-id="${sheetId}"${_familyPending ? ' data-ds-exact="pending"' : ''}${_railPending ? ' data-ds-rail="pending"' : ''}${_applUnverified ? ' data-ds-applicability="unverified"' : ''}>
    ${titleBlock(input, sheetId, title, n, t)}
    <div style="height:calc(100% - 150px);padding:10px 14px;display:flex;flex-direction:column;">
      ${_applBanner}
      ${_pendingBanner}
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
