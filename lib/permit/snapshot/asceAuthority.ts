// ═══════════════════════════════════════════════════════════════════════════
// D13 — THE ASCE EDITION, DECIDED ONCE.
//
// THE DEFECT THIS RETIRES. The ASCE edition reached the snapshot twice, from one
// compiled-in constant, under two provenance claims and neither was true:
//
//   build.ts:1070   asceEdition: `ASCE ${necFromRecord ? '7-22' : '7-22'}`
//   build.ts:1071   asceSource:  necFromRecord ? 'ahj-record' : 'pending-w4-ahj-authority'
//
// The first is a ternary whose branches are identical — a constant wearing the
// costume of a derivation. The second varies, and labels the edition
// `'ahj-record'` whenever the NEC came from the curated AHJ table, attributing a
// hardcoded value to the AHJ registry. That registry carries no ASCE edition at
// all; `buildCodeAuthority` states exactly that about IBC/IRC/IFC and refuses to
// infer them. The value then travelled structural.env.codeAuthority →
// asceEngineBasis → codeAuthority.editions.asce and was re-labelled
// `'structural-engine-basis'` — one constant, two records, two provenances.
//
// AND A DISCARDED AUTHORITY, the same shape as D4's dropped patch key.
// `CODE_EDITION_KINDS` includes `'asce'`, and `code-authority@v1` can retrieve an
// ADOPTED ASCE edition carrying a source hash — but `buildCodeAuthority` never
// called `adoptFor('asce')`. It overwrote the retrieval with the engine basis
// unconditionally, so a real, hashed AHJ adoption fact was unreachable.
//
// THE TWO QUESTIONS THAT SHARED ONE FIELD. "Which ASCE edition does this
// jurisdiction ADOPT?" and "Which ASCE edition were these design values COMPUTED
// under?" are different questions with different authorities. They are answered
// here together, ranked, and when they disagree that is reported as a conflict
// rather than reconciled by whichever writer ran last.
// ═══════════════════════════════════════════════════════════════════════════

/** The edition the structural engine is compiled against. This is the ONLY
 *  hardcoded ASCE edition in the projection, and it is labelled as a default —
 *  never as an authority that supplied it. */
export const ENGINE_DEFAULT_ASCE_EDITION = '7-22';

export type AsceEditionSource =
  /** an AHJ adoption retrieval named the adopted edition (hashed, attributed). */
  | 'ahj-adoption-retrieval'
  /** the hazard retrieval that produced the wind/snow/seismic design values. */
  | 'environmental-retrieval'
  /** PHASE A.2 / D8 — a VERIFIED, archived, hashed climate-hazard document whose
   *  own record names the edition it was published under. Strictly stronger
   *  evidence than a live retrieval (it is archived and content-hashed), and it
   *  was previously unreadable: only `environmentalRetrieval.edition` was
   *  consulted, so on a project whose hazard document is verified and titled
   *  "ASCE 7-22 hazard datasets" the answer still came back `engine-default`.
   *  The better the evidence on file, the weaker the reported provenance. */
  | 'archived-hazard-document'
  /** nothing on file — the engine's own compiled-in edition, said out loud. */
  | 'engine-default';

export interface AsceEditionAuthority {
  /** normalized, e.g. '7-22'. Never null: the engine always has a default, and
   *  stating it as a default is honest where inventing a source is not. */
  edition: string;
  /** display form, e.g. 'ASCE 7-22'. */
  label: string;
  source: AsceEditionSource;
  /** what to cite — a retrieval hash, never a bare module name. */
  ref: string | null;
  /** WHY this edition, in one sentence. */
  basis: string;
  /** the edition the JURISDICTION adopts, when a retrieval established one. */
  adoptedEdition: string | null;
  /** the edition the design VALUES were computed under, when a hazard retrieval
   *  established one. */
  computedEdition: string | null;
  /** true ⇔ adoption and computation name DIFFERENT editions. */
  conflict: boolean;
  conflictDetail: string | null;
}

/** Accept 'ASCE 7-22', '7-22', 'ASCE7-16' → '7-22' / '7-16'. */
export function normalizeAsce(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/7-\d{2}/);
  return m ? m[0] : null;
}

interface AdoptionLike {
  editions?: ReadonlyArray<{ kind?: string | null; edition?: string | null }> | null;
  conflicts?: ReadonlyArray<unknown> | null;
  sourceHash?: string | null;
  sourcesQueried?: ReadonlyArray<string> | null;
  ahjName?: string | null;
}
interface HazardLike {
  edition?: string | null;
  sourceHash?: string | null;
  resolverId?: string | null;
  proof?: string | null;
}

/**
 * THE ONE DECISION. Pure, total and deterministic.
 *
 *   1 ahj-adoption-retrieval   a conflict-free retrieval naming an adopted edition
 *   2 environmental-retrieval  the hazard datasets the design values came from
 *   3 engine-default           the engine's compiled-in edition
 *
 * Adoption outranks computation because adoption is what the AHJ enforces. When
 * they differ the ADOPTED edition is reported and `conflict` is set, so a
 * reviewer sees that the design values were computed under a different edition
 * than the one adopted — which is a real finding, not a formatting difference.
 */
export function resolveAsceEditionAuthority(args: {
  /** the AAC WS-3 adopted-code retrieval (`code-authority@v1`). */
  codeAdoption?: AdoptionLike | null;
  /** the AAC WS-4 hazard retrieval (`environmental-retrieval@v1`). */
  environmentalRetrieval?: HazardLike | null;
  /** D8 — a VERIFIED + archived + hashed climate-hazard document already on file.
   *  Consulted only when it is genuinely verified; an unverified or unhashed row
   *  may not establish an edition any more than it may establish a load. */
  archivedHazardDocument?: {
    edition?: string | null;
    documentId?: string | null;
    sha256?: string | null;
    verified?: boolean | null;
  } | null;
}): AsceEditionAuthority {
  // WS-3 rule, unchanged: a retrieval whose sources DISAGREE is evidence of a
  // conflict, not an adoption, and may not populate an edition.
  const adopt = args.codeAdoption && !(args.codeAdoption.conflicts ?? []).length ? args.codeAdoption : null;
  const adoptedEdition = normalizeAsce(
    adopt?.editions?.find(e => (e?.kind ?? '').toLowerCase() === 'asce')?.edition ?? null,
  );
  // D8 — an archived hazard DOCUMENT counts as a computational basis alongside a
  // live retrieval, and only when it is verified AND hashed. Retrieval wins when
  // both are present (it is what actually produced the values in this build);
  // the document answers when no retrieval ran, which is the live Braidon case.
  const _doc = args.archivedHazardDocument ?? null;
  const _docUsable = !!_doc && _doc.verified === true && !!(_doc.sha256 ?? '').trim();
  const _docEdition = _docUsable ? normalizeAsce(_doc!.edition ?? null) : null;
  const _retrievalEdition = normalizeAsce(args.environmentalRetrieval?.edition ?? null);
  const computedEdition = _retrievalEdition ?? _docEdition;

  const conflict = !!adoptedEdition && !!computedEdition && adoptedEdition !== computedEdition;
  const conflictDetail = conflict
    ? `the jurisdiction adopts ASCE ${adoptedEdition} but the design values were computed from ASCE ${computedEdition} hazard data — `
      + 'the values must be re-derived under the adopted edition, or the adoption re-confirmed'
    : null;

  if (adoptedEdition) {
    const q = adopt?.sourcesQueried?.[0] ?? 'ahj-registry';
    return {
      edition: adoptedEdition, label: `ASCE ${adoptedEdition}`,
      source: 'ahj-adoption-retrieval',
      ref: adopt?.sourceHash ? `${q}#${adopt.sourceHash.slice(0, 16)}` : q,
      basis: `ASCE ${adoptedEdition} is the edition adopted by ${adopt?.ahjName ?? 'the AHJ'}, from a code-adoption retrieval`
        + (conflict ? ` — NOTE: the design values were computed from ASCE ${computedEdition}` : ''),
      adoptedEdition, computedEdition, conflict, conflictDetail,
    };
  }

  if (_retrievalEdition) {
    const r = args.environmentalRetrieval!;
    return {
      edition: _retrievalEdition, label: `ASCE ${_retrievalEdition}`,
      source: 'environmental-retrieval',
      ref: r.sourceHash ? `${r.resolverId ?? 'environmental-retrieval'}#${r.sourceHash.slice(0, 16)}` : (r.resolverId ?? null),
      basis: `ASCE ${_retrievalEdition} is the edition the wind/snow/seismic design values were retrieved under`
        + `${r.proof === 'fixture' ? ' [FIXTURE PROOF, not live]' : ''}`
        + ' — a computational basis, not a claim of AHJ adoption',
      adoptedEdition: null, computedEdition, conflict, conflictDetail,
    };
  }

  // D8 — the archived, verified, hashed hazard document on file. Same rank as a
  // retrieval (a computational basis, never an adoption claim), but attributable
  // to a document id + content hash rather than to a live call.
  if (_docEdition) {
    return {
      edition: _docEdition, label: `ASCE ${_docEdition}`,
      source: 'archived-hazard-document',
      ref: _doc!.sha256 ? `document:${_doc!.documentId ?? 'climate-hazard'}#${_doc!.sha256!.slice(0, 16)}` : null,
      basis: `ASCE ${_docEdition} is the edition named by the VERIFIED archived climate-hazard document on file `
        + `(${_doc!.documentId ?? 'climate-hazard record'}) — a computational basis, not a claim of AHJ adoption`,
      adoptedEdition: null, computedEdition, conflict, conflictDetail,
    };
  }

  return {
    edition: ENGINE_DEFAULT_ASCE_EDITION, label: `ASCE ${ENGINE_DEFAULT_ASCE_EDITION}`,
    source: 'engine-default', ref: null,
    basis: `no adopted-code retrieval and no hazard retrieval established an ASCE edition — `
      + `ASCE ${ENGINE_DEFAULT_ASCE_EDITION} is the edition the structural engine is compiled against, stated as a default`,
    adoptedEdition: null, computedEdition: null, conflict: false, conflictDetail: null,
  };
}
