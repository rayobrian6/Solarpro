/**
 * tests/pipelineSldDoesNotOverwriteSld.test.ts
 *
 * THE PIPELINE MUST NEVER OVERWRITE THE ENGINEERING PAGE'S FILES.
 *
 * syncProjectPipeline runs on every layout save with panels, on bill-upload
 * provisioning, on /api/pipeline/run and on GET /api/engineering/sync-pipeline.
 * It wrote five files — Engineering_Report_, SLD_, BOM_, Permit_Packet_ and
 * System_Estimate_ + `${clientSlug}`. /api/engineering/save-outputs writes the
 * engineering page's live calc under the same five prefixes + `${name}`, and
 * for "John Smith" both come out identical. Both writers upsert ON CONFLICT
 * (project_id, user_id, file_name), so the permit-grade SLD in Client Files
 * was routinely replaced by buildSldSvgFromReport's generic diagram ('DC
 * DISC', 'INVERTER', no combiner, no CTs, no feeder neutral), and the page's
 * BOM by one built from report.equipmentSchedule — or, with none, by a
 * fallback naming IronRidge racking and a fused DC disconnect.
 *
 * The fix gives every pipeline file a name the engineering page can never
 * produce. The guarantee is a character: the routes sanitise with
 * `replace(/[^a-z0-9]/gi, '_')`, so `_Pipeline-` can never appear in their
 * names. The pipeline also retires the rows it wrote under the old names,
 * guarded by its own notes. The route formulas are pinned to source below so
 * a changed sanitiser fails here rather than silently in Client Files.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildAllArtifacts,
  legacyPipelineFileName,
  pipelineClientSlug,
  pipelineFileName,
  type PipelineArtifactPrefix,
} from '@/lib/engineering/artifactBuilders';
import type { EngineeringReport } from '@/lib/engineering/types';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Strip comments so a guard cannot be satisfied by prose describing itself. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// The five files, in the order buildAllArtifacts emits them.
const KINDS: ReadonlyArray<{ prefix: PipelineArtifactPrefix; ext: string }> = [
  { prefix: 'Engineering_Report', ext: 'txt' },
  { prefix: 'SLD',                ext: 'svg' },
  { prefix: 'BOM',                ext: 'csv' },
  { prefix: 'Permit_Packet',      ext: 'txt' },
  { prefix: 'System_Estimate',    ext: 'txt' },
];

// The engineering page's names, built exactly as the routes build them.
const saveOutputsNames = (clientName: string) => {
  const name = (clientName || 'Client').replace(/[^a-z0-9]/gi, '_');
  return [
    `Engineering_Report_${name}.txt`,
    `SLD_${name}.svg`,
    `BOM_${name}.csv`,
    `Permit_Packet_${name}.txt`,
    `System_Estimate_${name}.txt`,
  ];
};
const preliminaryNames = (clientName: string, systemKw: number) => {
  const name = (clientName || 'client').replace(/[^a-z0-9]/gi, '_');
  return [
    `SLD_${name}_Preliminary.svg`,
    `BOM_${name}_Preliminary.txt`,
    `Engineering_Packet_${name}_2026.txt`,
    `System_Estimate_${systemKw}kW.txt`,
  ];
};

const CLIENTS = [
  'John Smith',
  'Client',
  '',
  'Braidon',
  'Mary-Jane Doe',
  "O'Brien Family",
  'Dr. Smith',
  'John & Jane Smith',
  'Smith, John',
  'Pipeline John Smith',
  'Pipeline-John Smith',
  '  spaced   out  ',
  'ÉLODIE Ñúñez',
  '42',
  '72kW',
  'A'.repeat(60),
];
const SYSTEM_KW = [0, 7.2, 12, 72, -1, NaN];

// The pipeline's own path: syncPipeline slugs the client name, then
// buildAllArtifacts names the files. A minimal report is enough — every
// builder defaults its missing fields.
function pipelineArtifactsFor(clientName: string) {
  const report = { systemSummary: {} } as unknown as EngineeringReport;
  return buildAllArtifacts({
    report,
    projectId:  '00000000-0000-0000-0000-000000000000',
    clientName,
    clientSlug: pipelineClientSlug(clientName),
    reportDate: 'September 25, 2026',
  });
}

function pipelineSldFor(clientName: string) {
  const svgs = pipelineArtifactsFor(clientName).filter(a => a.mimeType === 'image/svg+xml');
  expect(svgs).toHaveLength(1);
  return svgs[0];
}

// ═══════════════════════════════════════════════════════════════════════════

describe('🚨 the collision was real', () => {
  it('for an ordinary client every old pipeline name WAS the engineering page name', () => {
    // Without this the rest of the file could pass against a scenario that
    // never happened.
    const slug = pipelineClientSlug('John Smith');
    const oldPipelineNames = KINDS.map(k => legacyPipelineFileName(k.prefix, slug, k.ext));
    expect(oldPipelineNames).toEqual([
      'Engineering_Report_John_Smith.txt',
      'SLD_John_Smith.svg',
      'BOM_John_Smith.csv',
      'Permit_Packet_John_Smith.txt',
      'System_Estimate_John_Smith.txt',
    ]);
    expect(oldPipelineNames).toEqual(saveOutputsNames('John Smith'));
  });
});

describe('no pipeline file can land on an engineering page file', () => {
  it('no pipeline name equals any save-outputs or preliminary name', () => {
    // Cross product: the pipeline names from project.client?.name ??
    // project.name, the page from its own clientName — they need not agree.
    const pageNames = new Set(CLIENTS.flatMap(c => [
      ...saveOutputsNames(c),
      ...SYSTEM_KW.flatMap(kw => preliminaryNames(c, kw)),
    ]));
    for (const c of CLIENTS) {
      for (const a of pipelineArtifactsFor(c)) {
        expect(pageNames.has(a.fileName), `${c} → ${a.fileName}`).toBe(false);
      }
    }
  });

  it('structurally: every pipeline name carries `_Pipeline-`, which no page name can', () => {
    for (const c of CLIENTS) {
      for (const a of pipelineArtifactsFor(c)) expect(a.fileName).toContain('_Pipeline-');
      for (const n of saveOutputsNames(c)) expect(n).toMatch(/^[A-Za-z0-9_]+\.(svg|csv|txt)$/);
      for (const kw of SYSTEM_KW) {
        const [sld, bom, packet, estimate] = preliminaryNames(c, kw);
        for (const n of [sld, bom, packet]) expect(n).toMatch(/^[A-Za-z0-9_]+\.(svg|txt)$/);
        // A number, so at most a '-' sign and a '.', never `_Pipeline-`.
        expect(estimate).not.toContain('Pipeline');
      }
    }
  });

  it('buildAllArtifacts names all five files through pipelineFileName', () => {
    const slug = pipelineClientSlug('John Smith');
    const names = pipelineArtifactsFor('John Smith').map(a => a.fileName);
    expect(names).toEqual(KINDS.map(k => pipelineFileName(k.prefix, slug, k.ext)));
    expect(names).toEqual([
      'Engineering_Report_Pipeline-John_Smith.txt',
      'SLD_Pipeline-John_Smith.svg',
      'BOM_Pipeline-John_Smith.csv',
      'Permit_Packet_Pipeline-John_Smith.txt',
      'System_Estimate_Pipeline-John_Smith.txt',
    ]);
  });
});

describe('retiring the rows the pipeline wrote under its old names', () => {
  it('each file retires exactly the name the old code wrote it under', () => {
    for (const c of CLIENTS) {
      const slug = pipelineClientSlug(c);
      const artifacts = pipelineArtifactsFor(c);
      expect(artifacts.map(a => a.retiresFileName))
        .toEqual(KINDS.map(k => `${k.prefix}_${slug}.${k.ext}`));
    }
  });

  it('a sync never retires a name it has just written', () => {
    // The DELETE matches file_name against every retired name at once, so a
    // retired name must not equal ANY of the new names, not only its own.
    for (const c of CLIENTS) {
      const artifacts = pipelineArtifactsFor(c);
      const written = new Set(artifacts.map(a => a.fileName));
      for (const a of artifacts) expect(written.has(a.retiresFileName)).toBe(false);
    }
  });

  it('the notes guard: no save-outputs note is a pipeline note', () => {
    // syncPipeline deletes an old-name row only while it still carries a
    // pipeline note. save-outputs always rewrites notes with its own, so a
    // page-written row can never match.
    const pipelineNotes = new Set(pipelineArtifactsFor('John Smith').map(a => a.notes));
    expect(pipelineNotes.size).toBe(5);
    const src = strip(read('app/api/engineering/save-outputs/route.ts'));
    const pageNotes = [...src.matchAll(/notes:\s*'([^']*)'/g)].map(m => m[1]);
    expect(pageNotes).toHaveLength(5);
    for (const n of pageNotes) expect(pipelineNotes.has(n)).toBe(false);
    expect(src).toMatch(/notes\s*=\s*EXCLUDED\.notes/);
  });

  it('no other source in app/ or lib/ writes a pipeline note', () => {
    const notes = pipelineArtifactsFor('John Smith').map(a => a.notes);
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir)) {
        if (entry === 'node_modules' || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry)) {
          const rel = path.relative(ROOT, full).replace(/\\/g, '/');
          if (rel === 'lib/engineering/artifactBuilders.ts') continue;
          const src = fs.readFileSync(full, 'utf8');
          if (notes.some(n => src.includes(n))) offenders.push(rel);
        }
      }
    };
    walk(path.join(ROOT, 'app'));
    walk(path.join(ROOT, 'lib'));
    expect(offenders).toEqual([]);
  });
});

describe('every consumer of the pipeline files still recognises them', () => {
  it('/api/pipeline/run still counts every step and still sees 5 files', () => {
    const files = pipelineArtifactsFor('John Smith').map(a => a.fileName);
    expect(files).toHaveLength(5);
    expect(files.some(n => n.startsWith('BOM_'))).toBe(true);
    expect(files.some(n => n.startsWith('SLD_'))).toBe(true);
    expect(files.some(n => n.startsWith('Permit_Packet_'))).toBe(true);
    expect(files.some(n => n.startsWith('Engineering_Report_'))).toBe(true);
  });

  it('Client Files still files each one in the same folder', () => {
    // app/engineering/page.tsx and EngineeringTab group by includes(...).
    const [report, sld, bom, permit, estimate] = pipelineArtifactsFor('John Smith');
    expect(report.fileName.includes('Engineering_Report_')).toBe(true);
    expect(sld.fileName.includes('SLD')).toBe(true);
    expect(sld.fileName.endsWith('.svg')).toBe(true);
    expect(sld.mimeType).toBe('image/svg+xml');
    expect(bom.fileName.includes('BOM')).toBe(true);
    expect(permit.fileName.includes('Permit_Packet')).toBe(true);
    expect(estimate.fileName.includes('Estimate')).toBe(true);
  });

  it('the SLD is still the only svg the pipeline writes', () => {
    expect(pipelineSldFor('John Smith').fileName).toBe('SLD_Pipeline-John_Smith.svg');
  });
});

describe('source pins — the formulas this file relies on', () => {
  it('save-outputs still names all five files from the [^a-z0-9] sanitiser', () => {
    const src = strip(read('app/api/engineering/save-outputs/route.ts'));
    expect(src).toMatch(/const name = \(clientName \|\| 'Client'\)\.replace\(\/\[\^a-z0-9\]\/gi, '_'\);/);
    expect(src).toMatch(/fileName: `Engineering_Report_\$\{name\}\.txt`/);
    expect(src).toMatch(/fileName: `SLD_\$\{name\}\.svg`/);
    expect(src).toMatch(/fileName: `BOM_\$\{name\}\.csv`/);
    expect(src).toMatch(/fileName: `Permit_Packet_\$\{name\}\.txt`/);
    expect(src).toMatch(/fileName: `System_Estimate_\$\{name\}\.txt`/);
  });

  it('the preliminary route still uses the same sanitiser, and a number for the estimate', () => {
    const src = strip(read('app/api/engineering/preliminary/route.ts'));
    expect(src).toMatch(/`SLD_\$\{\(clientName \|\| 'client'\)\.replace\(\/\[\^a-z0-9\]\/gi, '_'\)\}_Preliminary\.svg`/);
    expect(src).toMatch(/`BOM_\$\{\(clientName \|\| 'client'\)\.replace\(\/\[\^a-z0-9\]\/gi, '_'\)\}_Preliminary\.txt`/);
    expect(src).toMatch(/`System_Estimate_\$\{systemKw\}kW\.txt`/);
    expect(src).toMatch(/const systemKw\s+= Math\.round\(/);
  });

  it('/api/pipeline/run still keys its steps on the prefixes', () => {
    const src = strip(read('app/api/pipeline/run/route.ts'));
    expect(src).toMatch(/n\.startsWith\('BOM_'\)/);
    expect(src).toMatch(/n\.startsWith\('SLD_'\)/);
    expect(src).toMatch(/n\.startsWith\('Permit_Packet_'\)/);
    expect(src).toMatch(/n\.startsWith\('Engineering_Report_'\)/);
  });

  it('the pipeline has no second, inline file name', () => {
    const builders = strip(read('lib/engineering/artifactBuilders.ts'));
    const pipeline = strip(read('lib/engineering/syncPipeline.ts'));
    expect(builders).not.toMatch(/fileName:\s*`/);
    expect(builders).not.toMatch(/`SLD_\$\{clientSlug\}\.svg`/);
    expect(pipeline).not.toMatch(/(Engineering_Report|SLD|BOM|Permit_Packet|System_Estimate)_/);
    expect(pipeline).toMatch(/const clientSlug = pipelineClientSlug\(clientName\);/);
  });

  it('syncPipeline retires only old names, only with a pipeline note, only once replaced', () => {
    const pipeline = strip(read('lib/engineering/syncPipeline.ts'));
    expect(pipeline).toMatch(/const retire = artifacts\.filter\(a => writtenFiles\.includes\(a\.fileName\)\);/);
    expect(pipeline).toMatch(
      /DELETE FROM project_files\s+WHERE project_id = \$\{projectId\}\s+AND user_id\s+= \$\{userId\}\s+AND file_name\s+= ANY\(\$\{retire\.map\(a => a\.retiresFileName\)\}\)\s+AND notes\s+= ANY\(\$\{retire\.map\(a => a\.notes\)\}\)/,
    );
    // The only other DELETE is upsertFile's fallback, which targets the name
    // it is about to re-insert.
    expect(pipeline.match(/DELETE FROM project_files/g)).toHaveLength(2);
  });
});
