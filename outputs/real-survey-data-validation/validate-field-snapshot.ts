import { buildSurveyEvidenceManifest } from '../../Solarpro/lib/survey/evidence/manifest';
import { buildSurveyEvidenceEngineeringBridge, summarizeSurveyEvidenceEngineeringBridge } from '../../Solarpro/lib/survey/evidence/engineeringBridge';
import { normalizeSurveyEvidenceCategory, inferSurveyEvidenceCategoryFromText } from '../../Solarpro/lib/survey/evidence/categoryRegistry';

type SnapshotSurvey = {
  id: string;
  name: string;
  surveyData: Record<string, unknown> | null;
  files: Array<{ label: string | null; fileUrl: string; filename?: string | null; createdAt?: string }>;
};

const realSurveys: SnapshotSurvey[] = [
  {
    id: 'e3ac0230-9b62-427d-9b47-553966563e27',
    name: 'Ray — Roof Mount',
    surveyData: { source: 'partner_db_audit.md', address: 'Rays boots', type: 'roof_mount', photos: [] },
    files: [
      { label: null, fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776999431599-9odngge2pzb.jpg', filename: '1776999431599-9odngge2pzb.jpg' },
      { label: null, fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776999431589-9q0ziqy7uf4.jpg', filename: '1776999431589-9q0ziqy7uf4.jpg' },
    ],
  },
  {
    id: '8172ffe1-261c-4e8d-beef-7c708faed69d',
    name: 'Josh — Commercial 3-Phase Solar',
    surveyData: { source: 'partner_db_audit.md', address: '1027 darkroom', type: 'commercial_3_phase_solar', photos: [] },
    files: [
      { label: 'Got that sauce', fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776998279240-dkq2ffqwdtg.jpg', filename: '1776998279240-dkq2ffqwdtg.jpg' },
      { label: null, fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776998279236-twq9115dud.jpg', filename: '1776998279236-twq9115dud.jpg' },
    ],
  },
  {
    id: 'b367e8bd-26ce-4433-a0fe-3659433fe70f',
    name: 'Testies — Roof Mount',
    surveyData: { source: 'partner_db_audit.md', address: 'Ray giant choclate balls', type: 'roof_mount', azimuth: 180, rafter_size: '2x6', roof_material: 'Asphalt Shingle', rafter_spacing: '24in', roof_age_years: 5, photos: [] },
    files: [
      { label: 'Site Access Photo', fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776997006569-toy05beg0pl.jpg', filename: '1776997006569-toy05beg0pl.jpg' },
    ],
  },
  {
    id: 'e7f8bfda-6af2-4925-b5c3-000a36ca7df3',
    name: 'Testing — Roof Mount',
    surveyData: { source: 'partner_db_audit.md', address: '1016 franklin', type: 'roof_mount', roof_material: 'Asphalt Shingle', photos: [] },
    files: [
      { label: 'Site Access Photo', fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776978479702-llyml5myoic.jpg', filename: '1776978479702-llyml5myoic.jpg' },
    ],
  },
  {
    id: '75ce25c6-1456-4b81-89d1-ed39a9e0ea64',
    name: 'Testing 2 — Ground Mount',
    surveyData: { source: 'partner_db_audit.md', address: '1010 franklin st pocahontas', type: 'ground_mount', soil_type: 'Clay', slope_degrees: 0, trenching_path: 'The trench is going to be a bitch better call raymond', vegetation_clearing: false, photos: [] },
    files: [
      { label: null, fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776926369545-g2okj8p7fn.jpg', filename: '1776926369545-g2okj8p7fn.jpg' },
      { label: 'Overhead Line Photo', fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776926369550-w9ridr6nym.jpg', filename: '1776926369550-w9ridr6nym.jpg' },
      { label: 'Meter Photo', fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776926369554-2h1zvol2u7.jpg', filename: '1776926369554-2h1zvol2u7.jpg' },
    ],
  },
  {
    id: '8e1c1e0e-e377-4f1b-b732-3b90a6f4c0bd',
    name: 'Teating first upload 1 — Electrical',
    surveyData: { source: 'partner_db_audit.md', address: '1016 franklin st pocahontas il', type: 'electrical', photos: [] },
    files: [
      { label: null, fileUrl: 'https://site-survey-api-bpyz.onrender.com/uploads/1776925935206-d6ilez762np.jpg', filename: '1776925935206-d6ilez762np.jpg' },
    ],
  },
  { id: 'no-photo-1', name: 'Hdhdhfff — Roof Mount', surveyData: { source: 'partner_db_audit.md', type: 'roof_mount' }, files: [] },
  { id: 'no-photo-2', name: 'Bdbdhfjf — Roof Mount', surveyData: { source: 'partner_db_audit.md', type: 'roof_mount' }, files: [] },
  { id: 'no-photo-3', name: 'Bbhh — Roof Mount', surveyData: { source: 'partner_db_audit.md', type: 'roof_mount' }, files: [] },
];

const aliasChecks = ['utility_meter', 'site_exterior', 'attic_rafter', 'roof_obstruction', 'grounding_bonding', 'Meter Photo', 'Overhead Line Photo', 'Site Access Photo', 'Got that sauce'];

const results = realSurveys.map((record) => {
  const files = record.files.map((file, index) => ({
    id: `${record.id}-file-${index + 1}`,
    surveyId: record.id,
    fileUrl: file.fileUrl,
    fileType: 'photo' as const,
    label: file.label,
    filename: file.filename ?? null,
    mimeType: 'image/jpeg',
    createdAt: file.createdAt ?? '2026-04-24T00:00:00.000Z',
  }));
  const manifest = buildSurveyEvidenceManifest({
    survey: {
      id: record.id,
      projectId: `real-snapshot-${record.id}`,
      inspectorName: 'James',
      surveyData: record.surveyData,
    },
    files,
    generatedAt: '2026-04-24T12:00:00.000Z',
  });
  const bridge = buildSurveyEvidenceEngineeringBridge(manifest);
  const bridgeCounts = summarizeSurveyEvidenceEngineeringBridge(bridge);
  return {
    id: record.id,
    name: record.name,
    inputLabels: record.files.map(f => f.label ?? 'unlabeled'),
    itemCount: manifest.summary.totalItems,
    categories: manifest.items.map(item => item.category),
    uncategorizedCount: manifest.items.filter(item => item.category === 'uncategorized').length,
    missingRequired: manifest.summary.missingRequiredCategories,
    warningCount: manifest.warnings.length,
    warnings: manifest.warnings,
    completeness: manifest.summary.completeness,
    lifecycleState: manifest.lifecycleState,
    qualityStatus: manifest.qualityStatus,
    duplicateStatus: manifest.duplicateStatus,
    aiExtractionStatus: manifest.aiExtractionStatus,
    bridgeReadiness: bridge.readiness,
    bridgeCounts,
    cadAutomationStatus: bridge.cadAutomationStatus,
  };
});

const aggregate = {
  realSnapshotSource: 'partner_db_audit.md prior live pull from site_survey_app Render PostgreSQL',
  liveDbAccessibleInSandbox: false,
  photoBytesReachableAtAuditUrls: false,
  surveyCount: results.length,
  fileCount: results.reduce((sum, r) => sum + r.itemCount, 0),
  categoryCounts: results.flatMap(r => r.categories).reduce<Record<string, number>>((acc, category) => {
    acc[category] = (acc[category] ?? 0) + 1;
    return acc;
  }, {}),
  aliasChecks: aliasChecks.map(value => ({
    input: value,
    normalizeDirect: normalizeSurveyEvidenceCategory(value),
    inferFromText: inferSurveyEvidenceCategoryFromText(value),
  })),
  results,
};

console.log(JSON.stringify(aggregate, null, 2));
