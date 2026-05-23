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
  '/admin/engineering-intelligence/snapshots',
  '/admin/engineering-intelligence/graph',
];

const prohibitedDemoTargets = [
  '/admin/engineering-intelligence/project/demo',
  'project/demo',
  'no_project_data demo route',
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
    expect(adminShell).toContain("label: 'Project Intelligence Picker'");
    expect(adminShell).toContain("label: 'Snapshot Timeline'");
    expect(adminShell).toContain("label: 'Dependency Graph'");
  });

  it('removes demo-only project intelligence entry points from admin routing', () => {
    const checkedFiles = [
      'app/admin/AdminShell.tsx',
      'app/admin/engineering/page.tsx',
      'app/admin/engineering-intelligence/components.tsx',
      'app/admin/engineering-intelligence/page.tsx',
      'app/admin/engineering-intelligence/project/[id]/page.tsx',
    ];

    for (const file of checkedFiles) {
      const content = read(file);
      for (const prohibited of prohibitedDemoTargets) {
        expect(content, `${file} should not contain ${prohibited}`).not.toContain(prohibited);
      }
    }
  });

  it('exposes a deterministic real-project picker instead of a placeholder project id', () => {
    const pickerPage = read('app/admin/engineering-intelligence/page.tsx');
    const components = read('app/admin/engineering-intelligence/components.tsx');
    const projectRoute = read('app/admin/engineering-intelligence/project/[id]/page.tsx');
    const adminProjects = read('app/admin/projects/page.tsx');

    expect(pickerPage).toContain('getProjectsByUser');
    expect(pickerPage).toContain('loadProjectPickerRecords');
    expect(components).toContain('ProjectIntelligencePicker');
    expect(components).toContain('/admin/engineering-intelligence/project/${project.id}');
    expect(components).toContain('no_projects');
    expect(components).toContain('select_real_project');
    expect(projectRoute).toContain('isValidUUID(params.id)');
    expect(projectRoute).toContain('invalidProjectHydration');
    expect(adminProjects).toContain('/admin/engineering-intelligence/project/${p.id}');
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
