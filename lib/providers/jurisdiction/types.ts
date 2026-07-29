// ═══════════════════════════════════════════════════════════════════════════
// AAC WS-3 — ADOPTED-CODE / AHJ RETRIEVAL PROVIDER (the contract)
// ───────────────────────────────────────────────────────────────────────────
// Audit §2.1 / §7.5: `lookupAhjFromRegistry` (SunSpec / Orange Button) already
// returns `ElectricCode`, `BuildingCode`, `ResidentialCode` and `FireCode` per
// lat/lng — the EXACT three editions CODE-AUTHORITY-INCOMPLETE is blocked on —
// and `mapRegistryToAhjRecord` discarded three of the four. That is fixed in
// lib/jurisdictions/ahjRegistry.ts; this is the DI provider around it.
//
// WHAT MAY AND MAY NOT ESTABLISH AN ADOPTED EDITION (WS-3, binding):
//   MAY  — a retrieval from an authoritative registry, WITH the source URL, the
//          retrieval timestamp, and a hash of the payload. Retrieval WITH
//          provenance is not inference.
//   MAY  — a curated in-repo record, as a CORROBORATING second source only.
//   MAY NOT — a hardcoded table with no provenance, standing alone.
//   MAY NOT — a title-block default, sourceless prior text, or a generic state
//          assumption where a local adoption controls.
//   MAY NOT — the UTILITY territory. Ameren Illinois serving the meter says
//          nothing about which building code Madison County enforces.
// ═══════════════════════════════════════════════════════════════════════════

import type { RetrievalProvider, RetrievalResult } from '../types';
import type { RegistryCodeAdoption } from '@/lib/jurisdictions/ahjRegistry';

export interface CodeAdoptionQuery {
  lat: number | null;
  lng: number | null;
  address: string | null;
  stateCode: string | null;
  county: string | null;
  city: string | null;
}

export interface RetrievedCodeAdoption {
  /** the single AHJ of record. */
  record: RegistryCodeAdoption;
  /** every AHJ the query matched. length > 1 ⇒ overlapping jurisdiction, which
   *  is an OPERATOR_CONFIRMATION, never an engine choice. */
  allMatches: RegistryCodeAdoption[];
  proof: 'live-retrieval' | 'fixture';
  fixtureProvenance?: string | null;
}

export interface CodeAdoptionProvider extends RetrievalProvider {
  getCodeAdoption(q: CodeAdoptionQuery): Promise<RetrievalResult<RetrievedCodeAdoption>>;
}
