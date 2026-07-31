// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 — the LIVE document-retrieval provider.
//
// Fetches a published manufacturer / authority document over HTTPS, refuses
// anything that is not actually a document, and hashes the exact bytes.
//
// FAILURE IS NEVER SWALLOWED (directive "Execution discipline"): a timeout, a
// non-2xx, a soft-404 HTML body and an under-size body are four DIFFERENT
// failures with four different reasons, and each maps to its own retryability
// through the shared `retryabilityFor`.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { retrievalFailure, retrievalOk, type RetrievalResult } from '../types';
import {
  MIN_DOCUMENT_BYTES, SOFT_404,
  type DocumentRetrievalProvider, type DocumentRetrievalRequest, type RetrievedDocument,
} from './types';

export interface HttpDocumentProviderOptions {
  /** deterministic clock for the run (the lifecycle passes its own). */
  nowIso?: string;
  /** DI seam for tests that want to exercise the transport logic itself. */
  fetchImpl?: typeof fetch;
  /** Master switch. Retrieval is ON by default in production and OFF under
   *  vitest, so no test silently reaches the public internet (the same rule the
   *  WS-3/WS-4 provider bag applies). */
  enabled?: boolean;
}

function isTestRuntime(): boolean {
  return process.env.VITEST === 'true' || process.env.VITEST === '1' || process.env.NODE_ENV === 'test';
}

export function createHttpDocumentRetrievalProvider(
  opts?: HttpDocumentProviderOptions,
): DocumentRetrievalProvider {
  const enabled = opts?.enabled ?? (!isTestRuntime() && process.env.AAC_DOCUMENT_RETRIEVAL !== '0');
  const doFetch = opts?.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);

  return {
    name: 'http-document-retrieval',
    metered: false,
    isConfigured: () => enabled && typeof doFetch === 'function',

    async fetchDocument(req: DocumentRetrievalRequest): Promise<RetrievalResult<RetrievedDocument>> {
      const retrievedAtIso = opts?.nowIso ?? new Date().toISOString();
      const sourcesQueried = [req.url];
      if (!enabled || typeof doFetch !== 'function') {
        return retrievalFailure({
          sourcesQueried, retrievedAtIso,
          failure: `document retrieval is disabled in this runtime (${!enabled ? 'AAC_DOCUMENT_RETRIEVAL=0 or test runtime' : 'no fetch implementation'}) — ${req.url} was NOT fetched`,
          failureKind: 'NOT_CONFIGURED',
          operatorAction: null,
        });
      }
      if (!/^https:\/\//i.test(req.url)) {
        return retrievalFailure({
          sourcesQueried, retrievedAtIso,
          failure: `refused: a document source must be https (got '${req.url}')`,
          failureKind: 'INSUFFICIENT_QUERY', operatorAction: null,
        });
      }

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), req.timeoutMs);
      try {
        const res = await doFetch(req.url, { redirect: 'follow', signal: ctrl.signal });
        const finalUrl = (res as unknown as { url?: string }).url || req.url;
        if (!res.ok) {
          return retrievalFailure({
            sourcesQueried: [finalUrl], retrievedAtIso,
            failure: `HTTP ${res.status} ${res.statusText || ''}`.trim() + ` from ${finalUrl}`,
            failureKind: res.status >= 500 ? 'TRANSPORT' : 'NO_COVERAGE',
            operatorAction: null,
          });
        }
        const contentType = res.headers.get('content-type');
        const baseType = (contentType ?? '').split(';')[0].trim().toLowerCase();
        if (!req.acceptContentTypes.includes(baseType)) {
          // design.roof-tech.us answers 200 text/html for every wrong path. That
          // is a SOFT 404 and must never be archived as a document.
          return retrievalFailure({
            sourcesQueried: [finalUrl], retrievedAtIso,
            failure: `${SOFT_404}: ${finalUrl} answered HTTP 200 with content-type '${baseType || '(none)'}', not `
              + `${req.acceptContentTypes.join('|')} — the published document does not exist at this address`,
            failureKind: 'NO_COVERAGE', operatorAction: null,
          });
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > req.maxBytes) {
          return retrievalFailure({
            sourcesQueried: [finalUrl], retrievedAtIso,
            failure: `refused: ${finalUrl} returned ${buf.byteLength} bytes, above the ${req.maxBytes}-byte cap`,
            failureKind: 'PARSE', operatorAction: null,
          });
        }
        if (buf.byteLength < MIN_DOCUMENT_BYTES) {
          return retrievalFailure({
            sourcesQueried: [finalUrl], retrievedAtIso,
            failure: `refused: ${finalUrl} returned only ${buf.byteLength} bytes — below the ${MIN_DOCUMENT_BYTES}-byte `
              + 'minimum for a genuine document (an error page carrying a document content-type)',
            failureKind: 'NO_COVERAGE', operatorAction: null,
          });
        }
        return retrievalOk<RetrievedDocument>({
          value: {
            finalUrl,
            httpStatus: res.status,
            contentType: baseType || null,
            byteLength: buf.byteLength,
            sha256: createHash('sha256').update(buf).digest('hex'),
            retrievedAtIso,
          },
          sourcesQueried: [finalUrl], retrievedAtIso, confidence: 1,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        return retrievalFailure({
          sourcesQueried, retrievedAtIso,
          failure: `transport failure fetching ${req.url} — ${msg}`,
          failureKind: 'TRANSPORT', operatorAction: null,
        });
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
