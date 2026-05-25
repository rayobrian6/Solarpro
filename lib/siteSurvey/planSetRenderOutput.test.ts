import { describe, expect, it } from "vitest";

import type { SiteSurvey, SiteSurveyFile } from "@/lib/db/surveys";
import { buildProfessionalSurveyReadinessReport } from "./professionalSurveyReadinessReport";
import { buildProfessionalPlanSetRenderPackage } from "./planSetRenderOutput";
import { buildEvidenceDerivedCadReconstruction } from "./evidenceDerivedCadReconstruction";
import { buildSystemDefinition } from "../system/systemDefinition";
import type { SourceOfTruthDesignHandoffV1 } from "./sourceOfTruthCadRender";
import {
  professionalExpandedSurveyFixtures,
  type ProfessionalExpandedSurveyFixture,
} from "./professionalSurveyExpandedFixtures";

function survey(overrides: Partial<SiteSurvey> = {}): SiteSurvey {
  return {
    id: "plan-render-001",
    clientId: "client-001",
    projectId: "project-plan-001",
    createdBy: "user-001",
    createdAt: "2026-05-01T10:00:00Z",
    updatedAt: "2026-05-01T11:00:00Z",
    status: "completed",
    source: "standalone",
    addressSnapshot: "123 Plan Render Way, Las Vegas, NV",
    surveyData: {
      schemaVersion: "2.0",
      systemType: "roof",
      location: { lat: 36.17, lng: -115.14, address: "123 Plan Render Way" },
      geometry: {
        roofPlanes: [
          {
            id: "roof-a",
            pitch: 22,
            azimuth: 180,
            area: 850,
            vertices: [
              { lat: 36.17, lng: -115.14 },
              { lat: 36.1702, lng: -115.14 },
              { lat: 36.1702, lng: -115.1404 },
              { lat: 36.17, lng: -115.1404 },
            ],
          },
        ],
        obstructions: [],
        setbacks: [{ edges: ["eave", "rake"], distanceIn: 36 }],
        usableAreaSqFt: 620,
      },
      structural: {
        rafterSpacingIn: 24,
        rafterSize: "2x6",
        deckingThicknessIn: 0.5,
        windExposure: "C",
        roofCondition: "good",
        roofAgeYears: 8,
        atticAccess: true,
        roofMaterial: "composition_shingle",
        roofPitch: "5/12",
      },
      electrical: {
        mainPanelRatingAmps: 200,
        busbarRatingAmps: 200,
        breakerSpacesAvailable: "5+",
        serviceEntrance: "overhead",
        meterType: "standard",
        interconnectionPoint: "main_panel",
        panelBrand: "siemens",
        hasSubPanel: false,
      },
    },
    inspectorName: "Plan Render Tech",
    notes: "Professional plan-set render fixture.",
    externalSurveyId: "external-plan-001",
    deliveryId: "delivery-plan-001",
    ...overrides,
  };
}

function expandedSurvey(
  fixture: ProfessionalExpandedSurveyFixture,
): SiteSurvey {
  return {
    id: `plan-${fixture.id}`,
    clientId: "fixture-client-001",
    projectId: fixture.raw.projectId ?? `project-${fixture.id}`,
    createdBy: "fixture-user-001",
    createdAt: "2026-05-20T10:00:00Z",
    updatedAt: "2026-05-20T10:00:00Z",
    status: "completed",
    source: "standalone",
    addressSnapshot: fixture.raw.location?.address ?? null,
    surveyData: fixture.raw as unknown as Record<string, unknown>,
    inspectorName: fixture.raw.inspectorName ?? null,
    notes: fixture.raw.installerNotes ?? null,
    externalSurveyId: fixture.raw.id ?? fixture.id,
    deliveryId: null,
  };
}

function expandedFiles(id: string): SiteSurveyFile[] {
  return [
    {
      id: `${id}-mount`,
      surveyId: `plan-${id}`,
      fileUrl: "https://cdn.example.test/mount.jpg",
      fileType: "photo",
      label: "mount overview",
      filename: "mount.jpg",
      mimeType: "image/jpeg",
      createdAt: "2026-05-20T10:05:00Z",
    },
    {
      id: `${id}-panel`,
      surveyId: `plan-${id}`,
      fileUrl: "https://cdn.example.test/main_panel.jpg",
      fileType: "photo",
      label: "main panel",
      filename: "main_panel.jpg",
      mimeType: "image/jpeg",
      createdAt: "2026-05-20T10:06:00Z",
    },
    {
      id: `${id}-meter`,
      surveyId: `plan-${id}`,
      fileUrl: "https://cdn.example.test/meter.jpg",
      fileType: "photo",
      label: "meter",
      filename: "meter.jpg",
      mimeType: "image/jpeg",
      createdAt: "2026-05-20T10:07:00Z",
    },
  ];
}

function designHandoff(totalPanels = 12): SourceOfTruthDesignHandoffV1 {
  const systemDefinition = buildSystemDefinition({
    project: {
      systemType: "roof",
      roofPitch: 22,
      panelWidthIn: 41,
      panelLengthIn: 67,
      mainPanelAmps: 200,
    },
    system: {
      totalPanels,
      topology: "micro",
      totalDcKw: totalPanels * 0.4,
      inverters: [
        {
          manufacturer: "Enphase",
          model: "IQ8M",
          type: "micro",
          acOutputKw: 0.325,
          strings: [
            {
              panelManufacturer: "REC",
              panelModel: "Alpha Pure",
              panelWatts: 400,
              panelCount: totalPanels,
            },
          ],
        },
      ],
    },
    layout: { type: "roof" },
  });
  return {
    schemaVersion: "source_of_truth_design_handoff_v1",
    sourceReference: "design-layout-fixture-v1",
    systemDefinition,
    layout: {
      sourceReference: "layout-arrays-fixture-v1",
      totalPanels,
      arrays: [
        {
          arrayId: "ARRAY-A",
          planeId: "roof-a",
          panelCount: totalPanels,
          orientation: "portrait",
          azimuthDeg: 180,
          tiltDeg: 22,
          rowCount: 3,
          columnCount: 4,
        },
      ],
      installAreaRefs: ["roof-a"],
    },
    design3d: {
      sourceReference: "design-3d-fixture-v1",
      installPlanes: [{ planeId: "roof-a", azimuthDeg: 180, tiltDeg: 22 }],
      equipmentPlacements: [
        {
          id: "msp-design-node",
          type: "main_service_panel",
          x: 0,
          y: 0,
          confidence: 0.8,
        },
      ],
    },
    notes: ["test fixture design handoff is read-only"],
  };
}

function files(): SiteSurveyFile[] {
  return [
    {
      id: "file-roof",
      surveyId: "plan-render-001",
      fileUrl: "https://cdn.example.test/roof_overview.jpg",
      fileType: "photo",
      label: "roof overview",
      filename: "roof_overview.jpg",
      mimeType: "image/jpeg",
      createdAt: "2026-05-01T10:05:00Z",
    },
    {
      id: "file-panel",
      surveyId: "plan-render-001",
      fileUrl: "https://cdn.example.test/main_service_panel.jpg",
      fileType: "photo",
      label: "main panel",
      filename: "main_service_panel.jpg",
      mimeType: "image/jpeg",
      createdAt: "2026-05-01T10:06:00Z",
    },
    {
      id: "file-meter",
      surveyId: "plan-render-001",
      fileUrl: "https://cdn.example.test/utility_meter.jpg",
      fileType: "photo",
      label: "utility meter",
      filename: "utility_meter.jpg",
      mimeType: "image/jpeg",
      createdAt: "2026-05-01T10:07:00Z",
    },
  ];
}

describe("Professional Plan-Set Render Output V1", () => {
  it("builds deterministic professional multi-sheet SVG preview package", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const pkg = buildProfessionalPlanSetRenderPackage(report);
    const repeated = buildProfessionalPlanSetRenderPackage(report);

    expect(pkg.schemaVersion).toBe("professional_plan_set_render_package_v1");
    expect(pkg.mode).toBe("deterministic_svg_plan_set_preview_review_only");
    expect(pkg.packageHash).toBe(repeated.packageHash);
    expect(pkg.sheets.map((sheet) => sheet.sheetNumber)).toEqual([
      "A-000",
      "A-101",
      "A-201",
    ]);
    expect(pkg.sheets.map((sheet) => sheet.sheetType)).toEqual([
      "cover_summary",
      "site_plan_render",
      "evidence_review",
    ]);
    expect(pkg.summary.sheetCount).toBe(3);
    expect(pkg.htmlPreview).toContain("<!doctype html>");
    expect(pkg.htmlPreview).toContain("SolarPro Professional Plan-Set Preview");
  });

  it("maps canonical reviewed survey labels into professional photo readiness without CAD geometry mutation", () => {
    const canonicalFiles: SiteSurveyFile[] = [
      {
        id: "file-roof",
        surveyId: "plan-render-001",
        fileUrl: "https://cdn.example.test/roof_plane.jpg",
        fileType: "photo",
        label: "roof_plane",
        filename: "roof_plane.jpg",
        mimeType: "image/jpeg",
        createdAt: "2026-05-01T10:05:00Z",
      },
      {
        id: "file-panel",
        surveyId: "plan-render-001",
        fileUrl: "https://cdn.example.test/main_service_panel.jpg",
        fileType: "photo",
        label: "main_service_panel",
        filename: "main_service_panel.jpg",
        mimeType: "image/jpeg",
        createdAt: "2026-05-01T10:06:00Z",
      },
      {
        id: "file-meter",
        surveyId: "plan-render-001",
        fileUrl: "https://cdn.example.test/meter.jpg",
        fileType: "photo",
        label: "meter",
        filename: "meter.jpg",
        mimeType: "image/jpeg",
        createdAt: "2026-05-01T10:07:00Z",
      },
      {
        id: "file-site",
        surveyId: "plan-render-001",
        fileUrl: "https://cdn.example.test/overview.jpg",
        fileType: "photo",
        label: "overview",
        filename: "overview.jpg",
        mimeType: "image/jpeg",
        createdAt: "2026-05-01T10:08:00Z",
      },
    ];

    const report = buildProfessionalSurveyReadinessReport(
      survey(),
      canonicalFiles,
    );

    expect(report.photoEvidence.coverage.roofOrMountCoverage).toBe(true);
    expect(report.photoEvidence.coverage.electricalCoverage).toBe(true);
    expect(
      report.photoEvidence.coverage.categoryCounts.roof_overview,
    ).toBeGreaterThanOrEqual(1);
    expect(
      report.photoEvidence.coverage.categoryCounts.msp_electrical_panel,
    ).toBe(1);
    expect(report.photoEvidence.coverage.categoryCounts.meter).toBe(1);
    expect(report.noAuthorityEnforcement.cadSolverExecutionAllowed).toBe(false);
    expect(report.noAuthorityEnforcement.productionCADMutationAllowed).toBe(
      false,
    );
  });

  it("renders professional visual hierarchy, title blocks, legends, annotations, and preview stamps", () => {
    const pkg = buildProfessionalPlanSetRenderPackage(
      buildProfessionalSurveyReadinessReport(survey(), files()),
    );
    const sitePlan = pkg.sheets.find(
      (sheet) => sheet.sheetType === "site_plan_render",
    );

    expect(sitePlan?.svg).toContain("SolarPro Preview");
    expect(sitePlan?.svg).toContain("NON-AUTHORITATIVE PREVIEW");
    expect(sitePlan?.svg).toContain("SOURCE OF TRUTH");
    expect(sitePlan?.svg).toContain("FIRE SETBACK / ACCESS PATH PREVIEW");
    expect(sitePlan?.svg).toContain("module-layout");
    expect(sitePlan?.svg).toContain("MSP/Meter");
    expect(sitePlan?.svg).toContain("conduit candidate");
    expect(sitePlan?.svg).toContain("realistic site context");
    expect(sitePlan?.svg).toContain("PROPERTY / LOT CONTEXT PREVIEW");
    expect(sitePlan?.svg).toContain("DRIVEWAY / ACCESS");
    expect(sitePlan?.svg).toContain("PV-1 · FALLBACK PLACEHOLDER");
    expect(sitePlan?.svg).toContain("PV STRING / GROUP CALLOUT");
    expect(sitePlan?.svg).toContain("roof edge articulation");
    expect(sitePlan?.svg).toContain("roof hatch");
    expect(sitePlan?.svg).toContain("VENT / OBSTR. REF.");
    expect(sitePlan?.svg).toContain("GENERAL CONSTRUCTION NOTES");
    expect(sitePlan?.svg).toContain("EQUIPMENT SUMMARY");
    expect(sitePlan?.svg).toContain("REVISION / QA");
    expect(sitePlan?.svg).toContain("TRUE NORTH");
    expect(sitePlan?.svg).toContain("rail-attachment-symbols");
    expect(sitePlan?.layerOrder).toContain("site-context");
    expect(sitePlan?.layerOrder).toContain("property-boundary");
    expect(sitePlan?.layerOrder).toContain("module-string-groups");
    expect(sitePlan?.layerOrder).toContain("roof-outlines");
    expect(sitePlan?.layerOrder).toContain("roof-articulation");
    expect(sitePlan?.layerOrder).toContain("obstruction-symbols");
    expect(sitePlan?.layerOrder).toContain("review-callouts");
    expect(sitePlan?.annotations.join("\n")).toContain(
      "pitch/azimuth annotations",
    );
    expect(sitePlan?.annotations.join("\n")).toContain(
      "source-of-truth driven A-101",
    );
  });

  it("includes evidence/review sheet photo tiles and confidence notes for contractor usability", () => {
    const pkg = buildProfessionalPlanSetRenderPackage(
      buildProfessionalSurveyReadinessReport(survey(), files()),
    );
    const evidence = pkg.sheets.find(
      (sheet) => sheet.sheetType === "evidence_review",
    );

    expect(evidence?.svg).toContain("Photo Evidence / Review Callout Sheet");
    expect(evidence?.svg).toContain("Evidence Coverage");
    expect(evidence?.svg).toContain("roof_overview");
    expect(evidence?.svg).toContain("msp_electrical_panel");
    expect(evidence?.svg).toContain("meter");
    expect(evidence?.annotations).toContain("photo evidence tiles");
  });

  it("scores source-of-truth CAD render quality with design handoff without promoting engineering authority", () => {
    const pkg = buildProfessionalPlanSetRenderPackage(
      buildProfessionalSurveyReadinessReport(survey(), files()),
      designHandoff(12),
    );
    const checklist = pkg.summary.renderQualityChecklist;
    const sitePlan = pkg.sheets.find(
      (sheet) => sheet.sheetType === "site_plan_render",
    );

    expect(checklist.schemaVersion).toBe(
      "professional_plan_set_render_quality_checklist_v1",
    );
    expect(pkg.summary.renderQualityScore).toBe(checklist.score);
    expect(checklist.score).toBeGreaterThanOrEqual(70);
    expect(["commercial_preview", "ui_candidate"]).toContain(checklist.grade);
    expect(checklist.checks.map((check) => check.key)).toEqual([
      "survey_photo_truth_usage",
      "survey_metadata_truth_usage",
      "design_layout_truth_usage",
      "layer_provenance_completeness",
      "fallback_disclosure",
      "design_survey_reconciliation",
      "authenticity_score",
      "oss_adapter_boundaries",
      "no_authority_boundaries",
      "review_warning_visibility",
      "export_presentation_readiness",
    ]);
    expect(checklist.score).toBeLessThanOrEqual(checklist.maxScore);
    expect(checklist.noAuthorityEnforcement.stampedEngineeringPackage).toBe(
      false,
    );
    expect(sitePlan?.svg).toContain("SCALE: DIAGRAMMATIC / VERIFY IN FIELD");
    expect(sitePlan?.svg).toContain("DESIGN LAYOUT TRUTH");
    expect(sitePlan?.svg).toContain("12 MOD");
  });

  it("renders ground-mount and solar-fence fixtures with explicit fallback disclosure when design handoff is absent", () => {
    for (const id of ["ground_mount_survey", "solar_fence_survey"] as const) {
      const fixture = professionalExpandedSurveyFixtures.find(
        (item) => item.id === id,
      );
      expect(fixture).toBeDefined();
      const report = buildProfessionalSurveyReadinessReport(
        expandedSurvey(fixture!),
        expandedFiles(id),
      );
      const pkg = buildProfessionalPlanSetRenderPackage(report);
      const sitePlan = pkg.sheets.find(
        (sheet) => sheet.sheetType === "site_plan_render",
      );
      const svg = sitePlan?.svg ?? "";

      expect(svg).toContain(
        id === "ground_mount_survey"
          ? "GROUND-MOUNT FIXTURE PLAN"
          : "SOLAR-FENCE FIXTURE PLAN",
      );
      expect(svg).toContain("intentionally drafted fixture-specific preview");
      expect(svg).toContain("EVIDENCE-DERIVED CAD RECONSTRUCTION");
      expect(svg).toContain("LEGACY SYNTHETIC FALLBACK");
      expect(svg).toContain("FALLBACK PLACEHOLDER");
      expect(svg).toContain("CONTRACTOR / DEALER META");
      expect(svg).toContain("CLIENT / INSTALLER");
      expect(svg).toContain("rail-attachment-symbols");
      expect(svg).toContain("PV STRING / GROUP CALLOUT");
      expect(pkg.summary.renderQualityScore).toBeLessThan(76);
      expect(pkg.summary.renderQualityGrade).toBe("benchmark_gap");
      expect(pkg.noAuthorityEnforcement.canonicalGeometryMutationAllowed).toBe(
        false,
      );
    }
  });

  it("uses design layout handoff for A-101 panel count, orientation, provenance, and reconciliation", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const beforeReport = JSON.stringify(report);
    const handoff = designHandoff(12);
    const beforeDesign = JSON.stringify(handoff);
    const pkg = buildProfessionalPlanSetRenderPackage(report, handoff);
    const sitePlan = pkg.sheets.find(
      (sheet) => sheet.sheetType === "site_plan_render",
    );
    const svg = sitePlan?.svg ?? "";

    expect(svg).toContain("DESIGN LAYOUT TRUTH");
    expect(svg).toContain("12 MOD");
    expect(svg).toContain("SOURCE OF TRUTH");
    expect(svg).toContain("design_layout_truth");
    expect(svg).toContain("survey_photo_truth");
    expect(svg).toContain("RECONCILIATION");
    expect(svg).toContain("AUTHENTICITY");
    expect(
      pkg.summary.renderQualityChecklist.checks.find(
        (check) => check.key === "design_layout_truth_usage",
      )?.passed,
    ).toBe(true);
    expect(pkg.summary.renderQualityScore).toBeGreaterThanOrEqual(70);
    expect(JSON.stringify(report)).toBe(beforeReport);
    expect(JSON.stringify(handoff)).toBe(beforeDesign);
  });

  it("builds bounded evidence-derived reconstruction candidates without promoting CAD authority", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const beforeGeometry = JSON.stringify(report.canonicalGeometry);
    const reconstruction = buildEvidenceDerivedCadReconstruction(report);
    const repeated = buildEvidenceDerivedCadReconstruction(report);

    expect(reconstruction.schemaVersion).toBe(
      "evidence_derived_cad_reconstruction_v1",
    );
    expect(reconstruction.mode).toBe(
      "review_only_photo_aligned_spatial_candidates",
    );
    expect(reconstruction.reconstructionHash).toBe(repeated.reconstructionHash);
    expect(reconstruction.photoFrames.length).toBeGreaterThan(0);
    expect(
      reconstruction.candidates.some(
        (candidate) => candidate.layerType === "roof_edge_candidates",
      ),
    ).toBe(true);
    expect(
      reconstruction.candidates.some(
        (candidate) => candidate.layerType === "equipment_anchor_candidates",
      ),
    ).toBe(true);
    expect(reconstruction.ossAdapters.map((adapter) => adapter.name)).toEqual([
      "sharp",
      "exif-reader",
      "tesseract.js",
    ]);
    expect(
      reconstruction.ossAdapters.every(
        (adapter) => adapter.authoritative === false,
      ),
    ).toBe(true);
    expect(reconstruction.noAuthorityEnforcement).toMatchObject({
      readOnly: true,
      reviewOnly: true,
      automaticCadGenerationAllowed: false,
      automaticGeometryExtractionAuthoritative: false,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      persistenceAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBomAllowed: false,
    });
    expect(JSON.stringify(report.canonicalGeometry)).toBe(beforeGeometry);
  });

  it("renders explicit fallback labels and penalizes placeholder-only density when survey photos are missing", () => {
    const report = buildProfessionalSurveyReadinessReport(
      survey({ id: "plan-render-no-photos" }),
      [],
    );
    const pkg = buildProfessionalPlanSetRenderPackage(report);
    const sitePlan = pkg.sheets.find(
      (sheet) => sheet.sheetType === "site_plan_render",
    );
    const keys = pkg.summary.renderQualityChecklist.checks.map(
      (check) => check.key,
    );

    expect(sitePlan?.svg).toContain("EVIDENCE-DERIVED CAD RECONSTRUCTION");
    expect(sitePlan?.svg).toContain("FALLBACK:");
    expect(sitePlan?.svg).toContain("No accepted survey photos available");
    expect(keys).toContain("survey_photo_truth_usage");
    expect(pkg.summary.renderQualityScore).toBeLessThan(76);
    expect(pkg.summary.renderQualityGrade).toBe("benchmark_gap");
    expect(
      pkg.summary.renderQualityChecklist.benchmarkGaps.join(" "),
    ).toContain("synthetic drafting density");
  });

  it("prepares live-preview manifest metadata without wiring the live Engineering UI", () => {
    const pkg = buildProfessionalPlanSetRenderPackage(
      buildProfessionalSurveyReadinessReport(survey(), files()),
    );
    const manifest = pkg.previewManifest;

    expect(manifest.schemaVersion).toBe(
      "professional_plan_set_preview_manifest_v1",
    );
    expect(manifest.packageMode).toBe("live_preview_preparation_only");
    expect(manifest.packageHash).toBe(pkg.packageHash);
    expect(manifest.defaultPreviewPath).toBe("index.html");
    expect(manifest.pdfPath).toBe("package.pdf");
    expect(manifest.contactSheetPath).toBe("contact-sheet.png");
    expect(manifest.sheets).toHaveLength(3);
    expect(manifest.sheets[0]).toMatchObject({
      sheetNumber: "A-000",
      thumbnailPath: "thumbnails/A-000-cover_summary.png",
      snapshotPath: "snapshots/A-000-cover_summary.png",
    });
    expect(manifest.assets.map((asset) => asset.kind)).toContain("pdf");
    expect(manifest.assets.map((asset) => asset.kind)).toContain("thumbnail");
    expect(manifest.assets.map((asset) => asset.kind)).toContain(
      "contact_sheet",
    );
    expect(manifest.livePreviewReadiness.readyForInternalPreviewRoute).toBe(
      true,
    );
    expect(manifest.livePreviewReadiness.readyForLiveEngineeringUi).toBe(false);
    expect(manifest.noAuthorityEnforcement.persistenceAllowed).toBe(false);
  });

  it("enforces render-only safety boundaries without mutating source report objects", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const beforeReport = JSON.stringify(report);
    const beforeGeometry = JSON.stringify(report.canonicalGeometry);
    const beforeCad = JSON.stringify(report.cadReadiness);
    const pkg = buildProfessionalPlanSetRenderPackage(report);

    expect(pkg.noAuthorityEnforcement).toEqual({
      readOnly: true,
      renderOutputOnly: true,
      stampedEngineeringPackage: false,
      automaticCadGenerationAllowed: false,
      canonicalGeometryMutationAllowed: false,
      cadMutationAllowed: false,
      cadSolverExecutionAllowed: false,
      persistenceAllowed: false,
      downstreamEngineeringAllowed: false,
      downstreamPermitAllowed: false,
      downstreamBomAllowed: false,
    });
    expect(
      pkg.sheets.every(
        (sheet) =>
          sheet.noAuthorityEnforcement.cadSolverExecutionAllowed === false,
      ),
    ).toBe(true);
    expect(JSON.stringify(report)).toBe(beforeReport);
    expect(JSON.stringify(report.canonicalGeometry)).toBe(beforeGeometry);
    expect(JSON.stringify(report.cadReadiness)).toBe(beforeCad);
  });

  it("renders blocked/review states visibly without promoting output to authority", () => {
    const blocked = buildProfessionalSurveyReadinessReport(
      survey({
        id: "plan-render-blocked",
        surveyData: {
          schemaVersion: "2.0",
          systemType: "roof",
          location: { lat: 36.17, lng: -115.14 },
          geometry: {
            roofPlanes: [
              {
                id: "bowtie",
                pitch: 22,
                azimuth: 180,
                area: 850,
                vertices: [
                  { lat: 36.17, lng: -115.14 },
                  { lat: 36.1702, lng: -115.1404 },
                  { lat: 36.1702, lng: -115.14 },
                  { lat: 36.17, lng: -115.1404 },
                ],
              },
            ],
          },
          electrical: {
            mainPanelRatingAmps: 200,
            interconnectionPoint: "main_panel",
          },
        },
      }),
      files(),
    );
    const pkg = buildProfessionalPlanSetRenderPackage(blocked);

    expect(pkg.summary.renderReadinessState).toBe("render_blocked");
    expect(pkg.sheets[0].svg).toContain("render_blocked");
    expect(pkg.sheets[1].svg).toContain(
      "Geometry intelligence requires blocker review",
    );
    expect(pkg.noAuthorityEnforcement.stampedEngineeringPackage).toBe(false);
  });

  it("marks legacy reconstruction regions as synthetic fallback-only", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const reconstruction = buildEvidenceDerivedCadReconstruction(report);

    expect(reconstruction.alignmentSummary.evidenceAlignedCandidateCount).toBe(0);
    expect(reconstruction.candidates.length).toBeGreaterThan(0);
    expect(
      reconstruction.candidates.every(
        (candidate) => candidate.reviewStatus === "fallback_only",
      ),
    ).toBe(true);
    expect(reconstruction.candidates.map((candidate) => candidate.label).join(" ")).toContain(
      "LEGACY SYNTHETIC FALLBACK",
    );
    expect(reconstruction.deterministicNotes.join(" ")).toContain(
      "does not execute pixel CV",
    );
  });

  it("renders A-201 source thumbnails when worker thumbnails exist and safe placeholders otherwise", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const thumb = "data:image/jpeg;base64,VGh1bWJuYWls";
    const pkg = buildProfessionalPlanSetRenderPackage(report, null, {
      openSourcePhotoVision: {
        schemaVersion: "open_source_photo_vision_stored_bundle_v1",
        surveyId: report.source.surveyId,
        toolName: "open-source-photo-vision-worker",
        toolVersion: "1.0.0",
        candidateCount: 1,
        latestRunHash: "runhash-thumbnail-test",
        candidates: [
          {
            id: "candidate-thumb",
            surveyId: report.source.surveyId,
            fileId: "file-roof",
            toolName: "open-source-photo-vision-worker",
            toolVersion: "1.0.0",
            runHash: "runhash-thumbnail-test",
            candidateType: "edge_map_summary",
            candidateCategory: "quality",
            payload: { sourceFileUrl: "https://cdn.example.test/roof_overview.jpg" },
            confidence: 45,
            limitations: ["REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY"],
            reviewStatus: "review_required",
            deterministicHash: "hash-thumb",
            thumbnailDataUrl: thumb,
            createdAt: "2026-05-25T00:00:00Z",
          },
        ],
        authority: {
          reviewOnly: true,
          nonAuthoritative: true,
          canonicalMutationAllowed: false,
          cadMutationAllowed: false,
          permitGenerationAllowed: false,
          bomMutationAllowed: false,
          engineeringWorkflowMutationAllowed: false,
        },
        limitations: ["REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY"],
      },
    });
    const evidence = pkg.sheets.find((sheet) => sheet.sheetType === "evidence_review");
    const svg = evidence?.svg ?? "";

    expect(svg).toContain(thumb);
    expect(svg).toContain("SOURCE THUMBNAIL");
    expect(svg).toContain("SAFE PLACEHOLDER");
  });

  it("prefers real open-source worker overlays on A-101 with source provenance and review-only labels", () => {
    const report = buildProfessionalSurveyReadinessReport(survey(), files());
    const pkg = buildProfessionalPlanSetRenderPackage(report, null, {
      openSourcePhotoVision: {
        schemaVersion: "open_source_photo_vision_stored_bundle_v1",
        surveyId: report.source.surveyId,
        toolName: "open-source-photo-vision-worker",
        toolVersion: "1.0.0",
        candidateCount: 1,
        latestRunHash: "abcdef1234567890",
        candidates: [
          {
            id: "candidate-overlay",
            surveyId: report.source.surveyId,
            fileId: "file-roof",
            toolName: "open-source-photo-vision-worker",
            toolVersion: "1.0.0",
            runHash: "abcdef1234567890",
            candidateType: "roof_edge_candidate",
            candidateCategory: "roof_context",
            payload: {
              line: {
                x1: 100,
                y1: 220,
                x2: 900,
                y2: 220,
                orientation: "horizontal",
                strength: 0.72,
                coordinateSystem: "normalized_image_0_1000",
              },
              sourceFileUrl: "https://cdn.example.test/roof_overview.jpg",
            },
            confidence: 62,
            limitations: ["REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY"],
            reviewStatus: "review_required",
            deterministicHash: "hash-overlay",
            thumbnailDataUrl: null,
            createdAt: "2026-05-25T00:00:00Z",
          },
        ],
        authority: {
          reviewOnly: true,
          nonAuthoritative: true,
          canonicalMutationAllowed: false,
          cadMutationAllowed: false,
          permitGenerationAllowed: false,
          bomMutationAllowed: false,
          engineeringWorkflowMutationAllowed: false,
        },
        limitations: ["REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY"],
      },
    });
    const sitePlan = pkg.sheets.find((sheet) => sheet.sheetType === "site_plan_render");
    const svg = sitePlan?.svg ?? "";

    expect(svg).toContain("OPEN-SOURCE PHOTO VISION PASS");
    expect(svg).toContain("REVIEW-ONLY / NON-AUTHORITATIVE / NOT CAD GEOMETRY");
    expect(svg).toContain("open-source-photo-vision-worker/1.0.0");
    expect(svg).toContain("abcdef1234");
    expect(svg).not.toContain("LEGACY SYNTHETIC FALLBACK - ROOF EDGE REVIEW CUE");
  });

});
