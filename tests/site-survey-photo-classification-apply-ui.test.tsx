/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SurveyDetailPage from "@/app/projects/[id]/survey/[surveyId]/page";
import { buildSurveyEvidenceEngineeringBridge } from "@/lib/survey/evidence/engineeringBridge";
import { buildSurveyEvidenceManifest } from "@/lib/survey/evidence/manifest";
import { buildSurveyEvidenceTraceability } from "@/lib/survey/evidence/provenance";
import type { SiteSurvey, SiteSurveyFile } from "@/lib/db/surveys";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "project-ui-1", surveyId: "survey-ui-1" }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/ui/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}));

const survey: SiteSurvey = {
  id: "survey-ui-1",
  clientId: "client-ui-1",
  projectId: "project-ui-1",
  createdBy: "user-ui-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  status: "completed",
  source: "project_handoff",
  addressSnapshot: "123 Solar Way",
  surveyData: null,
  inspectorName: "Field Tech",
  notes: null,
  externalSurveyId: null,
  deliveryId: null,
};

function file(
  id: string,
  label: string | null,
  filename: string,
): SiteSurveyFile {
  return {
    id,
    surveyId: survey.id,
    fileUrl: `https://cdn.example.test/${filename}`,
    fileType: "photo",
    label,
    filename,
    mimeType: "image/jpeg",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const beforeFiles = [
  file("file-meter", null, "meter.jpg"),
  file("file-main-service-panel", null, "main-service-panel.jpg"),
  file("file-overview", null, "overview.jpg"),
];

const afterFiles = [
  file("file-meter", "meter", "meter.jpg"),
  file(
    "file-main-service-panel",
    "main_service_panel",
    "main-service-panel.jpg",
  ),
  file("file-overview", "overview", "overview.jpg"),
];

function detail(files: SiteSurveyFile[]) {
  const evidenceManifest = buildSurveyEvidenceManifest({
    survey,
    files,
    generatedAt: "2026-01-02T00:00:00.000Z",
  });
  const evidenceTraceability = buildSurveyEvidenceTraceability({
    canonicalManifest: evidenceManifest,
    evidenceTruthSource: "canonical_manifest_v1",
  });
  const evidenceBridge = buildSurveyEvidenceEngineeringBridge(
    evidenceManifest,
    evidenceTraceability,
  );
  return {
    survey,
    files,
    evidenceManifest,
    evidenceTraceability,
    evidenceBridge,
    evidenceHygiene: null,
  };
}

const previewResponse = {
  schemaVersion: "survey_photo_classification_preview_v1",
  mode: "operator_review",
  totalPhotoCount: 3,
  processedPhotoCount: 3,
  skippedPhotoCount: 0,
  requestedLimit: 12,
  openSourceAnalysisSummary: {
    analyzedPhotoCount: 3,
    duplicateGroupCount: 0,
    duplicatePhotoCount: 0,
    qualityReviewRequiredCount: 0,
    engine: "test",
  },
  visionExecuted: true,
  categoryCounts: {
    meter: 1,
    main_service_panel: 1,
    overview: 1,
  },
  candidates: [
    {
      fileId: "file-meter",
      filename: "meter.jpg",
      fileUrl: "https://cdn.example.test/meter.jpg",
      currentLabel: null,
      currentCategory: "uncategorized",
      suggestedCategory: "meter",
      suggestedLabel: "Utility Meter",
      confidence: "high",
      evidenceSignals: ["utility meter"],
      rationale: "The image clearly shows a utility meter.",
      reviewRequired: false,
      openSourceAnalysis: {
        qualityStatus: "good",
        duplicateGroupId: null,
        duplicateRank: null,
        duplicateGroupSize: 1,
        isDuplicateRepresentative: true,
        sharpnessScore: 100,
        brightnessScore: 52,
        widthPx: 3000,
        heightPx: 4000,
      },
    },
    {
      fileId: "file-main-service-panel",
      filename: "main-service-panel.jpg",
      fileUrl: "https://cdn.example.test/main-service-panel.jpg",
      currentLabel: null,
      currentCategory: "uncategorized",
      suggestedCategory: "main_service_panel",
      suggestedLabel: "Main Service Panel",
      confidence: "high",
      evidenceSignals: ["main service panel"],
      rationale: "The image depicts a main service panel.",
      reviewRequired: false,
      openSourceAnalysis: {
        qualityStatus: "good",
        duplicateGroupId: null,
        duplicateRank: null,
        duplicateGroupSize: 1,
        isDuplicateRepresentative: true,
        sharpnessScore: 90,
        brightnessScore: 60,
        widthPx: 3000,
        heightPx: 4000,
      },
    },
    {
      fileId: "file-overview",
      filename: "overview.jpg",
      fileUrl: "https://cdn.example.test/overview.jpg",
      currentLabel: null,
      currentCategory: "uncategorized",
      suggestedCategory: "overview",
      suggestedLabel: "Site Overview",
      confidence: "high",
      evidenceSignals: ["whole home exterior"],
      rationale: "This image provides a clear overview of the home.",
      reviewRequired: false,
      openSourceAnalysis: {
        qualityStatus: "good",
        duplicateGroupId: null,
        duplicateRank: null,
        duplicateGroupSize: 1,
        isDuplicateRepresentative: true,
        sharpnessScore: 95,
        brightnessScore: 55,
        widthPx: 3000,
        heightPx: 4000,
      },
    },
  ],
  note: "Vision classification preview completed. Review suggestions before any future persistence step.",
  noAuthorityEnforcement: {
    noDbWrites: true,
    noCadMutation: true,
    noPermitTrigger: true,
  },
};

describe("site survey photo classification apply UI", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("updates apply diagnostics and refreshed manifest without reloading the page", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/site-surveys/survey-ui-1") {
        return Response.json({ success: true, data: detail(beforeFiles) });
      }
      if (
        url === "/api/site-surveys/survey-ui-1/photo-classification-preview"
      ) {
        return Response.json({ success: true, data: previewResponse });
      }
      if (
        url ===
        "/api/site-surveys/survey-ui-1/photo-classification-preview/apply"
      ) {
        return Response.json({
          success: true,
          data: {
            appliedCount: 3,
            refreshedDetail: detail(afterFiles),
            diagnostics: {
              persistence: {
                requestedCount: 3,
                acceptedCount: 3,
                updateCount: 3,
                updatedCount: 3,
                persistedLabelSnapshot: afterFiles.map((nextFile) => ({
                  fileId: nextFile.id,
                  filename: nextFile.filename,
                  label: nextFile.label,
                })),
              },
              canonicalCounts: {
                classifiedItems: 3,
                qualityCheckedItems: 0,
                promotedAiReviewedCount: 3,
                suppressedDuplicateCount: 0,
                requiredMissing: ["roof_plane"],
              },
            },
          },
        });
      }
      if (
        url.includes("/cad-render-preview") ||
        url.includes("/professional-readiness")
      ) {
        return Response.json({
          success: false,
          error: "not needed in apply UI test",
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyDetailPage />);

    await screen.findByText("Survey Evidence Manifest v1");
    const manifestBefore =
      screen.getByText("Survey Evidence Manifest v1").closest("section") ??
      document.body;
    expect(
      within(manifestBefore).getByText("Classified").nextElementSibling,
    ).toHaveTextContent("0");
    expect(
      within(manifestBefore).getByText(/Promoted labels:/),
    ).toHaveTextContent("Promoted labels: 0");

    await user.click(
      screen.getByRole("button", { name: /Run AI classification preview/i }),
    );
    expect(
      (await screen.findAllByText("Utility Meter")).length,
    ).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", {
        name: /Apply high-confidence reviewed labels/i,
      }),
    );

    await screen.findByText("Apply lifecycle diagnostics");
    expect(
      screen.getAllByText(/Applied 3 reviewed label/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Request fired:/)).toHaveTextContent("Request fired: yes");
    expect(screen.getByText(/HTTP status:/)).toHaveTextContent("HTTP status: 200");
    expect(screen.getByText(/Requested:/)).toHaveTextContent("Requested: 3");
    expect(screen.getByText(/Accepted:/)).toHaveTextContent("Accepted: 3");
    expect(screen.getByText(/Attempted:/)).toHaveTextContent("Attempted: 3");
    expect(screen.getByText(/Updated:/)).toHaveTextContent("Updated: 3");
    expect(screen.getByText(/Persisted:/)).toHaveTextContent("Persisted: 3");
    expect(screen.getByText(/Promoted:/)).toHaveTextContent("Promoted: 3");

    await waitFor(() => {
      const manifestAfter =
        screen.getByText("Survey Evidence Manifest v1").closest("section") ??
        document.body;
      expect(
        within(manifestAfter).getByText("Classified").nextElementSibling,
      ).toHaveTextContent("3");
      expect(
        within(manifestAfter).getByText(/Promoted labels:/),
      ).toHaveTextContent("Promoted labels: 3");
      expect(manifestAfter).toHaveTextContent(/Main Service Panel\s*present/);
      expect(manifestAfter).toHaveTextContent(/Meter\s*present/);
      expect(manifestAfter).toHaveTextContent(/Overview\s*present/);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/site-surveys/survey-ui-1/photo-classification-preview/apply",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          items: [
            { fileId: "file-meter", acceptedCategory: "meter" },
            {
              fileId: "file-main-service-panel",
              acceptedCategory: "main_service_panel",
            },
            { fileId: "file-overview", acceptedCategory: "overview" },
          ],
        }),
      }),
    );
  });

  it("surfaces HTTP 409 diagnostics instead of silently leaving promoted labels at zero", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/site-surveys/survey-ui-1") {
        return Response.json({ success: true, data: detail(beforeFiles) });
      }
      if (
        url === "/api/site-surveys/survey-ui-1/photo-classification-preview"
      ) {
        return Response.json({ success: true, data: previewResponse });
      }
      if (
        url ===
        "/api/site-surveys/survey-ui-1/photo-classification-preview/apply"
      ) {
        return Response.json(
          {
            success: false,
            error:
              "No survey file labels were updated for one or more reviewed classifications; canonical evidence was not recomputed from stale rows.",
            diagnostics: {
              requestedCount: 3,
              acceptedCount: 3,
              updateCount: 3,
              updatedCount: 0,
              unmatchedFileIds: [
                "file-meter",
                "file-main-service-panel",
                "file-overview",
              ],
              rowMatchDiagnostics: [
                {
                  fileId: "file-meter",
                  fileRowExists: true,
                  fileBelongsToRequestedSurvey: true,
                  linkedSurveyRowExists: true,
                  linkedClientRowExists: true,
                  clientBelongsToAuthenticatedUser: false,
                  updatePredicateWouldMatch: false,
                },
              ],
            },
          },
          { status: 409 },
        );
      }
      if (
        url.includes("/cad-render-preview") ||
        url.includes("/professional-readiness")
      ) {
        return Response.json({
          success: false,
          error: "not needed in apply UI test",
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<SurveyDetailPage />);

    await screen.findByText("Survey Evidence Manifest v1");
    await user.click(
      screen.getByRole("button", { name: /Run AI classification preview/i }),
    );
    expect(
      (await screen.findAllByText("Utility Meter")).length,
    ).toBeGreaterThan(0);
    await user.click(
      screen.getByRole("button", {
        name: /Apply high-confidence reviewed labels/i,
      }),
    );

    await screen.findByText("Apply lifecycle diagnostics");
    expect(
      screen.getAllByText(/No survey file labels were updated/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Request fired:/)).toHaveTextContent("Request fired: yes");
    expect(screen.getByText(/HTTP status:/)).toHaveTextContent("HTTP status: 409");
    expect(screen.getByText(/Requested:/)).toHaveTextContent("Requested: 3");
    expect(screen.getByText(/Accepted:/)).toHaveTextContent("Accepted: 3");
    expect(screen.getByText(/Attempted:/)).toHaveTextContent("Attempted: 3");
    expect(screen.getByText(/Updated:/)).toHaveTextContent("Updated: 0");
    expect(screen.getByText(/Unmatched file IDs:/)).toHaveTextContent(
      "file-meter",
    );
    expect(screen.getByText(/Row match failures:/)).toHaveTextContent(
      "file-meter: client user",
    );

    const manifestAfterConflict =
      screen.getByText("Survey Evidence Manifest v1").closest("section") ??
      document.body;
    expect(
      within(manifestAfterConflict).getByText("Classified").nextElementSibling,
    ).toHaveTextContent("0");
    expect(
      within(manifestAfterConflict).getByText(/Promoted labels:/),
    ).toHaveTextContent("Promoted labels: 0");
  });
});
