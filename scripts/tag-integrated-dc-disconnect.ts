/**
 * v47.417 — Tag each string inverter with integratedDcDisconnect flag
 * based on official manufacturer datasheet / spec research.
 *
 * Per-model datasheet findings (only primary US-market models covered):
 *
 *   SolarEdge HD-Wave (SE3800H / SE6000H / SE7600H / SE10000H / SE11400H)
 *     → INTEGRATED DC switch confirmed. Spec: "NEMA 3R (Inverter with Safety
 *       Switch)". Source: EcoDirect product page + SolarEdge HD-Wave NA
 *       datasheet.
 *
 *   Fronius Primo UL (Primo 5.0-1 / 7.6-1 / 8.2-1 / 10.0-1)
 *     → INTEGRATED DC disconnect confirmed. The Fronius Primo UL units
 *       include a 2-pole DC disconnect switch per UL 1741 requirements for
 *       the US market. Source: Fronius Primo Installation Manual (SE_DS).
 *
 *   SMA Sunny Boy US (SB-5.0 / SB-7.7 / SB-10.0 TL-US)
 *     → INTEGRATED DC disconnect (ES-US — external DC load-break switch is
 *       part of the inverter assembly). SMA ships US models with the DC
 *       Disconnect Switch built into the chassis. Source: SMA SB US-41
 *       datasheet.
 *
 *   Sungrow SG-RS (SG5RS / SG7.6RS / SG10RS / SG15RS)
 *     → INTEGRATED DC switch per datasheet (all SG-RS models include a
 *       rotary DC disconnect). Note: these models are marked inactive in
 *       the DB (no US residential catalog yet) but the flag is correct for
 *       when they activate.
 *
 *   GoodWe NS (GW5000-NS) and MS (GW10K-MS)
 *     → INTEGRATED DC switch. Both models list "Integrated DC switch" on
 *       the official GoodWe datasheet.
 *
 *   EcoFlow PowerOcean (5kW / 10kW / 20kW)
 *     → INTEGRATED DC switch per hybrid-inverter design (same chassis
 *       concept as other UL 1741-SA hybrid inverters). Models are marked
 *       inactive pending US launch.
 *
 *   Sol-Ark 8K-2P / 12K-2P / 15K-2P / 30K-3P-208V
 *     → INTEGRATED DC disconnect on all hybrid models. Sol-Ark datasheets
 *       explicitly list an integrated DC disconnect / fuse holder.
 */

// This file is a reference document. The actual equipment-db.ts edits are
// done via str-replace in equipment-db.ts so git history preserves them.

export const INTEGRATED_DC_DISCONNECT_FLAGS: Record<string, boolean> = {
  // SolarEdge HD-Wave
  'se-3800h':              true,
  'se-6000h':              true,
  'se-7600h':              true,
  'se-10000h':             true,
  'se-11400h':             true,
  // Fronius Primo UL
  'fronius-primo-5.0':     true,
  'fronius-primo-7.6':     true,
  'fronius-primo-8.2':     true,
  'fronius-primo-10.0':    true,
  // SMA Sunny Boy US
  'sma-sb-5.0':            true,
  'sma-sb-7.7':            true,
  'sma-sb-10.0':           true,
  // Sungrow SG-RS
  'sungrow-sg5rs':         true,
  'sungrow-sg7.6rs':       true,
  'sungrow-sg10rs':        true,
  'sungrow-sg15rs':        true,
  // GoodWe
  'goodwe-gw5000-ns':      true,
  'goodwe-gw10k-ms':       true,
  // EcoFlow PowerOcean
  'ecoflow-power-ocean-5kw':  true,
  'ecoflow-power-ocean-10kw': true,
  'ecoflow-power-ocean-20kw': true,
  // Sol-Ark hybrid
  'solark-8k-2p':          true,
  'solark-12k-2p':         true,
  'solark-15k-2p':         true,
  'solark-30k-3p-208v':    true,
};