// ═══════════════════════════════════════════════════════════════════════════
// THE SERVICE-TOPOLOGY SHEET, DRAWN.
//
// Ray: "Do not stop at graph tests. Render the actual SLD and inspect it visually. Ray needs to see
// two real 200 A branches from the 400 A service topology... The Expansion connection must visually
// read as a DC expansion relationship to its host Powerwall, not an AC feeder. Show the canonical
// neutral-ground bond location. Show unresolved CT/metering requirements honestly. Run the normal
// collision/layout audit after introducing the new SLD node types."
//
// 🚨 WHAT THIS IS, AND WHAT IT IS NOT. This lays out the SERVICE half of the diagram — the part
// that had no vocabulary until this slice: utility, meter, isolation, service disconnect, the
// distribution split, and one column per backup domain. It is a real sheet a person can look at,
// and it is the thing the visual acceptance is against.
//
// It is NOT a replacement for `lib/sld-professional-renderer.ts`, which draws the array, the
// branches, the conductor schedule and the title block. Wiring this column layout into that
// renderer is the remaining integration, and until it lands the two sheets are produced separately
// rather than one pretending to be the other.
//
// LAYOUT RULES, so the collision audit has something deterministic to check:
//   · the service spine runs down the centre of the top band, one device per row
//   · each domain is a column below the distribution, evenly spaced, never overlapping
//   · a DC expansion hangs BESIDE its host on a dashed link — a different line style from every
//     AC feeder, because the whole point is that it reads as a different kind of connection
// ═══════════════════════════════════════════════════════════════════════════

import type { ServiceSldGraph } from '@/lib/sld/serviceTopologyGraph';

export interface SvgBox {
  id: string;
  x: number; y: number; w: number; h: number;
  label: string;
  lines: string[];
  kind: 'device' | 'domain-frame' | 'bond' | 'expansion' | 'note';
}

export interface ServiceSldLayout {
  width: number;
  height: number;
  boxes: SvgBox[];
  /** Straight AC feeders, drawn solid. */
  acLinks: Array<{ from: string; to: string; label: string }>;
  /** DC expansion harnesses, drawn dashed. Never an AC feeder. */
  dcLinks: Array<{ from: string; to: string; label: string }>;
  notes: string[];
}

const BOX_W = 330;
const EXP_W = 300;
const ROW_GAP = 34;
/**
 * 🚨 A COLUMN RESERVES ITS EXPANSION'S SPACE, so two domains cannot collide by construction.
 *
 * The second audit run found `domain-a-exp-1 overlaps domain-b-exp-1`: each expansion hung beside
 * its host and the two met in the middle of a fixed-width sheet. Flipping one to the other side
 * just moved the collision. The column is now wide enough for a device box AND its expansion, and
 * the sheet is as wide as the columns need — a layout that cannot overlap beats one that is
 * checked for overlapping.
 */
const COL_W = BOX_W + 150 + EXP_W + 60;
const sheetWidth = (domains: number) => Math.max(1400, Math.max(1, domains) * COL_W);
/** Characters that fit on one line at the 9.5 px body size, inside a box of `w`. */
const charsFor = (w: number) => Math.max(8, Math.floor((w - 16) / 5.4));

/**
 * 🚨 WRAP, DO NOT TRUNCATE. The unresolved callouts are long by nature — "NOT EVALUATED —
 * INTERRUPTING RATING REQUIRED (depends on the main breaker fitted)" is the whole point of the
 * box. The first layout audit after these node types went in reported seven overflows and a box
 * off the sheet, which is exactly what that audit is for. Cutting the text would have hidden the
 * requirement; the box grows instead.
 */
function wrap(text: string, w: number): string[] {
  const max = charsFor(w);
  const out: string[] = [];
  for (const word of String(text ?? '').split(/\s+/)) {
    if (out.length === 0) { out.push(word); continue; }
    const last = out[out.length - 1];
    if ((last + ' ' + word).length <= max) out[out.length - 1] = last + ' ' + word;
    else out.push(word);
  }
  return out.filter(Boolean);
}
/** A box tall enough for its own text. */
const boxHeight = (lines: string[]) => Math.max(74, 26 + lines.length * 13 + 8);

/**
 * Lay the graph out. Pure — no SVG, so the collision audit can measure boxes without parsing.
 */
export function layoutServiceTopology(g: ServiceSldGraph): ServiceSldLayout {
  const SHEET_W = sheetWidth(g.domains.length);
  const SPINE_X = (SHEET_W - BOX_W) / 2;
  const boxes: SvgBox[] = [];
  const acLinks: ServiceSldLayout['acLinks'] = [];
  const dcLinks: ServiceSldLayout['dcLinks'] = [];

  const node = (id: string) => g.nodes.find(n => n.id === id);
  const spine = ['utility', 'utility-meter',
    ...g.nodes.filter(n => n.type === 'DER_ISOLATION_DISCONNECT').map(n => n.id),
    ...g.nodes.filter(n => n.type === 'SERVICE_DISCONNECT').map(n => n.id),
    'service-distribution'];

  let y = 40;
  for (const id of spine) {
    const n = node(id);
    if (!n) continue;
    const lines = [
      n.ratedCurrent ? `Rating ${n.ratedCurrent}` : '',
      n.ocpdRating ?? '',
      ...(n.unresolvedCallouts ?? []).map(u => u.label),
    ].filter(Boolean).flatMap(t => wrap(t, BOX_W));
    const h = boxHeight(lines);
    boxes.push({ id, x: SPINE_X, y, w: BOX_W, h, label: n.label, lines, kind: 'device' });
    y += h + ROW_GAP;
  }
  for (let i = 1; i < spine.length; i++) {
    if (node(spine[i - 1]) && node(spine[i])) {
      acLinks.push({ from: spine[i - 1], to: spine[i], label: '' });
    }
  }

  // The bond marker sits beside the enclosure that carries it.
  for (const b of g.nodes.filter(n => n.type === 'NEUTRAL_GROUND_BOND')) {
    const hostId = b.id.replace(/^bond-/, '');
    const host = boxes.find(x => x.id === hostId);
    if (!host) continue;
    const bondLines = wrap(b.necReference ?? '', 230);
    boxes.push({
      id: b.id, x: host.x + host.w + 40, y: host.y + 12, w: 230,
      h: Math.max(46, 26 + bondLines.length * 13 + 8),
      label: 'N-G BOND', lines: bondLines, kind: 'bond',
    });
  }

  // One column per domain, under the distribution.
  const domainTop = y + 20;
  g.domains.forEach((d, i) => {
    // Left-aligned in its own column; the 30 + EXP_W to its right belongs to this column too.
    const cx = i * COL_W + 40;
    let dy = domainTop + 34;
    const inside = g.nodes.filter(n => d.nodeIds.includes(n.id) && n.type !== 'RUN_SEGMENT');
    const order = ['GATEWAY', 'CT_METERING', 'MAIN_SERVICE_PANEL', 'SUBPANEL', 'ESS_AC_SOURCE'];
    const sorted = [...inside].sort(
      (a, b) => order.indexOf(a.type as string) - order.indexOf(b.type as string));

    const placed: string[] = [];
    for (const n of sorted) {
      if (n.type === 'DC_BATTERY_EXPANSION') continue;      // hung beside its host below
      const lines = [
        n.ratedCurrent ? `Rating ${n.ratedCurrent}` : '',
        n.ocpdRating ?? '',
        ...(n.unresolvedCallouts ?? []).map(u => u.label),
      ].filter(Boolean).flatMap(t => wrap(t, BOX_W));
      const h = boxHeight(lines);
      boxes.push({ id: n.id, x: cx, y: dy, w: BOX_W, h, label: n.label, lines, kind: 'device' });
      placed.push(n.id);
      dy += h + ROW_GAP;
    }
    // The branch feeder from the distribution into this domain's gateway.
    const gw = inside.find(n => n.type === 'GATEWAY');
    const feeder = g.nodes.find(n => n.type === 'RUN_SEGMENT' && d.nodeIds.includes(n.id)
      && n.runSegment?.id === 'BRANCH_FEEDER_RUN');
    if (gw) {
      acLinks.push({
        from: 'service-distribution', to: gw.id,
        label: feeder?.label ?? '',
      });
    }
    // Gateway → panel, and ESS → its point of connection.
    const panel = inside.find(n => n.type === 'MAIN_SERVICE_PANEL' || n.type === 'SUBPANEL');
    if (gw && panel) acLinks.push({ from: gw.id, to: panel.id, label: '' });
    for (const ess of inside.filter(n => n.type === 'ESS_AC_SOURCE')) {
      const seg = g.nodes.find(n => n.id === `run-${ess.id}`);
      const target = g.edges.find(e => e.from === seg?.id)?.to;
      if (target) acLinks.push({ from: ess.id, to: target, label: seg?.runSegment?.conductorCallout || 'AC' });
    }

    // 🚨 EACH EXPANSION HANGS BESIDE ITS HOST, ON A DASHED DC LINK.
    for (const exp of g.nodes.filter(n => n.type === 'DC_BATTERY_EXPANSION' && d.nodeIds.includes(n.id))) {
      const seg = g.nodes.find(n => n.id === `run-${exp.id}`);
      const hostId = g.edges.find(e => e.to === seg?.id)?.from;
      const host = boxes.find(b => b.id === hostId);
      // 🚨 HANG IT ON WHICHEVER SIDE IS ON THE SHEET. The right-hand column's expansion ran
      // off the page in the first layout — found by the audit, not by looking.
      const anchorX = host ? host.x : cx;
      const anchorW = host ? host.w : BOX_W;
      const hx = anchorX + anchorW + 150;  // reserved by COL_W; never the next column's space
      const hy = host ? host.y : dy;
      const expLines = [exp.ratedPower ?? '', exp.ocpdRating ?? '']
        .filter(Boolean).flatMap(t => wrap(t, EXP_W));
      boxes.push({
        id: exp.id, x: hx, y: hy, w: EXP_W, h: boxHeight(expLines),
        label: exp.label, lines: expLines, kind: 'expansion',
      });
      if (hostId) dcLinks.push({ from: hostId, to: exp.id, label: 'DC expansion harness' });
    }

    // The domain frame, drawn around everything placed in this column.
    const mine = boxes.filter(b => placed.includes(b.id)
      || g.nodes.some(n => n.id === b.id && n.type === 'DC_BATTERY_EXPANSION' && d.nodeIds.includes(n.id)));
    if (mine.length > 0) {
      const minX = Math.min(...mine.map(b => b.x)) - 14;
      const maxX = Math.max(...mine.map(b => b.x + b.w)) + 14;
      const minY = Math.min(...mine.map(b => b.y)) - 26;
      const maxY = Math.max(...mine.map(b => b.y + b.h)) + 14;
      boxes.unshift({
        id: `frame-${d.id}`, x: minX, y: minY, w: maxX - minX, h: maxY - minY,
        label: d.label, lines: [], kind: 'domain-frame',
      });
    }
  });

  const height = Math.max(...boxes.map(b => b.y + b.h), 400) + 200;
  return { width: SHEET_W, height, boxes, acLinks, dcLinks, notes: g.notes };
}

const esc = (s: string) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Draw the layout. Plain SVG so it opens anywhere and a person can look at it. */
export function renderServiceTopologySvg(g: ServiceSldGraph, title = 'SERVICE TOPOLOGY'): string {
  const L = layoutServiceTopology(g);
  const byId = new Map(L.boxes.map(b => [b.id, b]));
  const cx = (b: SvgBox) => b.x + b.w / 2;

  const frames = L.boxes.filter(b => b.kind === 'domain-frame').map(b => `
    <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8"
          fill="none" stroke="#2563eb" stroke-width="1.5" stroke-dasharray="7 5"/>
    <text x="${b.x + 10}" y="${b.y + 17}" font-size="13" font-weight="700" fill="#2563eb">
      ${esc(b.label)} — backup domain</text>`).join('');

  const links = [
    ...L.acLinks.map(l => {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) return '';
      // 🚨 AN UPWARD FEEDER ROUTES AROUND, NOT THROUGH. An ESS sits BELOW the gateway it
      // lands in, so the straight top-to-bottom path drew back up through the boxes between them
      // and dropped its label on an unrelated conductor — seen in the first rendered sheet. A
      // feeder that runs up leaves by the side and comes back in by the side.
      if (b.y + b.h <= a.y) {
        const gutter = Math.min(a.x, b.x) - 18;
        const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
        return `<path d="M${a.x},${y1} L${gutter},${y1} L${gutter},${y2} L${b.x},${y2}"
                      fill="none" stroke="#111" stroke-width="2"/>
                ${l.label ? `<text x="${gutter + 4}" y="${(y1 + y2) / 2}" font-size="10" fill="#333">${esc(l.label)}</text>` : ''}`;
      }
      const x1 = cx(a), y1 = a.y + a.h, x2 = cx(b), y2 = b.y;
      const my = (y1 + y2) / 2;
      return `<path d="M${x1},${y1} L${x1},${my} L${x2},${my} L${x2},${y2}"
                    fill="none" stroke="#111" stroke-width="2"/>
              ${l.label ? `<text x="${(x1 + x2) / 2 + 6}" y="${my - 5}" font-size="10" fill="#333">${esc(l.label)}</text>` : ''}`;
    }),
    // 🚨 DASHED, ORANGE, HORIZONTAL AND LABELLED — visually a different kind of connection.
    ...L.dcLinks.map(l => {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) return '';
      const y = a.y + a.h / 2;
      const midX = (a.x + a.w + b.x) / 2;
      return `<path d="M${a.x + a.w},${y} L${b.x},${b.y + b.h / 2}"
                    fill="none" stroke="#d97706" stroke-width="2" stroke-dasharray="6 4"/>
              <text x="${midX}" y="${y - 8}" font-size="10" fill="#d97706"
                    text-anchor="middle">${esc(l.label)}</text>`;
    }),
  ].join('');

  const boxes = L.boxes.filter(b => b.kind !== 'domain-frame').map(b => {
    const stroke = b.kind === 'expansion' ? '#d97706' : b.kind === 'bond' ? '#059669' : '#111';
    const fill = b.kind === 'expansion' ? '#fffbeb' : b.kind === 'bond' ? '#ecfdf5' : '#fff';
    const lines = b.lines.map((t, i) =>
      `<text x="${b.x + 8}" y="${b.y + 36 + i * 13}" font-size="9.5"
             fill="${/NOT EVALUATED|REQUIRED/.test(t) ? '#b45309' : '#333'}"
             font-weight="${/NOT EVALUATED|REQUIRED/.test(t) ? '700' : '400'}">${esc(t)}</text>`).join('');
    return `
    <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"
          fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
    <text x="${b.x + 8}" y="${b.y + 19}" font-size="11.5" font-weight="700" fill="#111">${esc(b.label)}</text>
    ${lines}`;
  }).join('');

  const notesY = L.height - 130;
  const noteLines = L.notes.flatMap(n =>
    wrap(n, L.width - 60).map(t => ({ t, hot: /NOT EVALUATED|REQUIRED|FAIL/.test(n) }))).slice(0, 8);
  const notes = noteLines.map((n, i) =>
    `<text x="24" y="${notesY + i * 14}" font-size="10"
           fill="${n.hot ? '#b45309' : '#333'}"
           font-weight="${n.hot ? '700' : '400'}">${esc(n.t)}</text>`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}"
     viewBox="0 0 ${L.width} ${L.height}" style="background:#fff">
  <text x="24" y="26" font-size="15" font-weight="800" fill="#111">${esc(title)}</text>
  ${frames}
  ${links}
  ${boxes}
  <line x1="24" y1="${notesY - 18}" x2="${L.width - 24}" y2="${notesY - 18}" stroke="#111" stroke-width="1"/>
  <text x="24" y="${notesY - 24}" font-size="11" font-weight="700" fill="#111">NOTES</text>
  ${notes}
</svg>`;
}

/**
 * The collision audit, on the laid-out boxes.
 *
 * 🚨 RUN AFTER ADDING NODE TYPES. Ray asked for "the normal collision/layout audit after
 * introducing the new SLD node types" — new nouns on a sheet is exactly when two of them start
 * sitting on top of each other. Domain frames are excluded: a frame is drawn AROUND its contents
 * and overlapping them is what it is for.
 */
export function auditServiceTopologyLayout(g: ServiceSldGraph): string[] {
  const L = layoutServiceTopology(g);
  const drawn = L.boxes.filter(b => b.kind !== 'domain-frame');
  const problems: string[] = [];
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i], b = drawn[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlap) problems.push(`${a.id} overlaps ${b.id}`);
    }
  }
  for (const b of drawn) {
    if (b.x < 0 || b.x + b.w > L.width) problems.push(`${b.id} runs off the sheet horizontally`);
    if (b.y < 0 || b.y + b.h > L.height) problems.push(`${b.id} runs off the sheet vertically`);
    // A box whose text would overflow it is unreadable, which is the other half of a layout audit.
    const longest = Math.max(b.label.length, ...b.lines.map(l => l.length), 0);
    if (longest * 5.4 > b.w - 12) problems.push(`${b.id} text overflows its box (${longest} chars)`);
  }
  return problems;
}
