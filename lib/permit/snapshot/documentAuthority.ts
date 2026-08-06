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

// ═══════════════════════════════════════════════════════════════════════════
// D7 — IDENTITY AND FACTS MUST DESCRIBE THE SAME DOCUMENT.
//
// This module received registry FACTS (archive state, hash, status) but never
// registry document IDENTITY. It resolved the static `manufacturer_assets` entry
// for the equipment, then attached whatever facts sat under the same
// `category:equipmentId` key. Those are two different documents whenever the
// static asset and the registry disagree — and on the live Braidon project they
// do:
//
//   entry.documentTitle  "Roof Tech RT-MINI II Installation Manual (Jun 2025)"   ← static asset
//   entry.sourceUrl      …/Installation-Manual-RT-MINI-II.pdf                    ← static asset
//   registryFacts.sha256 2f6035586e94…                                           ← RT-MINI manual
//
// That hash belongs to `doc-rooftech-rtmini-install-manual-2f6035586e94`, the
// VERSION-EXACT RT-MINI document. The entry asserted, in one object, that the
// RT-MINI II manual has the RT-MINI manual's SHA-256. A citation built from it
// is false in a way no reader could detect.
//
// The existing guard in structuralResolvers ("only the VERSION-EXACT document may
// supply facts") checks that the DOCUMENT covers the selected model. It cannot
// catch this, because it never compares the document to the ASSET it is being
// attached to.
//
// The fix is structural: a document is SELECTED as a whole — identity, custody
// and applicability together — and the entry reports that one document. Facts
// are never grafted onto an identity they do not belong to.
// ═══════════════════════════════════════════════════════════════════════════

/** Where a selected document came from, in precedence order. */
export type DocumentAuthorityTier =
  /** a registry document that is verified AND applicable to the selection. */
  | 'REGISTRY_AUTHORITY'
  /** a registry document that is archived + hashed but NOT yet authoritative.
   *  Visible, citable as a candidate, and never treated as established. */
  | 'REGISTRY_CANDIDATE'
  /** the legacy static asset. A render cache: no hash, no verification. */
  | 'STATIC_ASSET'
  /** nothing on file. Stated explicitly rather than implied by nulls. */
  | 'UNAVAILABLE';

/** A registry document's identity, as the registry itself records it. Every
 *  field here describes ONE row; nothing in this object may be sourced from
 *  another document. */
export interface RegistryDocumentIdentity {
  documentId: string;
  documentClass: string;
  manufacturerOrIssuer: string | null;
  equipmentId: string | null;
  /** the product the document ACTUALLY covers — which may differ from the
   *  selection. This is the field that keeps RT-MINI and RT-MINI II apart. */
  equipmentModelApplicability: string | null;
  title: string | null;
  revision: string | null;
  documentDate: string | null;
  sourceUrl: string | null;
  archivedFileIdentity: string | null;
  archivedInRepo: boolean;
  sha256: string | null;
  status: string | null;
  verificationState: string | null;
  verificationActor: string | null;
  verificationActorKind: string | null;
  verificationBasis: string | null;
  /** D4 — the stable legal-AHJ identity the document is bound to. */
  jurisdictionAuthorityId: string | null;
  jurisdictionBoundary: string | null;
}

/** THE selection: one document, described once, with the reason it won. */
export interface SelectedDocumentAuthority {
  tier: DocumentAuthorityTier;
  /** true only for REGISTRY_AUTHORITY. A candidate is never authoritative. */
  authoritative: boolean;
  documentId: string | null;
  documentClass: string | null;
  title: string | null;
  revision: string | null;
  sourceUrl: string | null;
  archivedInRepo: boolean;
  sha256: string | null;
  status: string | null;
  verificationState: string | null;
  verificationActor: string | null;
  verificationActorKind: string | null;
  verificationBasis: string | null;
  jurisdictionAuthorityId: string | null;
  /** the product the SELECTED document covers. */
  documentProduct: string | null;
  /** true ⇔ documentProduct matches the selected equipment model exactly. */
  coversSelectedModelExactly: boolean;
  /** why this document won, in one sentence a reviewer can act on. */
  selectionReason: string;
}

/** Case/space-insensitive product comparison. Version suffixes are significant:
 *  'RT-MINI' and 'RT-MINI II' must NOT compare equal. */
function sameProduct(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const x = n(a), y = n(b);
  return !!x && x === y;
}

/**
 * THE PRECEDENCE. Pure, deterministic, and total — every path returns a
 * selection, including the explicit unavailable state.
 *
 *   1 REGISTRY_AUTHORITY  verified + current + archived + hashed + product-exact
 *   2 REGISTRY_CANDIDATE  archived + hashed, but not yet authoritative
 *   3 STATIC_ASSET        the legacy render cache
 *   4 UNAVAILABLE         nothing on file
 *
 * A candidate is preferred over a static asset even when the candidate is not
 * product-exact: the registry row is a real, hashed document of record, and
 * saying so is more honest than citing an unhashed asset. What it is NOT is
 * authoritative — and `coversSelectedModelExactly` reports the difference.
 */
export function selectEquipmentDocument(args: {
  selectedModel: string | null | undefined;
  candidates: readonly RegistryDocumentIdentity[] | null | undefined;
  staticAsset: { id: string; docTitle: string | null; sourceUrl: string | null; model: string | null } | null | undefined;
}): SelectedDocumentAuthority {
  const model = args.selectedModel ?? null;
  const pool = (args.candidates ?? []).filter(Boolean);

  const fromRegistry = (d: RegistryDocumentIdentity, tier: DocumentAuthorityTier, reason: string): SelectedDocumentAuthority => ({
    tier,
    authoritative: tier === 'REGISTRY_AUTHORITY',
    documentId: d.documentId,
    documentClass: d.documentClass,
    title: d.title,
    revision: d.revision,
    // the registry's archived identity is the citable location; fall back to the
    // recorded source only when no archive identity exists.
    sourceUrl: d.archivedFileIdentity ?? d.sourceUrl,
    archivedInRepo: d.archivedInRepo,
    sha256: d.sha256,
    status: d.status,
    verificationState: d.verificationState,
    verificationActor: d.verificationActor,
    verificationActorKind: d.verificationActorKind,
    verificationBasis: d.verificationBasis,
    jurisdictionAuthorityId: d.jurisdictionAuthorityId,
    documentProduct: d.equipmentModelApplicability,
    coversSelectedModelExactly: sameProduct(d.equipmentModelApplicability, model),
    selectionReason: reason,
  });

  // ── 1 — verified, current, archived, hashed AND product-exact ────────────
  const authority = pool.find(d =>
    (d.verificationState ?? '').toLowerCase() === 'verified'
    && (d.status ?? '').toLowerCase() === 'current'
    && d.archivedInRepo && !!d.sha256
    && sameProduct(d.equipmentModelApplicability, model));
  if (authority) {
    return fromRegistry(authority, 'REGISTRY_AUTHORITY',
      `verified registry document covering the selected model '${model}' exactly`);
  }

  // ── 2 — archived + hashed registry candidate ─────────────────────────────
  // Product-exact candidates rank ahead of non-exact ones, so the closest real
  // document is the one cited.
  const archived = pool.filter(d => d.archivedInRepo && !!d.sha256
    && (d.status ?? '').toLowerCase() !== 'withdrawn');
  const candidate = archived.find(d => sameProduct(d.equipmentModelApplicability, model)) ?? archived[0];
  if (candidate) {
    const exact = sameProduct(candidate.equipmentModelApplicability, model);
    const why = !exact
      ? `covers '${candidate.equipmentModelApplicability ?? 'an unstated product'}', not the selected '${model}'`
      : `verification is '${candidate.verificationState ?? 'unrecorded'}', not 'verified'`;
    return fromRegistry(candidate, 'REGISTRY_CANDIDATE',
      `archived registry document, NOT authoritative — ${why}`);
  }

  // ── 3 — the legacy static asset ──────────────────────────────────────────
  if (args.staticAsset) {
    const a = args.staticAsset;
    return {
      tier: 'STATIC_ASSET',
      authoritative: false,
      documentId: null,               // an asset has no registry document id
      documentClass: null,
      title: a.docTitle,
      revision: null,
      sourceUrl: a.sourceUrl,
      archivedInRepo: false,          // NEVER inherit archive state from a registry row
      sha256: null,                   // NEVER inherit a hash from another document
      status: null,
      verificationState: null,
      verificationActor: null,
      verificationActorKind: null,
      verificationBasis: null,
      jurisdictionAuthorityId: null,
      documentProduct: a.model,
      coversSelectedModelExactly: sameProduct(a.model, model),
      selectionReason: 'no registry document is on file; the legacy static asset is a render cache '
        + 'only — it carries no hash, no verification and no jurisdiction binding',
    };
  }

  // ── 4 — nothing at all, said out loud ────────────────────────────────────
  return {
    tier: 'UNAVAILABLE', authoritative: false,
    documentId: null, documentClass: null, title: null, revision: null, sourceUrl: null,
    archivedInRepo: false, sha256: null, status: null,
    verificationState: null, verificationActor: null, verificationActorKind: null,
    verificationBasis: null, jurisdictionAuthorityId: null,
    documentProduct: null, coversSelectedModelExactly: false,
    selectionReason: 'no registry document and no static asset are on file for this equipment',
  };
}

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
  /** D7 — THE SELECTED DOCUMENT, as one coherent object.
   *
   *  `assetId` / `documentTitle` / `sourceUrl` above are the LEGACY static-asset
   *  fields and are retained so no existing consumer breaks. They describe the
   *  asset, which is not necessarily the document of record. Anything that cites
   *  a document — a title beside a hash, a document id, an archive claim — must
   *  read `selectedDocument`, where every field describes the SAME row. */
  selectedDocument: SelectedDocumentAuthority;
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
  /** D7 — the registry document IDENTITIES the verdicts were selected from,
   *  keyed `${category}:${equipmentId}`. Frozen alongside the verdicts for the
   *  same reason `registryFacts` is: a sheet citing a document the build did not
   *  pre-enumerate must reach the same answer, from the same inputs. */
  registryDocuments: Record<string, RegistryDocumentIdentity[]>;
  /** VERIFIED cross-reference records only. Always empty unless one genuinely
   *  exists: the WS-8 research established that the manufacturer publishes no
   *  cross-reference, and none is ever fabricated to clear a gap. */
  aliases: Record<string, DocumentApplicabilityAlias>;
}

export function emptyEquipmentDocumentAuthority(): EquipmentDocumentAuthority {
  return { entries: {}, registryFacts: {}, registryDocuments: {}, aliases: {} };
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
  /** D7 — registry document IDENTITIES, keyed `${category}:${equipmentId}`.
   *  Optional: omitted ⇒ no registry candidate exists and the static asset is
   *  selected, which is byte-identical to the pre-D7 behaviour. */
  registryDocuments?: Record<string, RegistryDocumentIdentity[]> | null,
): EquipmentDocumentAuthority {
  const region: EquipmentDocumentAuthority = {
    entries: {},
    registryFacts: { ...(registryFacts ?? {}) },
    registryDocuments: { ...(registryDocuments ?? {}) },
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
    const model = req.selectedModel ?? asset?.model ?? null;

    // ── D7 — SELECT ONE DOCUMENT, WHOLE ──────────────────────────────────
    // The candidates are looked up under the SAME key shape as the facts, so a
    // registry document and its own custody travel together. `selectEquipmentDocument`
    // applies the precedence and returns a single coherent object.
    const candidates = registryDocuments?.[documentAuthorityKey(category, equipmentId)]
      ?? registryDocuments?.[key]
      ?? null;
    const selected = selectEquipmentDocument({
      selectedModel: model,
      candidates,
      staticAsset: asset ? { id: asset.id, docTitle: asset.docTitle ?? null, sourceUrl: asset.sourceUrl ?? null, model: asset.model ?? null } : null,
    });

    // ── D7 — FACTS MAY ONLY DESCRIBE THE SELECTED DOCUMENT ────────────────
    // The applicability evaluator takes custody facts (archive + hash + status).
    // Those must come from the document that was actually SELECTED. Passing the
    // key-scoped `facts` blindly is what let the RT-MINI manual's SHA-256 be
    // reported against the RT-MINI II asset's title. When a registry document
    // won, its own custody is used; when the static asset won, there is no
    // custody to report and `null` is the honest answer — an asset has no hash.
    const factsForSelection: DocumentRegistryFacts | null =
      selected.tier === 'REGISTRY_AUTHORITY' || selected.tier === 'REGISTRY_CANDIDATE'
        ? {
            archivedInRepo: selected.archivedInRepo,
            sha256: selected.sha256,
            status: (selected.status as DocumentRegistryFacts['status']) ?? null,
          }
        : (candidates && candidates.length ? null : facts);

    out[key] = {
      key,
      category: req.category,
      equipmentId,
      selectedModel: model,
      // LEGACY static-asset fields — retained for existing consumers.
      assetId: asset?.id ?? null,
      documentTitle: asset?.docTitle ?? null,
      sourceUrl: asset?.sourceUrl ?? null,
      applicability: evaluateDocumentApplicability(model, asset, alias, factsForSelection),
      registryFactsPresent: factsForSelection != null,
      selectedDocument: selected,
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
