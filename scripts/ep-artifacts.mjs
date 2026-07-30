// ═══════════════════════════════════════════════════════════════════════════
// ep-artifacts — ELECTRICAL / PROCUREMENT CLOSEOUT deliverable-artifact generator.
//
//   Usage: node scripts/ep-artifacts.mjs <snapshot.json> <planset.html> [outDir=docs/evidence]
//
// Companion to scripts/closeout-artifacts.mjs. Emits the EP-directive-specific
// object-derived reports (§7/§10 length taxonomy, §1–§9 electrical cross-sheet
// matrix, §11 racking candidate-vs-selected, §12 document applicability, §16
// label-topology). Never hand-authored — every value is read from the canonical
// snapshot and cross-checked against the RENDERED planset HTML.
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const [snapPath, htmlPath, outDir = 'docs/evidence'] = process.argv.slice(2);
if (!snapPath || !htmlPath) { console.error('usage: ep-artifacts.mjs <snapshot.json> <planset.html> [outDir]'); process.exit(1); }
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const rawHtml = fs.readFileSync(htmlPath, 'utf8');
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const el = snap.electrical || {};
const st = snap.structural || {};
const pr = snap.permitReadiness || {};
const meta = snap.meta || {};
const registry = (pr.registry ?? []).filter(r => !r.resolved);
const registryCodes = registry.map(r => r.code);
const r6 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null);
const nowIso = new Date().toISOString();
const hdr = (artifact, section, purpose) => ({ generatedAt: nowIso, artifact, section, project: 'BRAIDON M PILLA — Solar TEST', snapshotId: meta.snapshotId, digest: meta.digest, purpose });
const write = (name, obj) => { const p = path.join(outDir, name); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); console.log('[ep-artifacts]', p); };
fs.mkdirSync(path.resolve(outDir), { recursive: true });
const segs = el.routeSegments || [];
const rws = el.physicalRaceways || [];

// ── §10 DESIGN / CALC / PROCUREMENT LENGTH REPORT ────────────────────────────
write('braidon-length-taxonomy-report.json', {
  ...hdr('braidon-length-taxonomy-report', '§10 design vs calc vs procurement length taxonomy',
    'Every printed length identifies its meaning: geometricDesignLength (route-drawing), calculationLength '
    + '(VD/fill sheets), procurementLength (BOM), with waste factor, provenance and verification state, keyed to a '
    + 'segment id. No sheet mixes an unlabeled number. The contested Q-Cable branch carries the full taxonomy; the '
    + 'remaining runs carry oneWayFt + lengthSource (single design length, labeled at the cell).'),
  segments: segs.map(s => ({
    segmentId: s.segmentId, electricalFunction: s.electricalFunction,
    geometricDesignLengthFt: r6(s.geometricDesignLengthFt) ?? null,
    calculationLengthFt: r6(s.calculationLengthFt) ?? null,
    procurementLengthFt: r6(s.procurementLengthFt) ?? null,
    oneWayFt: r6(s.oneWayFt), wasteFactor: s.wasteFactor ?? null,
    lengthProvenance: s.lengthProvenance ?? s.lengthSource ?? null,
    verificationState: s.verificationState ?? s.verificationStatus ?? null,
  })),
  branchQcableTaxonomy: (() => { const b = segs.find(s => s.segmentId === 'BRANCH_RUN'); return b ? {
    geometricDesignLengthFt: r6(b.geometricDesignLengthFt), calculationLengthFt: r6(b.calculationLengthFt),
    procurementLengthFt: r6(b.procurementLengthFt), wasteFactor: b.wasteFactor,
    provenance: b.lengthProvenance, verificationState: b.verificationState,
    note: 'design (geometry-derived per-branch path) ≠ calc (per-run one-way) ≠ procurement (Σ drops × pitch × waste) — the three meanings are explicit, never conflated' } : null; })(),
  renderedLabelsPresent: { CAD_derived: /CAD-derived/i.test(html), PROCUREMENT: /PROCUREMENT/i.test(html), DESIGN: /\bDESIGN\b/i.test(html), CALC: /\bCALC\b/i.test(html) },
});

// ── §1–§9 E-1 / PV-4A / PV-4B / SCHED CROSS-SHEET MATRIX ─────────────────────
const hrRw = rws.find(r => /BRANCH-HOMERUN/.test(r.physicalRacewayId));
const asm = el.listedCableAssembly || null;
const F = el.feeder || {};
const onSheets = (lit) => ({ present: html.includes(lit) });
write('braidon-electrical-cross-sheet-matrix.json', {
  ...hdr('braidon-electrical-cross-sheet-matrix', '§1–§9 E-1 / PV-4A / PV-4B / SCHED electrical cross-sheet matrix',
    'One canonical electrical value per fact, projected identically across E-1, PV-4A, PV-4B and the SCHED conductor '
    + 'schedule. Verifies the branch conductor, shared home-run inventory, listed Q-Cable assembly, feeder raceway and '
    + 'supply-side interconnection render consistently and never as a fabricated #12-to-combiner branch conductor.'),
  facts: {
    sharedHomerunInventory: { canonical: hrRw ? `${hrRw.currentCarryingCount}×${hrRw.conductorGauge ?? '#10 AWG'} (ccc=${hrRw.currentCarryingCount}, cnt=${hrRw.conductorCount})` : null,
      e1Svg: onSheets(`${hrRw?.currentCarryingCount}#10 THWN-2`), e1Schedule: onSheets('BRANCH_HOMERUN_RUN') },
    listedQCableAssembly: { canonical: asm ? `${asm.manufacturer} ${asm.sku} (${asm.dropCount} drops)` : null,
      skuRendered: onSheets(asm?.sku ?? '—'), neverGenericThwn: ![...html.matchAll(/#12 AWG THWN-2([^<]{0,18})/g)].some(m => !/EGC|Ground/i.test(m[1])) },
    feederRaceway: { canonical: F?.conduit ? `${F.conduit.raceway} ${F.conduit.tradeSizeIn}` : null,
      rendered: onSheets(F?.conduit ? `${F.conduit.raceway} ${F.conduit.tradeSizeIn}`.replace(/"/g, '&quot;') : '—') },
    pv4aBranchTable: { form: 'option-B rating summary (no conductor/raceway column)', rendered: onSheets('AC Branch Circuit Rating Summary') },
    supplySideInterconnection: { method: 'SUPPLY-SIDE TAP (NEC 705.11)', bareCompliesCount: (html.replace(/<[^>]+>/g, ' ').match(/\bCOMPLIES\b/g) || []).length,
      tapPendingShown: /tap-conductor[^.]{0,60}(?:PENDING|not measured)/i.test(html.replace(/<[^>]+>/g, ' ')) },
    tapCode: { canonicalCode: 'TAP-CONDUCTOR-LENGTH-PENDING', renderedExact: html.includes('TAP-CONDUCTOR-LENGTH-PENDING'), staleCodeAbsent: !html.includes('TAP-LENGTH-PENDING<') },
  },
});

// ── §11 RACKING CANDIDATE-VS-SELECTED REPORT ─────────────────────────────────
const ra = st.rackingAssembly || {};
const railSelected = (ra.railSku ?? null) != null;
write('braidon-racking-candidate-vs-selected.json', {
  ...hdr('braidon-racking-candidate-vs-selected', '§11 racking confirmed-base vs assembly-dependent vs unselected',
    'The racking BOM separates CONFIRMED mount-base equipment (orderable, real SKU) from ASSEMBLY-DEPENDENT '
    + 'components (rails, splices, clamps, T-bolts, L-feet, bonding) that cannot be specified until the rail assembly '
    + 'is pinned. While railSku is null those rows render PENDING RACKING ASSEMBLY SELECTION, are non-orderable, and '
    + 'are excluded from procurement totals. Candidates live in the operator UI, never as an orderable permit BOM line.'),
  railSelected,
  confirmedBase: { mount: ra.mountModel ?? null, mountManufacturer: ra.mountManufacturer ?? null, mountSku: ra.mountSku ?? null, lFootOrAdapter: ra.lFootOrAdapter ?? null },
  assemblyDependentPending: { railModel: ra.railModel ?? null, railSku: ra.railSku ?? null, note: 'rails / splices / clamps / T-bolts / bonding gated behind rail selection' },
  fastener: { model: ra.screwLagModel ?? null, verified: false, certLabel: 'PENDING VERIFIED FASTENER ASSEMBLY' },
  renderedGuards: {
    pendingSelectionShown: html.includes('PENDING RACKING ASSEMBLY SELECTION'),
    orderableLeaks: ['T-BOLT-38', 'RT-MINI End Clamp', 'RT-MINI Mid Clamp', 'RT-MINI Bond Clip', 'XR100'].filter(sku => html.includes(sku)),
    ds4Omitted: !/data-sheet-id="DS-4"/.test(rawHtml),
  },
  blockers: registryCodes.filter(c => /RACKING|RAIL|FASTENER/i.test(c)),
});

// ── §12 EQUIPMENT-DOCUMENT APPLICABILITY REPORT ──────────────────────────────
write('braidon-document-applicability-report.json', {
  ...hdr('braidon-document-applicability-report', '§12 RT-MINI vs RT-MINI II document applicability',
    'The selected mount is RT-MINI; the on-file datasheet cites the RT-MINI II Installation Manual — a different '
    + 'product version with no verified alias evidence. Until a version-exact document (or a verified cross-reference) '
    + 'is archived, EQUIPMENT-DOCUMENT-APPLICABILITY fires, DS-3 is marked NON-AUTHORITATIVE, and no RT-MINI II value '
    + 'is used in calcs/BOM. Product-version applicability is never inferred from a naming variance.'),
  selectedMount: st.rackingAssembly?.mountModel ?? null,
  selectedSku: st.rackingAssembly?.mountSku ?? null,
  applicabilityState: registryCodes.includes('EQUIPMENT-DOCUMENT-APPLICABILITY') ? 'unverified' : 'verified',
  blockerFired: registryCodes.includes('EQUIPMENT-DOCUMENT-APPLICABILITY'),
  renderedGuards: {
    ds3MarkedNonAuthoritative: /not authoritative|non-authoritative/i.test(html),
    differentProductVersionCited: /different product version/i.test(html),
    ds4OmittedForUnpinnedRail: !/data-sheet-id="DS-4"/.test(rawHtml),
  },
});

// ── §16 LABEL-TOPOLOGY APPLICABILITY REPORT ──────────────────────────────────
const strip = (s) => s.replace(/<\/td>/g, ' | ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const placardRows = [...strip(html).matchAll(/(L-\d+)\s*\|\s*(NEC[^|]+?)\s*\|\s*(N\/A|YES\*?)\s*\|/g)]
  .map(m => ({ id: m[1], code: decode(m[2].trim()), applicability: m[3] }));
const isSupplySide = /705\.11/.test(html) && (el.serviceTopology || []).some(o => /tap/.test(o.type || ''));
write('braidon-label-topology-report.json', {
  ...hdr('braidon-label-topology-report', '§16 PV-5 label applicability is topology-driven',
    'On this 705.11 supply-side design, the load-side-only back-fed-breaker placard (NEC 705.12(D)(2)(3)(b)) is '
    + 'marked N/A, never required; the supply-side line-side treatment applies. Label applicability is driven by the '
    + 'canonical interconnection topology, not rendered unconditionally.'),
  interconnectionTopology: isSupplySide ? 'supply-side (705.11)' : 'load-side (705.12)',
  placards: placardRows,
  loadSideOnlyBackfedBreaker: (() => { const r = placardRows.find(p => /705\.12\(D\)\(2\)\(3\)\(b\)/.test(p.code)); return r ? { id: r.id, code: r.code, applicability: r.applicability, correctlySuppressed: /N\/A/i.test(r.applicability) } : null; })(),
  noLoadSideOnlyRequiredOnSupplySide: !placardRows.some(p => /705\.12\(D\)/.test(p.code) && /YES/i.test(p.applicability)),
});

console.log('[ep-artifacts] done —', meta.snapshotId, 'digest', (meta.digest || '').slice(0, 14));
