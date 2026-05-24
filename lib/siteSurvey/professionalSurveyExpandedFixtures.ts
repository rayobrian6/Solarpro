import type { RawSurveyPayload } from './types';

export type ProfessionalExpandedFixtureId =
  | 'clean_roof'
  | 'missing_roof_pitch'
  | 'missing_azimuth'
  | 'duplicate_roof_planes'
  | 'bad_self_intersecting_polygon'
  | 'obstruction_only_survey'
  | 'ground_mount_survey'
  | 'solar_fence_survey'
  | 'conflicting_panel_count'
  | 'wrong_mixed_units'
  | 'incomplete_electrical_service'
  | 'meter_location_present_msp_missing'
  | 'msp_present_utility_missing'
  | 'roof_geometry_no_usable_cad_preview'
  | 'document_derived_partial_evidence'
  | 'geometry_ready_without_cad_preview';

export interface ProfessionalExpandedSurveyFixture {
  id: ProfessionalExpandedFixtureId;
  description: string;
  raw: RawSurveyPayload;
  expected: {
    parserReadiness: 'cad_ready' | 'review_required' | 'blocked';
    reportReadiness?: 'blocked' | 'review_required' | 'geometry_ready' | 'cad_preview_ready';
    canonicalGeometryReady: boolean;
    cadPreviewBuilt: boolean;
    normalizedOnly?: boolean;
    expectedBlockingIncludes?: string[];
    expectedMissingIncludes?: string[];
    expectedWarningIncludes?: string[];
    expectedConfidenceGapIncludes?: string[];
  };
}

const cleanRoofBase: RawSurveyPayload = {
  id: 'expanded-clean-roof-001',
  projectId: 'expanded-project-001',
  location: {
    lat: 34.05,
    lng: -118.24,
    elevation: 300,
    address: '123 Expanded Fixture Way, Los Angeles, CA',
  },
  systemType: 'roof',
  geometry: {
    roofPlanes: [
      {
        id: 'roof-plane-a',
        pitch: 22,
        azimuth: 180,
        area: 850,
        vertices: rectangle(34.05, -118.24, 0.00022, 0.00042),
      },
    ],
    obstructions: [],
    setbacks: [
      { edges: ['eave', 'rake'], distanceIn: 36 },
      { edges: ['ridge'], distanceIn: 18 },
    ],
    usableAreaSqFt: 620,
  },
  structural: {
    rafterSpacingIn: 24,
    rafterSize: '2x6',
    deckingThicknessIn: 0.5,
    windExposure: 'C',
    snowLoadPsf: 0,
    roofCondition: 'good',
    roofAgeYears: 7,
    atticAccess: true,
    roofMaterial: 'composition_shingle',
    roofPitch: '5/12',
    stories: '1',
    structureType: 'single_family',
  },
  electrical: {
    mainPanelRatingAmps: 200,
    busbarRatingAmps: 200,
    breakerSpacesAvailable: '5+',
    serviceEntrance: 'overhead',
    meterType: 'standard',
    interconnectionPoint: 'main_panel',
    panelBrand: 'siemens',
    hasSubPanel: false,
  },
  photos: [
    { slotKey: 'roof_overview', url: 'https://cdn.example.test/expanded/roof.jpg', category: 'roof' },
    { slotKey: 'main_panel_open', url: 'https://cdn.example.test/expanded/panel.jpg', category: 'panel' },
    { slotKey: 'meter', url: 'https://cdn.example.test/expanded/meter.jpg', category: 'meter' },
  ],
  installerNotes: 'Expanded fixture base clean roof capture.',
  inspectorName: 'Expanded Fixture Technician',
  surveyedAt: '2026-05-20T10:00:00Z',
};

export const professionalExpandedSurveyFixtures: ProfessionalExpandedSurveyFixture[] = [
  {
    id: 'clean_roof',
    description: 'Clean roof survey with complete geometry and electrical evidence.',
    raw: withId('expanded-clean-roof-001', cleanRoofBase),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'missing_roof_pitch',
    description: 'Roof plane pitch missing from geometry; normalization defaults pitch and preserves review-safe deterministic output.',
    raw: patch('expanded-missing-roof-pitch-001', {
      geometry: {
        ...cleanRoofBase.geometry,
        roofPlanes: [{ ...cleanRoofBase.geometry?.roofPlanes?.[0], id: 'missing-pitch-plane', pitch: undefined }],
      },
      structural: { ...cleanRoofBase.structural, roofPitch: undefined },
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'missing_azimuth',
    description: 'Roof plane azimuth missing; normalization defaults south-facing azimuth instead of blocking.',
    raw: patch('expanded-missing-azimuth-001', {
      geometry: {
        ...cleanRoofBase.geometry,
        roofPlanes: [{ ...cleanRoofBase.geometry?.roofPlanes?.[0], id: 'missing-azimuth-plane', azimuth: undefined }],
      },
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'duplicate_roof_planes',
    description: 'Two duplicate roof planes are retained as review-visible candidate geometry without de-duplication authority.',
    raw: patch('expanded-duplicate-roof-planes-001', {
      geometry: {
        ...cleanRoofBase.geometry,
        roofPlanes: [
          { ...cleanRoofBase.geometry?.roofPlanes?.[0], id: 'duplicate-plane-a' },
          { ...cleanRoofBase.geometry?.roofPlanes?.[0], id: 'duplicate-plane-b' },
        ],
      },
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'bad_self_intersecting_polygon',
    description: 'Bow-tie roof polygon must block before CAD preview.',
    raw: patch('expanded-bowtie-001', {
      geometry: {
        ...cleanRoofBase.geometry,
        roofPlanes: [
          {
            id: 'bowtie-plane',
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 34.0500, lng: -118.2400 },
              { lat: 34.0502, lng: -118.2404 },
              { lat: 34.0502, lng: -118.2400 },
              { lat: 34.0500, lng: -118.2404 },
            ],
          },
        ],
      },
    }),
    expected: {
      parserReadiness: 'blocked',
      reportReadiness: 'blocked',
      canonicalGeometryReady: false,
      cadPreviewBuilt: false,
      expectedBlockingIncludes: ['self-intersects'],
    },
  },
  {
    id: 'obstruction_only_survey',
    description: 'Roof survey with obstruction evidence but no roof plane must block geometry readiness.',
    raw: patch('expanded-obstruction-only-001', {
      geometry: {
        roofPlanes: [],
        obstructions: [
          {
            id: 'chimney-only',
            type: 'chimney',
            position: { lat: 34.0501, lng: -118.2401 },
            dimensions: { widthFt: 3, lengthFt: 4, heightFt: 5 },
            setbackFt: 3,
          },
        ],
        setbacks: [],
        usableAreaSqFt: null,
      },
    }),
    expected: {
      parserReadiness: 'blocked',
      reportReadiness: 'blocked',
      canonicalGeometryReady: false,
      cadPreviewBuilt: false,
      expectedMissingIncludes: ['geometry.roofPlanes'],
      expectedBlockingIncludes: ['Roof surveys require at least one roof plane'],
    },
  },
  {
    id: 'ground_mount_survey',
    description: 'Ground mount survey should not require roof planes and may build a ground preview.',
    raw: patch('expanded-ground-001', {
      systemType: 'ground',
      geometry: { roofPlanes: [], obstructions: [], setbacks: [], usableAreaSqFt: 1600 },
      structural: { ...cleanRoofBase.structural, roofPitch: '15', roofMaterial: null },
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'solar_fence_survey',
    description: 'Solar fence survey should not require roof planes and may build a fence preview system type.',
    raw: patch('expanded-fence-001', {
      systemType: 'fence',
      geometry: { roofPlanes: [], obstructions: [], setbacks: [], usableAreaSqFt: 800 },
      structural: { ...cleanRoofBase.structural, roofPitch: null, roofMaterial: null },
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'conflicting_panel_count',
    description: 'Installer note conflicts with usable area estimate; parser should remain deterministic and review-safe.',
    raw: patch('expanded-conflicting-panel-count-001', {
      geometry: { ...cleanRoofBase.geometry, usableAreaSqFt: 40 },
      installerNotes: 'Field app says 40 usable sqft but installer note claims 38 modules will fit.',
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'wrong_mixed_units',
    description: 'Wrong/mixed unit strings are normalized where supported and defaulted where not supported.',
    raw: patch('expanded-wrong-mixed-units-001', {
      geometry: {
        ...cleanRoofBase.geometry,
        roofPlanes: [{ ...cleanRoofBase.geometry?.roofPlanes?.[0], id: 'mixed-units-plane', area: '850 sq ft' as unknown as number }],
      },
      structural: {
        ...cleanRoofBase.structural,
        rafterSpacingIn: '24in',
        deckingThicknessIn: '1/2"',
        roofPitch: '5:12',
      },
      electrical: { ...cleanRoofBase.electrical, mainPanelRatingAmps: '200A' as unknown as number },
    }),
    expected: {
      parserReadiness: 'blocked',
      reportReadiness: 'blocked',
      canonicalGeometryReady: false,
      cadPreviewBuilt: false,
      expectedBlockingIncludes: ['Roof plane area must be positive'],
    },
  },
  {
    id: 'incomplete_electrical_service',
    description: 'Geometry is usable but electrical service evidence is incomplete, so readiness must not promote to cad_preview_ready.',
    raw: patch('expanded-incomplete-electrical-001', {
      electrical: { mainPanelRatingAmps: null, busbarRatingAmps: null, interconnectionPoint: 'unknown', panelBrand: 'unknown' },
    }),
    expected: {
      parserReadiness: 'review_required',
      reportReadiness: 'review_required',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
      expectedMissingIncludes: ['electrical.mainPanelRatingAmps', 'electrical.interconnectionPoint'],
      expectedConfidenceGapIncludes: ['mainPanelRatingAmps', 'interconnectionPoint'],
    },
  },
  {
    id: 'meter_location_present_msp_missing',
    description: 'Meter evidence/photo exists but main service panel rating is missing.',
    raw: patch('expanded-meter-present-msp-missing-001', {
      electrical: { ...cleanRoofBase.electrical, mainPanelRatingAmps: null },
      photos: [{ slotKey: 'meter', url: 'https://cdn.example.test/expanded/meter-only.jpg', category: 'meter' }],
    }),
    expected: {
      parserReadiness: 'review_required',
      reportReadiness: 'review_required',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
      expectedMissingIncludes: ['electrical.mainPanelRatingAmps'],
      expectedConfidenceGapIncludes: ['mainPanelRatingAmps'],
    },
  },
  {
    id: 'msp_present_utility_missing',
    description: 'MSP rating is present while utility/service detail is sparse; current readiness can still build preview because utility name is not a required parser field.',
    raw: patch('expanded-msp-present-utility-missing-001', {
      electrical: { ...cleanRoofBase.electrical, serviceEntrance: 'unknown', meterType: 'unknown' },
      installerNotes: 'Utility provider not captured in field app.',
    }),
    expected: {
      parserReadiness: 'cad_ready',
      reportReadiness: 'cad_preview_ready',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
    },
  },
  {
    id: 'roof_geometry_no_usable_cad_preview',
    description: 'Roof geometry area is too small to be usable and must block before CAD preview.',
    raw: patch('expanded-no-usable-cad-preview-001', {
      geometry: {
        ...cleanRoofBase.geometry,
        roofPlanes: [{ ...cleanRoofBase.geometry?.roofPlanes?.[0], id: 'tiny-plane', area: 0 }],
        usableAreaSqFt: null,
      },
    }),
    expected: {
      parserReadiness: 'blocked',
      reportReadiness: 'blocked',
      canonicalGeometryReady: false,
      cadPreviewBuilt: false,
      expectedBlockingIncludes: ['Roof plane area must be positive'],
    },
  },
  {
    id: 'document_derived_partial_evidence',
    description: 'Uploaded/document-derived partial evidence has photos/docs and roof geometry, but no electrical facts.',
    raw: patch('expanded-document-partial-001', {
      electrical: {},
      photos: [
        { slotKey: 'uploaded_roof_pdf_page_1', url: 'https://cdn.example.test/expanded/roof-page-1.png', category: 'roof', notes: 'Document-derived roof outline candidate.' },
        { slotKey: 'uploaded_site_doc', url: 'https://cdn.example.test/expanded/site.pdf', category: 'other', notes: 'Uploaded document source.' },
      ],
      installerNotes: 'Document-derived partial evidence; electrical fields unavailable.',
    }),
    expected: {
      parserReadiness: 'review_required',
      reportReadiness: 'review_required',
      canonicalGeometryReady: true,
      cadPreviewBuilt: true,
      expectedMissingIncludes: ['electrical.mainPanelRatingAmps', 'electrical.interconnectionPoint'],
      expectedConfidenceGapIncludes: ['mainPanelRatingAmps', 'interconnectionPoint'],
    },
  },
  {
    id: 'geometry_ready_without_cad_preview',
    description: 'Normalized-only fixture has enough canonical roof geometry but cannot build CAD preview without enrichment.',
    raw: withId('expanded-geometry-ready-no-cad-preview-001', cleanRoofBase),
    expected: {
      parserReadiness: 'review_required',
      canonicalGeometryReady: true,
      cadPreviewBuilt: false,
      normalizedOnly: true,
      expectedMissingIncludes: ['derived.cadRoofSurfaces/enrichment'],
    },
  },
];

function rectangle(lat: number, lng: number, latDelta: number, lngDelta: number) {
  return [
    { lat, lng },
    { lat: lat + latDelta, lng },
    { lat: lat + latDelta, lng: lng - lngDelta },
    { lat, lng: lng - lngDelta },
  ];
}

function withId(id: string, raw: RawSurveyPayload): RawSurveyPayload {
  return {
    ...raw,
    id,
    location: { ...raw.location },
    geometry: raw.geometry ? {
      ...raw.geometry,
      roofPlanes: raw.geometry.roofPlanes?.map(plane => ({ ...plane, vertices: plane.vertices?.map(vertex => ({ ...vertex })) })) ?? [],
      obstructions: raw.geometry.obstructions?.map(obstruction => ({ ...obstruction })) ?? [],
      setbacks: raw.geometry.setbacks?.map(setback => ({ ...setback, edges: setback.edges ? [...setback.edges] : [] })) ?? [],
    } : null,
    structural: raw.structural ? { ...raw.structural } : undefined,
    electrical: raw.electrical ? { ...raw.electrical } : undefined,
    photos: raw.photos?.map(photo => ({ ...photo })) ?? [],
  };
}

function patch(id: string, overrides: Partial<RawSurveyPayload>): RawSurveyPayload {
  return {
    ...withId(id, cleanRoofBase),
    ...overrides,
    id,
    location: overrides.location ? { ...overrides.location } : { ...cleanRoofBase.location },
    geometry: overrides.geometry === null
      ? null
      : overrides.geometry
        ? { ...overrides.geometry }
        : withId(id, cleanRoofBase).geometry,
    structural: overrides.structural ? { ...overrides.structural } : { ...cleanRoofBase.structural },
    electrical: overrides.electrical ? { ...overrides.electrical } : { ...cleanRoofBase.electrical },
    photos: overrides.photos ? overrides.photos.map(photo => ({ ...photo })) : cleanRoofBase.photos?.map(photo => ({ ...photo })),
  };
}
