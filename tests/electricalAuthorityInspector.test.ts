// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE INSPECTOR'S CLAIMS ABOUT THE CODEBASE, HELD TO THE CODEBASE.
//
// `lib/electrical/authorityInspector.ts` answers Ray's nine questions per field, and five of its
// answers — owner, persisted source, writers, consumers, legacy mirrors — are a REGISTRY: claims
// about the code, transcribed by hand from the audit, not observations of it.
//
// 🚨 A REGISTRY THAT DRIFTS IS WORSE THAN NO REGISTRY, because it is believed. That is the whole
// reason `docs/ELECTRICAL-AUTHORITY-MAP.md` could not be the answer: a document can only go silently
// out of date, which is how three competing stores came to exist while a document said otherwise.
//
// So every "production consumer" the inspector names must actually consume the canonical model, every
// "writer" must exist, and every legacy mirror must state a mechanism. When a surface is migrated or
// removed, this file goes red and the registry gets corrected — which is the point.
// ═══════════════════════════════════════════════════════════════════════════

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  inspectElectricalAuthority, mirrorsThatCouldWin,
} from '@/lib/electrical/authorityInspector';
import { resolveElectricalProject } from '@/lib/electrical/projectModel';
import { electricalRevision } from '@/lib/electrical/revision';
import { buildRaysIntendedJob } from '@/lib/electrical/fixtures/tesla400aTwoGateway';
import type { LoadedElectricalProject } from '@/lib/electrical/loadElectricalProject';

const ROOT = join(__dirname, '..');
const src = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

/** A loaded project, shaped exactly as `loadElectricalProject` returns one. */
function loaded(moduleCount = 72, inverterId: string | null = null): LoadedElectricalProject {
  const model = resolveElectricalProject({
    topology: buildRaysIntendedJob().topology,
    selectedEquipment: { inverterId, moduleCount },
  });
  return {
    projectId: '4030b664-bebe-433b-a11c-cda05ead2f7d',
    model,
    revision: electricalRevision(model),
    sources: {
      serviceTopology: 'projects.service_topology',
      selectedEquipment: 'projects.selected_equipment',
      engineeringConfig: 'absent',
      moduleCount: 'layouts.total_panels',
    },
  };
}

describe('the inspector answers all nine questions for every field', () => {
  const report = inspectElectricalAuthority(loaded());

  it('covers every field Ray listed', () => {
    const fields = report.rows.map(r => r.field.toLowerCase());
    for (const required of [
      'service rating', 'selected inverter architecture', 'solarcoupling',
      'storage unit quantity', 'gateway quantity', 'generation / combiner panel quantity',
      'interconnection method', 'service-topology revision', 'generated-sld revision',
    ]) {
      expect(fields.some(f => f.includes(required)),
        `the inspector does not report '${required}'`).toBe(true);
    }
  });

  it('every row answers owner, source, value, provenance, writers and consumers', () => {
    for (const row of report.rows) {
      expect(row.owner.trim(), `${row.field}: no owner`).not.toBe('');
      expect(row.persistedAt.trim(), `${row.field}: no persisted source`).not.toBe('');
      expect(row.value.trim(), `${row.field}: no value`).not.toBe('');
      expect(row.provenance.trim(), `${row.field}: no provenance`).not.toBe('');
      expect(row.writers.length, `${row.field}: no writers named`).toBeGreaterThan(0);
      expect(row.consumers.length, `${row.field}: no production consumers named`).toBeGreaterThan(0);
    }
  });

  it('the values match the model rather than being recomputed', () => {
    const l = loaded();
    const r = inspectElectricalAuthority(l);
    const find = (f: string) => r.rows.find(x => x.field.includes(f))!;
    expect(find('Service rating').value).toContain(String(l.model.serviceRatedAmps));
    expect(find('Storage unit quantity').value)
      .toContain(String(l.model.storage.invertingUnitCount));
    expect(find('Gateway quantity').value).toContain(String(l.model.storage.gatewayCount));
    expect(find('Service-topology revision').value).toBe(l.revision);
  });

  it('🚨 the answer to "can another field disagree and win?" is NO', () => {
    expect(mirrorsThatCouldWin(report),
      'a legacy mirror is named with no mechanism preventing it from winning').toEqual([]);
  });

  it('every legacy mirror states a mechanism AND a removal path', () => {
    const mirrors = report.rows.flatMap(r => r.legacyMirrors.map(m => ({ field: r.field, m })));
    expect(mirrors.length, 'the inspector claims there are no legacy mirrors at all')
      .toBeGreaterThan(0);
    for (const { field, m } of mirrors) {
      expect(m.cannotWinBecause.length, `${field} ← ${m.field}: no mechanism`).toBeGreaterThan(40);
      expect(m.removalPath.length, `${field} ← ${m.field}: no removal path`).toBeGreaterThan(20);
    }
  });

  it('it is a diagnostic, not an authority — it persists nothing and writes nothing', () => {
    const code = src('lib', 'electrical', 'authorityInspector.ts');
    for (const forbidden of ['getDbReady', 'writeServiceTopology', 'UPDATE ', 'INSERT ', 'sql`']) {
      expect(code, `the inspector contains '${forbidden}' — it would then be a writer`)
        .not.toContain(forbidden);
    }
  });

  it('a conflict is surfaced against the field it touches', () => {
    const r = inspectElectricalAuthority(loaded(37, 'enphase-iq8plus'));
    expect(r.conflicts.length).toBeGreaterThan(0);
    const coupling = r.rows.find(x => x.field.includes('solarCoupling'))!;
    expect(coupling.conflict).toBeTruthy();
    expect(String(coupling.conflict)).toContain('→');     // the question is included
  });

  it('the pending canonicalization is reported, and is absent once recorded', () => {
    // The fixture RECORDS its coupling, so there is nothing to canonicalise.
    expect(inspectElectricalAuthority(loaded()).pendingCanonicalization).toBeNull();
  });

  it('the revision inputs travel with the report, for "which fact moved it?"', () => {
    const r = inspectElectricalAuthority(loaded());
    expect(r.revisionInputs.length).toBeGreaterThan(40);
    expect(r.revisionInputs.every(s => s.includes('='))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 THE REGISTRY, CHECKED AGAINST THE SOURCE IT DESCRIBES.
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 every file the registry names exists and does what it is said to do', () => {
  const report = inspectElectricalAuthority(loaded());
  /** Pull the repo-relative paths out of a registry string. */
  const paths = (s: string): string[] =>
    [...s.matchAll(/((?:app|lib|components)\/[A-Za-z0-9_.[\]/-]+\.tsx?)/g)].map(m => m[1]);

  it('every writer and consumer path the inspector names is a real file', () => {
    const named = new Set<string>();
    for (const row of report.rows) {
      for (const s of [...row.writers, ...row.consumers, row.owner, row.persistedAt]) {
        paths(s).forEach(p => named.add(p));
      }
      for (const m of row.legacyMirrors) paths(m.cannotWinBecause).forEach(p => named.add(p));
    }
    expect(named.size, 'the registry names no files at all').toBeGreaterThan(5);
    for (const p of named) {
      expect(existsSync(join(ROOT, p)), `the registry names '${p}', which does not exist`).toBe(true);
    }
  });

  it('🚨 every production consumer it names actually consumes the canonical model', () => {
    // The claim that would rot first, and the one the audit was called over. A surface listed as a
    // consumer must reference the canonical composition — not merely exist.
    const consumers = new Set<string>();
    for (const row of report.rows) row.consumers.forEach(c => paths(c).forEach(p => consumers.add(p)));

    const CANONICAL = ['loadElectricalProject', 'resolveElectricalProject', 'electricalRevision',
      'electricalArtifactFreshness'];
    // The renderer and the schedule page consume the GRAPH (they are handed it by a migrated route),
    // which is the same authority one projection further along.
    const GRAPH = ['serviceTopology', 'ServiceTopology'];

    for (const p of consumers) {
      const code = readFileSync(join(ROOT, p), 'utf8');
      const ok = CANONICAL.some(k => code.includes(k)) || GRAPH.some(k => code.includes(k));
      expect(ok, `the registry calls '${p}' a consumer of the canonical model, but it references `
        + 'neither the model nor the graph').toBe(true);
    }
  });

  it('🚨 the permit backfill gate the registry promises is really in the permit route', () => {
    // The inspector tells a developer that a stale `engineering_config.inverters` cannot reach a
    // DC-coupled package BECAUSE the permit route skips its backfill. If that gate were deleted, the
    // inspector would keep saying so — the single most dangerous kind of stale claim.
    const code = src('app', 'api', 'engineering', 'permit', 'route.ts');
    expect(code, 'the permit route no longer loads the canonical model')
      .toContain('loadElectricalProject');
    expect(code, 'the backfill gate is gone, but the inspector still promises it')
      .toContain('_noExternalInverter');
    expect(code).toContain("'dc-coupled-storage'");
    expect(code).toContain("'storage-only'");
    expect(code, 'the gate no longer skips the backfill').toContain('inverter backfill SKIPPED');
  });

  it('🚨 the BOM route really counts graph instances, as the registry claims', () => {
    const code = src('app', 'api', 'engineering', 'bom', 'route.ts');
    expect(code).toContain('loadElectricalProject');
    expect(code).toContain('bomFromServiceTopology');
    expect(code, 'the reconciliation the registry promises is gone')
      .toContain('reconcileQuantities');
    expect(code).toContain('invertingUnitCount');
  });

  it('🚨 the permit route writes project.serviceTopology — the field with two readers', () => {
    const code = src('app', 'api', 'engineering', 'permit', 'route.ts');
    expect(code, 'nothing writes PermitInput.project.serviceTopology again')
      .toContain('body.project.serviceTopology =');
    // And its two readers are still there to receive it.
    expect(src('lib', 'permit', 'sections', 'structuralPages.ts'))
      .toContain('input.project?.serviceTopology');
    expect(src('lib', 'permit', 'utils', 'sldAdapter.ts'))
      .toContain('project.serviceTopology');
  });

  it('🚨 the SLD route stamps the revision, and the page compares it', () => {
    expect(src('app', 'api', 'engineering', 'sld', 'route.ts'))
      .toContain('electricalRevision');
    const page = src('app', 'engineering', 'page.tsx');
    expect(page, 'the page no longer computes the live revision').toContain('electricalRevision(');
    expect(page, 'the page no longer compares freshness')
      .toContain('electricalArtifactFreshness(');
    expect(page, 'the staleness banner is gone').toContain('sld-staleness-banner');
    // 🚨 AND IT IS DECIDED BY REVISION, NOT BY TIME. A timestamp says when a file was written, not
    // what it was written from.
    const banner = page.slice(page.indexOf('sld-staleness-banner'));
    expect(banner.slice(0, 1800)).toContain('sldRevision');
  });

  it('the dev inspector route is gated out of production', () => {
    const code = src('app', 'api', 'dev', 'electrical-authority', 'route.ts');
    expect(code).toContain('VERCEL_ENV');
    expect(code).toContain('devDiagnosticsAllowed');
    // It still authenticates and still scopes to the caller's own project.
    expect(code).toContain('getUserFromRequest');
    expect(code).toContain('user.id');
  });
});

describe('the production gate on the dev inspector', () => {
  it('refuses production and preview, allows local and test', async () => {
    const { devDiagnosticsAllowed } = await import('@/app/api/dev/electrical-authority/route');
    expect(devDiagnosticsAllowed({ VERCEL_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(devDiagnosticsAllowed({ VERCEL_ENV: 'preview' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    // Non-Vercel hosting: NODE_ENV is the only signal, so production there is refused too.
    expect(devDiagnosticsAllowed({ NODE_ENV: 'production' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(devDiagnosticsAllowed({ VERCEL_ENV: 'development' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(devDiagnosticsAllowed({ NODE_ENV: 'test' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});
