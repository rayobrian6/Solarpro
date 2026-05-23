import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const exists = (path: string) => existsSync(join(repoRoot, path));

const engineeringIntelligenceRoutes = [
  'app/admin/engineering-intelligence/page.tsx',
  'app/admin/engineering-intelligence/project/[id]/page.tsx',
  'app/admin/engineering-intelligence/snapshots/page.tsx',
  'app/admin/engineering-intelligence/graph/page.tsx',
];

const requiredNavigationTargets = [
  '/admin/engineering',
  '/admin/engineering-intelligence',
  '/admin/engineering-intelligence/project/demo',
  '/admin/engineering-intelligence/snapshots',
  '/admin/engineering-intelligence/graph',
];

describe('Engineering Intelligence admin route integration', () => {
  it('keeps the major Engineering Intelligence app routes registered', () => {
    for (const routeFile of engineeringIntelligenceRoutes) {
      expect(exists(routeFile), `${routeFile} should exist`).toBe(true);
    }
  });

  it('keeps Engineering Intelligence routes discoverable from the admin sidebar', () => {
    const adminShell = read('app/admin/AdminShell.tsx');

    for (const target of requiredNavigationTargets) {
      expect(adminShell, `AdminShell should link ${target}`).toContain(target);
    }

    expect(adminShell).toContain("label: 'Engineering Monitor'");
    expect(adminShell).toContain("label: 'Engineering Intelligence'");
    expect(adminShell).toContain("label: 'Project Intelligence'");
    expect(adminShell).toContain("label: 'Snapshot Timeline'");
    expect(adminShell).toContain("label: 'Dependency Graph'");
  });

  it('uses path-safe active matching so legacy monitor does not shadow intelligence routes', () => {
    const adminShell = read('app/admin/AdminShell.tsx');

    expect(adminShell).toContain('path === href || path.startsWith(`${href}/`)');
    expect(adminShell).toContain('.sort((a, b) => b.href.length - a.href.length)');
  });

  it('keeps project-bound Engineering Intelligence entry points in admin and engineering surfaces', () => {
    const adminProject = read('app/admin/projects/[id]/page.tsx');
    const engineeringTab = read('components/engineering/EngineeringTab.tsx');
    const permitViewer = read('app/engineering/permit/page.tsx');
    const surveyDetail = read('app/projects/[id]/survey/[surveyId]/page.tsx');

    expect(adminProject).toContain('/admin/engineering-intelligence/project/${project.id}');
    expect(engineeringTab).toContain('/admin/engineering-intelligence/project/${projectId}');
    expect(permitViewer).toContain('/admin/engineering-intelligence/project/${projectId}');
    expect(surveyDetail).toContain('/admin/engineering-intelligence/project/${projectId}');
  });
});
