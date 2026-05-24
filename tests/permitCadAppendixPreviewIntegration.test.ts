import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('permit CAD appendix preview integration', () => {
  it('wires APP-CAD into generatePermitHTML behind explicit preview opt-in without replacing production sheets', () => {
    const source = readRepoFile('lib/permit/generatePermit.ts');

    expect(source).toContain("import { pageCADAppendixPreview } from './sections/cadAppendixPreviewPage';");
    expect(source).toContain('const includeCADAppendixPreview');
    expect(source).toContain('(input as any).cadAppendixPreviewV1 === true');
    expect(source).toContain('const TOTAL = includeCADAppendixPreview ? 16 : 15;');
    expect(source).toContain('pageArrayPrimary(input, cad, 3, TOTAL, renderCtx)');
    expect(source).toContain('pageStructuralPrimary(input, cad, 5, TOTAL, renderCtx)');
    expect(source).toContain('pages.push(pageCADAppendixPreview(input, cad, 16, TOTAL));');
  });

  it('adds APP-CAD to the generated permit preview map after existing production sheets', () => {
    const source = readRepoFile('app/api/engineering/permit-preview/route.ts');

    expect(source).toContain("'PV-2':  2");
    expect(source).toContain("'PV-3':  4");
    expect(source).toContain("'VAL-1': 14");
    expect(source).toContain("'APP-CAD': 15");
  });

  it('renders the permit appendix page through the existing non-authoritative CAD appendix boundary', () => {
    const source = readRepoFile('lib/permit/sections/cadAppendixPreviewPage.ts');

    expect(source).toContain('buildCADModelExportBundle');
    expect(source).toContain('buildCADSvgArtifactPreview');
    expect(source).toContain('buildPlanSetCADAppendixPreviewSheetV1');
    expect(source).toContain('renderPlanSetCADAppendixPreviewSheetV1');
    expect(source).toContain('CAD PREVIEW ONLY · NON-AUTHORITATIVE · NOT PERMIT AUTHORITY');
    expect(source).toContain('DOES NOT REPLACE PV-2 OR PV-3');
    expect(source).not.toContain('generateCADLayout(');
  });

  it('marks generated permit packages as explicitly opted into the preview appendix', () => {
    const source = readRepoFile('app/api/engineering/permit/route.ts');

    expect(source).toContain('(enrichedBody as any).cadAppendixPreviewV1 = true;');
    expect(source).toContain('const html = generatePermitHTML(enrichedBody, storedSldSvg);');
  });
});
