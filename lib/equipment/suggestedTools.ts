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

export function resolveSuggestedTools(ctx: ToolsContext): SuggestedTool[] {
  const tools: SuggestedTool[] = [];

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
      tool: 'Torque wrench (ft-lb, 3/8" drive) + sockets (7/16", 1/2")',
      use: `Module clamps, splices and L-foot hardware${ctx.rackingBrand ? ` — torque per ${ctx.rackingBrand} install manual` : ''}`,
      why: 'Manufacturer torque specs are a UL 2703 listing condition; under/over-torque voids bonding',
    });
  }
  if (ctx.hasRoofAttachments) {
    tools.push({
      tool: 'Rafter finder / stud sensor + chalk line',
      use: 'Locating and striking rafter lines for attachment rows',
    });
    tools.push({
      tool: 'Impact driver + pilot bits (per lag diameter)',
      use: 'Pilot-drilling and driving structural lags into rafters',
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
