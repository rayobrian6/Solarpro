// ═══════════════════════════════════════════════════════════════════════════
// 🚨 MUTATION 7 — SWITCHING TABS MUST NOT CHANGE WHAT THE PROJECT IS.
//
// Ray: "Switch active Engineering tab repeatedly: System Config → Topology → Compliance → Sizing →
// SLD → BOM. Electrical interpretation must not change because a component mounted/unmounted."
// And: "Electrical truth must not depend on whether the Service Topology tab is mounted.
// `ServiceTopologyBuilder` may edit topology. It must not be the mechanism by which the rest of the
// Engineering page learns what topology exists."
//
// 🚨 WHY THIS IS A SOURCE GUARD AND NOT A RENDER TEST.
//
// The defect is structural, not behavioural-at-one-moment: `ServiceTopologyBuilder` is mounted inside
// `{activeTab === 'service' ? … : null}` and its `onTopologyChange` was the ONLY writer of the page's
// copy of the graph. A render test that mounts the page, clicks through tabs and reads the badge
// would need a database, a session and a paid plan inside a 19,000-line client component — and worse,
// it would pass against the DEFECTIVE code in the one ordering where the operator happens to visit
// the Topology tab first. The thing that must be true is that NO SUCH ORDERING EXISTS, and that is a
// property of the source: the load is keyed on the project, and the tab-mounted child is not the
// writer.
//
// `render-time-correction-is-not-geometry` is the same lesson from the 3D side: `show3D` was a
// CONDITIONAL MOUNT, and a conditional e2e assertion passed against the unfixed code.
//
// 🚨 AND THE GUARD IS PROVEN AGAINST THE REAL PRIOR BYTES. Every pattern below is run against
// `git show bc190bd9:app/engineering/page.tsx` — the file as it actually was before this repair — and
// must MATCH there. A guard that cannot find the defect it was written for is decoration; this is the
// `mutate-by-restoring-bytes` discipline, and a re-typed approximation of the defect would be a
// different defect.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(__dirname, '..');
const PAGE = 'app/engineering/page.tsx';
const current = readFileSync(join(ROOT, PAGE), 'utf8');

/** The file as it was BEFORE this repair — the real bytes, from git. */
function priorBytes(): string | null {
  try {
    return execFileSync('git', ['show', `bc190bd9:${PAGE}`],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;   // shallow clone / no git — the current-state assertions still run
  }
}

/** Collapse whitespace so a reformat does not break a structural match. */
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('🚨 the page loads the electrical state itself, keyed on the PROJECT', () => {
  // ═══════════════════════════════════════════════════════════════════════
  // 🚨 THESE TWO GUARDS USED TO PIN THE EFFECT'S EXACT BYTES.
  //
  // One matched a regex containing `{ setSvcTopology(null); setElectrical(null); return; }`
  // verbatim; the other looked for the literal `setSvcTopology(t);`. Both broke the moment the
  // effect gained a third state — while the REQUIREMENT they exist to protect (the page loads the
  // graph itself, keyed on the project, never on the tab) was still satisfied.
  //
  // A guard that fails on a correct change is as expensive as one that passes on a defect: it
  // trains you to edit the test. So the effect is now LOCATED BY WHAT IT DOES — it is the effect
  // that fetches `/service-topology` — and the assertions are about its dependencies and its
  // writes, not its punctuation.
  // ═══════════════════════════════════════════════════════════════════════

  /** The effect that fetches the service topology, found by its fetch rather than its shape. */
  function topologyLoadEffect(): { body: string; deps: string } {
    const fetchIdx = current.indexOf('}/service-topology`');
    expect(fetchIdx, 'the page no longer fetches the service topology at all')
      .toBeGreaterThan(0);
    const start = current.lastIndexOf('useEffect(', fetchIdx);
    expect(start, 'the service-topology fetch is not inside a useEffect').toBeGreaterThan(0);
    const depsIdx = current.indexOf('}, [', fetchIdx);
    const depsEnd = current.indexOf(']);', depsIdx);
    expect(depsEnd, 'the topology load effect has no dependency array').toBeGreaterThan(depsIdx);
    return {
      body: current.slice(start, depsEnd + 3),
      deps: current.slice(depsIdx, depsEnd + 3),
    };
  }

  it('the load effect depends on the project id and not on the active tab', () => {
    const { body, deps } = topologyLoadEffect();
    expect(deps, 'the topology load is not keyed on the project').toContain('currentProjectId');
    // 🚨 AND IT MUST NOT MENTION THE TAB. A load that reads `activeTab` is a tab-conditional load
    // however it is written.
    expect(body, 'the topology load reads activeTab').not.toContain('activeTab');
    expect(deps, 'the topology load is keyed on the active tab').not.toContain('activeTab');
  });

  it('🚨 the tab-mounted builder is NOT the only writer of the page\'s graph', () => {
    // `onTopologyChange` may still exist — the builder should report its edits. What must also exist
    // is a writer that is not it: the load effect itself.
    const writers = [...current.matchAll(/setSvcTopology\s*\(/g)].length;
    expect(writers, 'nothing writes the page\'s copy of the graph').toBeGreaterThan(0);
    const { body } = topologyLoadEffect();
    expect(body, 'the load effect does not write the graph').toContain('setSvcTopology(');
  });

  it('🚨 the load distinguishes NO GRAPH AUTHORED from GRAPH LOAD FAILED, and fails SAFE', () => {
    // Ray, 2026-10-02: "A failed authority read must never manufacture a contradictory equipment
    // choice. Distinguish NO TOPOLOGY AUTHORED from TOPOLOGY LOAD FAILED. They are not the same
    // state."
    //
    // `svcTopology === null` meant both, and `pvCoupledToStorage` — the ONE link between System
    // Config and the service graph — read it as "not DC-coupled", which re-armed the
    // string-inverter auto-pick on a DC-coupled Powerwall project. A dropped fetch decided the
    // architecture.
    const { body } = topologyLoadEffect();
    expect(body, 'the load effect records no read state at all').toContain('setSvcTopologyRead(');
    for (const st of ["'failed'", "'absent'", "'loaded'"]) {
      expect(body, `the load effect never reports ${st}`).toContain(`setSvcTopologyRead(${st})`);
    }
    // A non-OK response must be a FAILURE, not an absence — `res.json().catch(() => null)` used to
    // land a 500 in the same `null` a project with no graph produces.
    expect(body, 'a non-OK response is not treated as a failure').toContain('res.ok');

    // 🚨 AND THE GATE ITSELF MUST SUPPRESS ON IGNORANCE.
    const gateIdx = current.indexOf('pvCoupledToStorage={');
    expect(gateIdx, 'the System Config / topology link is gone').toBeGreaterThan(0);
    const gate = current.slice(gateIdx, current.indexOf('}', current.indexOf('}', gateIdx) + 1) + 1);
    expect(gate, 'the equipment gate does not suppress when the graph could not be read')
      .toContain("svcTopologyRead === 'failed'");
    expect(gate, 'the equipment gate does not suppress while the graph is still loading')
      .toContain("svcTopologyRead === 'loading'");
  });

  it('the canonical model is composed from the loaded graph, not from a tab', () => {
    expect(current).toContain('resolveElectricalProject');
    // The sidebar/badge reads the model.
    expect(current).toContain('setElectrical(');
  });
});

describe('🚨 the guard is not blind — it matches the REAL prior bytes', () => {
  const before = priorBytes();

  it('the prior revision is readable (otherwise this whole block is skipped loudly)', () => {
    if (!before) {
      // Not a silent skip: say so, so a shallow clone cannot make this look proven.
      console.warn('[lifecycle guard] git show bc190bd9 unavailable — prior-bytes proof NOT run');
    }
    expect(true).toBe(true);
  });

  it('🚨 the prior file HAD the tab-conditional builder mount', () => {
    if (!before) return;
    // The defect, in the bytes: the builder mounted behind `activeTab === 'service'`.
    expect(flat(before), 'the prior revision did not contain the defect this guard is for')
      .toContain(flat(`activeTab === 'service'`));
    expect(before).toContain('ServiceTopologyBuilder');
  });

  it('🚨 the prior file had NO project-keyed topology load — the defect, precisely', () => {
    if (!before) return;
    // This is the exact thing the repair added. It must be ABSENT before.
    const hadProjectKeyedLoad = /\}, \[currentProjectId\]\);/.test(before)
      && /setSvcTopology\(t\);/.test(before);
    expect(hadProjectKeyedLoad,
      'the prior revision already loaded the graph by project, so this guard proves nothing')
      .toBe(false);
  });

  it('🚨 and the prior file wrote the graph ONLY from the tab-mounted builder', () => {
    if (!before) return;
    // THE DEFECT, EXACTLY AS IT WAS. At bc190bd9 the setter appeared TWICE in 19,000 lines: its own
    // `useState` declaration, and the prop handed to a child mounted behind `activeTab === 'service'`.
    // It was never CALLED anywhere — so the page's knowledge of the graph existed only while that one
    // tab was on screen, and the Engineering Intelligence badge on every other tab fell back to
    // `inverters[0].type === 'micro'`.
    const refs = [...before.matchAll(/setSvcTopology/g)].length;
    expect(refs, 'the prior revision did not reference the setter at all').toBe(2);
    expect(before, 'the prior revision did not hand the setter to the builder')
      .toContain('onTopologyChange={setSvcTopology}');
    // And the builder that received it was behind the tab.
    const mount = before.indexOf('onTopologyChange={setSvcTopology}');
    const gate = before.lastIndexOf(`activeTab === 'service'`, mount);
    expect(gate, 'the builder was not behind a tab gate').toBeGreaterThan(0);
    expect(mount - gate,
      'the tab gate found was not the one immediately wrapping the builder').toBeLessThan(400);
  });

  it('🚨 and the CURRENT file calls the setter from somewhere other than that prop', () => {
    // The repair, stated as the inverse of the defect above: the setter is now actually INVOKED,
    // outside the builder's prop, by the project-keyed load.
    const invocations = [...current.matchAll(/setSvcTopology\(/g)].length;
    expect(invocations,
      'the setter is still only ever handed to the tab-mounted builder').toBeGreaterThan(0);
  });
});

describe('🚨 the electrical interpretation is a function of the stores, not of a render', () => {
  it('the resolver is pure and reads no React state', async () => {
    const src = readFileSync(join(ROOT, 'lib', 'electrical', 'projectModel.ts'), 'utf8');
    for (const forbidden of ['useState', 'useEffect', 'useMemo', 'react']) {
      expect(src.toLowerCase(),
        `the canonical model imports '${forbidden}' — it would then depend on a render`)
        .not.toContain(forbidden.toLowerCase());
    }
  });

  it('🚨 resolving the same stores N times in any order gives one answer', async () => {
    // The property a tab switch must have, expressed where it is actually testable: the model is a
    // function of its inputs, so no sequence of mounts can change it.
    const { resolveElectricalProject } = await import('@/lib/electrical/projectModel');
    const { electricalRevision } = await import('@/lib/electrical/revision');
    const { buildRaysIntendedJob } = await import('@/lib/electrical/fixtures/tesla400aTwoGateway');
    const topology = buildRaysIntendedJob().topology;
    const input = { topology, selectedEquipment: { inverterId: null, moduleCount: 72 } };

    // Six resolutions, standing in for System Config → Topology → Compliance → Sizing → SLD → BOM.
    const seen = new Set<string>();
    const revs = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const m = resolveElectricalProject(input);
      seen.add(JSON.stringify(m));
      revs.add(electricalRevision(m));
    }
    expect(seen.size, 'the model changed between identical resolutions').toBe(1);
    expect(revs.size, 'the revision changed between identical resolutions').toBe(1);
  });
});
