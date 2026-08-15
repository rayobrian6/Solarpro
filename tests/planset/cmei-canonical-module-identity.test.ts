// ═══════════════════════════════════════════════════════════════════════════
// CMEI — CANONICAL MODULE EQUIPMENT IDENTITY.
//
// `panelId` is the identity. manufacturer / model / watts are projections of it.
//
// The defect: `applyCanonicalEquipmentToInput` already re-pinned the canonical
// selection onto every string, but the id was undeclared on the type, so ~26
// consumers identified the module by MODEL STRING and re-derived the catalogue
// row with two-way substring matching — FOUR independent copies of
//
//     list.find(e => e.model.includes(m) || m.includes(e.model))
//
// one of them inside the canonical picker's own catalogue. "REC 400" matches
// "REC 400AA Pure-R". In the BOM that is ordered hardware; in CAD it is geometry.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  resolveModuleIdentity, resolveStringModuleIdentity, resolveFleetModuleIdentities,
  resolveSubsystemModuleIdentity, searchModulesForDisplay,
  PRODUCTION_MODULE_CATALOG, type ModuleCatalog,
} from '@/lib/equipment/moduleIdentity';
import type { SolarPanel } from '@/lib/equipment-db';

// ── a deterministic catalogue whose models are deliberately substring-prone ──
const panel = (over: Partial<SolarPanel> & { id: string; model: string }): SolarPanel => ({
  manufacturer: 'REC', category: 'solar_panel', watts: 400, efficiency: 21, voc: 44, vmp: 37,
  isc: 11, imp: 10.5, tempCoeffVoc: -0.24, tempCoeffIsc: 0.04, tempCoeffPmax: -0.26,
  maxSystemVoltage: 1000, maxSeriesFuseRating: 25, nominalOperatingTemp: 44,
  parallelStringLimit: 2, weight: 46,
  ...over,
} as SolarPanel);

const CAT: SolarPanel[] = [
  panel({ id: 'rec-400aa-pure-r', model: 'REC 400AA Pure-R', watts: 400 }),
  panel({ id: 'rec-400', model: 'REC 400', watts: 400 }),
  panel({ id: 'qcells-peak-duo-400', manufacturer: 'Q CELLS', model: 'Q.PEAK DUO BLK ML-G10+ 400W', watts: 400 }),
  panel({ id: 'qcells-peak-duo-405', manufacturer: 'Q CELLS', model: 'Q.PEAK DUO BLK ML-G10+ 405W', watts: 405 }),
  // two rows sharing a model, distinguished only by wattage — the ambiguity case
  panel({ id: 'twin-a', manufacturer: 'Twin', model: 'TWIN-X', watts: 380 }),
  panel({ id: 'twin-b', manufacturer: 'Twin', model: 'TWIN-X', watts: 390 }),
];

const catalog: ModuleCatalog = {
  byId: (id) => CAT.find(p => p.id === id) ?? null,
  all: () => CAT,
};
const R = (src: Parameters<typeof resolveModuleIdentity>[0]) => resolveModuleIdentity(src, { catalog });

// ═══════════════════════════════════════════════════════════════════════════
// PROOFS 1–5 · THE IDENTITY CONTRACT
// ═══════════════════════════════════════════════════════════════════════════

describe('CMEI · panelId is the identity', () => {
  it('1. panelId WINS over conflicting model text', () => {
    const a = R({ panelId: 'rec-400', model: 'Q.PEAK DUO BLK ML-G10+ 405W', manufacturer: 'Q CELLS', watts: 405 });
    expect(a.state).toBe('CANONICAL');
    expect(a.panelId).toBe('rec-400');
    // the ATTRIBUTES come off the catalogue row, not off the conflicting text
    expect(a.model).toBe('REC 400');
    expect(a.manufacturer).toBe('REC');
    expect(a.watts).toBe(400);
    expect(a.spec?.id).toBe('rec-400');
  });

  it('1b. a dangling panelId fails closed and does NOT fall back to the model text', () => {
    const a = R({ panelId: 'no-such-panel', model: 'REC 400', watts: 400 });
    expect(a.state).toBe('NOT_ESTABLISHED');
    expect(a.panelId).toBeNull();
    expect(a.spec).toBeNull();
    expect(a.refusals.join(' ')).toMatch(/does not resolve to any catalogue module/);
    expect(a.basis).toMatch(/not consulted as a substitute/);
  });

  it('3. an EXACT unique legacy match resolves through the bridge and is repinnable', () => {
    const a = R({ model: 'Q.PEAK DUO BLK ML-G10+ 400W', manufacturer: 'Q CELLS', watts: 400 });
    expect(a.state).toBe('LEGACY_DERIVED');
    expect(a.established).toBe(true);
    expect(a.panelId).toBe('qcells-peak-duo-400');
    expect(a.repinnable).toBe(true);      // eligible for the existing self-heal re-pin
    expect(a.basis).toMatch(/exactly one catalogue module matches/);
  });

  it('3b. an exact catalogue ID hiding in the model field is a stable clue, not a guess', () => {
    // several older bodies persist the id in panelModel; generatePermit has long
    // called getPanelById(str.panelModel).
    const a = R({ model: 'rec-400aa-pure-r' });
    expect(a.state).toBe('LEGACY_DERIVED');
    expect(a.panelId).toBe('rec-400aa-pure-r');
  });

  it('4. an AMBIGUOUS legacy model fails closed', () => {
    const a = R({ model: 'TWIN-X', manufacturer: 'Twin' });   // two rows, 380 W and 390 W
    expect(a.state).toBe('NOT_ESTABLISHED');
    expect(a.panelId).toBeNull();
    expect(a.refusals.join(' ')).toMatch(/2 catalogue modules match/);
    expect(a.basis).toMatch(/AMBIGUOUS/);
    // …and adding the discriminating attribute resolves it
    expect(R({ model: 'TWIN-X', manufacturer: 'Twin', watts: 390 }).panelId).toBe('twin-b');
  });

  it('5. a SUBSTRING-only match can never establish identity', () => {
    // 'REC 400' is a strict prefix of 'REC 400AA Pure-R'. The old matcher
    // returned one of them; this must not.
    const partial = R({ model: 'REC 400A' });               // matches neither exactly
    expect(partial.state).toBe('NOT_ESTABLISHED');
    expect(partial.refusals.join(' ')).toMatch(/no catalogue module has the exact model/);

    const containsCatalogModel = R({ model: 'REC 400AA Pure-R (black frame)' });
    expect(containsCatalogModel.state).toBe('NOT_ESTABLISHED');

    // the exact string still resolves — proving the refusal is about substrings,
    // not about the fixture being unmatchable
    expect(R({ model: 'REC 400AA Pure-R' }).panelId).toBe('rec-400aa-pure-r');
    expect(R({ model: 'REC 400' }).panelId).toBe('rec-400');
  });

  it('5b. a mismatching attribute ELIMINATES a candidate rather than being ignored', () => {
    const a = R({ model: 'REC 400', manufacturer: 'Q CELLS' });   // wrong manufacturer
    expect(a.state).toBe('NOT_ESTABLISHED');
    const b = R({ model: 'REC 400', watts: 999 });                 // wrong wattage
    expect(b.state).toBe('NOT_ESTABLISHED');
    expect(b.refusals.join(' ')).toMatch(/none of them also match/);
  });

  it('5d. manufacturer alone — or manufacturer+watts — can NEVER identify a product', () => {
    // CONFIRMED BY ADVERSARIAL REVIEW. The candidate filter degraded to `true`
    // when no model was supplied, so a brand with exactly one catalogue row
    // resolved from the brand name alone — making `watts` an independent
    // identity authority, which the contract forbids. In the production
    // catalogue 9 of 17 manufacturers are single-row, so this was the common
    // case. It also violated monotonicity: DELETING the model upgraded a
    // refusal into a pinned SKU.
    const solo: SolarPanel[] = [panel({ id: 'solo-1', manufacturer: 'Solo', model: 'SOLO-ONE', watts: 400 })];
    const soloCat: ModuleCatalog = { byId: id => solo.find(p => p.id === id) ?? null, all: () => solo };
    expect(resolveModuleIdentity({ manufacturer: 'Solo' }, { catalog: soloCat }).state).toBe('NOT_ESTABLISHED');
    expect(resolveModuleIdentity({ manufacturer: 'Solo', watts: 400 }, { catalog: soloCat }).state).toBe('NOT_ESTABLISHED');
    expect(resolveModuleIdentity({ watts: 400 }, { catalog: soloCat }).state).toBe('NOT_ESTABLISHED');
    // …and MONOTONICITY holds: adding the model can only help, never the reverse
    expect(resolveModuleIdentity({ manufacturer: 'Solo', model: 'SOLO-ONE' }, { catalog: soloCat }).panelId).toBe('solo-1');
  });

  it('5e. a BLANK MARKER is absence, not a value to match on', () => {
    // CONFIRMED BY ADVERSARIAL REVIEW. `ResolvedEquipment` prints '—' for an
    // absent field and hands that record straight to the accessor. Matching on
    // '—' eliminated every candidate, so a per-subsystem BOM panel line vanished
    // because of a placeholder glyph rather than because of any ambiguity.
    for (const blank of ['—', '-', '', 'N/A', 'TBD', 'unknown', '?']) {
      const r = R({ model: 'REC 400', manufacturer: blank });
      expect(r.panelId, `manufacturer '${blank}' must not narrow`).toBe('rec-400');
    }
    // a blank MODEL is still absence — and absence of a model refuses
    expect(R({ model: '—', manufacturer: 'REC' }).state).toBe('NOT_ESTABLISHED');
  });

  it('5f. the id-in-model clue must AGREE with the other recorded attributes', () => {
    // CONFIRMED BY ADVERSARIAL REVIEW. The clue was admitted unconditionally, so
    // a record naming a catalogue id while also recording a contradicting
    // manufacturer/wattage resolved to the named row and discarded the conflict
    // — the one place a contradiction was ignored.
    expect(R({ model: 'rec-400aa-pure-r' }).panelId).toBe('rec-400aa-pure-r');
    expect(R({ model: 'rec-400aa-pure-r', manufacturer: 'Q CELLS' }).state).toBe('NOT_ESTABLISHED');
    expect(R({ model: 'rec-400aa-pure-r', watts: 999 }).state).toBe('NOT_ESTABLISHED');
    expect(R({ model: 'rec-400aa-pure-r', manufacturer: 'REC', watts: 400 }).panelId).toBe('rec-400aa-pure-r');
  });

  it('5c. nothing recorded at all is NOT_ESTABLISHED, not a default', () => {
    const a = R({});
    expect(a.state).toBe('NOT_ESTABLISHED');
    expect(a.spec).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROOFS 6–7 · ONE VALUE, SHARED, AND IT PROPAGATES
// ═══════════════════════════════════════════════════════════════════════════

describe('CMEI · one identity, consumed everywhere', () => {
  const fleet = (over: Partial<Record<string, unknown>> = {}) => ({
    inverters: [{
      strings: [
        { panelId: 'rec-400', panelModel: 'REC 400', panelManufacturer: 'REC', panelWatts: 400, ...over },
        { panelId: 'rec-400', panelModel: 'REC 400', panelManufacturer: 'REC', panelWatts: 400, ...over },
      ],
    }],
  });

  it('6. string, subsystem and fleet accessors all yield the SAME identity', () => {
    const s = resolveStringModuleIdentity(fleet().inverters[0].strings[0], { catalog });
    const sub = resolveSubsystemModuleIdentity({ panelId: 'rec-400' }, { catalog });
    const fl = resolveFleetModuleIdentities(fleet(), { catalog });
    expect(s.panelId).toBe('rec-400');
    expect(sub.panelId).toBe('rec-400');
    expect([...fl.keys()]).toEqual(['rec-400']);          // deduped by IDENTITY
    expect(fl.get('rec-400')!.panelId).toBe('rec-400');
    // identical value, field for field
    expect(JSON.stringify(s)).toBe(JSON.stringify(fl.get('rec-400')));
    expect(sub.spec?.id).toBe(s.spec?.id);
  });

  it('7. changing the canonical panelId propagates without any subsystem rematching', () => {
    // the model text is left STALE on purpose — nothing may re-derive from it
    const repinned = {
      inverters: [{ strings: [{
        panelId: 'qcells-peak-duo-405',
        panelModel: 'REC 400', panelManufacturer: 'REC', panelWatts: 400,
      }] }],
    };
    const fl = resolveFleetModuleIdentities(repinned, { catalog });
    expect([...fl.keys()]).toEqual(['qcells-peak-duo-405']);
    const idn = fl.get('qcells-peak-duo-405')!;
    expect(idn.model).toBe('Q.PEAK DUO BLK ML-G10+ 405W');   // projected from the id
    expect(idn.watts).toBe(405);
    expect(idn.manufacturer).toBe('Q CELLS');
  });

  it('8. no consumer can silently substitute a fuzzy registry match', () => {
    // The display/search surface returns MANY candidates precisely so nothing can
    // mistake it for a resolution.
    const hits = searchModulesForDisplay('REC 400', { catalog });
    expect(hits.length).toBeGreaterThan(1);
    // …and it is not an identity: the resolver still refuses the same query
    expect(R({ model: 'REC 400A' }).established).toBe(false);
  });

  it('9. old posted bodies without panelId remain readable', () => {
    const legacy = { inverters: [{ strings: [
      { panelModel: 'Q.PEAK DUO BLK ML-G10+ 400W', panelManufacturer: 'Q CELLS', panelWatts: 400 },
    ] }] };
    const fl = resolveFleetModuleIdentities(legacy, { catalog });
    const idn = [...fl.values()][0];
    expect(idn.state).toBe('LEGACY_DERIVED');
    expect(idn.panelId).toBe('qcells-peak-duo-400');
    expect(idn.repinnable).toBe(true);
  });

  it('9b. an unresolvable legacy string is keyed and reported, never dropped', () => {
    const legacy = { inverters: [{ strings: [{ panelModel: 'Mystery 500' }] }] };
    const fl = resolveFleetModuleIdentities(legacy, { catalog });
    expect([...fl.keys()]).toEqual(['unresolved:mystery 500']);
    expect([...fl.values()][0].established).toBe(false);
  });

  it('the production catalogue is wired and id-exact', () => {
    expect(PRODUCTION_MODULE_CATALOG.all().length).toBeGreaterThan(10);
    const first = PRODUCTION_MODULE_CATALOG.all()[0];
    expect(PRODUCTION_MODULE_CATALOG.byId(first.id)?.id).toBe(first.id);
    expect(PRODUCTION_MODULE_CATALOG.byId(`${first.id}-nope`)).toBeNull();
    expect(resolveModuleIdentity({ panelId: first.id }).state).toBe('CANONICAL');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE ARCHITECTURAL GUARD
// ═══════════════════════════════════════════════════════════════════════════

/** Two-way substring matching over a model field — the construction this phase
 *  removes. Matched against source text so a new copy cannot appear. */
const SUBSTRING_IDENTITY_RE =
  /\.model\.toLowerCase\(\)\.includes\(|includes\(\s*[\w.]*[Mm]odel[\w.]*\.toLowerCase\(\)\s*\)/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { walk(p, out); continue; }
    if (p.endsWith('.ts') || p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Lists/identifiers that make a substring match a MODULE-identity decision. */
const MODULE_SOURCE_RE = /SOLAR_PANELS|MODULE_SPECS|panelModel|panelId|\bpanels?\b/i;
/** Lists that belong to a DIFFERENT equipment identity domain (inverters,
 *  batteries, racking, generic registry parts). Still the same construction —
 *  counted and pinned below so it cannot grow — but out of this phase. */
const NON_MODULE_SOURCE_RE = /MICROINVERTERS|STRING_INVERTERS|BATTERIES|INVERTER_SPECS|BATTERY_SPECS|RACKING_SPECS|EQUIPMENT_REGISTRY_V4/;

describe('CMEI · architectural guard — module identity may not be established by substring', () => {
  /** Paths allowed to contain the construction, each with the reason. */
  const ALLOWED = new Map<string, string>([
    ['lib/equipment/moduleIdentity.ts', 'searchModulesForDisplay — display/search only, cannot reach authority'],
    ['tests/planset/cmei-canonical-module-identity.test.ts', 'this guard'],
  ]);

  const scan = () => {
    const roots = ['lib/permit', 'lib/cad', 'lib/drafting', 'lib/equipment', 'lib/system'];
    const files = roots.flatMap(r => walk(r));
    expect(files.length).toBeGreaterThan(50);
    const moduleHits: string[] = [];
    const nonModuleHits: string[] = [];
    for (const f of files) {
      const rel = f.replace(/\\/g, '/');
      if (ALLOWED.has(rel) || rel.endsWith('.test.ts')) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!SUBSTRING_IDENTITY_RE.test(line)) return;
        // classify from the line plus a small window, since the list name is
        // often on the `.find(` line above the predicate.
        const ctx = lines.slice(Math.max(0, i - 4), i + 3).join('\n');
        const entry = `${rel}:${i + 1}  ${line.trim().slice(0, 120)}`;
        if (NON_MODULE_SOURCE_RE.test(ctx) && !MODULE_SOURCE_RE.test(ctx)) nonModuleHits.push(entry);
        else moduleHits.push(entry);
      });
    }
    return { moduleHits, nonModuleHits };
  };

  it('no authority path resolves a MODULE by two-way substring match', () => {
    const { moduleHits } = scan();
    expect(
      moduleHits,
      `module identity must come from resolveModuleIdentity() in lib/equipment/moduleIdentity.ts:\n${moduleHits.join('\n')}`,
    ).toEqual([]);
  });

  it('a module may not be laundered through the pinned non-module helper', () => {
    // The residue is classified at its DEFINITION site, so a generic helper can
    // look non-module there while a MODULE call site feeds it. Close that by
    // asserting the known generic helper is never called with module arguments.
    const src = readFileSync('lib/permit/utils/bomForPermit.ts', 'utf8');
    const calls = [...src.matchAll(/resolveRegistryEntry\(([^)]*)\)/g)].map(m => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    const moduleCalls = calls.filter(a => /panel/i.test(a));
    expect(
      moduleCalls,
      `a module argument reached the generic registry helper — use resolveStringModuleIdentity instead:\n${moduleCalls.join('\n')}`,
    ).toEqual([]);
  });

  it('the non-module residue is PINNED — inverters/accessories may not grow it', () => {
    // These are the same construction in a DIFFERENT identity domain
    // (inverterId, accessory SKUs), which has no canonical accessor yet.
    // Removing them blind changed which hardware is ordered and broke 37 tests
    // across procurement, grounding and sheet pagination — so they are a named
    // follow-up, not a silent side effect of the module phase.
    //
    // The count is pinned so the debt is visible and cannot quietly increase.
    const { nonModuleHits } = scan();
    expect(
      nonModuleHits.length,
      `non-module substring identity changed. Give inverters/accessories a canonical accessor rather than adding more:\n${nonModuleHits.join('\n')}`,
    ).toBeLessThanOrEqual(2);
  });

  it('the guard actually detects the construction (anti-vacuity)', () => {
    expect('return list.find(e => e.model.toLowerCase().includes(m));').toMatch(SUBSTRING_IDENTITY_RE);
    expect('?? list.find(e => m.includes(e.model.toLowerCase()));').toMatch(SUBSTRING_IDENTITY_RE);
    expect('const spec = catalog.byId(panelId);').not.toMatch(SUBSTRING_IDENTITY_RE);
  });

  it('the authority modules do not import the display/search helper', () => {
    const roots = ['lib/permit', 'lib/cad', 'lib/drafting', 'lib/system'];
    const files = roots.flatMap(r => walk(r)).filter(f => !f.endsWith('.test.ts'));
    const offenders = files.filter(f => readFileSync(f, 'utf8').includes('searchModulesForDisplay'));
    expect(offenders, `display-only search may not reach an authority path:\n${offenders.join('\n')}`).toEqual([]);
  });
});
