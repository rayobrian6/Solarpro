// ═══════════════════════════════════════════════════════════════
// Compliance Pages — Warning Labels, Spec Sheet Reference
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { PERMIT_LABELS_SHEET_TITLE } from '../sheetManifest';
import { escapeH } from '../utils/drawing';
import { interconnectionLabel, hasRealBattery, isSupplySideInterconnection } from '../utils/helpers';
import { buildConductorAuthority, type SubSystemConductorAuthority } from '../utils/conductorAuthority';
import { selectFieldLabels, type FieldLabel } from '../utils/fieldLabels';
import { getThermalDesignBasis } from '../utils/designTemps';
import { projectMicroinverterDatasheet, type ProjectedValue } from '../snapshot/equipmentProjection';
import { isSubSystemKey, type SubSystemKey } from '../utils/subSystems';
import { resolvePanelSpecs, coldVocFactor, type ResolvedPanelSpecs } from '../utils/panelSpecs';
import { hybridSheetSections } from './subSystemSheets';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { getEquipmentContext, getInverterTopology, isFence, isGround, isRoof, topologyToLegacy } from '@/lib/system';
import type { CanonicalSysType } from '../types';
import { MOUNT_SYSTEM_MAP } from '../utils/canonical';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { SOLAR_PANELS, MICROINVERTERS, STRING_INVERTERS, BATTERIES } from '@/lib/equipment-db';
import {
  getManufacturerAsset, DOCUMENT_APPLICABILITY_CHIP,
  type DocumentApplicability, type DocumentApplicabilityState,
} from '@/lib/manufacturer-assets-db';
import { getSnapshot, peekSnapshot } from '../snapshot/read';
// AAC WS-9 — the ONE document-applicability seam every sheet may use.
import { sheetDocumentApplicability } from '../snapshot/documentAuthority';
// ECD §8 — APP-A's closing conclusion is DERIVED from the release-gate registry.
import { projectEquipmentListingConclusion } from '../snapshot/equipmentListingConclusion';
// ECD §7 — the canonical bonding authority (the APP-A UL-listing row).
import { projectRackingBondingAuthority } from '../snapshot/rackingBonding';
import { projectStructuralFromInput, projectFastenerAssembly } from '../snapshot/structuralProjection';
import { projectCodeAuthorityFromInput } from '../snapshot/codeAuthorityProjection';
// PPC §10 — PV-5's rated-value basis line comes from THE issue-state language
// accessor (digest-bound). It previously asserted "FROM THE APPROVED DESIGN" while
// the package carried open blocking release items and no seal.
import { projectIssueStateLanguageFromInput } from '../snapshot/projectAuthorityProjection';

// CMDA — the ONLY correct inline font-family spelling (single-quoted names
// nest safely inside a double-quoted style attribute).
import { CSS_FONT_MONO_STACK } from '../fonts/fontPack';
// CMEI — module identity comes from THE canonical accessor.
import { resolveModuleIdentity } from '@/lib/equipment/moduleIdentity';
export function pageWarningLabels(
  input: PermitInput, cad: CADModel, pageNum: number, totalPages: number,
  opts?: { merged?: boolean },
): string {
  const { compliance } = input;
  // W4 §2: NEC edition projects from the snapshot codeAuthority (single source).
  const cp = projectCodeAuthorityFromInput(input);
  const necVer = cp.nec ?? 'PENDING';
  // PPC §10 — the ONE issue-state language set (digest-bound). Approved-design
  // wording is reachable ONLY through this accessor and ONLY when a digest-bound
  // engineering approval exists with zero open blocking release items.
  const _issueLang = projectIssueStateLanguageFromInput(input);
  const _isRoof = isRoof(cad.systemType);
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);

  // The required field-label (sticker/decal) set is standard PER JOB — derive
  // it from the field-label dataset (lib/data/placards) gated by topology,
  // interconnection, battery and rapid-shutdown, resolved to this NEC edition.
  const labels = selectFieldLabels(input, cad);
  // A.4b §3 — `required` is a PROCUREMENT/INSTALLATION assertion and is false for
  // an edition-dependent placard whose adopted edition is unresolved. Such a
  // placard must still be SHOWN, marked NOT RELEASED — dropping it silently
  // would hide from the reviewer that a placard is in play and unresolved, which
  // is the opposite of the honesty this containment exists for. It is displayed
  // and excluded from procurement, never displayed as ordered.
  const requiredLabels = labels.filter(l => l.required);
  const displayLabels = requiredLabels;
  // A.4b — the RELEASED set drives the grid and every count line, exactly as
  // before, so the sheet's own arithmetic (decals + on-card == applies) still
  // reconciles. Pending placards are NOT folded into that accounting: they are
  // not released, and counting them as released is the claim being prevented.
  // They get their own block below, so the reviewer sees they are in play and
  // withheld — a placard that vanishes silently is the other failure mode.
  const pendingLabels = labels.filter(l => l.editionPending);
  const necYear = cp.nec ?? 'PENDING';

  // ── SITE-COMPUTED RATING LABELS (per sub-system) ─────────────────────────
  // The dataset's fill-in ratings labels (DC PV power source / AC disconnect)
  // carry ONE whole-system value set — wrong on a hybrid where each sub has
  // its own string length, module and feeder. Values below come from the SAME
  // per-sub conductor authority E-1/PV-4B print (never re-derived) + the
  // equipment DB datasheet records (Vmp/Imp/β) matched by the sub's OWN model.
  const { project, system } = input;
  const auth = buildConductorAuthority(input, cad);
  const _projX = project as unknown as { state?: string; address?: string; lat?: number; lng?: number };
  // W5 §4 — ONE thermal basis (singular; shared with APP-A + disconnect directory).
  const _temps = getThermalDesignBasis({
    lat: _projX.lat, lng: _projX.lng, state: _projX.state, address: _projX.address,
    designTempMinOverrideC: project.designTempMin ?? null,
  });
  const tMinC = _temps.minDesignTempC;

  // CMEI — THE canonical accessor. Was a two-way substring match.
  const _panelDb = (model?: string) => resolveModuleIdentity({ model: model ?? null }).spec ?? undefined;
  const _subName = (k: string) => k === 'roof' ? 'ROOF ARRAY' : k === 'ground' ? 'GROUND ARRAY' : k === 'fence' ? 'FENCE ARRAY' : k.toUpperCase();
  const _invListX = ((system.inverters ?? []) as Array<{ subSystemKey?: string; type?: string; model?: string; strings?: Array<{ panelCount?: number }> }>);
  const _primaryKey = auth.subSystems[0]?.key;

  interface RatingCard {
    kind: 'dc' | 'ac';
    id: string;
    title: string;
    subTitle: string;
    rows: Array<{ k: string; v: string }>;
    note?: string;
    loc: string;
    code: string;
  }
  const ratingCards: RatingCard[] = [];
  let _dcN = 0; let _acN = 0;
  let _betaAssumed = false;

  for (const sub of auth.subSystems) {
    if (sub.isMicro) continue;
    const eqS = sub.equipment;
    const db = _panelDb(eqS.panelModel);
    const voc = eqS.panelVoc || db?.voc || 0;
    const isc = eqS.panelIsc || db?.isc || 0;
    const vmp = db?.vmp ?? (voc ? parseFloat((voc * 0.83).toFixed(1)) : 0);
    const imp = db?.imp ?? (vmp && eqS.panelWatts ? parseFloat((eqS.panelWatts / vmp).toFixed(2)) : 0);
    const beta = typeof db?.tempCoeffVoc === 'number' ? db.tempCoeffVoc : undefined; // %/°C (negative)
    // String composition from the sub's OWN tagged inverters (contract §1.3).
    const own = _invListX.filter(inv =>
      ((isSubSystemKey(inv?.subSystemKey) ? inv.subSystemKey : _primaryKey) === sub.key)
      && String(inv?.type || '').toLowerCase() !== 'micro');
    let nPer = 0; let nStrings = 0;
    for (const inv of own) for (const s of inv.strings ?? []) {
      if ((s.panelCount || 0) > 0) { nStrings += 1; nPer = Math.max(nPer, s.panelCount || 0); }
    }
    if (!nPer) { nStrings = Math.max(1, sub.dcStrings.length); nPer = Math.ceil(sub.panelCount / nStrings); }
    // NEC 690.7(A): Voc × (1 + β(Tmin − 25)). β unresolved ⇒ MARKED ×1.25.
    const factor = beta !== undefined ? 1 + (beta / 100) * (tMinC - 25) : 1.25;
    if (beta === undefined) _betaAssumed = true;
    const maxSysV = voc * factor * nPer;
    _dcN += 1;
    ratingCards.push({
      kind: 'dc',
      id: `DC-L${_dcN}`,
      title: 'PHOTOVOLTAIC SYSTEM DC DISCONNECT',
      subTitle: `${_subName(sub.key)} — ${nStrings} STRING${nStrings === 1 ? '' : 'S'} × ${nPer} MODULES (${(eqS.panelModel || 'PV MODULE').toUpperCase()})`,
      rows: [
        { k: 'OPERATING VOLTAGE', v: voc && vmp ? `${(vmp * nPer).toFixed(1)} VDC` : '____ VDC' },
        { k: 'OPERATING CURRENT', v: imp ? `${imp.toFixed(2)} AMPS` : '____ AMPS' },
        { k: 'MAX SYSTEM VOLTAGE', v: voc ? `${maxSysV.toFixed(1)} VDC` : '____ VDC' },
        { k: 'SHORT CIRCUIT CURRENT', v: isc ? `${(isc * 1.25).toFixed(2)} AMPS` : '____ AMPS' },
      ],
      note: beta !== undefined
        ? `MAX SYSTEM VOLTAGE = VOC × (1 + β(TMIN−25)) · β = ${beta}%/°C @ ${tMinC}°C · ISC × 1.25 PER NEC 690.8(A)`
        : `MAX SYSTEM VOLTAGE = VOC × 1.25 († β UNRESOLVED — CONSERVATIVE) @ ${tMinC}°C · ISC × 1.25 PER NEC 690.8(A)`,
      loc: `Inverter and DC disconnecting means serving the ${sub.key} array${auth.isHybrid ? ` (${sub.key.toUpperCase()} sub-system)` : ''}.`,
      code: `NEC ${necYear}: 690.53, 690.13(B)`,
    });
  }

  // Combined POI current = Σ per-sub feeder currents from the SAME authority
  // E-1 draws (system.totalAcKw is a stale top-level aggregate on hybrids —
  // 19.4 kW vs the authority's 34.8 kW on Stowell; never trust it here).
  const _acTotalA = auth.subSystems.reduce((a, s) => a + (s.acSubFeeder.currentA || 0), 0)
    || ((getSnapshot(input).derived.acWattsContinuous || (system.totalAcKw || 0) * 1000) / 240);
  if (auth.isHybrid) {
    for (const sub of auth.subSystems) {
      _acN += 1;
      const devTxt = sub.isMicro
        ? `${sub.deviceCount} × ${(sub.equipment.inverterModel !== '—' ? sub.equipment.inverterModel : 'MICROINVERTERS').toUpperCase()}`
        : (sub.equipment.inverterModel !== '—' ? sub.equipment.inverterModel.toUpperCase() : 'STRING INVERTER');
      ratingCards.push({
        kind: 'ac',
        id: `AC-L${_acN}`,
        title: 'PHOTOVOLTAIC AC DISCONNECT',
        subTitle: `${_subName(sub.key)} CIRCUIT — ${devTxt}`,
        rows: [
          { k: 'MAX AC OPERATING CURRENT', v: sub.acSubFeeder.currentA > 0 ? `${sub.acSubFeeder.currentA.toFixed(1)} AMPS` : '____ AMPS' },
          { k: 'NOMINAL OPERATING AC VOLTAGE', v: '240 VAC' },
        ],
        loc: `PV AC combiner panel breaker for the ${sub.key} circuit; sub-system AC disconnect (if installed).`,
        code: `NEC ${necYear}: 690.54`,
      });
    }
  }
  ratingCards.push({
    kind: 'ac',
    id: 'AC-SYS',
    title: 'PHOTOVOLTAIC SYSTEM AC DISCONNECT',
    subTitle: auth.isHybrid ? 'COMBINED SYSTEM OUTPUT — POINT OF INTERCONNECTION' : 'SYSTEM OUTPUT — POINT OF INTERCONNECTION',
    rows: [
      { k: 'MAX AC OPERATING CURRENT', v: _acTotalA > 0 ? `${_acTotalA.toFixed(1)} AMPS` : '____ AMPS' },
      { k: 'NOMINAL OPERATING AC VOLTAGE', v: '240 VAC' },
    ],
    loc: 'Inverter, AC disconnect(s), and the photovoltaic system point of interconnection.',
    code: `NEC ${necYear}: 690.54`,
  });

  // These dataset labels are SUPERSEDED on this sheet by the site-computed
  // cards / the multiple-power-sources placard (still listed in the schedule).
  const SUPERSEDED = new Set([
    'dc-photovoltaic-power-source-ratings',
    'ac-point-of-connection-disconnect',
    'multiple-sources-of-power-directory',
  ]);
  const gridLabels = displayLabels.filter(l => !SUPERSEDED.has(l.refId));
  // TAC WS-13 — a superseded label is not DROPPED, it is delivered by another
  // item ON THIS SHEET. The set above is static; only the members that actually
  // apply to THIS system count, and each names where it went. This is what made
  // the old header fail to add up: "N SITE-COMPUTED + M STANDARD" omitted them.
  const _supersededApplicable = requiredLabels.filter(l => SUPERSEDED.has(l.refId));

  // Render each item as what it physically IS — a peel-and-stick field DECAL
  // (adhesive vinyl / reflective label) that gets applied to a specific piece
  // of equipment (conduit, inverter, disconnect, service panel), NOT a
  // monument placard. Real solar labels are die-cut (rounded corners), come in
  // two dominant formats — ANSI Z535 two-tone (colored signal header + white
  // message body) and solid reflective (white on red, NEC-mandated) — and each
  // one calls out the equipment it's affixed to.
  function renderLabel(lbl: FieldLabel): string {
    const SIGNALS = ['DANGER', 'WARNING', 'CAUTION', 'NOTICE'];
    const first = (lbl.lines[0] || '').trim().toUpperCase();
    const signal = SIGNALS.includes(first) ? first : '';
    const title = signal ? '' : (lbl.lines[0] || '');
    // Some dataset labels carry ONLY a title line (the marking wording), which
    // renders a dark title bar over an EMPTY white body (e.g. the L-18 GEC
    // placard "GROUNDING ELECTRODE CONDUCTOR — DO NOT DISCONNECT"). Supply real
    // body copy so the placard reads as a complete label, not a blank card.
    const BODY_FALLBACK: Record<string, string[]> = {
      'grounding-electrode-conductor-marking': [
        'DO NOT DISCONNECT OR REMOVE.',
        'Bonds the PV system to the building grounding electrode system.',
        'Green / green-yellow identification per NEC 250.119; sized per NEC 250.66 / 690.47.',
      ],
      // Title-only marking labels — supply body copy so the decal reads as a
      // complete label (and points at the site-computed ratings labels).
      'pv-system-dc-disconnect': [
        'IDENTIFIES THE PV SYSTEM DC DISCONNECTING MEANS.',
        'Ratings per the site-computed DC DISCONNECT labels (DC-L#) on this sheet.',
      ],
      'ac-disconnect-marking': [
        'IDENTIFIES THE EXTERIOR PV AC DISCONNECTING MEANS.',
        'Ratings per the site-computed AC DISCONNECT labels (AC-L# / AC-SYS) on this sheet.',
      ],
    };
    const _rest0 = lbl.lines.slice(1);
    const rest = _rest0.length ? _rest0 : (BODY_FALLBACK[lbl.refId] ?? []);

    // NEC-mandated white-on-red decals: rapid shutdown, PV power source,
    // disconnect + shock labels. These are solid reflective red by code.
    const necRed = /690\.56\((B|C)\)|690\.12\(D\)|690\.31|690\.13|690\.53|690\.7\(D\)/.test(lbl.necRef);

    // ANSI Z535 signal-panel colors (the recognizable vinyl-label look).
    const ANSI: Record<string, { band: string; ink: string }> = {
      DANGER: { band: '#c8102e', ink: '#ffffff' },
      WARNING: { band: '#f07c00', ink: '#0a0a0a' },
      CAUTION: { band: '#f4c400', ink: '#0a0a0a' },
      NOTICE: { band: '#0b5da8', ink: '#ffffff' },
    };

    // ISO 3864 / ANSI Z535 safety-alert symbol — yellow triangle, black "!".
    const alert = (h = 17) => {
      const w = Math.round(h * 1.17);
      return `<svg width="${w}" height="${h}" viewBox="0 0 21 18" aria-hidden="true" style="flex:0 0 auto;display:block;">` +
        `<path d="M10.5 1.4 L19.6 16.6 L1.4 16.6 Z" fill="#f5c400" stroke="#0a0a0a" stroke-width="1.4" stroke-linejoin="round"/>` +
        `<rect x="9.45" y="6.2" width="2.1" height="5.9" rx="0.4" fill="#0a0a0a"/>` +
        `<rect x="9.45" y="13.1" width="2.1" height="2.1" rx="0.4" fill="#0a0a0a"/></svg>`;
    };

    // Where does this decal get stuck? (drives the "AFFIX TO" tag)
    const p = lbl.placement.toLowerCase();
    const affix =
      /rapid shutdown|initiation/.test(p) ? 'RSD SWITCH' :
      /transfer switch|ats/.test(p) ? 'TRANSFER SWITCH' :
      /disconnect/.test(p) ? 'DISCONNECT' :
      /inverter/.test(p) ? 'INVERTER' :
      /battery|storage|ess/.test(p) ? 'ESS ENCLOSURE' :
      /service panel|main panel|main service|msp|load center/.test(p) ? 'SERVICE PANEL' :
      /combiner|raceway|conduit/.test(p) ? 'CONDUIT / RACEWAY' :
      /meter/.test(p) ? 'UTILITY METER' :
      /array|roof|elevation/.test(p) ? 'ARRAY' :
      'EQUIPMENT';

    const sheen = `<div style="position:absolute;top:0;left:0;right:0;height:42%;background:linear-gradient(180deg,rgba(255,255,255,0.20),rgba(255,255,255,0));pointer-events:none;"></div>`;
    const body = (ink: string, lines: string[], leadTitle = '') =>
      (leadTitle ? `<div style="font-size:10.5px;font-weight:900;letter-spacing:0.3px;line-height:1.2;color:${ink};margin-bottom:2px;">${escapeH(leadTitle)}</div>` : '') +
      lines.map((l, i) => `<div style="font-size:${i === 0 && !leadTitle ? '8.8' : '8'}px;font-weight:${i === 0 && !leadTitle ? '800' : '700'};letter-spacing:0.15px;line-height:1.4;color:${ink};">${escapeH(l)}</div>`).join('');

    let decal: string;
    if (necRed) {
      // Solid reflective red decal (white text, thin white keyline, sheen).
      decal = `<div style="position:relative;border-radius:6px;overflow:hidden;background:#c1121f;` +
        `border:1.5px solid #7d0b12;box-shadow:0 1.5px 3px rgba(0,0,0,0.4);padding:8px 9px;text-align:center;min-height:80px;box-sizing:border-box;">` +
        sheen +
        `<div style="position:absolute;top:3px;left:3px;right:3px;bottom:3px;border:1px solid rgba(255,255,255,0.55);border-radius:4px;pointer-events:none;"></div>` +
        (signal
          ? `<div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;">${alert(16)}<span style="font-size:14px;font-weight:900;letter-spacing:1.5px;color:#fff;">${escapeH(signal)}</span></div>`
          : '') +
        body('#ffffff', rest, title) +
      `</div>`;
    } else if (signal) {
      // ANSI Z535 two-tone decal: colored signal header + white message body.
      const a = ANSI[signal];
      decal = `<div style="position:relative;border-radius:6px;overflow:hidden;background:#fff;border:1.5px solid #0a0a0a;box-shadow:0 1.5px 3px rgba(0,0,0,0.35);min-height:80px;box-sizing:border-box;">` +
        `<div style="position:relative;background:${a.band};color:${a.ink};display:flex;align-items:center;justify-content:center;gap:7px;padding:4px 6px;border-bottom:1.5px solid #0a0a0a;">` +
          alert(16) + `<span style="font-size:14.5px;font-weight:900;letter-spacing:1.5px;">${escapeH(signal)}</span>` +
        `</div>` +
        `<div style="padding:7px 9px;text-align:center;">${body('#0a0a0a', rest)}</div>` +
      `</div>`;
    } else {
      // Printed info/rating decal: dark title bar + white body (engraved look).
      decal = `<div style="position:relative;border-radius:6px;overflow:hidden;background:#fff;border:1.5px solid #0a0a0a;box-shadow:0 1.5px 3px rgba(0,0,0,0.35);min-height:80px;box-sizing:border-box;">` +
        `<div style="background:#111;color:#fff;padding:4px 7px;text-align:center;font-size:9.5px;font-weight:900;letter-spacing:0.5px;">${escapeH(title)}</div>` +
        `<div style="padding:7px 9px;text-align:center;">${body('#111', rest)}</div>` +
      `</div>`;
    }

    // A.4b §3 — an edition-dependent placard with no established adopted edition
    // has no authoritative specification. It is shown so the reviewer knows it is
    // in play, and marked NOT RELEASED so nobody manufactures or installs it from
    // a defaulted year.
    // A.4b — no per-card pending marker here BY CONSTRUCTION: the grid renders
    // only RELEASED labels (`required` excludes editionPending), so a pending
    // placard never reaches this function. An earlier draft added a banner here
    // and it was doubly wrong — unreachable once the design settled, and while it
    // was reachable it overflowed the printable box by 64 px and clipped PV-5.
    // Pending placards are listed once, below the grid, where they cannot be
    // mistaken for part of the released set.
    return `<div style="page-break-inside:avoid;">` +
      decal +
      labelCaption(lbl.id, `AFFIX TO ${affix}: ${lbl.placement}`, lbl.necRef) +
    `</div>`;
  }

  // Reference-style caption under every label: LABEL LOCATION + PER CODE(S).
  function labelCaption(id: string, loc: string, code: string): string {
    return `<div style="margin-top:3px;padding:0 1px;">` +
      `<div style="font-size:6.5px;font-weight:900;letter-spacing:0.4px;color:#111;text-decoration:underline;">${escapeH(id)} — LABEL LOCATION:</div>` +
      `<div style="font-size:6.5px;color:#333;line-height:1.35;">${escapeH(loc)}</div>` +
      `<div style="font-size:6.5px;font-weight:800;color:#111;margin-top:1px;">PER CODE(S): <span style="font-family:var(--mono);font-weight:700;">${escapeH(code)}</span></div>` +
    `</div>`;
  }

  // Site-computed ratings decal (reference E-2 style): solid red field, white
  // keyline, centered KEY: VALUE rows with the value underlined.
  function renderRatingCard(c: RatingCard): string {
    const sheenR = `<div style="position:absolute;top:0;left:0;right:0;height:42%;background:linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0));pointer-events:none;"></div>`;
    const rows = c.rows.map(r =>
      `<div style="font-size:8.4px;font-weight:900;letter-spacing:0.2px;line-height:1.6;color:#fff;">${escapeH(r.k)}: ` +
      `<span style="text-decoration:underline;text-underline-offset:2px;font-family:var(--mono);white-space:nowrap;">${escapeH(r.v)}</span></div>`).join('');
    return `<div style="page-break-inside:avoid;">` +
      `<div style="position:relative;border-radius:6px;overflow:hidden;background:#c1121f;border:1.5px solid #7d0b12;box-shadow:0 1.5px 3px rgba(0,0,0,0.4);padding:7px 8px;text-align:center;min-height:80px;box-sizing:border-box;">` +
        sheenR +
        `<div style="position:absolute;top:3px;left:3px;right:3px;bottom:3px;border:1px solid rgba(255,255,255,0.55);border-radius:4px;pointer-events:none;"></div>` +
        `<div style="font-size:10px;font-weight:900;letter-spacing:0.6px;color:#fff;line-height:1.2;">&#9888; ${escapeH(c.title)} &#9888;</div>` +
        `<div style="font-size:6.6px;font-weight:800;letter-spacing:0.3px;color:#ffd9dc;margin:2px 0 3px;line-height:1.3;">${escapeH(c.subTitle)}</div>` +
        rows +
        (c.note ? `<div style="font-size:6.2px;font-weight:700;color:#ffc9cd;margin-top:3px;line-height:1.3;">${escapeH(c.note)}</div>` : '') +
      `</div>` +
      labelCaption(c.id, c.loc, c.code) +
    `</div>`;
  }

  // 4-across card grid (site-computed rating cards lead, then generic decals).
  // AAC WS-10 — `perRow` narrows the grid when the label column shares the sheet
  // with the merged plaque (3 wider cards instead of 4 narrow ones, so the
  // CAUTION/WARNING signal words never clip horizontally).
  function buildCardGrid(cells: string[], perRow = 4): string {
    let html = '';
    const _w = (100 / perRow).toFixed(4).replace(/\.?0+$/, '');
    for (let i = 0; i < cells.length; i += perRow) {
      const row = cells.slice(i, i + perRow);
      html += '<tr>';
      for (const c of row) html += `<td style="width:${_w}%;padding:5px 6px 13px;vertical-align:top;">${c}</td>`;
      for (let p = row.length; p < perRow; p++) html += `<td style="width:${_w}%;padding:5px 6px 13px;"></td>`;
      html += '</tr>';
    }
    return `<table style="width:100%;border-collapse:collapse;table-layout:fixed;"><tbody>${html}</tbody></table>`;
  }
  // Keep the dataset inverter-listing label's amp figure consistent with the
  // authority sum (its upstream fill reads the stale totalAcKw aggregate).
  const gridLabelsFixed = gridLabels.map(l =>
    l.refId === 'inverter-listing-label' && _acTotalA > 0
      ? { ...l, lines: l.lines.map(t => t.replace(/[\d.]+\s*A\s*@\s*240\s*V/i, `${_acTotalA.toFixed(1)} A @ 240 V`)) }
      : l);
  const cardCells = [
    ...ratingCards.map(renderRatingCard),
    ...gridLabelsFixed.map(renderLabel),
  ];

  // ── MULTIPLE POWER SOURCES placard (NEC 705.10 / 690.56(B)) ──────────────
  // Hybrid systems are multi-source by definition — the placard lists every
  // source + its disconnecting means. (The site map lives on PV-1/PV-2; this
  // placard carries the structured source directory only.)
  const hasBatteryW = hasRealBattery(project);
  const mainAW = project.mainPanelAmps || 200;
  const battKwhW = hasBatteryW ? (project.batteryCount || 1) * (project.batteryKwh ?? 5.0) : 0;
  interface SrcRow { name: string; rating: string; disco: string; }
  const srcRows: SrcRow[] = [{
    name: 'UTILITY GRID SERVICE',
    rating: `${mainAW} A &middot; 120/240 V 1&#966;`,
    disco: 'Main service disconnect &mdash; at utility meter / service entrance',
  }];
  for (const sub of auth.subSystems) {
    const kw = (sub.acSubFeeder.currentA * 240) / 1000;
    const topoTxt = sub.isMicro ? 'MICROINVERTERS' : sub.topology === 'OPTIMIZER' ? 'OPTIMIZER INVERTER' : 'STRING INVERTER';
    srcRows.push({
      name: `${_subName(sub.key)} &mdash; SOLAR PV (${topoTxt})`,
      // 2026-08-29 - AC kW is printed to TWO decimals everywhere else (cover, E-1,
      // PV-5, the equipment schedule). These four device-card ratings used one, so
      // the same system read 10.82 kW AC on six sheets and 10.8 kW AC on the
      // disconnect schedule. One number, one precision - the rule root 6 applied to
      // the roof pitch is the same rule here.
      rating: `${kw > 0 ? kw.toFixed(2) : '&mdash;'} kW AC &middot; ${sub.panelCount} MODULES`,
      disco: auth.isHybrid
        ? `${sub.key.charAt(0).toUpperCase() + sub.key.slice(1)} circuit breaker at the PV AC combiner panel &#8594; PV system disconnect at the point of interconnection`
        : 'PV AC disconnect &mdash; adjacent to utility meter (see PV-1)',
    });
  }
  if (hasBatteryW) {
    srcRows.push({
      name: 'ENERGY STORAGE SYSTEM (ESS)',
      rating: `${battKwhW.toFixed(1)} kWh${project.batteryBrand ? ` &middot; ${project.batteryBrand}` : ''}`,
      disco: 'ESS disconnect &mdash; at the battery / ESS enclosure',
    });
  }
  const placardHtml =
    `<div style="border:2.5px solid #000;background:#fff;page-break-inside:avoid;">` +
      `<div style="padding:6px 10px 5px;text-align:center;border-bottom:2px solid #000;">` +
        `<div style="font-size:24px;font-weight:900;letter-spacing:1px;line-height:1;">CAUTION:</div>` +
        `<div style="font-size:10.5px;font-weight:800;line-height:1.35;margin-top:3px;">POWER TO THIS BUILDING IS ALSO SUPPLIED FROM THE FOLLOWING SOURCES WITH DISCONNECTS AS SHOWN</div>` +
      `</div>` +
      `<table class="equip-table" style="margin:0;">` +
        `<thead><tr>` +
          `<th style="width:6%;text-align:center;">#</th>` +
          `<th style="width:33%;">POWER SOURCE</th>` +
          `<th style="width:24%;">RATING</th>` +
          `<th>DISCONNECTING MEANS / LOCATION</th>` +
        `</tr></thead>` +
        `<tbody>` +
        srcRows.map((s, i) =>
          `<tr${i % 2 === 1 ? ' class="bg-lt"' : ''}>` +
          `<td class="fw9 mono" style="text-align:center;">${i + 1}</td>` +
          `<td class="fw7" style="font-size:7.6px;">${s.name}</td>` +
          `<td class="mono" style="font-size:7.2px;">${s.rating}</td>` +
          `<td style="font-size:7.2px;">${s.disco}</td>` +
          `</tr>`).join('') +
        `</tbody>` +
      `</table>` +
    `</div>` +
    labelCaption('PL-1', 'At each service equipment location and at each power-source disconnecting means; group with all on-site power-source directories (see also PV-6 permanent plaque).', `NEC ${necYear}: 705.10, 690.56(B)`);

  // ── PERMANENT SIGNAGE NOTES (reference E-2 standard) ─────────────────────
  const signageNotes = [
    `Not all placards shown may be required by the local AHJ. Owner / installer shall verify placard requirements with the local AHJ before installation.`,
    `All plaques and signage shall comply with the adopted edition of the National Electrical Code (NEC ${necVer}) and local amendments.`,
    `Alternate power-source placards shall be metallic or plastic, engraved or machine-printed, with letters in a contrasting color to the plaque. Placards shall be attached by pop rivets, screws, or another approved permanent method &mdash; adhesive-only attachment is not permitted where prohibited by the AHJ.`,
    `Directory placard marking content and format: red background, white lettering, minimum 3/8" letter height, all capital letters, Arial or similar non-bold font, reflective, weather-resistant material suitable for the environment (UL 969).`,
    `Field-applied labels on conduit / raceways shall appear at intervals not exceeding 10 ft (3 m), at every turn, and above/below each penetration per NEC 690.31(D).`,
  ];
  const signageHtml =
    `<div style="border:var(--border);padding:5px 7px;font-size:7.4px;line-height:1.5;">` +
    signageNotes.map((n, i) => `<div style="display:flex;gap:5px;margin-bottom:2px;"><span style="font-weight:900;font-family:var(--mono);flex:0 0 auto;">${i + 1}.</span><span>${n}</span></div>`).join('') +
    `</div>`;

  // ── Label schedule (all labels incl. N/A + superseded → computed cards) ──
  const scheduleHtml = (() => {
    const _row = (lbl: typeof labels[number], idx: number) =>
      `<tr style="${!lbl.required ? 'opacity:0.45;' : ''}background:${idx % 2 === 0 ? '#fff' : '#f5f5f5'};">` +
      `<td class="fw9 mono" style="font-size:6.8px;">${lbl.id}</td>` +
      // ECD §9 / gate 16 — the placard CODE-REF cell is machine-tagged with the
      // label's own topology classification, so the package-wide topology/citation
      // gate can assert directly that no supply-side label carries a load-side-only
      // citation (it previously had no tagged cell to read and the PV-5 placard
      // schedule was outside the gate's reach).
      `<td style="font-family:${CSS_FONT_MONO_STACK};font-size:6.4px;" data-label-nec-ref="${escapeH(lbl.necRef)}" data-label-side="${escapeH(lbl.interconnectSide)}" data-label-required="${lbl.required ? 'true' : 'false'}">${lbl.necRef}</td>` +
      `<td style="text-align:center;font-weight:900;font-family:${CSS_FONT_MONO_STACK};font-size:6.6px;">${lbl.required ? (SUPERSEDED.has(lbl.refId) ? 'YES*' : 'YES') : 'N/A'}</td>` +
      `<td style="font-size:6.6px;">${lbl.placement}</td>` +
      `</tr>`;
    const _head = `<thead><tr>` +
      `<th style="width:9%;">LABEL</th>` +
      `<th style="width:26%;">CODE REF</th>` +
      `<th style="width:9%;text-align:center;">REQ'D</th>` +
      `<th>PLACEMENT LOCATION</th>` +
      `</tr></thead>`;
    return `<table class="equip-table" style="margin:0;">${_head}<tbody>${labels.map(_row).join('')}</tbody></table>` +
      `<div data-label-accounting="1" style="font-size:6.2px;color:#555;margin-top:2px;">`
      + `${gridLabels.length} + ${_supersededApplicable.length} YES* = ${requiredLabels.length} of ${labels.length} apply, ${labels.length - requiredLabels.length} N/A. `
      + `* Rendered on this sheet with site-computed ratings (DC/AC disconnect labels) or as the multiple-power-sources placard above.${_betaAssumed ? ' &nbsp;&dagger; Module Voc temperature coefficient unresolved in the equipment DB &mdash; conservative NEC 690.7 &times;1.25 applied; field-verify against the module datasheet.' : ''}</div>`;
  })();

  // ── AAC WS-10 — MERGED PV-5 + PV-6 (the permit profile's ONE labels sheet) ──
  // The PV-6 body (the permanent plaque = the NEC 705.10 power-source directory
  // + the 690.56(B) disconnect-location plaque + the rapid-shutdown band + the
  // placard specification) composes into the middle column. The only block that
  // LEAVES the set is PV-5's own "MULTIPLE POWER SOURCES" table, because the
  // plaque beside it IS that directory in its permanent, code-required form —
  // a duplicate is removed, no requirement is.
  const _merged = opts?.merged === true;
  const _pv6Body = _merged
    ? pageDisconnectDirectory(input, cad, pageNum, totalPages, { bodyOnly: true })
    : '';
  const _mergedPlacardRef = `
          <div class="sec-hdr-dark" style="margin-bottom:4px;">
            MULTIPLE POWER SOURCES &mdash; PERMANENT PLACARD (NEC 705.10)
          </div>
          <div style="border:var(--border);padding:5px 7px;font-size:7.4px;line-height:1.5;">
            The permanent power-source directory / disconnect-location plaque required by NEC ${necYear} 705.10 and 690.56(B)
            is the plaque detailed on this sheet (centre column) &mdash; it lists every source, every disconnecting means,
            its rating and its location, and carries the rapid-shutdown placard. Install per the placard specification.
          </div>`;

  return `
  <div class="page">
    ${titleBlock(input, 'PV-5', _merged ? PERMIT_LABELS_SHEET_TITLE : 'WARNING LABELS & REQUIRED PLACARDS', pageNum, totalPages)}
    <div class="page-content">

      <div class="note-bar" style="margin-bottom:6px;">
        ALL WARNING LABELS SHALL BE PERMANENTLY INSTALLED, WEATHER-RESISTANT (UL 969), AND MEET MINIMUM CHARACTER HEIGHT REQUIREMENTS PER NEC ${necVer} &mdash;
        LETTERING MIN. 3/8" HEIGHT FOR FIELD-APPLIED LABELS, OR AS SPECIFIED BY MANUFACTURER FOR LISTED LABELS.
        COLOR: WHITE LETTERING ON RED BACKGROUND (${necVer === '2023' ? 'NEC 690.12(D)' : 'NEC 690.56'}) UNLESS OTHERWISE NOTED.
        RATED VALUES ON THIS SHEET ARE ${escapeH(_issueLang.computedFromLabel)} &mdash; DESIGN LOW TEMP ${tMinC}&deg;C (${escapeH(_temps.source).toUpperCase()}).
      </div>

      <div style="display:grid;grid-template-columns:${_merged ? '33fr 35fr 32fr' : '59fr 41fr'};gap:10px;align-items:start;">

        <!-- LEFT: the label set -->
        <div>
          <div class="sec-hdr-dark" style="margin-bottom:4px;">
            REQUIRED LABELS &mdash; ${requiredLabels.length} OF ${labels.length} DATASET LABELS (${gridLabels.length} DECAL${gridLabels.length === 1 ? '' : 'S'} &middot; ${ratingCards.length} CARD${ratingCards.length === 1 ? '' : 'S'} &middot; ${_supersededApplicable.length} ON CARD/PLACARD)
          </div>
          ${buildCardGrid(cardCells, _merged ? 3 : 4)}
          ${pendingLabels.length ? `
          <div style="margin-top:5px;border:1px solid #b91c1c;background:#fdecec;padding:3px 4px;">
            <div style="font-size:6.4px;font-weight:900;color:#b91c1c;letter-spacing:0.3px;">
              ${pendingLabels.length} PLACARD${pendingLabels.length === 1 ? '' : 'S'} PENDING CODE AUTHORITY &mdash; NOT RELEASED FOR PROCUREMENT / INSTALLATION
            </div>
            <div style="font-size:6px;color:#7f1d1d;line-height:1.35;margin-top:1px;">
              These placards apply to this system, but their requirement, wording, colour or reflectivity changes by
              NEC edition and the jurisdiction's adopted edition is not established. They are excluded from the
              released set above and must not be ordered or installed until the adoption is governed. Specification
              follows the adopted edition, never a bundled or default year.
            </div>
            ${pendingLabels.map(l => `<div style="font-size:6px;color:#111;margin-top:1px;">
              <span style="font-weight:800;">${escapeH(l.refId)}</span> &mdash; ${escapeH(l.necRef || 'section pending')}
            </div>`).join('')}
          </div>` : ''}

        </div>${_merged ? `

        <!-- CENTRE (merged profile): the permanent plaque — former PV-6 -->
        <div data-merged-sheet="PV-6">${_pv6Body}</div>` : ''}

        <!-- RIGHT: multi-source placard / signage rules / QA tables -->
        <div>
          ${_merged ? _mergedPlacardRef : `<div class="sec-hdr-dark" style="margin-bottom:4px;">
            MULTIPLE POWER SOURCES &mdash; PERMANENT PLACARD (NEC 705.10)
          </div>
          ${placardHtml}`}

          <div class="sec-hdr-dark" style="margin:6px 0 4px;">
            PERMANENT SIGNAGE NOTES
          </div>
          ${signageHtml}

          <div class="sec-hdr-dark" style="margin:6px 0 4px;">
            INSPECTION HOLD POINTS
          </div>
          <table class="equip-table" style="margin:0;">
            <thead><tr><th style="width:6%;">#</th><th style="width:26%;">Inspection Point</th><th style="width:50%;">Verification Requirements</th><th style="width:18%;">Code Ref</th></tr></thead>
            <tbody>
              <tr><td class="fw9 mono">1</td><td class="fw7" style="font-size:7px;">Rough Electrical</td><td style="font-size:7px;">Conductor sizing, conduit routing, grounding connections, junction box accessibility</td><td class="mono" style="font-size:6.6px;">NEC 690, 250</td></tr>
              <tr class="bg-lt"><td class="fw9 mono">2</td><td class="fw7" style="font-size:7px;">${_isRoof ? 'Structural / Roof' : _isFence ? 'Structural / Fence' : 'Structural / Ground Mount'}</td><td style="font-size:7px;">${_isRoof ? 'Attachment to structural members, lag bolt embedment, flashing, rail alignment' : _isFence ? 'Fence post embedment, concrete footing pour, post plumb/alignment, module mounting' : 'Pile embedment, ground clearance, tilt angle, module mounting'}</td><td class="mono" style="font-size:6.6px;">IBC 16, IRC R301</td></tr>
              <tr><td class="fw9 mono">3</td><td class="fw7" style="font-size:7px;">Module Installation</td><td style="font-size:7px;">Module mounting, clamp torque, bonding connections, setback compliance</td><td class="mono" style="font-size:6.6px;">UL 2703, IFC 1204</td></tr>
              <tr class="bg-lt"><td class="fw9 mono">4</td><td class="fw7" style="font-size:7px;">Final Electrical</td><td style="font-size:7px;">Labeling, rapid shutdown, disconnect operation, grounding continuity, Voc/Isc verification</td><td class="mono" style="font-size:6.6px;">NEC 690.12, 690.54</td></tr>
              <tr><td class="fw9 mono">5</td><td class="fw7" style="font-size:7px;">Utility Interconnection</td><td style="font-size:7px;">Meter configuration, net metering enrollment, anti-islanding test (if required by AHJ)</td><td class="mono" style="font-size:6.6px;">IEEE 1547, NEC 705</td></tr>
            </tbody>
          </table>

          <div class="sec-hdr-dark" style="margin:6px 0 4px;">
            LABEL SCHEDULE &mdash; ALL LABELS
          </div>
          ${scheduleHtml}

          <div class="sec-hdr-dark" style="margin:6px 0 4px;">
            GENERAL NOTES &mdash; INSTALLATION REQUIREMENTS
          </div>
          <div style="padding:var(--xs);font-size:6.8px;line-height:1.4;border:var(--border);">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <div style="font-weight:900;font-size:7.4px;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1px solid #ccc;padding-bottom:2px;">ELECTRICAL</div>
                <div style="margin-bottom:2px;">1. All electrical work shall be performed by a licensed electrician in accordance with NEC ${necVer}.</div>
                <div style="margin-bottom:2px;">2. All equipment shall be UL-listed and labeled for the intended application.</div>
                <div style="margin-bottom:2px;">3. All conductor terminations shall be torqued to manufacturer specifications.</div>
                <div style="margin-bottom:2px;">4. Conduit penetrations through fire-rated assemblies shall be firestopped per IBC 714.</div>
                <div style="margin-bottom:2px;">5. Anti-islanding protection per IEEE 1547 and UL 1741 SA is integral to the inverter.</div>
              </div>
              <div>
                <div style="font-weight:900;font-size:7.4px;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1px solid #ccc;padding-bottom:2px;">STRUCTURAL / INSTALLATION</div>
                <div style="margin-bottom:2px;">1. Contractor shall verify ${_isRoof ? 'roof framing type, size, spacing, and condition prior to installation' : _isFence ? 'fence post layout, spacing, and foundation conditions prior to installation' : 'ground mount pile layout, soil conditions, and site grades prior to installation'}.</div>
                <div style="margin-bottom:2px;">2. Any deviation from ${escapeH(_issueLang.deviationReferenceLabel)} shall be reported to the engineer of record.</div>
                <div style="margin-bottom:2px;">3. ${_isRoof ? 'All roof penetrations shall be waterproofed per roofing manufacturer requirements.' : 'All below-grade conduit and conductors shall be rated for wet/direct burial locations per NEC 300.5.'}</div>
                <div style="margin-bottom:2px;">4. Module and racking installation per manufacturer instructions and UL 2703 listing.</div>
                <div style="margin-bottom:2px;">5. Maintain fire-access pathways and ridge setbacks per IFC &sect;1204.2.1 as shown on PV-1.</div>
              </div>
            </div>
          </div>
        </div>

      </div>

    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════════════
// PV-6: DISCONNECT DIRECTORY & EMERGENCY PLACARD
// The permanent plaque installed at the service disconnect. One sheet
// satisfies three code requirements at once:
//   • NEC 705.10  — power-source directory (all sources + disconnect map)
//   • NEC 690.56(B) — plaque giving the location of every PV disconnect
//   • NEC 690.12(D)/690.56(C) — rapid-shutdown building placard
// Ratings are pulled from the shared conductor authority so the plaque
// can never disagree with E-1 / PV-4B. Content adapts to topology,
// interconnection method, rapid-shutdown and battery presence.
// ═══════════════════════════════════════════════════════════════

export function pageDisconnectDirectory(
  input: PermitInput, cad: CADModel, pageNum: number, totalPages: number,
  opts?: { bodyOnly?: boolean },
): string {
  const { project, system, compliance } = input;
  // W4 §2: NEC edition + edition-keyed clause selection project from codeAuthority.
  const cp = projectCodeAuthorityFromInput(input);
  const necVerRaw = cp.nec ?? 'PENDING';
  const is2023 = cp.nec === '2023';
  const hasBattery = hasRealBattery(project);
  const isMicro = topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO';
  const isSupply = isSupplySideInterconnection(input);
  const auth = buildConductorAuthority(input, cad);

  const eq = getEquipmentContext(input, cad);
  const invModel = eq.inverterModel !== '—' ? eq.inverterModel : (system.inverters?.[0]?.model || 'Inverter');
  const invMfr = eq.inverterManufacturer !== '—' ? eq.inverterManufacturer : (system.inverters?.[0]?.manufacturer || '');
  const invCount = isMicro ? (system.totalPanels || 0) : (system.inverters?.length || 1);

  // ── Ratings (single-sourced) ──────────────────────────────────
  // Rated AC output = Σ per-sub feeder currents from the shared authority
  // (system.totalAcKw is a stale aggregate on hybrids — it disagreed with
  // E-1/PV-5 by 64 A on Stowell). Fallback keeps single-system behavior.
  const acOutA = auth.subSystems.reduce((a, s) => a + (s.acSubFeeder.currentA || 0), 0)
    || (getSnapshot(input).derived.acWattsContinuous || (system.totalAcKw || 0) * 1000) / 240;
  const acOcpd = auth.acFeeder.ocpdAmps;
  const mainA = project.mainPanelAmps || 200;
  const _str0 = system.inverters?.[0]?.strings?.[0];
  // P1-1 (data-authority register): the panel Voc routes through the per-sub
  // panel-spec authority (equipment-db via project.subSystems / the sub's own
  // fleet) — project.panelVoc is a panel0 scalar (the FENCE module's on
  // hybrids). Legacy chain survives only as the final fallback.
  const _specKey: SubSystemKey = isFence(cad.systemType) ? 'fence'
    : isGround(cad.systemType) ? 'ground' : 'roof';
  const _ps = resolvePanelSpecs(input, cad, _specKey);
  const _panelVoc = _ps.voc || eq.panelVoc || project.panelVoc || _str0?.panelVoc || 0;
  // Design-low temp for the ONE cold-Voc law (shared by the hybrid branch AND
  // the single-system fallback below — register P1-4).
  const _projT = project as unknown as { state?: string; address?: string; lat?: number; lng?: number };
  // W5 §4 — ONE thermal basis (singular; shared with APP-A + warning labels).
  const _tMin = getThermalDesignBasis({
    lat: _projT.lat, lng: _projT.lng, state: _projT.state, address: _projT.address,
    designTempMinOverrideC: project.designTempMin ?? null,
  }).minDesignTempC;
  // SYSTEMIC ROOT #1: on a hybrid the whole system is NOT microinverter — the
  // string/optimizer subs carry real series DC. "MAX DC SYSTEM VOLTAGE" is the
  // largest cold-corrected string Voc across those subs, never "N/A" (which
  // reads the roof-micro winner as the whole system).
  const _hybridMaxDcV = (() => {
    if (!auth.isHybrid) return null;
    // SAME cold-Voc basis as PV-5 / E-1: NEC 690.7(A) Voc × (1 + β(Tmin−25))
    // with the equipment-DB β when the model resolves (blanket ×1.25 printed
    // 576 V here beside PV-5's 527 V for the same fence string). Unresolved
    // β keeps the conservative ×1.25.
    const vals: number[] = [];
    for (const inv of system.inverters ?? []) {
      if (String(inv.type || '').toLowerCase().includes('micro')) continue;
      for (const s of inv.strings ?? []) {
        const voc = s.panelVoc || 0;
        const n = s.panelCount || 0;
        if (!(voc > 0 && n > 0)) continue;
        const m = (s.panelModel || '').toLowerCase().trim();
        // CMEI — THE canonical accessor (cold-Voc beta must come from the
        // SELECTED module, never from one whose name merely contains it).
        const db = m ? (resolveModuleIdentity({ model: m }).spec ?? undefined) : undefined;
        const beta = typeof db?.tempCoeffVoc === 'number' ? db.tempCoeffVoc : undefined;
        const factor = coldVocFactor(beta, _tMin);  // P1-4: the ONE cold-Voc law
        vals.push(Math.round(voc * factor * n));
      }
    }
    return vals.length ? Math.max(...vals) : null;
  })();
  // P1-4: single-system fallback uses the SAME β-based NEC 690.7(A) law as the
  // hybrid branch above (blanket ×1.25 only when no β resolves) — two cold-Voc
  // laws printed contradictory maxima across sheets.
  const _coldF = coldVocFactor(_ps.tempCoeffVocPctPerC, _tMin);
  const maxDcV = _hybridMaxDcV != null
    ? `${_hybridMaxDcV} V DC`
    : (isMicro
        ? 'N/A — MICROINVERTER (MODULE-LEVEL DC ONLY)'
        : (_str0?.panelCount && _panelVoc
            ? `${Math.round(_panelVoc * _coldF * _str0.panelCount)} V DC`
            : (_panelVoc ? `${Math.round(_panelVoc * _coldF)} V DC` : '____ V DC')));
  const interType = isSupply
    ? 'SUPPLY-SIDE TAP — NEC 705.11'
    : `LOAD-SIDE BACK-FED BREAKER${acOcpd ? ` (${acOcpd}A)` : ''} — NEC 705.12`;

  // ── Disconnecting-means & equipment directory (NEC 690.56(B) / 705.10) ──
  // A real numbered directory: every disconnect + PV equipment, its rating/ID,
  // and where it is. No invented building drawing — locations reference PV-1.
  interface Disco { name: string; rating: string; loc: string; }
  const battKwh = hasBattery ? (project.batteryCount || 1) * (project.batteryKwh ?? 5.0) : 0;
  // Brand-integrated BOS device ("the brains" — e.g. Enphase IQ Combiner 6C:
  // combiner + gateway + AC disconnect in one box). Single-sourced.
  const bos = buildIntegratedEquipment(input, cad);
  const discos: Disco[] = [];
  // ── W2a §service-topology — the disconnect roles PROJECT the canonical
  // snapshot.serviceTopology objects (svc-service-disconnect, svc-fused-ocpd,
  // svc-utility-disconnect, …). Each canonical device is ONE row with ONE role:
  // the combiner's integral load-break (NEC 690.13, listed under the BOS device
  // below) is NOT the same object as the supply-side FUSED tap OCPD (NEC 705.11)
  // or the utility-accessible lockable disconnect. The old code merged the fused
  // tap disconnect + the combiner load-break into a single "PV AC DISCONNECT"
  // row — that conflation is the defect this replaces. ──
  const _svcTopo = getSnapshot(input).electrical.serviceTopology ?? [];
  const _svcObj = (t: string) => _svcTopo.find(o => o.type === t) ?? null;
  const _svcDisco = _svcObj('service-disconnect');
  discos.push({ name: 'MAIN SERVICE DISCONNECT', rating: `${_svcDisco?.ocpdRatingA ?? mainA} A${project.mainPanelBrand ? ` · ${project.mainPanelBrand}` : ''}`, loc: 'Exterior — at utility meter / service entrance' });
  if (isSupply) {
    // Supply-side (NEC 705.11). §9 (closeout 2026-07-23): the fused tap OCPD is,
    // by determination from the design data, the SAME LISTED lockable device that
    // serves as the utility-accessible disconnecting means — ONE row with a DUAL
    // role (no phantom duplicate). A separate row prints ONLY when the project
    // specifies a distinct utility-disconnect device (svc-utility-disconnect).
    const _fused = _svcObj('fused-ocpd');
    const _util = _svcObj('utility-disconnect');
    const _fusedDual = _fused?.dualPurposeListing === true && _util == null;
    discos.push({
      name: _fusedDual
        ? 'FUSED AC DISCONNECT — SUPPLY-SIDE TAP OCPD + UTILITY-ACCESSIBLE (LOCKABLE)'
        : 'FUSED AC DISCONNECT — SUPPLY-SIDE TAP OCPD',
      rating: `${_fused?.ocpdRatingA ?? acOcpd ?? '—'} A fused${_fusedDual ? ' · lockable' : ''} · NEC 705.11`,
      loc: _fusedDual
        ? 'At the supply-side tap (line side of the service disconnect) — single listed device serving both the 705.11 tap OCPD and the utility-accessible disconnecting means'
        : 'At the supply-side tap — line side of the service disconnecting means',
    });
    if (_util) discos.push({ name: 'UTILITY-ACCESSIBLE AC DISCONNECT (LOCKABLE)', rating: `${_util.ocpdRatingA ?? acOcpd ?? '—'} A · lockable`, loc: 'Ahead of the point of interconnection — per serving-utility requirement' });
    if (bos.providesAcDisconnect) discos.push({ name: 'PV SYSTEM AC DISCONNECT (COMBINER LOAD-BREAK)', rating: `${acOcpd ? `${acOcpd} A · ` : ''}NEC 690.13`, loc: 'Integral load-break in the AC combiner — the PV-system disconnecting means' });
  } else if (project.acDisconnect !== false) {
    discos.push({ name: 'PV AC DISCONNECT', rating: acOcpd ? `${acOcpd} A` : 'PER PLAN', loc: bos.providesAcDisconnect ? 'Integral to the combiner (load-break) — exterior AC disconnect only if required by AHJ/utility' : 'Exterior, lockable — adjacent to utility meter' });
  }
  if (!isMicro && project.dcDisconnect !== false) discos.push({ name: 'PV DC / SYSTEM DISCONNECT', rating: `${maxDcV}`, loc: 'At the inverter' });
  // Integrated combiner / gateway — the AC aggregation + monitoring device.
  for (const d of bos.devices) {
    discos.push({
      name: `${d.brand.toUpperCase()} ${d.model.toUpperCase()}`,
      rating: `${d.roleSummary}${d.branchSlots ? ` · ${d.branchSlots}-branch` : ''}`,
      loc: d.mounting === 'wall' ? 'Wall-mounted — AC aggregation / monitoring / disconnect' : 'At the point of interconnection',
    });
  }
  // SYSTEMIC ROOT #1: one inverter directory row PER SUB (roof micros ×roofN,
  // ground string ×1, fence optimizer-inverter ×1) — never a single
  // "MICROINVERTERS (×91)" row that reads the roof brand across the whole
  // hybrid. Each row carries the sub's OWN equipment + its OWN AC nameplate.
  if (auth.isHybrid) {
    for (const sub of auth.subSystems) {
      const se = sub.equipment;
      const subAcKw = (sub.acSubFeeder.currentA * 240) / 1000;
      const nm = `${se.inverterManufacturer} ${se.inverterModel}`.trim();
      const subLabel = sub.key.toUpperCase();
      if (sub.isMicro) {
        discos.push({ name: `MICROINVERTERS — ${subLabel} (×${sub.deviceCount})`, rating: `${subAcKw.toFixed(2)} kW AC · ${nm}`.trim(), loc: 'On the array — one per module' });
      } else {
        const word = sub.topology === 'OPTIMIZER' ? 'INVERTER (OPTIMIZER)' : 'INVERTER';
        discos.push({ name: `${word} — ${subLabel}`, rating: `${subAcKw.toFixed(2)} kW AC · ${nm}`.trim(), loc: `${sub.key} sub-system — at the inverter location` });
      }
    }
  } else {
    discos.push({ name: `${isMicro ? 'MICROINVERTERS' : 'INVERTER'}${invCount > 1 ? ` (×${invCount})` : ''}`, rating: `${(getSnapshot(input).derived.acWattsContinuous / 1000 || system.totalAcKw || 0).toFixed(2)} kW AC · ${invMfr} ${invModel}`.trim(), loc: isMicro ? 'On the array — one per module' : 'At the inverter location' });
  }
  if (project.rapidShutdown) discos.push({ name: 'RAPID SHUTDOWN INITIATOR', rating: isMicro ? 'MODULE-LEVEL (PVRSS)' : 'ARRAY-LEVEL', loc: bos.brains ? `Hosted by the ${bos.brains.model}` : 'Adjacent to the PV AC disconnect' });
  if (hasBattery) discos.push({ name: 'ENERGY STORAGE (ESS) DISCONNECT', rating: `${battKwh.toFixed(1)} kWh · ${project.batteryBrand || 'ESS'}`.trim(), loc: 'At the battery/ESS enclosure' });

  // ── Emergency shutdown steps (adapt to what's present) ────────
  const steps: string[] = ['OPEN MAIN SERVICE / UTILITY DISCONNECT'];
  if (project.acDisconnect !== false) steps.push('OPEN PV AC DISCONNECT');
  if (project.rapidShutdown) steps.push('TURN RAPID SHUTDOWN SWITCH TO THE "OFF" POSITION');
  if (!isMicro && project.dcDisconnect !== false) steps.push('OPEN PV DC / SYSTEM DISCONNECT');
  if (hasBattery) steps.push('OPEN ENERGY STORAGE (ESS) / BATTERY DISCONNECT');
  steps.push('ARRAY CONDUCTORS REMAIN ENERGIZED IN DAYLIGHT — TREAT AS LIVE');

  const rsdText = is2023
    ? 'SOLAR PV SYSTEM IS EQUIPPED WITH RAPID SHUTDOWN. TURN THE RAPID SHUTDOWN SWITCH TO THE "OFF" POSITION TO SHUT DOWN THE PV SYSTEM AND REDUCE SHOCK HAZARD IN THE ARRAY.'
    : 'SOLAR PV SYSTEM EQUIPPED WITH RAPID SHUTDOWN. TURN RAPID SHUTDOWN SWITCH TO THE "OFF" POSITION TO SHUT DOWN PV SYSTEM AND REDUCE SHOCK HAZARD IN THE ARRAY.';
  const rsdRef = is2023 ? 'NEC 690.12(D)' : 'NEC 690.56(C)';
  // BRAIDON PDF AUDIT 2026-08-27 (N9) — the rapid-shutdown building placard is EDITION-DEPENDENT
  // (wording, colour and reflectivity change by NEC edition, and under NEC 2005 it has no basis
  // at all). fieldLabels.ts already withholds it correctly — PV-5 listed
  // `rapid-shutdown-building-placard` under "PLACARDS PENDING CODE AUTHORITY — NOT RELEASED FOR
  // PROCUREMENT / INSTALLATION" — but THIS plaque, on the same sheet, simultaneously printed the
  // finished red RSD band and asserted "IT SATISFIES ... THE RAPID-SHUTDOWN BUILDING PLACARD",
  // while L-1/L-2/L-3 were marked N/A in the label schedule and the BOM ordered LABEL-RSD qty 1.
  // Four different answers for one safety label. The plaque may only claim what the adopted
  // edition supports; when the edition is not governed, the RSD portion is explicitly pending.
  const _rsdEditionPending = cp.nec == null;

  // Source list for the CAUTION header.
  const sources = `UTILITY GRID + SOLAR PV${hasBattery ? ' + ENERGY STORAGE' : ''}`;

  // Directory rows — the numbered list of every disconnect + PV equipment.
  const _dirRows = discos.map((d, i) =>
    `<tr>` +
    `<td class="fw9 mono" style="text-align:center;">${i + 1}</td>` +
    `<td class="fw7">${escapeH(d.name)}</td>` +
    `<td class="mono" style="font-size:7.5px;">${escapeH(d.rating)}</td>` +
    `<td style="font-size:8px;">${escapeH(d.loc)}</td>` +
    `</tr>`).join('');

  // AAC WS-10 — the sheet BODY, extracted so the permit profile can compose it
  // onto the merged PV-5 labels/directory sheet without a second renderer (one
  // source: the plaque, the directory rows and the spec table are identical in
  // both profiles).
  const _pv6Body = `
      <div class="note-bar" style="margin-bottom:7px;">
        THE PLACARD BELOW SHALL BE PERMANENTLY INSTALLED AT THE MAIN SERVICE DISCONNECT (ENGRAVED PHENOLIC OR UV-STABLE PRINTED ALUMINUM, HIGH-CONTRAST, READABLE AT EYE LEVEL).
        IT SATISFIES THE POWER-SOURCE DIRECTORY (NEC 705.10) AND THE PV DISCONNECT-LOCATION PLAQUE (NEC 690.56(B)).${
          _rsdEditionPending
            ? ` THE RAPID-SHUTDOWN BUILDING PLACARD IS <strong>NOT RELEASED</strong> — ITS WORDING, COLOUR AND REFLECTIVITY ARE EDITION-DEPENDENT AND THE JURISDICTION'S ADOPTED NEC EDITION IS NOT ESTABLISHED. THE RAPID-SHUTDOWN BAND SHOWN BELOW IS A DESIGN-REVIEW PREVIEW ONLY — DO NOT ORDER OR INSTALL IT UNTIL THE ADOPTION IS GOVERNED.`
            : ` IT ALSO SATISFIES THE RAPID-SHUTDOWN BUILDING PLACARD (${rsdRef}).`
        }
        GROUP WITH ANY OTHER ON-SITE POWER-SOURCE DIRECTORIES SO ALL APPEAR TOGETHER.
      </div>

      <!-- ══ THE PERMANENT PLAQUE ══ -->
      <div style="border:3px solid #000;background:#fff;">
        <!-- CAUTION banner (ANSI Z535 CAUTION: yellow field, black text) -->
        <div style="background:#f2c200;color:#000;padding:6px 10px;border-bottom:3px solid #000;text-align:center;">
          <div style="font-size:16px;font-weight:900;letter-spacing:1.5px;">&#9888; CAUTION — MULTIPLE SOURCES OF POWER</div>
          <div style="font-size:9px;font-weight:800;letter-spacing:0.4px;margin-top:1px;">THIS BUILDING IS SERVED BY: ${sources}</div>
        </div>

        <!-- body row 1: the disconnecting-means & equipment directory -->
        <div style="padding:8px 10px;border-bottom:3px solid #000;">
          <div style="font-size:9px;font-weight:900;letter-spacing:0.5px;margin-bottom:4px;">DISCONNECTING MEANS &amp; PV EQUIPMENT DIRECTORY <span style="font-weight:600;color:#333;">— locations shown on PV-1 site plan</span></div>
          <table class="equip-table" style="margin:0;">
            <thead><tr>
              <th style="width:6%;text-align:center;">#</th>
              <th style="width:30%;">DISCONNECT / EQUIPMENT</th>
              <th style="width:28%;">RATING / ID</th>
              <th>LOCATION</th>
            </tr></thead>
            <tbody>${_dirRows}</tbody>
          </table>
        </div>

        <!-- body row 2: ratings | emergency shutdown -->
        <div style="display:grid;grid-template-columns:1fr 1fr;">
          <div style="padding:8px 10px;border-right:2px solid #000;">
            <div style="font-size:9px;font-weight:900;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1.5px solid #000;padding-bottom:2px;">SYSTEM RATINGS</div>
            <table style="width:100%;border-collapse:collapse;font-size:8.5px;">
              <tr><td style="padding:2px 0;">RATED AC OUTPUT CURRENT</td><td style="text-align:right;font-family:var(--mono);font-weight:800;">${acOutA > 0 ? acOutA.toFixed(1) + ' A' : '____ A'}</td></tr>
              <tr><td style="padding:2px 0;">NOMINAL OPERATING AC VOLTAGE</td><td style="text-align:right;font-family:var(--mono);font-weight:800;">240 V</td></tr>
              <tr><td style="padding:2px 0;">MAX DC SYSTEM VOLTAGE</td><td style="text-align:right;font-family:var(--mono);font-weight:800;">${maxDcV}</td></tr>
              <tr><td style="padding:2px 0;">INTERCONNECTION</td><td style="text-align:right;font-family:var(--mono);font-weight:800;font-size:7.5px;">${interType}</td></tr>
            </table>
          </div>
          <div style="padding:8px 10px;">
            <div style="font-size:9px;font-weight:900;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1.5px solid #000;padding-bottom:2px;">EMERGENCY SHUTDOWN PROCEDURE</div>
            <ol style="margin:0;padding-left:16px;font-size:8.2px;line-height:1.55;font-weight:700;">
              ${steps.map(s => `<li>${escapeH(s)}</li>`).join('')}
            </ol>
          </div>
        </div>

        <!-- rapid-shutdown band (red field — NEC-mandated color for PV RSD placard) -->
        <div style="background:#cc0000;color:#fff;padding:6px 10px;border-top:3px solid #000;display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;">
          <div>
            <div style="font-size:10px;font-weight:900;letter-spacing:0.5px;">RAPID SHUTDOWN${_rsdEditionPending ? ' &mdash; NOT RELEASED (PREVIEW)' : ''}</div>
            <div style="font-size:7.6px;font-weight:700;line-height:1.4;margin-top:1px;">${escapeH(rsdText)}</div>
            <div style="font-size:7px;font-weight:800;margin-top:2px;">TYPE: ${isMicro ? 'MODULE-LEVEL — CONDUCTORS OUTSIDE THE ARRAY BOUNDARY REDUCE TO A SAFE LEVEL' : 'ARRAY-LEVEL — CONTROLLED CONDUCTORS PER ' + rsdRef} &nbsp;·&nbsp; ${escapeH(rsdRef)}</div>
            ${_rsdEditionPending ? `<div style="font-size:6.8px;font-weight:800;margin-top:3px;background:#fff;color:#cc0000;padding:2px 4px;">N9 &mdash; EDITION-DEPENDENT PLACARD, ADOPTED NEC EDITION NOT ESTABLISHED. DO NOT ORDER OR INSTALL. SPECIFICATION FOLLOWS THE GOVERNED ADOPTION, NEVER A DEFAULT YEAR.</div>` : ''}
          </div>
          <svg viewBox="0 0 96 60" width="96" style="flex:0 0 auto;">
            <path d="M8 44 L48 18 L88 44 Z" fill="none" stroke="#fff" stroke-width="1.4"/>
            <path d="M26 38 L48 24 L70 38 L48 38 Z" fill="#ffffff" fill-opacity="0.35" stroke="#fff" stroke-width="0.9" stroke-dasharray="3 2"/>
            <line x1="8" y1="44" x2="88" y2="44" stroke="#fff" stroke-width="1.4"/>
            <text x="48" y="55" text-anchor="middle" font-size="6" fill="#fff" font-weight="bold">ARRAY BOUNDARY</text>
          </svg>
        </div>

        <!-- footer: installer / contact / date -->
        <div style="border-top:3px solid #000;padding:5px 10px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:7.5px;">
          <div><strong>INSTALLED BY:</strong> ${escapeH(project.designer || '____________________')}</div>
          <div><strong>EMERGENCY / MONITORING CONTACT:</strong> ____________________</div>
          <!-- §15(c): the install date must NOT be populated before installation.
               The package/issue date (project.date) is NOT the install date —
               leave it blank for field completion at install time. -->
          <div><strong>INSTALL DATE:</strong> ______________ <span style="font-size:6px;color:#999;">(AT INSTALLATION)</span></div>
        </div>
      </div>

      <!-- placard specification -->
      <div class="sec-hdr-dark" style="margin:8px 0 4px;">PLACARD SPECIFICATION &amp; CODE BASIS</div>
      <table class="equip-table" style="margin:0;">
        <thead><tr><th style="width:20%;">Attribute</th><th>Requirement</th></tr></thead>
        <tbody>
          <tr><td class="fw7">Material</td><td>Engraved phenolic, UV-stable printed aluminum, or fire-marshal-accepted metal placard — permanently affixed per NEC 110.21(B).</td></tr>
          <tr class="bg-lt"><td class="fw7">Letter Height</td><td>Title / signal words min. 3/8" (9.5 mm); body text min. 3/16" (4.8 mm); high-contrast, non-handwritten.</td></tr>
          <tr><td class="fw7">Location</td><td>At the main service disconnect (readily visible, eye level). Group with all on-site power-source directories.</td></tr>
          <tr class="bg-lt"><td class="fw7">Color</td><td>CAUTION header per ANSI Z535 (black on safety yellow); the rapid-shutdown band is white on red as mandated by ${rsdRef}.</td></tr>
          <tr><td class="fw7">Code Basis</td><td class="mono" style="font-size:8px;">NEC ${necVerRaw} — 705.10 (power-source directory) · 690.56(B) (PV disconnect-location plaque) · ${rsdRef} (rapid-shutdown building placard)${hasBattery ? ' · 706 / IFC 1207 (ESS)' : ''}</td></tr>
        </tbody>
      </table>
`;

  if (opts?.bodyOnly) return _pv6Body;

  return `
  <div class="page">
    ${titleBlock(input, 'PV-6', 'DISCONNECT DIRECTORY & EMERGENCY PLACARD', pageNum, totalPages)}
    <div class="page-content">
${_pv6Body}
    </div>
  </div>`;
}


// ─── Spec Sheet Reference Page ─────────────────────────────────────────────

export function pageSpecSheetReference(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system } = input;
  const cp = projectCodeAuthorityFromInput(input);   // W4 §2 code editions
  const _isRoof = isRoof(cad.systemType);   // FIX v47.296
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);
  const panels = system.inverters?.[0]?.strings?.[0];
  const modMfr = panels?.panelManufacturer || '—';
  const modModel = panels?.panelModel || '—';
  const modWatts = panels?.panelWatts || 400;
  const invMfr = system.inverters?.[0]?.manufacturer || '—';
  const invModel = system.inverters?.[0]?.model || '—';

  // REAL datasheet records from equipment-db (fuzzy model match) — the sheet
  // previously ESTIMATED Vmp (Voc×0.83), derived Imp, and hardcoded the temp
  // coefficients + NOCT while the DB carries the manufacturer values.
  // CMEI — EXACT ONLY. This fed manufacturer temperature coefficients and NOCT
  // onto the compliance sheet; a substring match sourced them from another product.
  const _dbFind = <T extends { model: string }>(list: T[], model?: string): T | undefined => {
    const m = (model || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (!m) return undefined;
    return list.find(e => e.model.toLowerCase().trim().replace(/\s+/g, ' ') === m);
  };
  const _dbPanel = _dbFind(SOLAR_PANELS, panels?.panelModel);
  const _dbMicro = system.inverters?.[0]?.type === 'micro'
    ? _dbFind(MICROINVERTERS, system.inverters?.[0]?.model) : undefined;
  // W5 §1 — APP-A microinverter datasheet table projects ONLY from the verified
  // equipment/document record chain (equipment-db + manufacturer-assets-db),
  // with per-value provenance. No hand-entered parallel spec values.
  const _microProj = _dbMicro
    ? projectMicroinverterDatasheet(system.inverters?.[0]?.model) : null;
  // Render one provenance-stamped datasheet row. PENDING when the value is
  // absent from the verified record (never a fabricated default).
  const _mvRow = (label: string, pv: ProjectedValue<number | string | boolean | null>, fmt: (v: number | string | boolean) => string): string => {
    const p = pv.provenance;
    const disp = pv.value === null ? '<span style="color:#b00">PENDING</span>' : escapeH(fmt(pv.value));
    return `<tr data-app-a-field="${escapeH(p.extractedFieldPath)}" data-verify="${p.verification}"`
      + ` data-eq-id="${escapeH(p.equipmentRecordId ?? '')}" data-sku="${escapeH(p.sku ?? '')}"`
      + ` data-doc-id="${escapeH(p.documentRecordId ?? '')}">`
      + `<td class="il">${label}</td><td class="iv">${disp}</td></tr>`;
  };

  // BRAIDON PDF AUDIT 2026-08-27 (N1) — this chain ran the panel-spec precedence BACKWARDS
  // relative to the documented doctrine in utils/panelSpecs.ts: `panels` is
  // system.inverters[0].strings[0] (the panel0 scalar, the FENCE module on a hybrid), and it beat
  // the resolved equipment-db record. So a stale scalar saved onto a project outranked the
  // manufacturer datasheet, and a corrected DB record could not reach this sheet at all.
  // Doctrine order: per-sub resolved record → equipment-db exact match → legacy scalars last.
  // The old `|| 41.6` / `|| 12.26` literals were the generic copy-paste values, not this module's.
  const _specKeySS: SubSystemKey = _isFence ? 'fence' : _isGround ? 'ground' : 'roof';
  const _psSS = resolvePanelSpecs(input, cad, _specKeySS);
  const voc = _psSS.voc || _dbPanel?.voc || panels?.panelVoc || project.panelVoc || 0;
  const isc = _psSS.isc || _dbPanel?.isc || panels?.panelIsc || project.panelIsc || 0;
  const pmax = modWatts;
  // Vmp/Imp: manufacturer values when the DB record resolves; otherwise the
  // nameplate-consistent estimate (Vmp≈Voc×0.83, Imp=Pmax/Vmp).
  const vmp = _dbPanel?.vmp ?? parseFloat((voc * 0.83).toFixed(1));
  const imp = _dbPanel?.imp ?? parseFloat((pmax / vmp).toFixed(2));
  const tempCoeff = _dbPanel?.tempCoeffPmax ?? -0.35;
  // Physical dims: project override → resolved equipment-db record → generic
  // default. Falling straight to the 66"×40" default made a 440W module read
  // 25.8% efficiency (physically impossible for silicon; the DB carries the real
  // 67.8"×44.6"). The real datasheet dims also match what PV-1 draws (module
  // width is derived from design pitch ~44.5"), so this tightens cross-sheet
  // consistency rather than loosening it.
  // W3 §2 — exact catalog dims from the canonical snapshot module instance
  // (single-sourced with PV-1/PV-3); DB record + project scalars are fallbacks
  // for the standalone path, never a generic 66×40.
  const _spSpec = projectStructuralFromInput(input);
  const panelLen = _spSpec.moduleHeightIn ?? project.panelLengthIn ?? _dbPanel?.length ?? 66;
  const panelWid = _spSpec.moduleWidthIn ?? project.panelWidthIn ?? _dbPanel?.width  ?? 40;
  // BRAIDON PDF AUDIT 2026-08-27 (N1) — scalars-before-catalogue again, plus a bare 
  // literal. The equipment-db record is the datasheet; a posted scalar is a saved copy that goes
  // stale the moment the record is corrected.
  const panelWt  = _psSS.weightLbs || _dbPanel?.weight || project.panelWeightLbs || 0;
  // Module efficiency = manufacturer/CEC datasheet value when the DB record
  // resolves; only fall back to the geometric estimate (Pmax ÷ area) when it
  // doesn't. Back-computing from the drawn footprint is what produced the
  // impossible 25.8% (real 22.57%).
  const moduleEff = _dbPanel?.efficiency ?? (pmax / (panelLen / 39.37 * panelWid / 39.37)) / 10;

  // NEC 690.7/690.8 calculations — cold Voc uses the exact NEC 690.7(A)
  // formula with the project design-low temp (same input the SLD/engines
  // use), matching the compatibility gate. The old blanket ×1.25 printed a
  // 62.3 V "max" beside a 60 V inverter DC limit on the same sheet.
  const VOC_TEMP_COEFF = _dbPanel?.tempCoeffVoc ?? -0.27;  // %/°C — manufacturer value when resolved; matches the printed spec row
  // W5 §4 — ONE thermal basis (kills the APP-A −10 °C split vs ASHRAE −23 °C).
  // Same singular basis the other compliance sheets consume; no renderer-local temp.
  const _projA = project as unknown as { state?: string; address?: string; lat?: number; lng?: number };
  const _thermA = getThermalDesignBasis({
    lat: _projA.lat, lng: _projA.lng, state: _projA.state, address: _projA.address,
    designTempMinOverrideC: project.designTempMin ?? null,
  });
  const designTempMinC = _thermA.minDesignTempC;
  const vocColdFactor = 1 + (VOC_TEMP_COEFF / 100) * (designTempMinC - 25);
  const NEC_SAFETY = 1.25;
  const vocMax = parseFloat((voc * vocColdFactor).toFixed(1));
  const iscMax = parseFloat((isc * NEC_SAFETY).toFixed(2));

  // ── P0-4 (data-authority register): on hybrids this sheet printed ONE
  // module datasheet (panel0 — the FENCE module) for the whole system, so the
  // roof/ground modules' Voc/dims/weight/efficiency never appeared anywhere.
  // Render one datasheet card PER SUB from the per-sub panel-spec authority
  // (equipment-db via project.subSystems[key].panelId → the sub's fleet).
  // Single-system markup below is untouched.
  const _hybridSecsA = hybridSheetSections(cad);
  const _subModCards = _hybridSecsA.length > 1 ? _hybridSecsA.map(sec => {
    const ps = resolvePanelSpecs(input, cad, sec.key);
    const d = ps.db;
    const vmpS = d?.vmp ?? (ps.voc > 0 ? parseFloat((ps.voc * 0.83).toFixed(1)) : 0);
    const impS = d?.imp ?? (vmpS > 0 ? parseFloat((ps.watts / vmpS).toFixed(2)) : 0);
    const effS = d?.efficiency
      ?? ((ps.watts > 0 && ps.lengthIn > 0 && ps.widthIn > 0)
        ? (ps.watts / (ps.lengthIn / 39.37 * ps.widthIn / 39.37)) / 10 : 0);
    const cfS = coldVocFactor(ps.tempCoeffVocPctPerC, designTempMinC);
    const vocMaxS = parseFloat((ps.voc * cfS).toFixed(1));
    const iscMaxS = parseFloat((ps.isc * NEC_SAFETY).toFixed(2));
    return `
          <div class="section-title">PV Module — ${sec.key.toUpperCase()} ARRAY (×${sec.totalPanels})</div>
          <table class="info-table" style="margin-bottom:5px;">
            <tr><td class="il">Manufacturer / Model</td><td class="iv">${ps.manufacturer} ${ps.model}</td></tr>
            <tr><td class="il">STC Power (Pmax)</td><td class="iv">${ps.watts} Wp</td></tr>
            <tr><td class="il">Voc / Isc</td><td class="iv">${ps.voc} V / ${ps.isc} A</td></tr>
            <tr><td class="il">Vmp / Imp</td><td class="iv">${vmpS} V / ${impS} A</td></tr>
            <tr><td class="il">Temp. Coeff. Voc</td><td class="iv">${ps.tempCoeffVocPctPerC ?? '—'}%/°C</td></tr>
            <tr><td class="il">NOCT</td><td class="iv">${d?.nominalOperatingTemp ?? 45}°C ±2°C</td></tr>
            <tr><td class="il">Module Efficiency</td><td class="iv">${effS ? effS.toFixed(1) + '%' : '—'}</td></tr>
            <tr><td class="il">Dimensions (L × W)</td><td class="iv">${ps.lengthIn}" × ${ps.widthIn}" (${(ps.lengthIn * 25.4).toFixed(0)} × ${(ps.widthIn * 25.4).toFixed(0)} mm)</td></tr>
            <tr><td class="il">Weight</td><td class="iv">${ps.weightLbs} lbs (${(ps.weightLbs * 0.453592).toFixed(1)} kg)</td></tr>
            <tr><td class="il">Cell Type</td><td class="iv">${d ? `${d.cellType}${d.bifacial ? ' — Bifacial' : ''}` : '—'}</td></tr>
            <tr><td class="il">UL Listing</td><td class="iv">${d?.ulListing || 'UL 61730 / IEC 61215'}</td></tr>
            <tr><td class="il">NEC 690.7 Max Voc</td><td class="iv"><strong>${vocMaxS} V</strong> (×${cfS.toFixed(3)} @ ${designTempMinC}°C)</td></tr>
            <tr><td class="il">NEC 690.8(A) Max Isc</td><td class="iv"><strong>${iscMaxS} A</strong> (×1.25)</td></tr>
          </table>`;
  }).join('') + `
          <div style="font-size:7px;color:#555;margin:-2px 0 4px 0;">One module record per sub-system — resolved from the project equipment map / equipment database. Vmp/Imp and temperature coefficients are typical values — verify against the manufacturer's certified datasheet before construction.</div>` : '';

  return `
  <div class="page">
    ${titleBlock(input, 'APP-A', 'EQUIPMENT SPECIFICATION REFERENCE', pageNum, totalPages)}
    <div class="page-content">
      <div class="two-col-layout">
        <div class="col-left">
          ${_subModCards || `<!-- Module Datasheet Summary -->
          <div class="section-title">PV Module — Electrical Specifications</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Manufacturer</td><td class="iv">${modMfr}</td></tr>
            <tr><td class="il">Model</td><td class="iv">${modModel}</td></tr>
            <tr><td class="il">STC Power (Pmax)</td><td class="iv">${pmax} Wp</td></tr>
            <tr><td class="il">Open Circuit Voltage (Voc)</td><td class="iv">${voc} V</td></tr>
            <tr><td class="il">Short Circuit Current (Isc)</td><td class="iv">${isc} A</td></tr>
            <tr><td class="il">Max Power Voltage (Vmp)</td><td class="iv">${vmp} V</td></tr>
            <tr><td class="il">Max Power Current (Imp)</td><td class="iv">${imp} A</td></tr>
            <tr><td class="il">Temp. Coeff. Pmax</td><td class="iv">${tempCoeff}%/°C</td></tr>
            <tr><td class="il">Temp. Coeff. Voc</td><td class="iv">${VOC_TEMP_COEFF}%/°C</td></tr>
            <tr><td class="il">NOCT</td><td class="iv">${_dbPanel?.nominalOperatingTemp ?? 45}°C ±2°C</td></tr>
            <tr><td class="il">Module Efficiency</td><td class="iv">${moduleEff.toFixed(1)}%</td></tr>
          </table>
          <div style="font-size:7px;color:#555;margin:-2px 0 4px 0;">Vmp/Imp and temperature coefficients are typical values — verify against the manufacturer's certified datasheet before construction.</div>

          <div class="section-title">PV Module — Physical Specifications</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Length</td><td class="iv">${panelLen}" (${(panelLen*25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Width</td><td class="iv">${panelWid}" (${(panelWid*25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Weight</td><td class="iv">${panelWt} lbs (${(panelWt*0.453592).toFixed(1)} kg)</td></tr>
            <tr><td class="il">Front Load</td><td class="iv">5400 Pa (Wind/Snow)</td></tr>
            <tr><td class="il">Rear Load</td><td class="iv">2400 Pa</td></tr>
            <tr><td class="il">Cell Type</td><td class="iv">${_dbPanel ? `${_dbPanel.cellType}${_dbPanel.bifacial ? ' — Bifacial' : ''}` : 'Monocrystalline PERC / TOPCon'}</td></tr>
            <tr><td class="il">Frame</td><td class="iv">Anodized Aluminum Alloy</td></tr>
            <tr><td class="il">Connector</td><td class="iv">MC4 Compatible</td></tr>
            <tr><td class="il">UL Listing</td><td class="iv">${_dbPanel?.ulListing || 'UL 61730 / IEC 61215'}</td></tr>
          </table>

          ${_dbPanel ? `
          <div class="section-title">PV Module — Datasheet Reference</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Max System Voltage</td><td class="iv">${_dbPanel.maxSystemVoltage} V DC</td></tr>
            <tr><td class="il">Max Series Fuse Rating</td><td class="iv">${_dbPanel.maxSeriesFuseRating} A</td></tr>
            <tr><td class="il">Temp. Coeff. Isc</td><td class="iv">+${_dbPanel.tempCoeffIsc}%/°C</td></tr>
            <tr><td class="il">Module Thickness</td><td class="iv">${_dbPanel.thickness}" (${(_dbPanel.thickness * 25.4).toFixed(0)}mm)</td></tr>
            <tr><td class="il">Product Warranty</td><td class="iv">${_dbPanel.warranty}</td></tr>
            <tr><td class="il">Source</td><td class="iv">Manufacturer datasheet — copies available upon AHJ request</td></tr>
          </table>` : ''}

          <!-- NEC 690.8 Calculations from module specs -->
          <div class="section-title">NEC 690.8 — Module Electrical Calculations</div>
          <table class="equip-table">
            <thead><tr><th>Parameter</th><th>Nameplate</th><th>NEC Factor</th><th>Result</th></tr></thead>
            <tbody>
              <tr><td>Voc (Open Circuit)</td><td>${voc} V</td><td>×${vocColdFactor.toFixed(3)} (NEC 690.7 @ ${designTempMinC}°C)</td><td><strong>${vocMax} V max</strong></td></tr>
              <tr><td>Isc (Short Circuit)</td><td>${isc} A</td><td>×1.25 (NEC 690.8(A))</td><td><strong>${iscMax} A max</strong></td></tr>
              <tr><td>Vmp (Operating)</td><td>${vmp} V</td><td>×1.0</td><td>${vmp} V</td></tr>
              <tr><td>Imp (Operating)</td><td>${imp} A</td><td>×1.0</td><td>${imp} A</td></tr>
            </tbody>
          </table>`}
        </div>

        <div class="col-right">
          <!-- Inverter Datasheet Summary -->
          <div class="section-title">Inverter — Specifications</div>
          ${system.inverters?.map((inv, i) => `
          <div style="border:1px solid #ccc;;overflow:hidden;margin-bottom:10px;">
            <div class=\"sec-hdr-dark\">
              Inverter #${i+1}: ${inv.manufacturer} ${inv.model}
            </div>
            <table class="info-table" style="margin:0;">
              <tr><td class="il">Type</td><td class="iv">${inv.type === 'micro' ? 'MICROINVERTER' : inv.type === 'optimizer' ? 'POWER OPTIMIZER' : inv.type?.toUpperCase() || 'STRING'}</td></tr>
              <tr><td class="il">AC Output</td><td class="iv">${Number(inv.acOutputKw).toFixed(2)} kW</td></tr>
              <tr><td class="il">Max DC Voltage</td><td class="iv">${inv.maxDcVoltage} V</td></tr>
              <tr><td class="il">Efficiency (CEC)</td><td class="iv">${inv.efficiency}%</td></tr>
              <tr><td class="il">UL Listing</td><td class="iv">${inv.ulListing || 'UL 1741'}</td></tr>
              <tr><td class="il">Grid Standards</td><td class="iv">IEEE 1547-2018, UL 1741 SA</td></tr>
              <tr><td class="il">Anti-Islanding</td><td class="iv">Yes — Per IEEE 1547</td></tr>
              <tr><td class="il">Rapid Shutdown</td><td class="iv">NEC 690.12 Compliant</td></tr>
              <tr><td class="il">MPPT Channels</td><td class="iv">${topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO' ? 'Per-module MPPT (microinverter)' : (inv.strings?.length || 1)}</td></tr>
            </table>
            ${(() => {
              // NEC 690.7 sanity at the DATA level — this sheet used to print
              // a module Voc ABOVE the inverter's max DC input on the same
              // page with no flag (electrically impossible pairing shipping
              // silently). Micro topologies skipped every upstream Voc check.
              // P0-4: on hybrids, judge each inverter against ITS OWN sub's
              // module — the panel0 (fence) Voc/Pmax basis fired false
              // compatibility warnings on the roof/ground lanes.
              const _invSubKey = (inv as { subSystemKey?: string }).subSystemKey;
              const _invPs: ResolvedPanelSpecs | null = (_hybridSecsA.length > 1 && isSubSystemKey(_invSubKey))
                ? resolvePanelSpecs(input, cad, _invSubKey) : null;
              const _basisVocMax = _invPs
                ? parseFloat((_invPs.voc * coldVocFactor(_invPs.tempCoeffVocPctPerC, designTempMinC)).toFixed(1))
                : vocMax;
              const _basisPmax = _invPs?.watts || pmax;
              const _mVoc = Number(_basisVocMax); // cold-corrected per NEC 690.7 — raw Voc can pass while the corrected value exceeds the limit
              const _mMax = Number(inv.maxDcVoltage);
              const _warns: string[] = [];
              if (isFinite(_mVoc) && isFinite(_mMax) && _mMax > 0 && _mVoc > _mMax) {
                _warns.push(`cold-corrected module Voc (${_mVoc} V per NEC 690.7 @ ${designTempMinC}°C) exceeds this inverter's maximum DC input voltage (${_mMax} V)`);
              }
              // Per-module overpower on micros — a 600 W module on a ~350 W-AC
              // micro (DC/AC 1.7) is beyond every manufacturer pairing range
              // and shipped silently as "31 kW DC / 18 kW AC".
              const _mAcW = Number(inv.acOutputKw) * 1000;
              if (inv.type === 'micro' && isFinite(_mAcW) && _mAcW > 0 && _basisPmax / _mAcW > 1.55) {
                _warns.push(`module STC power (${_basisPmax} W) is ${(_basisPmax / _mAcW).toFixed(2)}× this microinverter's AC rating (${Math.round(_mAcW)} W) — beyond the manufacturer's pairing range (≤1.55×); expect sustained clipping`);
              }
              return _warns.length ? `
            <div style="border:2px solid #cc0000;background:#fff5f5;padding:4px 6px;margin-top:3px;font-size:8px;line-height:1.4;color:#cc0000;font-weight:700;">
              ⚠ EQUIPMENT COMPATIBILITY — VERIFY BEFORE CONSTRUCTION: ${_warns.join('; ')}.
              Confirm the module/inverter pairing per NEC 690.7 and both manufacturers' compatibility lists;
              correct the equipment selection if this reflects the actual design.
            </div>` : '';
            })()}
          </div>
          `).join('') || '<p style="font-size:9px;color:#999">No inverter data</p>'}

          ${_microProj ? `
          <div class="section-title">Microinverter — Datasheet Reference${_microProj.sku ? ` (${escapeH(_microProj.sku)})` : ''}</div>
          <table class="info-table" style="margin-bottom:2px;" data-app-a-source="micro-datasheet" data-doc-verified="${_microProj.documentVerified}">
            ${_mvRow('Peak AC Output', _microProj.fields.peakVa, v => `${v} VA`)}
            ${_mvRow('Continuous AC Output', _microProj.fields.continuousVa, v => `${v} VA`)}
            ${_mvRow('Max Continuous Output Current', _microProj.fields.maxContinuousCurrentA, v => `${v} A${_microProj!.fields.acVoltage.value !== null ? ` @ ${_microProj!.fields.acVoltage.value} V` : ''}`)}
            ${_mvRow('DC Input Power (Module STC Max)', _microProj.fields.dcInputWMax, v => `${v} W`)}
            ${_mvRow('MPPT Voltage Range', _microProj.fields.mpptMinV, v => `${v}–${_microProj!.fields.mpptMaxV.value ?? '—'} V`)}
            ${_mvRow('Max DC Input Current', _microProj.fields.maxDcInputCurrentA, v => `${v} A`)}
            ${_microProj.fields.maxUnitsPerBranch20A.value !== null ? _mvRow('Max Units / 20A Branch', _microProj.fields.maxUnitsPerBranch20A, v => `${v}`) : ''}
            ${_mvRow('CEC Weighted Efficiency', _microProj.fields.cecEfficiency, v => `${v}%`)}
            ${_mvRow('DC Connector', _microProj.fields.connector, v => `${v}`)}
            ${_mvRow('Rapid Shutdown', _microProj.fields.rapidShutdown, v => v ? 'Integrated — NEC 690.12 MLRS' : 'External MLRS required')}
            ${_mvRow('Unit Weight', _microProj.fields.weightLb, v => `${v} lbs`)}
            ${_mvRow('Product Warranty', _microProj.fields.warranty, v => `${v}`)}
          </table>
          <div style="font-size:6.5px;color:#555;margin:0 0 6px 0;line-height:1.35;">${escapeH(_microProj.sourceLine)}</div>` : ''}

          <!-- Racking System Summary — from the SELECTED mounting system.
               The old static table printed IronRidge FlashFoot2 / 5/16" lag
               specs on every package regardless of the racking actually
               specified on PV-3 (two racking systems in one permit). -->
          ${(() => {
            const _mSel = project.mountingSystemId ? getMountingSystemById(project.mountingSystemId) : undefined;
            const _sysName = project._canonical?.mountSystem || project.mountingSystem
              || (_mSel ? `${_mSel.manufacturer} ${_mSel.model}` : '')
              || MOUNT_SYSTEM_MAP[cad.systemType as CanonicalSysType] || 'IronRidge XR100';
            // W6 — the rail + fastener are PROJECTED from the ONE canonical racking
            // assembly record (structuralProjection), never a local string or a
            // fabricated length formula. The record already carries the blocked-state
            // language ("PENDING RACKING ASSEMBLY SELECTION …") when the rail SKU is
            // unpinned, so APP-A stays in lockstep with the structural sheets.
            const _ra = _spSpec.rackingAssembly;
            // ECD §7 — the canonical bonding authority (requirement vs method).
            const _bondA = projectRackingBondingAuthority(peekSnapshot(input));
            const _railPinned = !!(_ra && _ra.railSku);
            const _railState = _ra
              ? (_railPinned ? 'verified' : 'pending')
              : 'no-record';
            // Rail profile: pinned rail with own dims → dims; otherwise the canonical
            // record railModel (= PENDING RACKING ASSEMBLY SELECTION when unpinned).
            const _railProfile = (_mSel?.rail && _railPinned)
              ? `${escapeH(_mSel.rail.model)} (${_mSel.rail.heightIn}" × ${_mSel.rail.widthIn}")`
              : (_ra?.railModel
                  ? escapeH(_ra.railModel)
                  : (_mSel?.systemType === 'rail_less' && _mSel?.mountTopology !== 'rail_paired'
                      ? 'Rail-less / direct-attach'
                      : 'PENDING RACKING ASSEMBLY SELECTION'));
            // Mount topology (W6.4) — RT-MINI is rail_paired, never rail-less/direct.
            const _mountTopo = _mSel?.mountTopology ?? _mSel?.systemType ?? '—';
            // Fastener: the ONE canonical fastener assembly (§12) — projected
            // identically onto PV-3 / PE-1 / SCHED. No fabricated "×4\" SS lag"
            // length formula. PENDING VERIFIED FASTENER ASSEMBLY when unresolved.
            const _fa = projectFastenerAssembly(input);
            // §14 — canonical spacing authority (design vs maximum-verified).
            const _spc = projectStructuralFromInput(input).spacingAuthority;
            const _fastenerDisp = _fa.present ? escapeH(_fa.line) : 'PENDING VERIFIED FASTENER ASSEMBLY';
            // §6 (BAR) — no fastener dimension (embedment/diameter/length) may render
            // while the assembly is NON-ORDERABLE (unverified); the observed geometry
            // is withheld until a verified fastener assembly is archived.
            const _embedDisp = _fa.nonOrderable
              ? 'PENDING VERIFIED FASTENER ASSEMBLY'
              : _fa.embedmentIn != null
                ? `Min. ${_fa.embedmentIn}" thread embedment into ${escapeH(_fa.substrate ?? 'rafter')}`
                : 'Per verified racking assembly';
            return `
          <div class="section-title">Racking System</div>
          <table class="info-table" data-app-a-source="racking-assembly" data-rail-state="${_railState}">
            <tr><td class="il">System</td><td class="iv">${_sysName}</td></tr>
            <tr><td class="il">Mount Topology</td><td class="iv" data-app-a-field="mountTopology">${escapeH(String(_mountTopo))}</td></tr>
            <tr><td class="il">Material</td><td class="iv">${_mSel?.rail?.materialAlloy || 'Aluminum — per manufacturer listing'}</td></tr>
            <tr><td class="il">Rail Profile</td><td class="iv" data-app-a-field="railModel">${_railProfile}</td></tr>
            <tr><td class="il">${_spc.verificationState === 'verified' ? 'Max Attach Spacing' : 'Attach Spacing (design)'}</td><td class="iv">${(() => {
              // §14 — DESIGN spacing + verification state. "MAX" language renders
              // ONLY when a verified source establishes it; otherwise the design
              // value + PENDING STRUCTURAL VERIFICATION (never 48" as an allowable).
              const _dsn = _spc.designSpacingIn
                ?? input.compliance?.structural?.attachment?.maxAllowedSpacing
                ?? (project.attachmentSpacing as number | undefined)
                ?? _mSel?.mount?.maxSpacingIn;
              const _val = _dsn ? `${_dsn}&quot; O.C.` : 'Per PV-3 / structural calc';
              return _spc.verificationState === 'verified'
                ? `${_val} (MAX ALLOWED &mdash; VERIFIED)`
                : `${_val} <span style="color:#b45309;font-weight:bold;">&mdash; PENDING STRUCTURAL VERIFICATION</span>`;
            })()}</td></tr>
            ${_isRoof ? `<tr><td class="il">Attachment</td><td class="iv">${_mSel?.mount?.model || 'Per PV-3 attachment detail'}</td></tr>` : ''}
            ${_isRoof ? `<tr><td class="il">Fastener</td><td class="iv" data-app-a-field="fastener">${_fastenerDisp}</td></tr>` : ''}
            ${_isRoof ? `<tr><td class="il">Embedment</td><td class="iv">${escapeH(_embedDisp)}</td></tr>` : _isFence ? '<tr><td class="il">Post Type</td><td class="iv">Steel Pipe / HSS</td></tr>' : '<tr><td class="il">Pile Type</td><td class="iv">Driven Pile / Helical Pier</td></tr>'}
            <!-- ECD §7 — this row printed 'UL 2703' unless a flag explicitly said
                 ul2703Listed === false: a FAIL-OPEN default that asserted a listing
                 for any mount whose record simply says nothing. The bonding METHOD
                 now projects the canonical bonding authority; the ICC-ES report
                 reference (a real record field) still prints when present. -->
            <tr><td class="il">Bonding Method</td><td class="iv" data-app-a-bonding-result="${escapeH(_bondA.result)}" style="color:${_bondA.verificationState === 'verified' ? '#0a5c23' : '#8a3f04'};font-weight:700;">${escapeH(_bondA.methodCompactLabel)}${_mSel?.mount?.iccEsReport ? ` <span style="color:#333;font-weight:400;">/ ${escapeH(String(_mSel.mount.iccEsReport))}</span>` : ''}</td></tr>
            <tr><td class="il">Bonding Requirement</td><td class="iv">${escapeH(_bondA.requirementLabel)}</td></tr>
            <tr><td class="il">Wind Rating</td><td class="iv">Per ${cp.asceLabel} (see PV-4C)</td></tr>
          </table>`;
          })()}

          <!-- Spec Sheet Links Note — real manufacturer documents on file (manufacturer_assets library) -->
          ${(() => {
            // Resolve the actual sourced manufacturer datasheet/detail per selected
            // equipment id, and cite the real document (title · page · source). Falls
            // back to a generic "see manufacturer website" line when none on file.
            // ECD §8 — the registry-derived listing conclusion (never a literal).
            const _listing = projectEquipmentListingConclusion(peekSnapshot(input));
            // CMEI — EXACT ONLY (equipment listing conclusion, not a guess).
            const _fuzz = <T extends { model: string; id: string }>(list: T[], model?: string): T | undefined => {
              const m = (model || '').toLowerCase().trim().replace(/\s+/g, ' '); if (!m) return undefined;
              return list.find(e => e.model.toLowerCase().trim().replace(/\s+/g, ' ') === m);
            };
            const _inv0 = system.inverters?.[0];
            const _invId = _dbMicro?.id
              ?? _fuzz(STRING_INVERTERS, _inv0?.model)?.id
              ?? _fuzz(MICROINVERTERS, _inv0?.model)?.id;
            const _batId = _fuzz(BATTERIES, (project._canonical as { battery?: { model?: string } })?.battery?.model
              || (project as { batteryModel?: string }).batteryModel)?.id;
            // ── ECD §8 — DOCUMENT STATE CHIPS (was: a green scrape tick) ─────────
            // Three separate facts used to be collapsed into one green '✓ on file':
            //   1 the document EXISTS / is retained  (availability)
            //   2 the source_url was fetched + confirmed  (a SCRAPE flag —
            //     ManufacturerAsset.verified; it has no relationship to either of
            //     the other two, and it is what drove the tick)
            //   3 the document is APPLICABLE to the SELECTED product, and whether it
            //     is AUTHORITATIVE for engineering values  (the only thing a
            //     reviewer cares about)
            // The ✓ is gone. Each row now renders the canonical DOCUMENT STATE chips
            // from evaluateDocumentApplicability — and applicability is evaluated for
            // ALL FIVE rows, not only Racking (the other four were structurally
            // incapable of showing a state because `selectedModel` was never passed).
            // ARCHIVED renders as a NEUTRAL availability chip: archived ≠ applicable.
            const _chipStyle = (st: DocumentApplicabilityState): string =>
              st === 'AUTHORITATIVE' || st === 'VERIFIED' || st === 'APPLICABLE'
                ? 'background:#e8f5ec;border:1px solid #0a7a2f;color:#0a5c23;'
                : st === 'ARCHIVED'
                  // NEUTRAL — availability only. Never a positive applicability mark.
                  ? 'background:#f2f2f2;border:1px solid #777;color:#333;'
                  : st === 'PENDING_APPLICABILITY'
                    ? 'background:#fdf3e3;border:1px solid #b45309;color:#8a3f04;'
                    : 'background:#fdecea;border:1px solid #b00;color:#8a0000;';
            const _chips = (appl: DocumentApplicability): string => appl.states.map(st =>
              `<span data-ds-doc-state="${escapeH(st)}" style="${_chipStyle(st)}`
              + `font-weight:700;padding:0 3px;border-radius:2px;font-size:7.5px;white-space:nowrap;">`
              + `${escapeH(DOCUMENT_APPLICABILITY_CHIP[st])}</span>`).join(' ');
            const _docRegion = peekSnapshot(input)?.equipmentDocumentAuthority ?? null;
            const _cite = (label: string, a: ReturnType<typeof getManufacturerAsset>, selectedModel: string | null): string => {
              if (!a || (!a.sourceUrl && !a.imageUrl)) return '';
              const host = a.sourceUrl ? (() => { try { return new URL(a.sourceUrl!).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
              const bits = [a.docTitle, a.pageRef, host].filter(Boolean).join(' · ');
              // ECD §8 — evaluated for EVERY row. `selectedModel` falls back to the
              // asset's own model, which is the identity the asset was keyed by.
              // AAC WS-9 RENDERER PURITY — the verdict is NOT decided here. It is
              // projected from the frozen snapshot region (or, for a document the
              // build did not pre-enumerate, decided by the snapshot layer from
              // the SAME frozen registry facts). The old call passed `null` for
              // registryFacts, which is exactly why AUTHORITATIVE was unreachable.
              const _appl = sheetDocumentApplicability({
                region: _docRegion, category: a.category as string, equipmentId: a.equipmentId,
                selectedModel: selectedModel ?? a.model, asset: a,
              });
              const _applTag = !_appl.applicabilityVerified
                ? ` <span data-ds-applicability="${escapeH(_appl.state)}" style="color:#b45309;font-weight:700;">`
                  + `— the document covers `
                  + `${escapeH(_appl.documentProduct ?? 'a different product version')}, NOT VERIFIED for the selected `
                  + `${escapeH(String(selectedModel ?? a.model))} — NOT AUTHORITATIVE for installation requirements</span>`
                : '';
              // The authority statement is explicit on EVERY row: nothing in the asset
              // library is archived + content-hash bound, so no row may read as the
              // citable authority for an engineering value.
              const _authTag = _appl.authoritative
                ? ''
                : ` <span data-ds-authoritative="false" style="color:#555;">— not authoritative for engineering values</span>`;
              return `<li><strong>${label}:</strong> ${a.brand} ${a.model} — ${bits || 'manufacturer datasheet'} `
                + `${_chips(_appl)}${_applTag}${_authTag}</li>`;
            };
            const rows = [
              _cite('Module', getManufacturerAsset(_dbPanel?.id, 'module_spec'), _dbPanel?.model ?? null),
              // The SELECTED identity is the DESIGN's inverter model — never a
              // renderer-local equipment-db fuzzy find. `_dbMicro` is used only
              // for its `.id` (the citation key + presence gating); reading a
              // scalar off it here would originate a product SELECTION inside a
              // verified-document surface, which the standing rule forbids
              // (planset-evidence-rp gate 18, "no-renderer-local-product-selection").
              _cite('Inverter', getManufacturerAsset(_invId, 'inverter_spec') || getManufacturerAsset(_invId, 'microinverter_spec') || getManufacturerAsset(_invId, 'optimizer_spec'),
                _inv0?.model ?? null),
              _cite('Battery', getManufacturerAsset(_batId, 'battery_spec'),
                ((project._canonical as { battery?: { model?: string } })?.battery?.model
                  || (project as { batteryModel?: string }).batteryModel) ?? null),
              _cite('Racking', getManufacturerAsset(project.mountingSystemId, 'racking_detail'),
                getMountingSystemById(project.mountingSystemId ?? '')?.model ?? null),
              // Brand-integrated AC combiner / gateway ("the brains") — datasheet
              // required for plan review; cited by device name (no image on file).
              // NO document is on file, so it carries no positive mark at all.
              (() => {
                const _d = buildIntegratedEquipment(input, cad).brains;
                return _d ? `<li><strong>AC Combiner / Gateway:</strong> ${_d.brand} ${_d.model} — integrated ${_d.roleSummary.toLowerCase()} · manufacturer datasheet `
                  + `<span data-ds-doc-state="PENDING_APPLICABILITY" style="background:#fdf3e3;border:1px solid #b45309;color:#8a3f04;font-weight:700;padding:0 3px;border-radius:2px;font-size:7.5px;white-space:nowrap;">NO DOCUMENT ON FILE</span></li>` : '';
              })(),
            ].filter(Boolean);
            const fallback = `• <strong>Module:</strong> ${modMfr} — see manufacturer website<br>• <strong>Inverter:</strong> ${invMfr} — see manufacturer website<br>`;
            return `
          <div style="background:#fff;border:1px solid #000;padding:6px;margin-top:6px;font-size:8.5px;color:#000;line-height:1.5;">
            <strong>Manufacturer Data Sheets — On File</strong><br>
            The following manufacturer specification sheets / installation details are on file for this project and available upon AHJ request:
            ${rows.length ? `<ul style="margin:3px 0 4px 0;padding-left:16px;">${rows.join('')}</ul>` : `<br>${fallback}`}
            <strong>Racking structural calculations — SEE PV-4C.</strong><br>
            <!-- ECD §8 / gate 14 — this line was the bare literal "All equipment is
                 CEC Listed, UL Listed, and approved for grid interconnection.": a
                 blanket approval, with no registry read, on a package carrying open
                 equipment-identity, document-applicability, racking-selection and
                 capacity-document requirements. It is now DERIVED from the canonical
                 release-gate registry and can only turn positive when that scope is
                 clear. The document-state chips above carry the per-document truth. -->
            <span data-app-a-listing-conclusion="${escapeH(_listing.established ? 'ESTABLISHED' : 'NOT_ESTABLISHED')}" data-app-a-listing-open-codes="${escapeH(_listing.openCodes.join(','))}" style="font-weight:700;color:${_listing.established ? '#0a5c23' : '#8a3f04'};">${escapeH(_listing.sentence)}</span>${_listing.openCodes.length
              ? `<br><span style="font-size:7.5px;color:#555;">Open requirements in this scope: <span class="mono">${escapeH(_listing.openCodes.join(' · '))}</span>${_listing.openAdvisoryCodes.length ? ` (advisory: <span class="mono">${escapeH(_listing.openAdvisoryCodes.join(' · '))}</span>)` : ''}</span>`
              : ''}
          </div>`;
          })()}
        </div>
      </div>
    </div>
  </div>`;
}




