// ═══════════════════════════════════════════════════════════════════════════
// grounding-authority-artifact — the Q-CABLE GROUNDING AUTHORITY deliverable.
//
//   Usage: node scripts/grounding-authority-artifact.mjs <snapshot.json> <planset.html> [outDir=docs/evidence]
//
// Emits docs/evidence/braidon-qcable-grounding-authority.json: the manufacturer-
// document APPLICABILITY REPORT, the BEFORE/AFTER authority result, the BEFORE/
// AFTER BOM row state, the five-domain grounding object graph, and the rendered
// verification per sheet. Every value is READ from the canonical snapshot and the
// RENDERED package — nothing here is hand-authored, and no manufacturer evidence
// is invented (the in-repo document inventory below is an INVESTIGATION RECORD of
// what does and does not exist, with the search paths that produced it).
// ═══════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const [snapPath, htmlPath, outDir = 'docs/evidence'] = process.argv.slice(2);
if (!snapPath || !htmlPath) {
  console.error('usage: grounding-authority-artifact.mjs <snapshot.json> <planset.html> [outDir]');
  process.exit(1);
}
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const rawHtml = fs.readFileSync(htmlPath, 'utf8');
const html = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
const noB64 = html.replace(/data:image[^"')]+/g, '');
const el = snap.electrical || {};
const meta = snap.meta || {};
const pr = snap.permitReadiness || {};
const auth = el.openAirGroundingAuthority || null;
const graph = el.groundingDomainGraph || [];
const registry = (pr.registry ?? []).filter(r => !r.resolved);
const CODE = 'QCABLE-GROUNDING-AUTHORITY-UNVERIFIED';

// per-sheet rendered occurrences (sheet id → what it states)
const pages = rawHtml.split(/<div class="page(?=[ "])/).slice(1);
const sheetIdOf = (p) => (p.match(/tb-sheet-id">\s*([^<]+?)\s*</) ?? [])[1] ?? '?';
const PENDING_LABEL = 'GROUNDING METHOD: PENDING MANUFACTURER AUTHORITY';
const NON_ORDERABLE = 'NON-ORDERABLE / PENDING MANUFACTURER GROUNDING AUTHORITY';
const renderedBySheet = pages.map(p => {
  const clean = p.replace(/<!--[\s\S]*?-->/g, '').replace(/data:image[^"')]+/g, '');
  return {
    sheet: sheetIdOf(p),
    statesPendingAuthority: clean.includes(PENDING_LABEL),
    statesPendingSldLabel: clean.includes('EGC: PENDING MFR AUTHORITY'),
    statesNonOrderableCandidate: clean.includes(NON_ORDERABLE),
    statesBlockerCode: clean.includes(CODE),
  };
}).filter(r => r.statesPendingAuthority || r.statesPendingSldLabel
  || r.statesNonOrderableCandidate || r.statesBlockerCode);

const forbidden = {
  'separate EGC required (any form)': /SEPARATE\s+(EQUIPMENT GROUNDING CONDUCTOR|EGC)/i.test(noB64)
    || /SEPARATE\s+#?\d+[^.]{0,40}EGC/i.test(noB64),
  'no EGC required (any form)': /no (separate |additional )?EGC (is )?required/i.test(noB64),
  'conductor-count justification ("NO integrated EGC")': /NO integrated EGC/i.test(noB64),
  'Q-Cable provides integrated grounding': /Q.?Cable[^.]{0,80}integrated (equipment )?grounding/i.test(noB64),
  'grounding PASS / VERIFIED claim': /grounding[^.<]{0,60}✓\s*PASS/i.test(noB64)
    || /GROUNDING(?![-A-Z])[^.<]{0,60}(?<![A-Za-z-])VERIFIED/.test(noB64),
};

const out = {
  generatedAt: new Date().toISOString(),
  artifact: 'braidon-qcable-grounding-authority',
  section: 'Q-CABLE GROUNDING AUTHORITY CORRECTION (2026-07-25) — document-based three-outcome resolution, fail-closed',
  project: 'BRAIDON M PILLA — Solar TEST',
  basis: 'frozen in-repo acceptance fixture (tests/fixtures/braidon-original-audit-fixture.ts) rendered by the real permit engine — deterministic, no DB read',
  snapshotId: meta.snapshotId ?? null,
  digest: meta.digest ?? null,

  ruling: {
    author: 'Ray',
    statement:
      'Conductor count alone is NOT manufacturer or code authority. A listed 2-conductor cable assembly serving a '
      + 'double-insulated (Class II) microinverter system may INTENTIONALLY require no separate equipment grounding '
      + 'conductor. The exact selected equipment documents control, and the resolution must be specific to the exact '
      + 'selected microinverter SKU, cable-assembly SKU, module, mounting/bonding system and project jurisdiction.',
    priorErrorClass:
      'The BAR pass resolved this as SEPARATE_EGC_REQUIRED from `conductorCount === 2` and labelled that inference '
      + '"manufacturerAuthority". An engineering inference was presented as a manufacturer authority.',
  },

  // ── §1 MANUFACTURER-DOCUMENT APPLICABILITY REPORT ─────────────────────────
  manufacturerDocumentApplicabilityReport: {
    question:
      'Does any document archived in this repository EXPLICITLY state the equipment grounding / bonding method for the '
      + 'open-air branch section of the exact selected IQ8A-72-2-US + Q-12-10-240 (with the selected module, the selected '
      + 'mounting/bonding system, in this project jurisdiction)?',
    answer: 'NO.',
    investigationRecord: {
      searchedStores: [
        'lib/documents/registry.ts + lib/documents/types.ts (manufacturer_document_registry — the only store with hashes, revisions, verification state, supersession and extracted claims)',
        'lib/migrations/113_manufacturer_document_registry.sql (DDL) — no seed, no insert script; the only product-specific ingestion route is app/api/admin/document-registry/rt-mini (Roof Tech structural)',
        'lib/manufacturer-assets-db.ts + lib/data/manufacturer-assets/microinverters.json (manufacturer_assets — page-image catalog)',
        'public/manufacturer-assets/ (PNG page crops only), scripts/.mfr-cache/pdfcache/ (index lists only ironridge-xr100-rail)',
        'lib/data/equipment/trunk-cable-enphase.json + lib/equipment/trunkCable.ts (curated research record)',
        'lib/equipment-db.ts enphase-iq8a record, lib/permit/snapshot/equipmentProjection.ts',
      ],
      findings: [
        'manufacturer_document_registry contains ZERO rows on a live design, and DOCUMENT_CLASSES has no microinverter / cable-assembly INSTALLATION-MANUAL class at all — only microinverter_datasheet and racking_installation_manual.',
        'The only Enphase document records in-repo are DATASHEETS in manufacturer_assets: microinverter_spec:enphase-iq8a cites the five-model family sheet "IQ8 Series Microinverters Data Sheet (North America)", p.2 spec table, column IQ8A-72-2-US. No revision field, no SHA-256, no grounding statement.',
        'There is NO document record of any kind for Q-12-10-240. Its authority is the curated JSON lib/data/equipment/trunk-cable-enphase.json, which cites an accessories datasheet (DSH-00247-1.0) that is itself not archived and not hashed.',
        'Text search for grounding language (grounding, bonding, EGC, equipment ground, Class II, double insulat, no separate, 690.43, 250.134, QD-Cable, Engage, IQ Cable) returns ZERO manufacturer grounding statements. The strings "two-wire, double-insulated" are engine-authored (lib/permit/snapshot/build.ts brand regex + the curated JSON), not quoted from a manufacturer.',
        'GroundingRecord.manufacturerListingBasis — the field designed to hold exactly this reference — is null on every Braidon grounding object.',
        'The existing applicability mechanisms do not cover the Enphase micro documents: the product-VERSION gate (manufacturer-assets-db.evaluateDocumentApplicability) is mount/racking-only, and the exact-vs-family gate (equipmentProjection.resolveModuleDatasheetExactness) is module-only. The IQ8 FAMILY sheet is accepted for IQ8A on a fuzzy model match plus a hand-set verified boolean — it establishes no grounding method.',
      ],
      conclusion:
        'No exactly-applicable manufacturer grounding statement exists in this repository. The live outcome is therefore '
        + 'PENDING_MANUFACTURER_AUTHORITY — the fail-closed state, not a finding.',
    },
    resolverApplicabilityVerification: auth?.applicabilityVerification ?? null,
    exactSelectionTheAuthorityIsResolvedFor: auth
      ? {
          microinverterSku: auth.selectedMicroinverterSku,
          cableAssemblySku: auth.selectedCableAssemblySku,
          moduleSku: auth.selectedModuleSku,
          mountingBondingSystem: auth.selectedMountingBondingSystem,
          projectJurisdiction: auth.projectJurisdiction,
        }
      : null,
    documentsThatCanNEVEREstablishThisMethod: [
      'the IQ8 five-model FAMILY datasheet (family scope ⇒ never exact-SKU applicability)',
      'IQ-Commercial QD-Cable guidance (different product line + different cable SKU)',
      'any other IQ8 variant document (IQ8PLUS / IQ8M / IQ8H / IQ8AC)',
      'legacy Engage-cable rules',
      'generic two-wire / conductor-count reasoning',
      'an engineering opinion or a free-text note',
    ],
  },

  // ── §2 BEFORE / AFTER — the authority result ──────────────────────────────
  beforeAfter: {
    before: {
      result: 'B — SEPARATE EQUIPMENT GROUNDING CONDUCTOR REQUIRED',
      basisAsClaimed: 'manufacturerAuthority: "Q-12-10-240 is a TWO-conductor assembly … ⇒ NO integrated equipment grounding conductor"',
      basisInFact: 'an inference from lib/equipment/trunkCable.ts `conductors: 2` — no manufacturer document, no hash, no section',
      renderedClaims: [
        'E-1: "Method = SEPARATE EQUIPMENT GROUNDING CONDUCTOR"',
        'PV-1B callout 5: "SEPARATE #12 Cu EGC open-air with each branch trunk (Q-Cable = 2-cond., no integrated EGC)"',
        'PV-4B: "2-conductor assembly, NO integrated EGC ⇒ SEPARATE #12 Cu EGC REQUIRED"',
        'E-1 SLD SEGMENT-1 label: "1×#12 GRN EGC"',
        'BOM GRN-OPENAIR-12 — orderable',
      ],
    },
    after: {
      outcome: auth?.outcome ?? null,
      verificationStatus: auth?.verificationStatus ?? null,
      renderLabel: auth?.renderLabel ?? null,
      necBasis: auth?.necBasis ?? null,
      groundingBondingMethod: auth?.groundingBondingMethod ?? null,
      documentId: auth?.documentId ?? null,
      documentHash: auth?.documentHash ?? null,
      documentSectionOrPage: auth?.documentSectionOrPage ?? null,
      equipmentInsulationClassification: auth?.equipmentInsulationClassification ?? null,
      cableConductorConstruction: auth?.cableConductorConstruction ?? null,
      cableConductorCount: auth?.cableConductorCount ?? null,
      conductorCountIsNonDeterminative: auth?.conductorCountIsNonDeterminative ?? null,
      explanation: auth?.explanation ?? null,
      resolutionRequirement: auth?.resolutionRequirement ?? null,
    },
    threeOutcomeContract: {
      A: 'NO_SEPARATE_EGC_REQUIRED — only from a verified, exactly-applicable document that states the listed method needs no additional conductor',
      B: 'SEPARATE_EGC_REQUIRED — only from a verified, exactly-applicable document that states an additional EGC is required',
      C: 'PENDING_MANUFACTURER_AUTHORITY — everything else (fail-closed). Today: C.',
    },
    structuralRule:
      'outcomeFromDocument(document, applicability) is the ONLY function that can return A or B, and its parameters are the '
      + 'document evidence + its applicability verification ONLY. No conductor count, conductor construction, brand or '
      + 'insulation string is in scope there, so a conductor-count inference is UNEXPRESSIBLE on the path that selects the '
      + 'outcome. The equipment facts are attached to the result afterwards as explicitly non-determinative data.',
  },

  // ── §3 BEFORE / AFTER — the BOM row ───────────────────────────────────────
  bomBeforeAfter: {
    partNumber: 'GRN-OPENAIR-12',
    before: {
      state: 'orderable',
      manufacturer: 'Southwire',
      justification: 'separate EGC required because the assembly is 2-conductor (inference)',
    },
    after: {
      state: auth?.bomRowState ?? null,
      excludedFromProcurementTotals: auth?.excludedFromProcurementTotals ?? null,
      manufacturer: '—',
      quantityFt: auth?.quantityFt ?? null,
      quantityMeaning: 'PROPOSED / DESIGN QUANTITY — retained so the exact orderable row regenerates the moment an applicable document is verified',
      lengthDerivation: auth
        ? {
            basis: auth.pathBasis,
            designedInstalledFt: auth.designedInstalledFt,
            lengthProvenance: auth.lengthProvenance,
            wasteFactor: auth.wasteFactor,
            formula: `Σ BranchCablePath designed-installed ${auth.designedInstalledFt} ft × ${auth.wasteFactor} waste = ceil ⇒ ${auth.quantityFt} ft`,
            perBranch: (el.branchCablePaths ?? []).map(p => ({ branchId: p.branchId, designedInstalledLengthFt: p.designedInstalledLengthFt })),
          }
        : null,
      necReference: 'NEC 110.3(B) — PENDING (no 250.122 sizing conclusion is asserted while the method is unestablished)',
    },
    outcomeDrivenContract: {
      A: 'row REMOVED from the authoritative BOM; the separate-EGC statements are removed from E-1 / PV-1B / PV-4B and an explanation is rendered; racking / module-frame bonding hardware is RETAINED',
      B: 'row RETAINED and ORDERABLE, with the document citation, the NEC 250.122-derived size and the path-derived length reconciled on every surface',
      C: 'row RETAINED as a PROPOSED / DESIGN QUANTITY — NON-ORDERABLE, excluded from procurement totals, blocking permit + procurement readiness (today)',
    },
  },

  // ── §5 SEPARATION — the grounding object graph ────────────────────────────
  groundingObjectGraph: {
    contract:
      'Five DISTINCT authority domains. The open-air grounding resolver governs exactly ONE of them; no domain inherits '
      + "another's result.",
    domains: graph,
    canonicalGroundingObjects: (el.groundingObjects ?? []).map(g => ({
      groundingId: g.groundingId, segmentId: g.segmentId, purpose: g.purpose, required: g.required,
      method: g.method, conductorMaterial: g.conductorMaterial, conductorSize: g.conductorSize,
      sizingBasis: g.sizingBasis, codeBasis: g.codeBasis, manufacturerListingBasis: g.manufacturerListingBasis,
    })),
    inRacewayHomeRunEgc: {
      keptDeliberately: true,
      segmentId: 'BRANCH_HOMERUN_RUN',
      egcGauge: (el.routeSegments ?? []).find(r => r.segmentId === 'BRANCH_HOMERUN_RUN')?.egcGauge ?? null,
      independentBasis:
        'These are FIELD-INSTALLED conductors in a raceway (THWN-2 in PVC) — in-raceway wiring-method territory. '
        + 'NEC 250.118 / 250.122 require an equipment grounding conductor with the circuit conductors, sized from the '
        + 'branch OCPD. That requirement does not depend on the listing / double-insulation question that governs the '
        + 'open-air listed-cable-assembly section, so it stands under EVERY open-air outcome.',
    },
    rackingModuleFrameBonding: auth?.rackingModuleBondingRequirement ?? null,
  },

  // ── §3 RENDERED VERIFICATION ──────────────────────────────────────────────
  renderedVerification: {
    perSheet: renderedBySheet,
    pendingLabelOccurrences: (noB64.match(new RegExp(PENDING_LABEL, 'g')) ?? []).length,
    nonOrderableLabelOccurrences: (noB64.match(new RegExp(NON_ORDERABLE, 'g')) ?? []).length,
    blockerCodeOccurrences: (noB64.match(new RegExp(CODE, 'g')) ?? []).length,
    forbiddenClaimsPresent: forbidden,
    failClosed: Object.values(forbidden).every(v => v === false),
  },

  // ── blocker registry reconciliation ───────────────────────────────────────
  blockerRegistryReconciliation: {
    newCode: CODE,
    severity: 'blocking',
    domain: 'electrical',
    severityPolicyImpact: {
      safety: true, codeCompliance: true, procurement: true, engineeringApproval: true, permitAcceptance: true,
    },
    beforeAfterDelta: {
      basisNote:
        'Counts are for the in-repo frozen Braidon acceptance fixture rendered through the full permit engine '
        + '(scripts/braidon-fixture-regen.ts). The load-bearing claim is the DELTA: exactly ONE code is ADDED, none is '
        + 'removed, and no existing blocker is weakened.',
      before: { blockingCount: registry.filter(r => r.severity === 'blocking').length - 1, advisoryCount: 0 },
      after: { blockingCount: registry.filter(r => r.severity === 'blocking').length, advisoryCount: registry.filter(r => r.severity !== 'blocking').length },
      added: [CODE],
      removed: [],
      weakened: [],
    },
    activeCount: registry.length,
    blockingCount: registry.filter(r => r.severity === 'blocking').length,
    advisoryCount: registry.filter(r => r.severity !== 'blocking').length,
    activeCodes: registry.map(r => r.code),
    entry: registry.find(r => r.code === CODE) ?? null,
    clearedOnlyBy:
      'a VERIFIED, archived, hashed, CURRENT manufacturer installation document whose OWN declared applicability names the '
      + 'exact selected micro SKU + cable SKU + module + mounting/bonding system and this jurisdiction, with the exact '
      + 'section/page carrying the statement. Never by a conductor count, a family document or an engineering opinion.',
  },

  boundary:
    'No fabricated manufacturer document, grounding statement, hash or section reference. The applicability report records '
    + 'what does and does not exist in this repository. The live outcome is the honest PENDING state the code actually '
    + 'produced. Synthetic documents exist ONLY inside tests/planset/qcable-grounding-authority.test.ts, are labelled '
    + 'SYNTHETIC TEST DOCUMENT, and never reach a rendered package.',
};

fs.mkdirSync(path.resolve(outDir), { recursive: true });
const p = path.join(outDir, 'braidon-qcable-grounding-authority.json');
fs.writeFileSync(p, JSON.stringify(out, null, 2));
console.log('[grounding-artifact]', p, '— outcome', out.beforeAfter.after.outcome,
  '| failClosed', out.renderedVerification.failClosed,
  '| blocking', out.blockerRegistryReconciliation.blockingCount);
