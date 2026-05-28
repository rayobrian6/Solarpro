/**
 * tests/unifiedArtifactStore-column-guard.test.ts
 *
 * Tests for the Migration 081 column existence guard in unifiedArtifactStore.
 *
 * These tests verify that:
 *   1. When the table exists + obstruction_metadata column exists → full data returned
 *   2. When the table exists + obstruction_metadata column missing → data returned with obstructionMetadata=null
 *   3. When the table doesn't exist → empty array returned (no error thrown)
 *
 * The key invariant: routes must NEVER silently return empty arrays due to a
 * missing column when the table has data. The column guard ensures the SELECT
 * adapts to the actual schema state.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock setup ──────────────────────────────────────────────────────────────

const mockSql = vi.fn();
const mockGetDbReady = vi.fn(() => mockSql);

vi.mock('@/lib/db/core', () => ({
  getDbReady: mockGetDbReady,
}));

// Re-import for each test so module-level cache is fresh
async function importStore() {
  const mod = await import('@/lib/siteSurveys/unifiedGeometry/unifiedArtifactStore');
  return mod;
}

// ── Fixture data ────────────────────────────────────────────────────────────

const SURVEY_ID = 'survey-1234';
const ARTIFACT_ID = 'art-001';

/**
 * A base row that would come from Migration 079b (no obstruction_metadata).
 */
const BASE_ROW = {
  id: ARTIFACT_ID,
  survey_id: SURVEY_ID,
  geometry_class: 'plane',
  authority_state: 'raw_evidence',
  authority: {
    state: 'raw_evidence',
    reviewOnly: false,
    nonAuthoritative: false,
    cadMutationAllowed: false,
    permitGenerationAllowed: false,
    bomMutationAllowed: false,
    canonicalMutationAllowed: false,
    engineeringWorkflowMutationAllowed: false,
    mockArtifact: false,
    cadConsumable: false,
  },
  provenance: {
    sourcePipeline: 'geometry_reconstruction',
    toolName: 'mockWorker',
    toolVersion: '1.0.0',
    runHash: 'hash-001',
    sourceFileIds: [],
    derivedFromArtifactIds: [],
    createdAt: '2025-01-01T00:00:00Z',
  },
  confidence: 0.85,
  label: 'test-plane',
  limitations: [],
  geometry_data: null,
  review_state: 'review_required',
  review_notes: null,
  priority: 'medium',
  mock_artifact: false,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

/**
 * A full row with obstruction_metadata (Migration 081 applied).
 */
const FULL_ROW = {
  ...BASE_ROW,
  geometry_class: 'obstruction',
  obstruction_metadata: {
    id: ARTIFACT_ID,
    sourceFilename: 'photo1.jpg',
    sourceFileId: 'file-001',
    region: { x: 100, y: 200, width: 50, height: 60, coordinateSystem: 'normalized_image_0_1000' },
    center: { x: 125, y: 230, coordinateSystem: 'normalized_image_0_1000' },
    areaNormalized: 0.03,
    aspectRatio: 1.2,
    sizeBucket: 'small',
    orientationHint: null,
    edgeDistance: 0.1,
    edgeProximity: 'near',
    quadrant: 'TL',
    setbackBuffer: 0.05,
    confidence: 75,
    detectionMethod: 'heuristic',
    limitations: [],
    sourcePhotoUrl: null,
    sourceImageSha256: null,
    regionIndex: 0,
    reviewState: 'review_required',
    obstructionType: 'chimney',
    priority: 'medium',
    cadBlockHint: null,
    obstructionFootprintHint: null,
    clearanceRadiusHint: null,
    setbackCategoryHint: null,
    layoutAvoidancePriority: 'medium',
    requiresHumanReview: false,
    canAffectPanelPlacement: true,
    canAffectFirePathway: false,
    canAffectConduitPath: false,
    canAffectStructuralAttachment: false,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Configure the mock SQL to simulate different DB schema states.
 *
 * @param state - 'table-missing' | 'table-only' | 'table-with-column'
 * @param rows - Optional rows to return from the data query
 */
function mockSchemaState(
  state: 'table-missing' | 'table-only' | 'table-with-column',
  rows: Record<string, unknown>[] = [],
) {
  mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
    const q = strings.join(' ').replace(/\s+/g, ' ').trim();

    // Table existence check
    if (q.includes('information_schema.tables') && q.includes('unified_geometry_artifacts')) {
      if (state === 'table-missing') return [];
      return [{ '?column?': 1 }]; // table exists
    }

    // Column existence check
    if (q.includes('information_schema.columns') && q.includes('obstruction_metadata')) {
      if (state === 'table-with-column') return [{ '?column?': 1 }];
      return []; // column missing
    }

    // Data query (SELECT FROM unified_geometry_artifacts)
    if (q.includes('FROM unified_geometry_artifacts')) {
      return rows;
    }

    return [];
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('unifiedArtifactStore — migration drift column guard', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSql.mockReset();
    mockGetDbReady.mockReset();
    mockGetDbReady.mockReturnValue(mockSql);
  });

  // ── getUnifiedArtifactsForSurvey ────────────────────────────────────────

  describe('getUnifiedArtifactsForSurvey', () => {
    it('returns empty array when table does not exist', async () => {
      mockSchemaState('table-missing');

      const { getUnifiedArtifactsForSurvey } = await importStore();
      const result = await getUnifiedArtifactsForSurvey(SURVEY_ID);

      expect(result).toEqual([]);
      // Should have made the table check but NOT a data query
      expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it('returns artifacts with obstructionMetadata=null when table exists but obstruction_metadata column is missing', async () => {
      mockSchemaState('table-only', [BASE_ROW]);

      const { getUnifiedArtifactsForSurvey, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache(); // ensure fresh check

      const result = await getUnifiedArtifactsForSurvey(SURVEY_ID);

      // Should get data back — NOT an empty array from a failed query
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ARTIFACT_ID);
      expect(result[0].obstructionMetadata).toBeNull();
      expect(result[0].geometryClass).toBe('plane');

      // Verify queries: table check + column check + data query
      expect(mockSql).toHaveBeenCalled();
    });

    it('returns artifacts with obstructionMetadata populated when table and column both exist', async () => {
      mockSchemaState('table-with-column', [FULL_ROW]);

      const { getUnifiedArtifactsForSurvey, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache(); // ensure fresh check

      const result = await getUnifiedArtifactsForSurvey(SURVEY_ID);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ARTIFACT_ID);
      expect(result[0].obstructionMetadata).not.toBeNull();
      expect(result[0].obstructionMetadata?.obstructionType).toBe('chimney');
      expect(result[0].geometryClass).toBe('obstruction');
    });

    it('does not include obstruction_metadata in SELECT when column is missing', async () => {
      const queries: string[] = [];
      mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join(' ').replace(/\s+/g, ' ').trim();
        queries.push(q);

        if (q.includes('information_schema.tables')) return [{ '?column?': 1 }];
        if (q.includes('information_schema.columns')) return []; // column missing
        if (q.includes('FROM unified_geometry_artifacts')) return [BASE_ROW];
        return [];
      });

      const { getUnifiedArtifactsForSurvey, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache();

      await getUnifiedArtifactsForSurvey(SURVEY_ID);

      // Find the data query
      const dataQuery = queries.find(q => q.includes('FROM unified_geometry_artifacts'));
      expect(dataQuery).toBeDefined();
      expect(dataQuery).not.toContain('obstruction_metadata');
    });

    it('includes obstruction_metadata in SELECT when column exists', async () => {
      const queries: string[] = [];
      mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join(' ').replace(/\s+/g, ' ').trim();
        queries.push(q);

        if (q.includes('information_schema.tables')) return [{ '?column?': 1 }];
        if (q.includes('information_schema.columns')) return [{ '?column?': 1 }]; // column exists
        if (q.includes('FROM unified_geometry_artifacts')) return [FULL_ROW];
        return [];
      });

      const { getUnifiedArtifactsForSurvey, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache();

      await getUnifiedArtifactsForSurvey(SURVEY_ID);

      const dataQuery = queries.find(q => q.includes('FROM unified_geometry_artifacts'));
      expect(dataQuery).toBeDefined();
      expect(dataQuery).toContain('obstruction_metadata');
    });
  });

  // ── getUnifiedArtifactsByIds ────────────────────────────────────────────

  describe('getUnifiedArtifactsByIds', () => {
    it('returns empty array when table does not exist', async () => {
      mockSchemaState('table-missing');

      const { getUnifiedArtifactsByIds } = await importStore();
      const result = await getUnifiedArtifactsByIds([ARTIFACT_ID]);

      expect(result).toEqual([]);
    });

    it('returns empty array for empty input', async () => {
      const { getUnifiedArtifactsByIds } = await importStore();
      const result = await getUnifiedArtifactsByIds([]);

      expect(result).toEqual([]);
      expect(mockSql).not.toHaveBeenCalled();
    });

    it('returns artifacts with obstructionMetadata=null when column is missing', async () => {
      mockSchemaState('table-only', [BASE_ROW]);

      const { getUnifiedArtifactsByIds, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache();

      const result = await getUnifiedArtifactsByIds([ARTIFACT_ID]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(ARTIFACT_ID);
      expect(result[0].obstructionMetadata).toBeNull();
    });

    it('returns artifacts with obstructionMetadata populated when column exists', async () => {
      mockSchemaState('table-with-column', [FULL_ROW]);

      const { getUnifiedArtifactsByIds, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache();

      const result = await getUnifiedArtifactsByIds([ARTIFACT_ID]);

      expect(result).toHaveLength(1);
      expect(result[0].obstructionMetadata).not.toBeNull();
      expect(result[0].obstructionMetadata?.obstructionType).toBe('chimney');
    });
  });

  // ── Column cache behavior ──────────────────────────────────────────────

  describe('_resetObstructionMetadataColumnCache', () => {
    it('allows column check to be re-evaluated after reset', async () => {
      // First call: column missing
      let callCount = 0;
      mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join(' ').replace(/\s+/g, ' ').trim();
        callCount++;

        if (q.includes('information_schema.tables')) return [{ '?column?': 1 }];
        if (q.includes('information_schema.columns')) {
          // Column doesn't exist on first check
          return [];
        }
        if (q.includes('FROM unified_geometry_artifacts')) return [BASE_ROW];
        return [];
      });

      const { getUnifiedArtifactsForSurvey, _resetObstructionMetadataColumnCache } = await importStore();

      // First call — column missing
      const result1 = await getUnifiedArtifactsForSurvey(SURVEY_ID);
      expect(result1).toHaveLength(1);
      expect(result1[0].obstructionMetadata).toBeNull();

      // Reset cache
      _resetObstructionMetadataColumnCache();

      // Now simulate column being added
      mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
        const q = strings.join(' ').replace(/\s+/g, ' ').trim();

        if (q.includes('information_schema.tables')) return [{ '?column?': 1 }];
        if (q.includes('information_schema.columns')) return [{ '?column?': 1 }]; // column now exists
        if (q.includes('FROM unified_geometry_artifacts')) return [FULL_ROW];
        return [];
      });

      const result2 = await getUnifiedArtifactsForSurvey(SURVEY_ID);
      expect(result2).toHaveLength(1);
      expect(result2[0].obstructionMetadata).not.toBeNull();
    });
  });

  // ── Geometry_data path with embedded obstructionMetadata ───────────────

  describe('geometry_data path — obstructionMetadata from embedded JSON', () => {
    it('extracts obstructionMetadata from geometry_data when column is missing', async () => {
      // Row WITHOUT obstruction_metadata column, but WITH geometry_data
      // that has obstructionMetadata embedded inside it
      const rowWithEmbeddedObs = {
        ...BASE_ROW,
        geometry_data: {
          ...FULL_ROW,
          obstructionMetadata: FULL_ROW.obstruction_metadata,
        },
      };

      mockSchemaState('table-only', [rowWithEmbeddedObs]);

      const { getUnifiedArtifactsForSurvey, _resetObstructionMetadataColumnCache } = await importStore();
      _resetObstructionMetadataColumnCache();

      const result = await getUnifiedArtifactsForSurvey(SURVEY_ID);

      expect(result).toHaveLength(1);
      // obstructionMetadata comes from geometry_data JSON, not the column
      expect(result[0].obstructionMetadata).not.toBeNull();
      expect(result[0].obstructionMetadata?.obstructionType).toBe('chimney');
    });
  });
});
