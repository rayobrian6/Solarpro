/**
 * Tests for:
 *   J) Portal Monitoring Widget
 *      — migration 043: monitoring_platform + monitoring_url columns
 *      — MonitoringLinkEditor component (installer sets the link)
 *      — MonitoringFoundation portal component (homeowner sees the link)
 *      — Project type has new fields
 *      — Portal dashboard API returns monitoring fields
 *      — Portal dashboard page local Project interface has monitoring fields
 *
 * All tests are source-code scanning (no DB connection needed).
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

const root = path.resolve(__dirname, '..');

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

// ─── Migration 043 ──────────────────────────────────────────────────────────
describe('Migration 043: project monitoring columns', () => {

  const migSrc = readSrc('lib/migrations/043_project_monitoring_link.sql');

  it('migration file exists', () => {
    expect(fs.existsSync(path.join(root, 'lib/migrations/043_project_monitoring_link.sql'))).toBe(true);
  });

  it('adds monitoring_platform column', () => {
    expect(migSrc).toContain('monitoring_platform');
    expect(migSrc).toContain('ALTER TABLE projects');
    expect(migSrc).toContain('ADD COLUMN IF NOT EXISTS');
  });

  it('adds monitoring_url column', () => {
    expect(migSrc).toContain('monitoring_url');
  });

  it('uses IF NOT EXISTS for idempotency', () => {
    expect(migSrc).toContain('IF NOT EXISTS');
  });
});

// ─── Project type ────────────────────────────────────────────────────────────
describe('Project type: monitoring fields', () => {

  const typesSrc = readSrc('types/index.ts');

  it('Project interface has monitoringPlatform', () => {
    expect(typesSrc).toContain('monitoringPlatform?:');
  });

  it('monitoringPlatform lists known platforms', () => {
    expect(typesSrc).toContain("'enphase'");
    expect(typesSrc).toContain("'solaredge'");
    expect(typesSrc).toContain("'apsystems'");
    expect(typesSrc).toContain("'hoymiles'");
  });

  it('Project interface has monitoringUrl', () => {
    expect(typesSrc).toContain('monitoringUrl?:');
  });
});

// ─── rowToProject hydration ──────────────────────────────────────────────────
describe('rowToProject: hydrates monitoring fields', () => {

  const dbNeon = readSrc('lib/db-neon.ts');

  it('hydrates monitoringPlatform from monitoring_platform', () => {
    expect(dbNeon).toContain('monitoringPlatform:');
    expect(dbNeon).toContain('row.monitoring_platform');
  });

  it('hydrates monitoringUrl from monitoring_url', () => {
    expect(dbNeon).toContain('monitoringUrl:');
    expect(dbNeon).toContain('row.monitoring_url');
  });

  it('updateProject branch 1 (with bill_data) saves monitoring fields', () => {
    const idx = dbNeon.indexOf('monitoring_platform =');
    expect(idx).toBeGreaterThan(-1);
  });

  it('updateProject branch 2 (without bill_data) saves monitoring fields', () => {
    // Count SET occurrences for monitoring fields — should be 2 UPDATE branches
    const matches = dbNeon.match(/monitoring_platform\s*=/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2); // 2 UPDATE branches
  });
});

// ─── MonitoringLinkEditor component ─────────────────────────────────────────
describe('MonitoringLinkEditor: installer UI', () => {

  const src = readSrc('components/project/MonitoringLinkEditor.tsx');

  it('component file exists', () => {
    expect(fs.existsSync(path.join(root, 'components/project/MonitoringLinkEditor.tsx'))).toBe(true);
  });

  it('is a client component', () => {
    expect(src.startsWith("'use client'")).toBe(true);
  });

  it('renders a platform selector with known platforms', () => {
    expect(src).toContain('enphase');
    expect(src).toContain('solaredge');
    expect(src).toContain('apsystems');
    expect(src).toContain('hoymiles');
    expect(src).toContain('generac');
    expect(src).toContain('sma');
    expect(src).toContain('fronius');
    expect(src).toContain('solis');
  });

  it('loads existing values from GET /api/projects/[id]', () => {
    expect(src).toContain('fetch(`/api/projects/${projectId}`)');
    expect(src).toContain('monitoringPlatform');
    expect(src).toContain('monitoringUrl');
  });

  it('saves via PATCH /api/projects/[id]', () => {
    expect(src).toContain("method: 'PATCH'");
    expect(src).toContain('monitoringPlatform: platform');
    expect(src).toContain('monitoringUrl: url.trim()');
  });

  it('shows a preview link when URL is set', () => {
    expect(src).toContain('Preview monitoring dashboard');
    expect(src).toContain('target="_blank"');
  });

  it('has Save button with loading/saved states', () => {
    expect(src).toContain('Saving…');
    expect(src).toContain('Saved!');
    expect(src).toContain('Save Monitoring Link');
  });
});

// ─── OperationsTab integration ───────────────────────────────────────────────
describe('OperationsTab: MonitoringLinkEditor mounted', () => {

  const src = readSrc('components/project/OperationsTab.tsx');

  it('imports MonitoringLinkEditor', () => {
    expect(src).toContain("import MonitoringLinkEditor from '@/components/project/MonitoringLinkEditor'");
  });

  it('renders MonitoringLinkEditor in Monitoring section', () => {
    expect(src).toContain('<MonitoringLinkEditor projectId={projectId} />');
    expect(src).toContain('"Monitoring"');
  });
});

// ─── Portal MonitoringFoundation ─────────────────────────────────────────────
describe('Portal MonitoringFoundation: shows monitoring link', () => {

  const src = readSrc('app/portal/dashboard/page.tsx');

  it('MonitoringFoundation accepts a project prop', () => {
    expect(src).toContain('project: Project | null');
  });

  it('portal Project interface has monitoringPlatform', () => {
    expect(src).toContain('monitoringPlatform?:');
  });

  it('portal Project interface has monitoringUrl', () => {
    expect(src).toContain('monitoringUrl?:');
  });

  it('shows monitoring link when monitoringUrl is set', () => {
    expect(src).toContain('hasMonitoring');
    expect(src).toContain('project?.monitoringUrl');
    expect(src).toContain('View {label}');
  });

  it('includes all known platform labels', () => {
    expect(src).toContain('Enphase Enlighten');
    expect(src).toContain('SolarEdge Monitoring');
    expect(src).toContain('APsystems EMA');
    expect(src).toContain('Hoymiles HMS');
  });

  it('call site passes activeProject', () => {
    expect(src).toContain('<MonitoringFoundation stage={stage} project={activeProject} />');
  });

  it('shows fallback placeholder when no monitoring link', () => {
    expect(src).toContain('Monitoring data typically activates within 24');
  });
});

// ─── Portal API dashboard route ──────────────────────────────────────────────
describe('Portal API: returns monitoring fields', () => {

  const src = readSrc('app/api/portal/dashboard/route.ts');

  it('SELECT includes monitoring_platform', () => {
    expect(src).toContain('monitoring_platform');
  });

  it('SELECT includes monitoring_url', () => {
    expect(src).toContain('monitoring_url');
  });

  it('aliases monitoring fields to camelCase', () => {
    expect(src).toContain('"monitoringPlatform"');
    expect(src).toContain('"monitoringUrl"');
  });
});
