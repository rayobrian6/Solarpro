// ============================================================================
// lib/topography/getTopographyState.ts
//
// READ-ONLY data discovery layer for the topography system audit view.
//
// For a given projectId, queries DB state to determine:
//   - Whether survey data exists (legacy pipeline vs new pipeline)
//   - Which physical_data fields are populated vs null
//   - Which downstream systems (engineering, CAD, permit, proposal) are
//     actually wired to survey data
//   - Whether engineering report exists
//   - Whether permit artifacts exist in project_files
//   - Whether a layout exists
//
// 🚨 THE OLD HEADER HERE ASSERTED A CALLER COUNT THAT HAD SINCE CHANGED.
//
// It read "permitIntegration → 0 callers in app/ → false", and that had stopped
// being true: app/api/engineering/permit/route.ts:1215 calls it, and the survey
// values it returns override design values on the plan set. A comment stating a
// grep result is a fact with an expiry date, and this one had expired while the
// flag it justified was frozen at the literal type `false`.
//
// INTEGRATION TRUTH is therefore no longer asserted in prose. `usedInEngineering`
// and `usedInPermit` are COMPUTED from rows this function already reads. The
// remaining flags are each a named constant with its verification basis and date
// on the field itself (see TopographyState.systemIntegration) and are typed
// `boolean`, so wiring one is a one-line change and not a type error.
//
// NEVER throws — all DB errors return safe null-state.
// NEVER writes to DB.
// NEVER modifies pipelines.
// ============================================================================

import { getDbReady } from '@/lib/db-neon';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Status of a single survey field: was it captured (non-null) or missing? */
export interface FieldUsage {
  field: string;
  label: string;
  value: string | number | boolean | null;
  captured: boolean;
  usedByEngineering: boolean;
}

/** Full state snapshot for the topography audit view */
export interface TopographyState {
  projectId: string;
  projectName: string | null;
  projectAddress: string | null;
  projectLat: number | null;
  projectLng: number | null;
  fetchedAt: string;

  survey: {
    /** project_physical_data row exists (legacy ingest pipeline) */
    legacy: boolean;
    /** project_site_surveys row exists (new Phase 1-10 pipeline) */
    newPipeline: boolean;
    /** Count of non-null fields in project_physical_data */
    fieldsUsedCount: number;
    /** Total fields defined in ProjectPhysicalData */
    fieldsTotalCount: number;
    /** Per-field breakdown */
    fieldUsage: FieldUsage[];
    /** When the legacy survey was last updated (null if no data) */
    legacyUpdatedAt: string | null;
    /** When the new pipeline survey was last updated (null if no data) */
    newPipelineUpdatedAt: string | null;
    /** Whether new pipeline has enriched data */
    newPipelineEnriched: boolean;
  };

  // 🚨 A `false` LITERAL TYPE IS A GUARD THAT CANNOT FIRE.
  //
  // Four of these six were typed as the literal `false`, not `boolean`. That is
  // not a default — it makes green UNREPRESENTABLE: the compiler would have
  // rejected the correct value, so no amount of wiring could ever turn the node
  // on, for any project, forever.
  //
  // `usedInPermit` was the expensive one. `permitIntegration` HAS a caller —
  // app/api/engineering/permit/route.ts:1215 — and the surveyed roofType,
  // roofPitch, rafterSize, rafterSpacing, mainPanelAmps, mainPanelBrand,
  // utilityMeter, interconnectionMethod and panelBusRating override the design
  // values on the generated plan set (SURVEY_WINS_FIELDS, permit/route.ts
  // :1236-1247). So the one dashboard built to answer "did the survey reach
  // engineering?" answered NO about the one place it demonstrably did, which both
  // hides the real gaps and invites an engineer to distrust correct,
  // survey-driven permit values.
  //
  // All four are now `boolean` and each is COMPUTED. Where a flag is still false
  // it is false because the code path was re-verified as unreachable on this
  // branch, and the basis is stated per field — not because the type forbids the
  // alternative.
  systemIntegration: {
    /**
     * `applyToSystemDefinition` IS called — app/api/engineering/generate/route.ts
     * :126 — but the `definition` it returns is consumed only by the
     * `[SURVEY APPLIED]` console.log on the next line. `generateEngineeringReport`
     * is handed `snapshot`, `physicalData` and `enrichedSurvey`, never the patched
     * definition, so nothing downstream reads the override layer's output.
     * False here means "computed, not consumed", which is what the node should
     * say. Re-verified 2026-09-26 by following `definition` to its last use.
     */
    appliedToSystemDefinition: boolean;
    /**
     * `buildCADFromSurvey` is reached only from `getArrayPlanFromPermit` and
     * `getStructuralFromPermit` (lib/drafting/composers/index.ts:95,:172), and
     * BOTH are unreachable: their only references anywhere are the re-exports in
     * lib/drafting/index.ts. The permit array sheet calls
     * `drawingEngine.getArrayPlanFromCAD` instead (lib/permit/sections/
     * arrayPages.ts:471), which takes no survey. Re-verified 2026-09-26.
     */
    usedInCAD: boolean;
    /**
     * project_physical_data IS read by generateEngineeringReport().
     * 4 fields: panel_rating_amps, rafter_spacing_in, roof_material, interconnection_point.
     * partial = true because only 4/20 fields are consumed.
     */
    usedInEngineering: boolean;   // true when engineering_reports row exists AND physical_data exists
    usedInEngineeringPartial: boolean; // always true when usedInEngineering (only 4/20 fields used)
    /**
     * TRUE when this project has both survey data and a generated permit
     * artifact. The permit route runs `permitIntegration(enriched)` on exactly
     * the condition that a project_physical_data row exists, so a permit artifact
     * plus a legacy survey row means the survey DID reach the plan set for this
     * project. Same shape of observation as `usedInEngineering`.
     */
    usedInPermit: boolean;
    /**
     * No proposal route reads physical_data. Re-verified 2026-09-26: zero
     * `physical_data` / `physicalData` references under app/api/proposals or
     * lib/proposal.
     */
    usedInProposal: boolean;
  };

  engineering: {
    /** engineering_reports row exists for this project */
    reportExists: boolean;
    /** When it was last generated */
    reportUpdatedAt: string | null;
    /** How many engineering artifact files exist in project_files */
    artifactCount: number;
  };

  permit: {
    /** permit_cover_sheet or permit_planset file exists in project_files */
    artifactExists: boolean;
    /** Count of permit artifacts */
    artifactCount: number;
  };

  layout: {
    /** layouts row exists */
    exists: boolean;
    /** Total panel count from layout */
    panelCount: number | null;
    /** system type from layout */
    systemType: string | null;
  };

  topo: {
    /** iframe is always active — hardcoded URL */
    iframeActive: true;
    /**
     * Topography iframe accepts ?lat=&lng= URL params only if external tool
     * supports it. Currently the URL is hardcoded — no dynamic data connected.
     */
    dynamicDataConnected: false;
    /** External iframe URL base */
    iframeUrl: string;
  };

  /** Any errors encountered during state collection (non-fatal) */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The hardcoded iframe URL from app/admin/topography/page.tsx */
const TOPO_IFRAME_URL =
  'https://sites.super.myninja.ai/399ee147-1c47-4168-953c-039b63bf656e/a29238b9/index.html';

/** All 20 ProjectPhysicalData fields with display labels */
const PHYSICAL_DATA_FIELDS: Array<{
  field: string;
  label: string;
  usedByEngineering: boolean;
}> = [
  // Roof / Structure
  { field: 'roof_material',           label: 'Roof Material',           usedByEngineering: true  },
  { field: 'roof_pitch',              label: 'Roof Pitch',              usedByEngineering: false },
  { field: 'rafter_spacing_in',       label: 'Rafter Spacing (in)',     usedByEngineering: true  },
  { field: 'roof_condition',          label: 'Roof Condition',          usedByEngineering: false },
  { field: 'roof_age_years',          label: 'Roof Age (years)',        usedByEngineering: false },
  { field: 'attic_access',            label: 'Attic Access',            usedByEngineering: false },
  // Electrical
  { field: 'panel_brand',             label: 'Panel Brand',             usedByEngineering: false },
  { field: 'panel_rating_amps',       label: 'Panel Rating (A)',        usedByEngineering: true  },
  { field: 'available_breaker_slots', label: 'Breaker Slots Available', usedByEngineering: false },
  { field: 'meter_socket_type',       label: 'Meter Socket Type',       usedByEngineering: false },
  { field: 'interconnection_point',   label: 'Interconnection Point',   usedByEngineering: true  },
  { field: 'service_entrance_type',   label: 'Service Entrance Type',   usedByEngineering: false },
  { field: 'has_sub_panel',           label: 'Has Sub-Panel',           usedByEngineering: false },
  { field: 'sub_panel_rating_amps',   label: 'Sub-Panel Rating (A)',    usedByEngineering: false },
  // Constraints
  { field: 'obstructions',            label: 'Obstructions',            usedByEngineering: false },
  { field: 'usable_roof_pct',         label: 'Usable Roof %',           usedByEngineering: false },
  // Metadata
  { field: 'inspector_name',          label: 'Inspector Name',          usedByEngineering: false },
  { field: 'surveyed_at',             label: 'Surveyed At',             usedByEngineering: false },
  { field: 'structure_type',          label: 'Structure Type',          usedByEngineering: false },
  { field: 'stories',                 label: 'Stories',                 usedByEngineering: false },
];

const TOTAL_FIELD_COUNT = PHYSICAL_DATA_FIELDS.length; // 20

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function getTopographyState(projectId: string): Promise<TopographyState> {
  const errors: string[] = [];

  // -- DB connection ---------------------------------------------------------
  let sql: Awaited<ReturnType<typeof getDbReady>>;
  try {
    sql = await getDbReady();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Return minimal state with error — do not throw
    return buildEmptyState(projectId, [`DB connection failed: ${msg}`]);
  }

  // -- 1. Project row --------------------------------------------------------
  let projectName: string | null = null;
  let projectAddress: string | null = null;
  let projectLat: number | null = null;
  let projectLng: number | null = null;

  try {
    const rows = await sql`
      SELECT name, address, lat, lng
        FROM projects
       WHERE id = ${projectId}
         AND deleted_at IS NULL
       LIMIT 1
    `;
    if (rows.length > 0) {
      const r = rows[0] as Record<string, unknown>;
      projectName    = (r.name    as string | null) ?? null;
      projectAddress = (r.address as string | null) ?? null;
      projectLat     = r.lat  != null ? Number(r.lat)  : null;
      projectLng     = r.lng  != null ? Number(r.lng)  : null;
    }
  } catch (err) {
    errors.push(`project fetch: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -- 2. project_physical_data (legacy survey system) -----------------------
  let legacyExists = false;
  let legacyUpdatedAt: string | null = null;
  let fieldUsage: FieldUsage[] = PHYSICAL_DATA_FIELDS.map((f) => ({
    field: f.field,
    label: f.label,
    value: null,
    captured: false,
    usedByEngineering: f.usedByEngineering,
  }));

  try {
    const rows = await sql`
      SELECT
        roof_material, roof_pitch, rafter_spacing_in, roof_condition,
        roof_age_years, attic_access, panel_brand, panel_rating_amps,
        available_breaker_slots, meter_socket_type, interconnection_point,
        service_entrance_type, has_sub_panel, sub_panel_rating_amps,
        obstructions, usable_roof_pct, inspector_name, surveyed_at,
        structure_type, stories, updated_at
      FROM project_physical_data
      WHERE project_id = ${projectId}
      LIMIT 1
    `;

    if (rows.length > 0) {
      legacyExists = true;
      const r = rows[0] as Record<string, unknown>;
      legacyUpdatedAt = r.updated_at ? String(r.updated_at) : null;

      fieldUsage = PHYSICAL_DATA_FIELDS.map((f) => {
        const raw = r[f.field];
        // Treat empty arrays as not-captured for obstructions
        const isEmpty = Array.isArray(raw) && raw.length === 0;
        const captured = raw !== null && raw !== undefined && !isEmpty;
        return {
          field: f.field,
          label: f.label,
          value: captured ? (raw as string | number | boolean) : null,
          captured,
          usedByEngineering: f.usedByEngineering,
        };
      });
    }
  } catch (err) {
    errors.push(`project_physical_data: ${err instanceof Error ? err.message : String(err)}`);
  }

  const capturedCount = fieldUsage.filter((f) => f.captured).length;

  // -- 3. site_surveys (canonical survey storage — migration 016) -------------
  // NOTE: The old code queried `project_site_surveys`, a table that was NEVER
  // created by any migration (confirmed: grep migrations/ = 0 results).
  // The canonical table is `site_surveys` (migration 016_site_surveys.sql).
  // Fixed in Phase 2 data-integrity pass.
  let newPipelineExists = false;
  let newPipelineUpdatedAt: string | null = null;
  let newPipelineEnriched = false;

  try {
    const rows = await sql`
      SELECT
        survey_data,
        created_at
      FROM site_surveys
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length > 0) {
      newPipelineExists = true;
      const r = rows[0] as Record<string, unknown>;
      newPipelineUpdatedAt = r.created_at ? String(r.created_at) : null;
      // survey_data is non-null when the full SurveyV2Payload was stored
      newPipelineEnriched = r.survey_data !== null && r.survey_data !== undefined;
    }
  } catch (err) {
    errors.push(`site_surveys: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -- 4. Engineering report -------------------------------------------------
  let engineeringReportExists = false;
  let engineeringReportUpdatedAt: string | null = null;
  let engineeringArtifactCount = 0;

  try {
    const rows = await sql`
      SELECT updated_at
      FROM engineering_reports
      WHERE project_id = ${projectId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows.length > 0) {
      engineeringReportExists = true;
      const r = rows[0] as Record<string, unknown>;
      engineeringReportUpdatedAt = r.updated_at ? String(r.updated_at) : null;
    }
  } catch (err) {
    errors.push(`engineering_reports: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM project_files
      WHERE project_id = ${projectId}
        AND file_type = 'engineering'
    `;
    engineeringArtifactCount = Number((rows[0] as Record<string, unknown>)?.cnt ?? 0);
  } catch {
    // non-fatal — some environments may not have project_files yet
  }

  // -- 5. Permit artifacts ---------------------------------------------------
  let permitArtifactCount = 0;

  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM project_files
      WHERE project_id = ${projectId}
        AND file_type IN ('permit_cover_sheet', 'permit_planset')
    `;
    permitArtifactCount = Number((rows[0] as Record<string, unknown>)?.cnt ?? 0);
  } catch {
    // non-fatal
  }

  // -- 6. Layout -------------------------------------------------------------
  let layoutExists = false;
  let layoutPanelCount: number | null = null;
  let layoutSystemType: string | null = null;

  try {
    const rows = await sql`
      SELECT total_panels, system_type
      FROM layouts
      WHERE project_id = ${projectId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (rows.length > 0) {
      layoutExists = true;
      const r = rows[0] as Record<string, unknown>;
      layoutPanelCount  = r.total_panels != null ? Number(r.total_panels) : null;
      layoutSystemType  = (r.system_type as string | null) ?? null;
    }
  } catch (err) {
    errors.push(`layouts: ${err instanceof Error ? err.message : String(err)}`);
  }

  // -- 7. Assemble result ----------------------------------------------------

  // usedInEngineering = true when BOTH survey data AND engineering report exist.
  // The engineering report generator reads pd.panel_rating_amps etc. when pd != null.
  const usedInEngineering = legacyExists && engineeringReportExists;

  // 🚨 COMPUTED FROM OBSERVABLE STATE, NOT ASSERTED.
  //
  // The permit route's survey block is gated on one thing: a
  // project_physical_data row for this project. When it finds one it normalises,
  // enriches and calls `permitIntegration(enriched)`, then merges
  // SURVEY_WINS_FIELDS into the permit input (app/api/engineering/permit/route.ts
  // :1200-1247). So a project that has BOTH a legacy survey row AND a permit
  // artifact had its survey applied to that plan set — the same inference, on the
  // same two kinds of evidence, as `usedInEngineering` above.
  //
  // This is deliberately not "a permit artifact exists": without survey data
  // permitIntegration never runs, and the node would go green on a plan set the
  // survey never touched.
  const usedInPermit = legacyExists && permitArtifactCount > 0;

  // The remaining two are false because the code path is unreachable or its
  // output unconsumed on this branch, re-verified 2026-09-26 — see the per-field
  // notes on TopographyState.systemIntegration. They are typed `boolean`, so
  // wiring either one only needs this constant replaced with the real check.
  const appliedToSystemDefinition = false;
  const usedInCAD = false;
  const usedInProposal = false;

  if (process.env.NODE_ENV === 'development') {
    console.log('[TOPO DEBUG]', JSON.stringify({
      projectId,
      surveySource: legacyExists ? 'project_physical_data' : 'none',
      newPipeline: newPipelineExists,
      integrationFlags: {
        appliedToSystemDefinition,
        usedInCAD,
        usedInEngineering,
        usedInPermit,
        usedInProposal,
      },
      missingConnections: [
        !usedInEngineering && 'engineering',
        !appliedToSystemDefinition && 'systemDefinition (applyToSystemDefinition — called, output not consumed)',
        !usedInCAD && 'CAD (buildCADFromSurvey — composer entry points have no callers)',
        !usedInPermit && 'permit (no survey row and/or no permit artifact for this project)',
        !usedInProposal && 'proposal (no physical_data reads in proposal routes)',
      ].filter(Boolean),
      capturedFields: capturedCount,
      totalFields: TOTAL_FIELD_COUNT,
      errors,
    }, null, 2));
  }

  return {
    projectId,
    projectName,
    projectAddress,
    projectLat,
    projectLng,
    fetchedAt: new Date().toISOString(),

    survey: {
      legacy: legacyExists,
      newPipeline: newPipelineExists,
      fieldsUsedCount: capturedCount,
      fieldsTotalCount: TOTAL_FIELD_COUNT,
      fieldUsage,
      legacyUpdatedAt,
      newPipelineUpdatedAt,
      newPipelineEnriched,
    },

    systemIntegration: {
      appliedToSystemDefinition,
      usedInCAD,
      usedInEngineering,
      usedInEngineeringPartial: usedInEngineering, // only 4/20 fields consumed
      usedInPermit,
      usedInProposal,
    },

    engineering: {
      reportExists: engineeringReportExists,
      reportUpdatedAt: engineeringReportUpdatedAt,
      artifactCount: engineeringArtifactCount,
    },

    permit: {
      artifactExists: permitArtifactCount > 0,
      artifactCount: permitArtifactCount,
    },

    layout: {
      exists: layoutExists,
      panelCount: layoutPanelCount,
      systemType: layoutSystemType,
    },

    topo: {
      iframeActive: true,
      dynamicDataConnected: false, // hardcoded URL — no postMessage or URL params
      iframeUrl: TOPO_IFRAME_URL,
    },

    errors,
  };
}

// ---------------------------------------------------------------------------
// Empty/error state helper
// ---------------------------------------------------------------------------

function buildEmptyState(projectId: string, errors: string[]): TopographyState {
  const emptyFieldUsage: FieldUsage[] = PHYSICAL_DATA_FIELDS.map((f) => ({
    field: f.field,
    label: f.label,
    value: null,
    captured: false,
    usedByEngineering: f.usedByEngineering,
  }));

  return {
    projectId,
    projectName: null,
    projectAddress: null,
    projectLat: null,
    projectLng: null,
    fetchedAt: new Date().toISOString(),

    survey: {
      legacy: false,
      newPipeline: false,
      fieldsUsedCount: 0,
      fieldsTotalCount: TOTAL_FIELD_COUNT,
      fieldUsage: emptyFieldUsage,
      legacyUpdatedAt: null,
      newPipelineUpdatedAt: null,
      newPipelineEnriched: false,
    },

    // NOT OBSERVED, not measured false: this helper is reached only when the DB
    // connection itself failed, and the reason is in `errors`, which the page
    // renders. A caller must read `errors` before reading any flag here.
    systemIntegration: {
      appliedToSystemDefinition: false,
      usedInCAD: false,
      usedInEngineering: false,
      usedInEngineeringPartial: false,
      usedInPermit: false,
      usedInProposal: false,
    },

    engineering: {
      reportExists: false,
      reportUpdatedAt: null,
      artifactCount: 0,
    },

    permit: {
      artifactExists: false,
      artifactCount: 0,
    },

    layout: {
      exists: false,
      panelCount: null,
      systemType: null,
    },

    topo: {
      iframeActive: true,
      dynamicDataConnected: false,
      iframeUrl: TOPO_IFRAME_URL,
    },

    errors,
  };
}