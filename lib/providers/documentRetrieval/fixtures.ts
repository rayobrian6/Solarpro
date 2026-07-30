// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-8 — DETERMINISTIC DOCUMENT-RETRIEVAL FIXTURES.
//
// The directive: "Providers unavailable in test env → dependency injection +
// deterministic fixtures, clearly distinguishing FIXTURE proof from LIVE
// retrieval proof."
//
// Every record below is a REPLAY of a retrieval that was actually performed
// against the live manufacturer host on the date stamped in `capturedAtIso`.
// The byte lengths and SHA-256 digests are the real ones. A test that consumes
// this bag is proving the RESOLVER, and its evidence is labelled
// `fixture-replay`; only a production run through
// `createHttpDocumentRetrievalProvider` produces `live-retrieval` proof.
// ═══════════════════════════════════════════════════════════════════════════

import { retrievalFailure, retrievalOk, type RetrievalResult } from '../types';
import { SOFT_404, type DocumentRetrievalProvider, type DocumentRetrievalRequest, type RetrievedDocument } from './types';

export interface DocumentFixture {
  url: string;
  httpStatus: number;
  contentType: string | null;
  byteLength: number;
  sha256: string | null;
  /** when the live retrieval this record replays was performed. */
  capturedAtIso: string;
  /** set when the live host answered but did NOT serve a document. */
  softFailure?: string;
}

/** Live retrievals captured 2026-07-27 against design.roof-tech.us. */
export const ROOF_TECH_DOCUMENT_FIXTURES: DocumentFixture[] = [
  {
    url: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI.pdf',
    httpStatus: 200, contentType: 'application/pdf', byteLength: 2042678,
    sha256: '2f6035586e948758ff1892f2775a1a6905120750eaf2158f206a2155687486be',
    capturedAtIso: '2026-07-27T00:00:00.000Z',
  },
  {
    url: 'https://design.roof-tech.us/PDF/Installation-Manuals/Installation-Manual-RT-MINI-II.pdf',
    httpStatus: 200, contentType: 'application/pdf', byteLength: 2157589,
    sha256: '6d868692a90bb0cc4df1919934e6cb81fee3ca668a3b22e3cf06cce255e33bb0',
    capturedAtIso: '2026-07-27T00:00:00.000Z',
  },
  {
    url: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/RT_Mini_II_ASCE_7-10_KY.pdf',
    httpStatus: 200, contentType: 'application/pdf', byteLength: 4086298,
    sha256: '2e28a74ca306fdc1dd856f69b066d95a8b4b944f6b9b5ae86fff478e8af9588b',
    capturedAtIso: '2026-07-27T00:00:00.000Z',
  },
  {
    // The IL letters were confirmed live (byte length recorded); their digests
    // are NOT captured here, so a fixture run reports them as retrieved-without-
    // hash rather than inventing one.
    url: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/RT_Mini_II_ASCE_7-10_IL.pdf',
    httpStatus: 200, contentType: 'application/pdf', byteLength: 5689999, sha256: null,
    capturedAtIso: '2026-07-27T00:00:00.000Z',
  },
  {
    url: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_16/RT_Mini_II_ASCE_7-16_IL.pdf',
    httpStatus: 200, contentType: 'application/pdf', byteLength: 11228523, sha256: null,
    capturedAtIso: '2026-07-27T00:00:00.000Z',
  },
  {
    // The directory URL cited in rackingAssembly.ts — 403, not a document.
    url: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_II_7_10/',
    httpStatus: 403, contentType: 'text/html', byteLength: 13, sha256: null,
    capturedAtIso: '2026-07-27T00:00:00.000Z',
    softFailure: 'HTTP 403 Forbidden — a directory index, not a document',
  },
  {
    // Proof the legacy RT-MINI has NO PE letter published at the family pattern.
    url: 'https://design.roof-tech.us/PDF/Stamped-PE-Letters/RT_MINI_7_10/RT_Mini_ASCE_7-10_IL.pdf',
    httpStatus: 200, contentType: 'text/html', byteLength: 3059, sha256: null,
    capturedAtIso: '2026-07-27T00:00:00.000Z',
    softFailure: `${SOFT_404}: the host answered 200 text/html — no RT-MINI (first-generation) stamped PE letter is published at this address`,
  },
];

/** A provider that replays captured retrievals and NEVER touches the network. */
export function createFixtureDocumentRetrievalProvider(
  fixtures: DocumentFixture[] = ROOF_TECH_DOCUMENT_FIXTURES,
  opts?: { nowIso?: string; configured?: boolean },
): DocumentRetrievalProvider {
  const byUrl = new Map(fixtures.map(f => [f.url, f]));
  return {
    name: 'fixture-document-retrieval',
    metered: false,
    isConfigured: () => opts?.configured ?? true,
    async fetchDocument(req: DocumentRetrievalRequest): Promise<RetrievalResult<RetrievedDocument>> {
      const retrievedAtIso = opts?.nowIso ?? '2026-07-27T00:00:00.000Z';
      const f = byUrl.get(req.url);
      if (!f) {
        return retrievalFailure({
          sourcesQueried: [req.url], retrievedAtIso,
          failure: `no captured retrieval for ${req.url} — the fixture bag does not cover this source`,
          failureKind: 'NOT_CONFIGURED', operatorAction: null,
        });
      }
      const baseType = (f.contentType ?? '').toLowerCase();
      if (f.softFailure || f.httpStatus !== 200 || !req.acceptContentTypes.includes(baseType)) {
        return retrievalFailure({
          sourcesQueried: [f.url], retrievedAtIso,
          failure: f.softFailure ?? `HTTP ${f.httpStatus} with content-type '${baseType || '(none)'}' from ${f.url}`,
          failureKind: 'NO_COVERAGE', operatorAction: null,
        });
      }
      if (!f.sha256) {
        // Retrieved, but this fixture carries no captured digest. An archival
        // needs a hash, so this is an honest PARSE-class failure rather than a
        // fabricated digest.
        return retrievalFailure({
          sourcesQueried: [f.url], retrievedAtIso,
          failure: `${f.url} was confirmed live (HTTP 200, ${f.byteLength} bytes) but no content hash was captured in `
            + 'this fixture — a document may not be archived without a SHA-256',
          failureKind: 'PARSE', operatorAction: null,
        });
      }
      return retrievalOk<RetrievedDocument>({
        value: {
          finalUrl: f.url, httpStatus: f.httpStatus, contentType: baseType,
          byteLength: f.byteLength, sha256: f.sha256, retrievedAtIso,
        },
        sourcesQueried: [f.url], retrievedAtIso, confidence: 1,
      });
    },
  };
}
