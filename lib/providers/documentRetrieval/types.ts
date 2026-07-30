// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 — THE DOCUMENT-RETRIEVAL PROVIDER (DI seam)
// ───────────────────────────────────────────────────────────────────────────
// The audit's Path 8 finding: `createDocument` performs "no fetch, no hashing,
// no archival" and "there is no ingestion path in the repo". Every structural
// document requirement therefore waited on an operator typing a SHA-256 by hand.
//
// This is the missing half: a provider that FETCHES a published manufacturer /
// authority document, verifies it is actually a document (not a soft-404 HTML
// page — see SOFT_404 below, which is exactly what design.roof-tech.us returns
// for a wrong path), and computes its content hash. The ARCHIVAL then happens
// through the existing `lib/documents/registry.createDocument` seam.
//
// WHAT IT DELIBERATELY DOES NOT DO — it never VERIFIES a document. Retrieval
// establishes existence, identity-of-bytes and provenance; whether the document
// is APPLICABLE to the selected assembly is a separate, already-existing pure
// evaluation (`evaluateRackingCapacityClearance`,
// `evaluateDocumentApplicability`), and whether it is VERIFIED is a registry /
// operator act. A fetched PDF is EVIDENCE, never a clearance.
//
// SHAPE — the AAC WS-3/WS-4 `RetrievalProvider` contract, verbatim (result
// envelope, `isConfigured()`, `metered`), so the lifecycle's DI bag, the
// fixture discipline and the failure-kind → retryability mapping are shared and
// not re-invented.
//
// QUOTA DISCIPLINE — these are free, unmetered, publicly-published manufacturer
// PDFs, so `metered: false`. The durable cache is the archived registry
// document: a document already archived for a site/assembly is never re-fetched
// (the resolver short-circuits on the registry lookup before calling this).
// ═══════════════════════════════════════════════════════════════════════════

import type { RetrievalProvider, RetrievalResult } from '../types';

/** A published document the engine knows how to go and get. */
export interface DocumentRetrievalRequest {
  /** the URL to fetch (already templated for state / code edition). */
  url: string;
  /** the media types that constitute a genuine document. A server that answers
   *  200 text/html to a wrong path is a SOFT 404, not a document. */
  acceptContentTypes: string[];
  /** refuse a body larger than this (bytes) — a runaway download is a failure,
   *  never a silent truncation. */
  maxBytes: number;
  /** transport timeout (ms). */
  timeoutMs: number;
}

/** What a successful retrieval establishes. NOTHING here is a verdict. */
export interface RetrievedDocument {
  /** the URL actually fetched (after redirects). */
  finalUrl: string;
  httpStatus: number;
  contentType: string | null;
  byteLength: number;
  /** SHA-256 of the EXACT bytes retrieved — the integrity anchor. */
  sha256: string;
  retrievedAtIso: string;
}

/** The smallest possible body that could be a real PDF; anything under this is
 *  an error page with a PDF content-type, which we refuse. */
export const MIN_DOCUMENT_BYTES = 4096;

/** A 200 response whose content-type is not in `acceptContentTypes`. Named so
 *  the failure reason can say what actually happened rather than "not found". */
export const SOFT_404 = 'SOFT-404';

export interface DocumentRetrievalProvider extends RetrievalProvider {
  readonly name: 'http-document-retrieval' | 'fixture-document-retrieval';
  fetchDocument(req: DocumentRetrievalRequest): Promise<RetrievalResult<RetrievedDocument>>;
}

export const DEFAULT_DOCUMENT_REQUEST: Omit<DocumentRetrievalRequest, 'url'> = {
  acceptContentTypes: ['application/pdf'],
  maxBytes: 32 * 1024 * 1024,
  timeoutMs: 30_000,
};
