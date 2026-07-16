// ═══════════════════════════════════════════════════════════════
// Suggested Tools — job-specific tool recommendations for the BOM.
//
// Ray (2026-07-11): "We could add a tools suggested section. Like a
// bandsaw for cutting rails, wire caddys, rolls of thhn etc. A lot of
// manufacturers have a recommended tool usage section."
//
// Same pattern as trunkCable.ts: a curated catalog + a PURE resolver
// gated on what the job actually involves — a rail saw only when there
// are rails to cut, the Q-cable disconnect tool only on an Enphase
// micro job, an EMT bender only when the conduit is EMT, insulated
// tools/PPE only on supply-side work. Manufacturer provenance in
// lib/data/equipment/install-tools-*.json (researched 2026-07-11).
//
// Tools are ADVICE, not materials: never priced, never in totals or
// unpriced KPIs, never on the permit SCHED.
// ═══════════════════════════════════════════════════════════════

export interface SuggestedTool {
  tool: string;              // display name
  use: string;               // what it's for on THIS job
  why?: string;              // best-practice / code rationale
  partNumber?: string;       // real SKU when one exists (e.g. Q-DISC-10)
  manufacturer?: string;
}

export interface ToolsContext {
  /** Rail-based racking on the job (rails must be cut/torqued). */
  isRailBased: boolean;
  /** Racking manufacturer for torque-spec callouts (e.g. 'Roof Tech'). */
  rackingBrand?: string;
  /** Microinverter topology (trunk-cable tooling). */
  isMicro: boolean;
  /** Micro brand — Enphase gets the Q-DISC disconnect tool etc. */
  microBrand?: string;
  /** Conduit type on the job ('EMT' | 'PVC' | …). */
  conduitType?: string;
  /** NEC 705.11 supply-side interconnection (insulated tools / PPE). */
  isSupplySideTap: boolean;
  /** Roof attachments present (rafter locating, pilot drilling, sealant gun). */
  hasRoofAttachments: boolean;
  /** There is a wire pull (THHN in conduit) on the job. */
  hasWirePull: boolean;
}

// Per-brand torque/tooling callouts — quoted from the actual install manuals
// (lib/data/equipment/install-tools-racking.json, extracted 2026-07-11:
// IronRidge XR Flush v5.2, Roof Tech RT-MINI II Jun/2025, Unirac SolarMount,
// SnapNrack Ultra Rail v4.6.1). K2 values unverified — omitted.
const BRAND_TORQUE_NOTES: Record<string, { torque: string; socket: string; special?: string }> = {
  'ironridge': {
    torque: 'UFO clamps 80 in-lbs; rail-to-attachment bonding nuts 300 in-lbs (XR Flush v5.2)',
    socket: '7/16" socket; 0–300 in-lb torque wrench is in IronRidge\'s TOOLS REQUIRED list',
  },
  'roof tech': {
    torque: 'M5 screws: NO numeric torque — tighten until the conical washer stops rotating; FBN25 L-foot bolt 140 in-lbs (RT-MINI II manual)',
    socket: '8 mm hex bit socket',
    special: '⚠ IMPACT DRIVER PROHIBITED on the M5 mounting screws — drill/driver only',
  },
  'unirac': {
    torque: 'L-foot nut 30 ft-lbs; standard clamps 10 ft-lbs WITH anti-seize; Pro clamps 11 ft-lbs NO anti-seize (single-use)',
    socket: '1/2" and 7/16" sockets; 3/16" pilot bit',
  },
  'snapnrack': {
    torque: 'Ultra clamps 16 ft-lbs; splices & L-feet 12 ft-lbs (Ultra Rail v4.6.1)',
    socket: 'everything on a 1/2" socket',
  },
};

export function resolveSuggestedTools(ctx: ToolsContext): SuggestedTool[] {
  const tools: SuggestedTool[] = [];
  const _brandNote = ctx.rackingBrand
    ? BRAND_TORQUE_NOTES[Object.keys(BRAND_TORQUE_NOTES).find(k =>
        ctx.rackingBrand!.toLowerCase().includes(k)) ?? '']
    : undefined;

  // ── Racking / structural ──────────────────────────────────────
  if (ctx.isRailBased) {
    tools.push({
      tool: 'Portable bandsaw (metal blade)',
      use: 'Cutting aluminum rail to length on the roof',
      why: 'Cold, clean cut — no hot chips landing on shingles (vs chop/abrasive saws); deburr after cutting',
    });
    tools.push({
      tool: 'Deburring tool / flat file',
      use: 'Dress cut rail ends before splicing',
    });
    tools.push({
      tool: `Torque wrench + sockets${_brandNote ? ` (${_brandNote.socket})` : ' (7/16", 1/2")'}`,
      use: _brandNote
        ? `Module clamps, splices and L-foot hardware — ${_brandNote.torque}`
        : `Module clamps, splices and L-foot hardware${ctx.rackingBrand ? ` — torque per ${ctx.rackingBrand} install manual` : ''}`,
      why: 'Manufacturer torque specs are a UL 2703 listing condition; under/over-torque voids bonding',
    });
  }
  if (ctx.hasRoofAttachments) {
    tools.push({
      tool: 'Rafter finder / stud sensor + chalk line',
      use: 'Locating and striking rafter lines for attachment rows',
    });
    tools.push({
      tool: _brandNote?.special?.includes('IMPACT DRIVER PROHIBITED')
        ? 'Drill/driver (NOT impact) + pilot bits'
        : 'Impact driver + pilot bits (per lag diameter)',
      use: `Pilot-drilling and driving structural fasteners into rafters${_brandNote?.special ? ` — ${_brandNote.special}` : ''}`,
      why: 'Pilot per manufacturer spec prevents rafter splitting — a split rafter is a failed attachment',
    });
    tools.push({
      tool: 'Caulk gun (quart-rated)',
      use: 'Roof-rated sealant at penetrations per flashing manufacturer instructions',
    });
  }

  // ── Micro trunk (brand-specific) ──────────────────────────────
  if (ctx.isMicro && (ctx.microBrand ?? '').toLowerCase().includes('enphase')) {
    tools.push({
      tool: 'Q-Cable disconnect tool',
      use: 'Releasing micro/trunk connectors without damaging the latch',
      partNumber: 'Q-DISC-10',
      manufacturer: 'Enphase',
      why: 'Enphase-listed tool — prying connectors apart destroys the seal',
    });
  }

  // ── Conduit ───────────────────────────────────────────────────
  if ((ctx.conduitType ?? '').toUpperCase().includes('EMT')) {
    tools.push({
      tool: 'EMT bender (per trade size) + level',
      use: 'Field bends — offsets, kicks and saddles on the conduit run',
    });
    tools.push({
      tool: 'Conduit reamer',
      use: 'Ream cut EMT ends before termination',
      why: 'NEC 358.28(A): cut ends shall be reamed to remove rough edges',
    });
  }

  // ── Wire pull ─────────────────────────────────────────────────
  if (ctx.hasWirePull) {
    tools.push({
      tool: 'Wire caddy / spool rack + 500 ft THHN rolls',
      use: 'Feeding conductors for the conduit pull without kinks or crossovers',
    });
    tools.push({
      tool: 'Fish tape + wire-pulling lubricant',
      use: 'Pulling the conductor bundle through the conduit run',
    });
  }

  // ── Termination & commissioning (every job) ───────────────────
  tools.push({
    tool: 'Torque screwdriver (in-lb)',
    use: 'Breaker, lug and terminal terminations to the listed torque',
    why: 'NEC 110.14(D) REQUIRES terminations be torqued per manufacturer — inspectors check',
  });
  tools.push({
    tool: 'Wire strippers (#14–#6) + multimeter / clamp meter',
    use: 'Terminations and commissioning verification (voltage, polarity, current)',
  });

  // ── Supply-side work ──────────────────────────────────────────
  if (ctx.isSupplySideTap) {
    tools.push({
      tool: 'Insulated hand tools (1000 V) + Class 0 gloves',
      use: 'Line-side tap work at the service-entrance conductors',
      why: 'Supply-side conductors have no upstream OCPD — treat as energized; OSHA/NFPA 70E PPE applies',
    });
  }

  return tools;
}
