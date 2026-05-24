import type { CADModel } from '@/lib/cad/types';
import type { PermitInput } from '../types';
import { buildCADModelExportBundle } from '@/lib/cad/cadModelExportBundle';
import { buildCADSvgArtifactPreview } from '@/lib/cad/cadSvgArtifactPreview';
import {
  buildPlanSetCADAppendixPreviewSheetV1,
  CAD_APPENDIX_PREVIEW_SHEET_ID,
  renderPlanSetCADAppendixPreviewSheetV1,
} from '@/lib/drafting/cadAppendixPreviewSheet';
import { titleBlock } from '../utils/titleBlock';

export function pageCADAppendixPreview(input: PermitInput, cad: CADModel, pageNum: number, totalPages: number): string {
  const exportBundle = buildCADModelExportBundle(cad, {
    exportedAt: '1970-01-01T00:00:00.000Z',
    exportedBy: 'generatePermitHTML.cadAppendixPreviewV1',
    exportReason: 'permit-package-cad-appendix-preview-v1',
    sourceProjectId: normalizeSourceId((input.project as any).projectId ?? (input.project as any).id),
    sourceSurveyId: normalizeSourceId((input as any).surveyEvidence?.source?.surveyId),
    sourcePlanSetId: normalizeSourceId((input as any).planSetId),
  });
  const svgArtifact = buildCADSvgArtifactPreview(exportBundle);
  const appendixSheet = buildPlanSetCADAppendixPreviewSheetV1({
    exportBundle,
    svgArtifact,
    renderingWarnings: cad.warnings ?? [],
  });
  const appendixSvg = renderPlanSetCADAppendixPreviewSheetV1(appendixSheet);

  return `
  <div class="page cad-appendix-preview-page" data-sheet-id="${CAD_APPENDIX_PREVIEW_SHEET_ID}" data-preview-only="true" data-authority="none">
    ${titleBlock(input, CAD_APPENDIX_PREVIEW_SHEET_ID, 'CAD PREVIEW APPENDIX', pageNum, totalPages)}
    <div class="cad-appendix-wrap" style="height:calc(100% - 150px);padding:10px 14px 14px 14px;display:flex;align-items:center;justify-content:center;">
      <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;border:var(--border);background:#fff;overflow:hidden;">
        ${appendixSvg.replace('<svg ', '<svg style="width:100%;height:100%;display:block;" ')}
      </div>
    </div>
    <div style="position:absolute;left:32px;right:32px;bottom:18px;font-family:var(--sans);font-size:7px;font-weight:900;text-align:center;letter-spacing:0.5px;color:#000;border:var(--border);padding:5px;background:#fff;">
      CAD PREVIEW ONLY · NON-AUTHORITATIVE · NOT PERMIT AUTHORITY · NOT ENGINEERING AUTHORITY · NOT CONSTRUCTION DRAWING · DOES NOT REPLACE PV-2 OR PV-3
    </div>
  </div>`;
}

function normalizeSourceId(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}
