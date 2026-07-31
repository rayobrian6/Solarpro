// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-9 — THE EQUIPMENT-DOCUMENT AUTHORITY REGION (renderer purity).
//
// THE VIOLATION THIS RETIRES (audit §7.12 / Path 10): five renderer files
// independently called `getManufacturerAsset(...)` + `evaluateDocumentApplicability(...)`
// INSIDE the render pass —
//     lib/permit/sections/compliancePages.ts   (APP-A citation block)
//     lib/permit/sections/datasheetAppendix.ts (DS-n appendix)
//     lib/permit/sections/structuralPages.ts   (PV-3 detail citation)
//     lib/drafting/sheetComposition.ts         (drafting-stack detail)
//     lib/drafting/templates/roof.ts           (in-drawing detail callout)
// — each re-deciding an applicability question the snapshot had already decided,
// each with its OWN choice of `selectedModel` argument, and every one of them
// passing `null` for `registryFacts`, which is precisely why the AUTHORITATIVE
// verdict was structurally unreachable (audit §7.7).
//
// WS-9 is explicit: "The renderer must not retrieve authority, choose equipment,
// mutate calcs, resolve requirements, reconcile records, invent authority, or
// clear gates — it consumes the frozen snapshot."
//
// So the determination happens ONCE, here, during the pure build, with the REAL
// registry facts the retrieval resolver established, and lands in the frozen
// snapshot as `equipmentDocumentAuthority`. Renderers project it. When there is
// no snapshot at all (a standalone drafting preview), the projection returns
// null and the caller renders the honest "not established" state — it does NOT
// silently re-derive a verdict.
// ═══════════════════════════════════════════════════════════════════════════

import {
  getManufacturerAsset, evaluateDocumentApplicability,
  type DocumentApplicability, type DocumentApplicabilityAlias, type DocumentRegistryFacts,
} from '@/lib/manufacturer-assets-db';

/** The per-document verdict the snapshot carries and every sheet projects. */
export interface EquipmentDocumentAuthorityEntry {
  /** `${category}:${equipmentId}` — the key the asset library itself resolves on. */
  key: string;
  category: string;
  equipmentId: string;
  /** the model the verdict was decided FOR (one choice, not five). */
  selectedModel: string | null;
  /** the on-file document, when one exists. */
  assetId: string | null;
  documentTitle: string | null;
  sourceUrl: string | null;
  /** the ECD §8 seven-state verdict, decided once. */
  applicability: DocumentApplicability;
  /** true ⇔ REAL registry facts (archive + hash + status) were available. When
   *  false the AUTHORITATIVE verdict is genuinely out of reach, and that is a
   *  fact about the archive, not about the renderer. */
  registryFactsPresent: boolean;
}

/**
 * THE snapshot region. `entries` are the verdicts decided during the build;
 * `registryFacts` / `aliases` are the INPUTS those verdicts were decided from,
 * frozen alongside them so a sheet that cites a document the build did not
 * pre-enumerate (a second module model, a battery, a rail product) is decided
 * by THIS module from the SAME facts — never by the renderer, and never with a
 * silently different `null`.
 */
export interface EquipmentDocumentAuthority {
  entries: Record<string, EquipmentDocumentAuthorityEntry>;
  registryFacts: Record<string, DocumentRegistryFacts>;
  /** VERIFIED cross-reference records only. Always empty unless one genuinely
   *  exists: the WS-8 research established that the manufacturer publishes no
   *  cross-reference, and none is ever fabricated to clear a gap. */
  aliases: Record<string, DocumentApplicabilityAlias>;
}

export function emptyEquipmentDocumentAuthority(): EquipmentDocumentAuthority {
  return { entries: {}, registryFacts: {}, aliases: {} };
}

export interface DocumentAuthorityRequest {
  category: string;
  equipmentId: string | null | undefined;
  selectedModel: string | null | undefined;
  /** alternate categories to try in order (inverter_spec → microinverter_spec → …). */
  fallbackCategories?: string[];
}

export function documentAuthorityKey(category: string, equipmentId: string): string {
  return `${category}:${equipmentId}`;
}

/**
 * Decide every equipment-document verdict ONCE. Pure and deterministic: the same
 * requests + the same facts produce the same record, so the snapshot digest is a
 * function of the design and the archive, never of render order.
 */
export function buildEquipmentDocumentAuthority(
  requests: DocumentAuthorityRequest[],
  registryFacts?: Record<string, DocumentRegistryFacts> | null,
  aliases?: Record<string, DocumentApplicabilityAlias> | null,
): EquipmentDocumentAuthority {
  const region: EquipmentDocumentAuthority = {
    entries: {},
    registryFacts: { ...(registryFacts ?? {}) },
    aliases: { ...(aliases ?? {}) },
  };
  const out = region.entries;
  for (const req of requests) {
    const equipmentId = (req.equipmentId ?? '').trim();
    if (!equipmentId) continue;
    const categories = [req.category, ...(req.fallbackCategories ?? [])];
    let asset = null as ReturnType<typeof getManufacturerAsset>;
    let category = req.category;
    for (const c of categories) {
      const a = getManufacturerAsset(equipmentId, c);
      if (a) { asset = a; category = c; break; }
    }
    const key = documentAuthorityKey(req.category, equipmentId);
    if (key in out) continue;
    const facts = registryFacts?.[documentAuthorityKey(category, equipmentId)]
      ?? registryFacts?.[key]
      ?? null;
    // The alias store stays EMPTY unless a verified cross-reference record is
    // supplied. Nothing here fabricates one — the RT-MINI research proved a
    // manufacturer cross-reference does not exist, and the correct answer was
    // the version-exact document, not a bridge.
    const alias = aliases?.[key] ?? null;
    out[key] = {
      key,
      category: req.category,
      equipmentId,
      selectedModel: req.selectedModel ?? asset?.model ?? null,
      assetId: asset?.id ?? null,
      documentTitle: asset?.docTitle ?? null,
      sourceUrl: asset?.sourceUrl ?? null,
      applicability: evaluateDocumentApplicability(
        req.selectedModel ?? asset?.model ?? null, asset, alias, facts),
      registryFactsPresent: facts != null,
    };
  }
  return region;
}

/** Project a decided verdict out of the frozen snapshot. Returns null when the
 *  snapshot carries none for this key. */
export function projectDocumentAuthority(
  snapshot: { equipmentDocumentAuthority?: EquipmentDocumentAuthority | null } | null | undefined,
  category: string,
  equipmentId: string | null | undefined,
): EquipmentDocumentAuthorityEntry | null {
  const id = (equipmentId ?? '').trim();
  const region = snapshot?.equipmentDocumentAuthority;
  if (!id || !region?.entries) return null;
  return region.entries[documentAuthorityKey(category, id)] ?? null;
}

/**
 * THE ONE FUNCTION EVERY SHEET CALLS.
 *
 * WS-9 renderer purity: no renderer file may call `evaluateDocumentApplicability`
 * itself. It asks here, and this module — part of the snapshot layer, not the
 * drafting layer — answers from the frozen region:
 *   1. the verdict the BUILD already decided, when the key was pre-enumerated
 *      (module, inverter, mount — the ones that gate requirements); otherwise
 *   2. the verdict evaluated from the SAME frozen registryFacts + aliases the
 *      build used, so a sheet citing a document the build did not enumerate (a
 *      second module model, a battery, a rail product) can never disagree with
 *      one that did, and can never silently pass `null` facts;
 *   3. with no snapshot at all (standalone drafting preview), the honest
 *      no-facts evaluation — the same answer the build would give with an empty
 *      archive, explicitly flagged `registryFactsPresent: false`.
 */
export function sheetDocumentApplicability(args: {
  region: EquipmentDocumentAuthority | null | undefined;
  category: string;
  equipmentId: string | null | undefined;
  selectedModel: string | null | undefined;
  /** the already-resolved asset, when the caller holds one. */
  asset?: Parameters<typeof evaluateDocumentApplicability>[1];
}): DocumentApplicability {
  const decided = args.equipmentId && args.region?.entries
    ? args.region.entries[documentAuthorityKey(args.category, String(args.equipmentId).trim())]
    : undefined;
  if (decided) return decided.applicability;
  const id = (args.equipmentId ?? '').trim();
  const asset = args.asset !== undefined ? args.asset : (id ? getManufacturerAsset(id, args.category) : null);
  const key = id ? documentAuthorityKey(args.category, id) : '';
  return evaluateDocumentApplicability(
    args.selectedModel ?? asset?.model ?? null,
    asset,
    args.region?.aliases?.[key] ?? null,
    args.region?.registryFacts?.[key] ?? null,
  );
}
