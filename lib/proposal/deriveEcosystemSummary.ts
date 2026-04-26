// ═══════════════════════════════════════════════════════════════════════
// lib/proposal/deriveEcosystemSummary.ts
// v47.398 — Derive ecosystem-aware marketing summary for proposals.
//
// RULES
//   • Deterministic: same inputs → same output. No randomness.
//   • No fabrication: only describes what is explicitly present.
//   • Fallback: if mixed brands or unknown, returns a generic sentence.
//   • Confidence gated: requires a dominant-brand match ≥ threshold.
//   • Pure function: no side effects, no network, no DB writes.
// ═══════════════════════════════════════════════════════════════════════

export interface EquipmentRef {
  manufacturer?: string;
  model?: string;
  category?: string;
  ecosystemBrand?: string;
}

export interface EcosystemSummaryInput {
  /** Panel(s) on the system. Optional. */
  panels?: EquipmentRef[];
  /** Inverter(s). Can be string, micro, or optimizer central. */
  inverters?: EquipmentRef[];
  /** Battery system(s), if any. */
  batteries?: EquipmentRef[];
  /** Monitoring gateway / data comm device, if any. */
  gateways?: EquipmentRef[];
  /** EV charger(s), if any. */
  evChargers?: EquipmentRef[];
  /** Generator, ATS, backup interface, etc. — optional. */
  backup?: EquipmentRef[];
}

export interface EcosystemSummaryOutput {
  /** The marketing sentence to show in the proposal. */
  sentence: string;
  /** Dominant ecosystem brand id (or 'mixed' / 'unknown'). */
  brand: string;
  /** 0-1 confidence in the dominant brand classification. */
  confidence: number;
  /** Whether the caller should show this as ecosystem-branded copy. */
  showEcosystemCopy: boolean;
  /** Human-readable components list used in the sentence. */
  highlights: string[];
}

const CONFIDENCE_THRESHOLD = 0.6;

// Per-brand marketing copy. Keep to known ecosystems only.
// Sentences are deliberately conservative — describing hardware, not
// claims about reliability, pricing, or comparative performance.
const BRAND_COPY: Record<
  string,
  { name: string; template: (highlights: string[]) => string }
> = {
  tesla: {
    name: 'Tesla',
    template: (h) =>
      `This system uses the Tesla Energy ecosystem${
        h.length ? `, including ${formatList(h)}` : ''
      }. Components are designed to operate together through the Tesla app, with integrated monitoring, backup control, and EV charging management.`,
  },
  enphase: {
    name: 'Enphase',
    template: (h) =>
      `This system is built on the Enphase IQ8 microinverter architecture${
        h.length ? `, including ${formatList(h)}` : ''
      }. Each module operates independently for shade tolerance and panel-level monitoring through the Enphase Enlighten platform.`,
  },
  solaredge: {
    name: 'SolarEdge',
    template: (h) =>
      `This system uses SolarEdge's optimizer-based DC architecture${
        h.length ? `, including ${formatList(h)}` : ''
      }. Per-panel optimizers deliver module-level MPPT tracking and rapid shutdown, with cloud monitoring through the SolarEdge mySolarEdge app.`,
  },
  generac: {
    name: 'Generac',
    template: (h) =>
      `This system uses the Generac PWRcell storage platform${
        h.length ? `, including ${formatList(h)}` : ''
      }, providing DC-coupled battery integration and whole-home backup capability.`,
  },
  apsystems: {
    name: 'APsystems',
    template: (h) =>
      `This system uses APsystems dual-module microinverters${
        h.length ? `, including ${formatList(h)}` : ''
      }, with panel-pair level monitoring through the APsystems EMA platform.`,
  },
  hoymiles: {
    name: 'Hoymiles',
    template: (h) =>
      `This system uses Hoymiles microinverters${
        h.length ? `, including ${formatList(h)}` : ''
      }, with module-level monitoring through the Hoymiles S-Miles Cloud platform.`,
  },
};

/**
 * Main entry point. Analyzes selected equipment and returns a proposal
 * sentence describing the ecosystem — or a neutral fallback if mixed.
 */
export function deriveEcosystemSummary(
  input: EcosystemSummaryInput
): EcosystemSummaryOutput {
  const allEquipment: EquipmentRef[] = [
    ...(input.panels || []),
    ...(input.inverters || []),
    ...(input.batteries || []),
    ...(input.gateways || []),
    ...(input.evChargers || []),
    ...(input.backup || []),
  ].filter((e) => e && (e.ecosystemBrand || e.manufacturer));

  if (allEquipment.length === 0) {
    return {
      sentence: '',
      brand: 'unknown',
      confidence: 0,
      showEcosystemCopy: false,
      highlights: [],
    };
  }

  // Count brand hits (prefer ecosystemBrand; fall back to manufacturer)
  const counts: Record<string, number> = {};
  for (const e of allEquipment) {
    const b =
      (e.ecosystemBrand || '').toLowerCase() ||
      (e.manufacturer || '').toLowerCase();
    if (!b) continue;
    counts[b] = (counts[b] || 0) + 1;
  }

  // Find dominant brand
  let dominant = '';
  let maxCount = 0;
  let total = 0;
  for (const [b, c] of Object.entries(counts)) {
    total += c;
    if (c > maxCount) {
      maxCount = c;
      dominant = b;
    }
  }

  const confidence = total > 0 ? maxCount / total : 0;

  // Build highlights from the dominant-brand equipment only
  const dominantEquip = allEquipment.filter((e) => {
    const b =
      (e.ecosystemBrand || '').toLowerCase() ||
      (e.manufacturer || '').toLowerCase();
    return b === dominant;
  });
  const highlights = buildHighlights(dominantEquip, input);

  // Is this a known ecosystem brand we have marketing copy for?
  const copy = BRAND_COPY[dominant];

  // Require confidence threshold AND known brand copy
  if (!copy || confidence < CONFIDENCE_THRESHOLD) {
    return {
      sentence: buildGenericSentence(input),
      brand: copy ? dominant : total > 1 ? 'mixed' : 'unknown',
      confidence,
      showEcosystemCopy: false,
      highlights: [],
    };
  }

  return {
    sentence: copy.template(highlights),
    brand: dominant,
    confidence,
    showEcosystemCopy: true,
    highlights,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildHighlights(
  equip: EquipmentRef[],
  input: EcosystemSummaryInput
): string[] {
  const h: string[] = [];
  const seen = new Set<string>();

  // Pull inverter model(s) first — most distinctive
  for (const e of input.inverters || []) {
    if (equip.includes(e) && e.model && !seen.has(e.model)) {
      h.push(e.model);
      seen.add(e.model);
    }
  }
  // Then batteries
  for (const e of input.batteries || []) {
    if (equip.includes(e) && e.model && !seen.has(e.model)) {
      h.push(e.model);
      seen.add(e.model);
    }
  }
  // Then gateways
  for (const e of input.gateways || []) {
    if (equip.includes(e) && e.model && !seen.has(e.model)) {
      h.push(e.model);
      seen.add(e.model);
    }
  }
  // Then EV chargers
  for (const e of input.evChargers || []) {
    if (equip.includes(e) && e.model && !seen.has(e.model)) {
      h.push(e.model);
      seen.add(e.model);
    }
  }

  return h.slice(0, 4); // cap for readability
}

function buildGenericSentence(input: EcosystemSummaryInput): string {
  const count =
    (input.panels?.length || 0) +
    (input.inverters?.length || 0) +
    (input.batteries?.length || 0);
  if (count === 0) return '';
  // Neutral fallback — no brand claims.
  return 'This system integrates solar generation with permit-grade electrical design and code-compliant installation standards.';
}

function formatList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}