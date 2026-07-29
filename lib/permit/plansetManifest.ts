// ═══════════════════════════════════════════════════════════════════════════
// computePlansetManifest — THE single computation of the ordered sheet manifest
// for a package, shared by the snapshot project-authority builder (which stores
// it as projectAuthority.sheetIndex) and any renderer that needs the index.
//
// W4 §3: the cover no longer computes its OWN sheet index — it reads
// projectAuthority.sheetIndex (this manifest), so the printed index can never be
// an independent list that disagrees with the actual generated page set. The
// page assembly in generatePermit mirrors buildSheetManifest exactly; this
// helper feeds the SAME builder the SAME args the cover used.
// ═══════════════════════════════════════════════════════════════════════════
import type { PermitInput } from './types';
import type { CADModel } from '@/lib/cad/types';
import { buildSheetManifest, type SheetRef } from './sheetManifest';
import { schedBomRowCount, SCHED_BOM_ROWS_FIRST, schedContPageCount, roofStructuralHasContinuation } from './sections/structuralPages';
import { reviewStatusContPageCount } from './sections/reviewStatus';
import { peekSnapshot } from './snapshot/read';
import type { PermitReadinessBlocker } from './snapshot/types';
import { equipmentDatasheetIndexRows } from './sections/datasheetAppendix';
import { hybridSheetSections, SUB_KEY_TO_CAD_TYPE } from './sections/subSystemSheets';
import { hasPhysicalSectionSchedule } from './sections/electricalPages';
import { pv2Title, pv3Title, type SysType } from './utils/helpers';
import { getInverterTopology, topologyToLegacy } from '@/lib/system';
import { resolvePlansetProfile, certificationIsCompleted } from './plansetProfile';

/** RGM §5 — the review-status registry the RS-1.n pagination is computed from.
 *  build.ts passes its FINAL registry explicitly (the snapshot does not exist yet
 *  while its own sheet index is being computed); every other caller reads the
 *  attached snapshot, so both see the same registry and the same page count. */
export interface PlansetManifestOverrides {
  releaseRegistry?: readonly PermitReadinessBlocker[] | null;
}

export function computePlansetManifest(
  input: PermitInput, cad: CADModel, overrides?: PlansetManifestOverrides,
): SheetRef[] {
  // APP-CAD is opt-in (Ray, 2026-07-09) — match generatePermit's internal flag.
  const includeCADAppendixPreview =
    (input.permitOptions as { includeCadAppendixInternal?: boolean } | undefined)?.includeCadAppendixInternal === true;
  const includeInternalValidation = input.permitOptions?.includeInternalValidation === true
    || input.planSetOptions?.includeInternalValidation === true;
  const includeSchedCont = schedBomRowCount(input.bom) > SCHED_BOM_ROWS_FIRST;
  const schedContCount = schedContPageCount(input.bom);

  // RGM §5 — RS-1.n continuation count, from the SAME layout function the RS
  // renderer uses. Explicit registry wins (build.ts); otherwise the attached
  // snapshot. No snapshot ⇒ 0 continuations, exactly like a package with no
  // registry, and the page assembly agrees because it reads the same source.
  const _rsRegistry = overrides?.releaseRegistry
    ?? peekSnapshot(input)?.permitReadiness?.registry
    ?? [];
  const reviewStatusContCount = reviewStatusContPageCount(_rsRegistry);

  // Wave 5B: hybrid sets grow per-sub detail sheets — mirror generatePermit's
  // sub loop by passing the SAME ordered present-sub list.
  const _tocSubs = hybridSheetSections(cad).map(s => s.key);
  const _tocPrimaryType = _tocSubs.length > 1
    ? SUB_KEY_TO_CAD_TYPE[_tocSubs[0]]
    : (cad.systemType as SysType);

  // §4 — PV-1B title is topology-aware (AC branches vs DC strings). Resolve the
  // primary system's topology through the SAME accessor the sheets use.
  const _isMicro = topologyToLegacy(getInverterTopology(input, cad)) === 'MICRO';

  // W9/§15 — roof structural calcs (PV-4C) spill to the PV-4C.1 continuation.
  // Single-system roof only (hybrid uses per-sub structural sheets). Shared with
  // the page assembly via roofStructuralHasContinuation so both agree.
  const includePv4cCont = _tocSubs.length <= 1 && roofStructuralHasContinuation(cad.systemType);

  // Post-AAC E-1 repair — PV-4B.1 (canonical physical section schedule) exists
  // exactly when the snapshot projects sectioned physical objects (micro
  // topologies). SAME predicate as the page assembly.
  const includePv4b1 = hasPhysicalSectionSchedule(input, cad);

  return buildSheetManifest({
    pv1Title: pv2Title(_tocPrimaryType as SysType),
    pv3Title: pv3Title(_tocPrimaryType as SysType),
    datasheets: equipmentDatasheetIndexRows(input),
    includeSchedCont,
    schedContCount,
    reviewStatusContCount,
    includePv4cCont,
    includePv4b1,
    includeValidation: includeInternalValidation,
    includeCadAppendix: includeCADAppendixPreview,
    isMicro: _isMicro,
    // AAC WS-10 — the output profile + the certification-completion fact the
    // permit profile needs. ONE reader (resolvePlansetProfile) so the manifest,
    // the page assembly and the cover index can never disagree.
    profile: resolvePlansetProfile(input),
    certificationCompleted: certificationIsCompleted(input),
    ...(_tocSubs.length > 1 ? { hybridSubs: _tocSubs } : {}),
  });
}
