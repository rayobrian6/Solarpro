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
import { schedBomRowCount, SCHED_BOM_ROWS_FIRST } from './sections/structuralPages';
import { equipmentDatasheetIndexRows } from './sections/datasheetAppendix';
import { hybridSheetSections, SUB_KEY_TO_CAD_TYPE } from './sections/subSystemSheets';
import { pv2Title, pv3Title, type SysType } from './utils/helpers';

export function computePlansetManifest(input: PermitInput, cad: CADModel): SheetRef[] {
  // APP-CAD is opt-in (Ray, 2026-07-09) — match generatePermit's internal flag.
  const includeCADAppendixPreview =
    (input.permitOptions as { includeCadAppendixInternal?: boolean } | undefined)?.includeCadAppendixInternal === true;
  const includeInternalValidation = input.permitOptions?.includeInternalValidation === true
    || input.planSetOptions?.includeInternalValidation === true;
  const includeSchedCont = schedBomRowCount(input.bom) > SCHED_BOM_ROWS_FIRST;

  // Wave 5B: hybrid sets grow per-sub detail sheets — mirror generatePermit's
  // sub loop by passing the SAME ordered present-sub list.
  const _tocSubs = hybridSheetSections(cad).map(s => s.key);
  const _tocPrimaryType = _tocSubs.length > 1
    ? SUB_KEY_TO_CAD_TYPE[_tocSubs[0]]
    : (cad.systemType as SysType);

  return buildSheetManifest({
    pv1Title: pv2Title(_tocPrimaryType as SysType),
    pv3Title: pv3Title(_tocPrimaryType as SysType),
    datasheets: equipmentDatasheetIndexRows(input),
    includeSchedCont,
    includeValidation: includeInternalValidation,
    includeCadAppendix: includeCADAppendixPreview,
    ...(_tocSubs.length > 1 ? { hybridSubs: _tocSubs } : {}),
  });
}
