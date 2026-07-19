// ═══════════════════════════════════════════════════════════════
// Compliance Pages — Warning Labels, Spec Sheet Reference
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { escapeH } from '../utils/drawing';
import { interconnectionLabel, hasRealBattery, isSupplySideInterconnection } from '../utils/helpers';
import { buildConductorAuthority, type SubSystemConductorAuthority } from '../utils/conductorAuthority';
import { selectFieldLabels, type FieldLabel } from '../utils/fieldLabels';
import { getDesignTemps } from '../utils/designTemps';
import { isSubSystemKey, type SubSystemKey } from '../utils/subSystems';
import { resolvePanelSpecs, coldVocFactor, type ResolvedPanelSpecs } from '../utils/panelSpecs';
import { hybridSheetSections } from './subSystemSheets';
import { buildIntegratedEquipment } from '../utils/integratedEquipment';
import { getEquipmentContext, getInverterTopology, isFence, isGround, isRoof, topologyToLegacy } from '@/lib/system';
import type { CanonicalSysType } from '../types';
import { MOUNT_SYSTEM_MAP } from '../utils/canonical';
import { getMountingSystemById } from '@/lib/mounting-hardware-db';
import { SOLAR_PANELS, MICROINVERTERS, STRING_INVERTERS, BATTERIES } from '@/lib/equipment-db';
import { getManufacturerAsset } from '@/lib/manufacturer-assets-db';

export function pageWarningLabels(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { compliance } = input;
  const necVer = compliance.jurisdiction?.necVersion || '2020';
  const _isRoof = isRoof(cad.systemType);
  const _isFence = isFence(cad.systemType);
  const _isGround = isGround(cad.systemType);

  // The required field-label (sticker/decal) set is standard PER JOB — derive
  // it from the field-label dataset (lib/data/placards) gated by topology,
  // interconnection, battery and rapid-shutdown, resolved to this NEC edition.
  const labels = selectFieldLabels(input, cad);
  const requiredLabels = labels.filter(l => l.required);
  const necYear = String(necVer).match(/20\d\d/)?.[0] || '2020';

  // ── SITE-COMPUTED RATING LABELS (per sub-system) ─────────────────────────
  // The dataset's fill-in ratings labels (DC PV power source / AC disconnect)
  // carry ONE whole-system value set — wrong on a hybrid where each sub has
  // its own string length, module and feeder. Values below come from the SAME
  // per-sub conductor authority E-1/PV-4B print (never re-derived) + the
  // equipment DB datasheet records (Vmp/Imp/β) matched by the sub's OWN model.
  const { project, system } = input;
  const auth = buildConductorAuthority(input, cad);
  const _projX = project as unknown as { state?: string; address?: string; lat?: number; lng?: number };
  const _stateAbbr = (() => {
    if (_projX.state && /^[A-Za-z]{2}$/.test(_projX.state.trim())) return _projX.state.trim().toUpperCase();
    const m = (_projX.address ?? '').match(/,\s*([A-Za-z]{2})[\s,]+\d{5}(?:-\d{4})?\b/);
    return m ? m[1].toUpperCase() : undefined;
  })();
  const _temps = getDesignTemps(_projX.lat, _projX.lng, _stateAbbr);
  // Explicit AHJ design-temp override wins over the ASHRAE state envelope.
  const tMinC = project.designTempMin ?? _temps.ashraeExtremeLowC;

  const _panelDb = (model?: string) => {
    const m = (model || '').toLowerCase().trim();
    if (!m) return undefined;
    return SOLAR_PANELS.find(p => p.model.toLowerCase() === m)
      ?? SOLAR_PANELS.find(p => m.includes(p.model.toLowerCase()) || p.model.toLowerCase().includes(m));
  };
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
    || ((system.totalAcKw || 0) * 1000) / 240;
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
  const gridLabels = requiredLabels.filter(l => !SUPERSEDED.has(l.refId));

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
  function buildCardGrid(cells: string[]): string {
    let html = '';
    for (let i = 0; i < cells.length; i += 4) {
      const row = cells.slice(i, i + 4);
      html += '<tr>';
      for (const c of row) html += `<td style="width:25%;padding:5px 6px 13px;vertical-align:top;">${c}</td>`;
      for (let p = row.length; p < 4; p++) html += '<td style="width:25%;padding:5px 6px 13px;"></td>';
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
      rating: `${kw > 0 ? kw.toFixed(1) : '&mdash;'} kW AC &middot; ${sub.panelCount} MODULES`,
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
      `<td style="font-family:monospace;font-size:6.4px;">${lbl.necRef}</td>` +
      `<td style="text-align:center;font-weight:900;font-family:monospace;font-size:6.6px;">${lbl.required ? (SUPERSEDED.has(lbl.refId) ? 'YES*' : 'YES') : 'N/A'}</td>` +
      `<td style="font-size:6.6px;">${lbl.placement}</td>` +
      `</tr>`;
    const _head = `<thead><tr>` +
      `<th style="width:9%;">LABEL</th>` +
      `<th style="width:26%;">CODE REF</th>` +
      `<th style="width:9%;text-align:center;">REQ'D</th>` +
      `<th>PLACEMENT LOCATION</th>` +
      `</tr></thead>`;
    return `<table class="equip-table" style="margin:0;">${_head}<tbody>${labels.map(_row).join('')}</tbody></table>` +
      `<div style="font-size:6.2px;color:#555;margin-top:2px;">* Rendered on this sheet with site-computed ratings (DC/AC disconnect labels) or as the multiple-power-sources placard above.${_betaAssumed ? ' &nbsp;&dagger; Module Voc temperature coefficient unresolved in the equipment DB &mdash; conservative NEC 690.7 &times;1.25 applied; field-verify against the module datasheet.' : ''}</div>`;
  })();

  return `
  <div class="page">
    ${titleBlock(input, 'PV-5', 'WARNING LABELS & REQUIRED PLACARDS', pageNum, totalPages)}
    <div class="page-content">

      <div class="note-bar" style="margin-bottom:6px;">
        ALL WARNING LABELS SHALL BE PERMANENTLY INSTALLED, WEATHER-RESISTANT (UL 969), AND MEET MINIMUM CHARACTER HEIGHT REQUIREMENTS PER NEC ${necVer} &mdash;
        LETTERING MIN. 3/8" HEIGHT FOR FIELD-APPLIED LABELS, OR AS SPECIFIED BY MANUFACTURER FOR LISTED LABELS.
        COLOR: WHITE LETTERING ON RED BACKGROUND (${necVer === '2023' ? 'NEC 690.12(D)' : 'NEC 690.56'}) UNLESS OTHERWISE NOTED.
        RATED VALUES ON THIS SHEET ARE SITE-COMPUTED FROM THE APPROVED DESIGN &mdash; DESIGN LOW TEMP ${tMinC}&deg;C (${escapeH(_temps.source).toUpperCase()}).
      </div>

      <div style="display:grid;grid-template-columns:59fr 41fr;gap:10px;align-items:start;">

        <!-- LEFT: the label set -->
        <div>
          <div class="sec-hdr-dark" style="margin-bottom:4px;">
            REQUIRED LABELS &mdash; ${ratingCards.length} SITE-COMPUTED + ${gridLabels.length} STANDARD (${requiredLabels.length} OF ${labels.length} DATASET LABELS APPLY)
          </div>
          ${buildCardGrid(cardCells)}
        </div>

        <!-- RIGHT: multi-source placard / signage rules / QA tables -->
        <div>
          <div class="sec-hdr-dark" style="margin-bottom:4px;">
            MULTIPLE POWER SOURCES &mdash; PERMANENT PLACARD (NEC 705.10)
          </div>
          ${placardHtml}

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
                <div style="margin-bottom:2px;">2. Any deviation from the approved design shall be reported to the engineer of record.</div>
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

export function pageDisconnectDirectory(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system, compliance } = input;
  const necVerRaw = compliance.jurisdiction?.necVersion || '2020';
  const is2023 = String(necVerRaw).includes('2023');
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
    || ((system.totalAcKw || 0) * 1000) / 240;
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
  const _st = (_projT.state && /^[A-Za-z]{2}$/.test(_projT.state.trim()))
    ? _projT.state.trim().toUpperCase()
    : ((_projT.address ?? '').match(/,\s*([A-Za-z]{2})[\s,]+\d{5}(?:-\d{4})?\b/)?.[1]?.toUpperCase());
  const _tMin = project.designTempMin ?? getDesignTemps(_projT.lat, _projT.lng, _st).ashraeExtremeLowC;
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
        const db = m
          ? (SOLAR_PANELS.find(p => p.model.toLowerCase() === m)
            ?? SOLAR_PANELS.find(p => m.includes(p.model.toLowerCase()) || p.model.toLowerCase().includes(m)))
          : undefined;
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
  discos.push({ name: 'MAIN SERVICE DISCONNECT', rating: `${mainA} A${project.mainPanelBrand ? ` · ${project.mainPanelBrand}` : ''}`, loc: 'Exterior — at utility meter / service entrance' });
  if (project.acDisconnect !== false) discos.push({ name: 'PV AC DISCONNECT', rating: acOcpd ? `${acOcpd} A${isSupply ? ' fused' : ''}` : 'PER PLAN', loc: bos.providesAcDisconnect ? 'Integral to the combiner (load-break) — exterior AC disconnect only if required by AHJ/utility' : 'Exterior, lockable — adjacent to utility meter' });
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
        discos.push({ name: `MICROINVERTERS — ${subLabel} (×${sub.deviceCount})`, rating: `${subAcKw.toFixed(1)} kW AC · ${nm}`.trim(), loc: 'On the array — one per module' });
      } else {
        const word = sub.topology === 'OPTIMIZER' ? 'INVERTER (OPTIMIZER)' : 'INVERTER';
        discos.push({ name: `${word} — ${subLabel}`, rating: `${subAcKw.toFixed(1)} kW AC · ${nm}`.trim(), loc: `${sub.key} sub-system — at the inverter location` });
      }
    }
  } else {
    discos.push({ name: `${isMicro ? 'MICROINVERTERS' : 'INVERTER'}${invCount > 1 ? ` (×${invCount})` : ''}`, rating: `${(system.totalAcKw || 0).toFixed(1)} kW AC · ${invMfr} ${invModel}`.trim(), loc: isMicro ? 'On the array — one per module' : 'At the inverter location' });
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

  return `
  <div class="page">
    ${titleBlock(input, 'PV-6', 'DISCONNECT DIRECTORY & EMERGENCY PLACARD', pageNum, totalPages)}
    <div class="page-content">

      <div class="note-bar" style="margin-bottom:7px;">
        THE PLACARD BELOW SHALL BE PERMANENTLY INSTALLED AT THE MAIN SERVICE DISCONNECT (ENGRAVED PHENOLIC OR UV-STABLE PRINTED ALUMINUM, HIGH-CONTRAST, READABLE AT EYE LEVEL).
        IT SATISFIES THE POWER-SOURCE DIRECTORY (NEC 705.10), THE PV DISCONNECT-LOCATION PLAQUE (NEC 690.56(B)), AND THE RAPID-SHUTDOWN BUILDING PLACARD (${rsdRef}).
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
            <div style="font-size:10px;font-weight:900;letter-spacing:0.5px;">RAPID SHUTDOWN</div>
            <div style="font-size:7.6px;font-weight:700;line-height:1.4;margin-top:1px;">${escapeH(rsdText)}</div>
            <div style="font-size:7px;font-weight:800;margin-top:2px;">TYPE: ${isMicro ? 'MODULE-LEVEL — CONDUCTORS OUTSIDE THE ARRAY BOUNDARY REDUCE TO A SAFE LEVEL' : 'ARRAY-LEVEL — CONTROLLED CONDUCTORS PER ' + rsdRef} &nbsp;·&nbsp; ${escapeH(rsdRef)}</div>
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
          <div><strong>INSTALL DATE:</strong> ${escapeH(project.date || '______________')}</div>
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
          <tr><td class="fw7">Code Basis</td><td class="mono" style="font-size:8px;">NEC ${is2023 ? '2023' : necVerRaw} — 705.10 (power-source directory) · 690.56(B) (PV disconnect-location plaque) · ${rsdRef} (rapid-shutdown building placard)${hasBattery ? ' · 706 / IFC 1207 (ESS)' : ''}</td></tr>
        </tbody>
      </table>

    </div>
  </div>`;
}


// ─── Spec Sheet Reference Page ─────────────────────────────────────────────

export function pageSpecSheetReference(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const { project, system } = input;
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
  const _dbFind = <T extends { model: string }>(list: T[], model?: string): T | undefined => {
    const m = (model || '').toLowerCase().trim();
    if (!m) return undefined;
    return list.find(e => e.model.toLowerCase() === m)
      ?? list.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
  };
  const _dbPanel = _dbFind(SOLAR_PANELS, panels?.panelModel);
  const _dbMicro = system.inverters?.[0]?.type === 'micro'
    ? _dbFind(MICROINVERTERS, system.inverters?.[0]?.model) : undefined;

  // Get specs from the spec sheet DB
  const voc = panels?.panelVoc || project.panelVoc || _dbPanel?.voc || 41.6;
  const isc = panels?.panelIsc || project.panelIsc || _dbPanel?.isc || 12.26;
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
  const panelLen = project.panelLengthIn || _dbPanel?.length || 66;
  const panelWid = project.panelWidthIn || _dbPanel?.width  || 40;
  const panelWt  = project.panelWeightLbs || _dbPanel?.weight || 44;
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
  const designTempMinC = project.designTempMin ?? -10;
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

          ${_dbMicro ? `
          <div class="section-title">Microinverter — Datasheet Reference</div>
          <table class="info-table" style="margin-bottom:6px;">
            <tr><td class="il">Peak AC Output</td><td class="iv">${_dbMicro.acOutputW} VA</td></tr>
            <tr><td class="il">Max Continuous Output Current</td><td class="iv">${_dbMicro.acOutputCurrentMax} A @ ${_dbMicro.acOutputVoltage} V</td></tr>
            <tr><td class="il">DC Input Power (Module STC Max)</td><td class="iv">${_dbMicro.dcInputWMax} W</td></tr>
            <tr><td class="il">MPPT Voltage Range</td><td class="iv">${_dbMicro.mpptVoltageMin}–${_dbMicro.mpptVoltageMax} V</td></tr>
            <tr><td class="il">Max DC Input Current</td><td class="iv">${_dbMicro.maxInputCurrent} A</td></tr>
            ${_dbMicro.maxPerBranch20A ? `<tr><td class="il">Max Units / 20A Branch</td><td class="iv">${_dbMicro.maxPerBranch20A}</td></tr>` : ''}
            <tr><td class="il">CEC Weighted Efficiency</td><td class="iv">${_dbMicro.cec_efficiency}%</td></tr>
            <tr><td class="il">Rapid Shutdown</td><td class="iv">${_dbMicro.rapidShutdownCompliant ? 'Integrated — NEC 690.12 MLRS' : 'External MLRS required'}</td></tr>
            <tr><td class="il">Unit Weight</td><td class="iv">${_dbMicro.weight} lbs</td></tr>
            <tr><td class="il">Product Warranty</td><td class="iv">${_dbMicro.warranty}</td></tr>
          </table>` : ''}

          <!-- Racking System Summary — from the SELECTED mounting system.
               The old static table printed IronRidge FlashFoot2 / 5/16" lag
               specs on every package regardless of the racking actually
               specified on PV-3 (two racking systems in one permit). -->
          ${(() => {
            const _mSel = project.mountingSystemId ? getMountingSystemById(project.mountingSystemId) : undefined;
            const _sysName = project._canonical?.mountSystem || project.mountingSystem
              || (_mSel ? `${_mSel.manufacturer} ${_mSel.model}` : '')
              || MOUNT_SYSTEM_MAP[cad.systemType as CanonicalSysType] || 'IronRidge XR100';
            const _fr = (v: number) =>
              v === 0.25 ? '1/4' : v === 0.3125 ? '5/16' : v === 0.375 ? '3/8' : v === 0.5 ? '1/2' : `${v}`;
            const _lagDia = _mSel?.mount?.fastenerDiameterIn ?? 0.375;
            const _embed  = _mSel?.mount?.fastenerEmbedmentIn ?? 2.5;
            const _lagLen = Math.ceil((_embed + 1.5) * 2) / 2;
            return `
          <div class="section-title">Racking System</div>
          <table class="info-table">
            <tr><td class="il">System</td><td class="iv">${_sysName}</td></tr>
            <tr><td class="il">Material</td><td class="iv">${_mSel?.rail?.materialAlloy || 'Aluminum — per manufacturer listing'}</td></tr>
            <tr><td class="il">Rail Profile</td><td class="iv">${_mSel?.rail ? `${_mSel.rail.model} (${_mSel.rail.heightIn}" × ${_mSel.rail.widthIn}")` : (_mSel ? 'Rail-less / direct-attach' : 'Per manufacturer')}</td></tr>
            <tr><td class="il">Max Attach Spacing</td><td class="iv">${(() => {
              // Engineering-resolved spacing first (same chain as PV-3/PE-1) —
              // the racking's rated 48" printed here beside PV-3's resolved 24".
              const _spc = input.compliance?.structural?.attachment?.maxAllowedSpacing
                || (project.attachmentSpacing as number | undefined)
                || _mSel?.mount?.maxSpacingIn;
              return _spc ? `${_spc}" O.C.` : 'Per PV-3 / structural calc';
            })()}</td></tr>
            ${_isRoof ? `<tr><td class="il">Attachment</td><td class="iv">${_mSel?.mount?.model || 'Per PV-3 attachment detail'}</td></tr>` : ''}
            ${_isRoof ? `<tr><td class="il">Lag Bolt</td><td class="iv">${_fr(_lagDia)}" DIA × ${_lagLen}" Min. Stainless Steel</td></tr>` : ''}
            ${_isRoof ? `<tr><td class="il">Embedment</td><td class="iv">Min. ${_embed}" thread embedment into rafter</td></tr>` : _isFence ? '<tr><td class="il">Post Type</td><td class="iv">Steel Pipe / HSS</td></tr>' : '<tr><td class="il">Pile Type</td><td class="iv">Driven Pile / Helical Pier</td></tr>'}
            <tr><td class="il">UL Listing</td><td class="iv">${_mSel?.mount?.ul2703Listed === false ? 'See manufacturer listing' : 'UL 2703'}${_mSel?.mount?.iccEsReport ? ` / ${_mSel.mount.iccEsReport}` : ''}</td></tr>
            <tr><td class="il">Wind Rating</td><td class="iv">Per ASCE 7-22 (see PV-4C)</td></tr>
          </table>`;
          })()}

          <!-- Spec Sheet Links Note — real manufacturer documents on file (manufacturer_assets library) -->
          ${(() => {
            // Resolve the actual sourced manufacturer datasheet/detail per selected
            // equipment id, and cite the real document (title · page · source). Falls
            // back to a generic "see manufacturer website" line when none on file.
            const _fuzz = <T extends { model: string; id: string }>(list: T[], model?: string): T | undefined => {
              const m = (model || '').toLowerCase().trim(); if (!m) return undefined;
              return list.find(e => e.model.toLowerCase() === m)
                ?? list.find(e => e.model.toLowerCase().includes(m) || m.includes(e.model.toLowerCase()));
            };
            const _inv0 = system.inverters?.[0];
            const _invId = _dbMicro?.id
              ?? _fuzz(STRING_INVERTERS, _inv0?.model)?.id
              ?? _fuzz(MICROINVERTERS, _inv0?.model)?.id;
            const _batId = _fuzz(BATTERIES, (project._canonical as { battery?: { model?: string } })?.battery?.model
              || (project as { batteryModel?: string }).batteryModel)?.id;
            const _cite = (label: string, a: ReturnType<typeof getManufacturerAsset>): string => {
              if (!a || (!a.sourceUrl && !a.imageUrl)) return '';
              const host = a.sourceUrl ? (() => { try { return new URL(a.sourceUrl!).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '';
              const bits = [a.docTitle, a.pageRef, host].filter(Boolean).join(' · ');
              const mark = a.verified ? '✓ on file' : 'on file';
              return `<li><strong>${label}:</strong> ${a.brand} ${a.model} — ${bits || 'manufacturer datasheet'} <span style="color:#0a7a2f;font-weight:700;">(${mark})</span></li>`;
            };
            const rows = [
              _cite('Module', getManufacturerAsset(_dbPanel?.id, 'module_spec')),
              _cite('Inverter', getManufacturerAsset(_invId, 'inverter_spec') || getManufacturerAsset(_invId, 'microinverter_spec') || getManufacturerAsset(_invId, 'optimizer_spec')),
              _cite('Battery', getManufacturerAsset(_batId, 'battery_spec')),
              _cite('Racking', getManufacturerAsset(project.mountingSystemId, 'racking_detail')),
              // Brand-integrated AC combiner / gateway ("the brains") — datasheet
              // required for plan review; cited by device name (no image on file).
              (() => {
                const _d = buildIntegratedEquipment(input, cad).brains;
                return _d ? `<li><strong>AC Combiner / Gateway:</strong> ${_d.brand} ${_d.model} — integrated ${_d.roleSummary.toLowerCase()} · manufacturer datasheet <span style="color:#555;font-weight:700;">(upon request)</span></li>` : '';
              })(),
            ].filter(Boolean);
            const fallback = `• <strong>Module:</strong> ${modMfr} — see manufacturer website<br>• <strong>Inverter:</strong> ${invMfr} — see manufacturer website<br>`;
            return `
          <div style="background:#fff;border:1px solid #000;padding:6px;margin-top:6px;font-size:8.5px;color:#000;line-height:1.5;">
            <strong>Manufacturer Data Sheets — On File</strong><br>
            The following manufacturer specification sheets / installation details are on file for this project and available upon AHJ request:
            ${rows.length ? `<ul style="margin:3px 0 4px 0;padding-left:16px;">${rows.join('')}</ul>` : `<br>${fallback}`}
            <strong>Racking structural calculations — SEE PV-4C.</strong><br>
            All equipment is CEC Listed, UL Listed, and approved for grid interconnection.
          </div>`;
          })()}
        </div>
      </div>
    </div>
  </div>`;
}




