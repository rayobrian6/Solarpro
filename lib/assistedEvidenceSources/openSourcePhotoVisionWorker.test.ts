import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { runOpenSourcePhotoVisionWorker } from "./openSourcePhotoVisionWorker";
import type { SiteSurveyFile } from "@/lib/db/surveys";

async function fixtureImageBytes(): Promise<Buffer> {
  return sharp({
    create: {
      width: 96,
      height: 72,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="96" height="72" xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="72" height="44" fill="none" stroke="black" stroke-width="4"/><line x1="5" y1="60" x2="90" y2="60" stroke="black" stroke-width="3"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg()
    .toBuffer();
}

function photoFile(): SiteSurveyFile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    surveyId: "22222222-2222-4222-8222-222222222222",
    fileUrl: "https://cdn.example.test/roof-overview.jpg",
    fileType: "photo",
    label: "roof overview",
    filename: "roof-overview.jpg",
    mimeType: "image/jpeg",
    createdAt: "2026-05-01T10:05:00Z",
  };
}

describe("open-source photo vision worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("processes actual image bytes into review-only deterministic candidates with unavailable native diagnostics", async () => {
    const bytes = await fixtureImageBytes();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { "content-length": String(bytes.length), "content-type": "image/jpeg" },
        }),
      ),
    );

    const input = {
      survey: { id: "22222222-2222-4222-8222-222222222222", projectId: "project-1" },
      files: [photoFile()],
      createdAt: "2026-05-25T00:00:00.000Z",
    };
    const run = await runOpenSourcePhotoVisionWorker(input);
    const repeated = await runOpenSourcePhotoVisionWorker({
      ...input,
      createdAt: "2026-05-26T00:00:00.000Z",
    });

    expect(run.schemaVersion).toBe("open_source_photo_vision_run_v1");
    expect(run.processedCount).toBe(1);
    expect(run.failedCount).toBe(0);
    expect(run.candidateCount).toBeGreaterThan(0);
    expect(run.files[0].metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(run.files[0].thumbnailDataUrl).toContain("data:image/jpeg;base64,");
    expect(run.candidates.map((candidate) => candidate.deterministicHash)).toEqual(
      repeated.candidates.map((candidate) => candidate.deterministicHash),
    );
    expect(run.availability).toMatchObject({
      sharp: "available",
      opencv: "unavailable_next_runtime_adapter_not_configured",
      yoloSupervision: "unavailable_model_worker_not_configured",
      pythonWorker: "unavailable_not_configured",
    });
    expect(run.authority).toMatchObject({
      reviewOnly: true,
      nonAuthoritative: true,
      canonicalMutationAllowed: false,
      cadMutationAllowed: false,
      permitGenerationAllowed: false,
      bomMutationAllowed: false,
      engineeringWorkflowMutationAllowed: false,
    });
    expect(
      run.candidates.every(
        (candidate) =>
          candidate.reviewStatus === "review_required" &&
          candidate.nonAuthoritative === true &&
          candidate.limitations.join(" ").includes("NOT CAD GEOMETRY"),
      ),
    ).toBe(true);
  });
});
