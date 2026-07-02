// ═══════════════════════════════════════════════════════════════════════
// components/engineering/EcosystemPicker.tsx
// v47.398 — Visible ecosystem bundle picker for the engineering page.
//
// What it does
//   • Lists the 6 supported ecosystems (Tesla, Enphase, SolarEdge,
//     Generac, APsystems, Hoymiles).
//   • On selection, shows the full kit returned by
//     resolveBrandEquipment(): inverters/micros, batteries, gateways,
//     EV chargers, backup interfaces, etc.
//   • Offers "Apply Ecosystem" button that invokes a callback with the
//     chosen kit. Parent decides what to do with it (engineering page
//     handles the config mutation + confirmation).
//
// Non-breaking guarantees
//   • Never writes to config directly — only calls onApply callback.
//   • Never auto-fires — user must click Apply.
//   • Hides itself entirely if no brand is selected.
// ═══════════════════════════════════════════════════════════════════════

'use client';

import React, { useState, useMemo } from 'react';
import {
  resolveBrandEquipment,
  ECOSYSTEM_BRANDS,
  type ResolvedBrandEquipment,
} from '@/lib/system/brandProfiles/resolveBrandEquipment';
import {
  Package,
  Battery,
  Cpu,
  Wifi,
  Zap,
  Shield,
  CheckCircle2,
  Sparkles,
  ChevronRight,
  Info,
  Layers,
} from 'lucide-react';

export interface EcosystemApplyPayload {
  brand: string;
  kit: ResolvedBrandEquipment;
  selections: {
    inverterId?: string;
    batteryId?: string;
    gatewayId?: string;
    evChargerId?: string;
  };
}

export interface EcosystemPickerProps {
  /** Called when user clicks "Apply Ecosystem". Parent makes the final
   *  decision on whether/how to mutate config. */
  onApply?: (payload: EcosystemApplyPayload) => void;
  /** Currently applied brand, if any — highlights the active row. */
  appliedBrand?: string;
  /** Optional: hide the picker entirely (e.g., in manual mode). */
  hidden?: boolean;
}

export default function EcosystemPicker({
  onApply,
  appliedBrand,
  hidden,
}: EcosystemPickerProps) {
  const [expandedBrand, setExpandedBrand] = useState<string | null>(null);
  const [selectedInverter, setSelectedInverter] = useState<string>('');
  const [selectedBattery, setSelectedBattery] = useState<string>('');
  const [selectedGateway, setSelectedGateway] = useState<string>('');
  const [selectedEvCharger, setSelectedEvCharger] = useState<string>('');
  const [includeBattery, setIncludeBattery] = useState(true);
  const [expertMode, setExpertMode] = useState(false);

  const kit: ResolvedBrandEquipment | null = useMemo(() => {
    if (!expandedBrand) return null;
    return resolveBrandEquipment(expandedBrand);
  }, [expandedBrand]);

  // Auto-select defaults whenever brand or includeBattery changes
  const autoSelections = useMemo(() => {
    if (!expandedBrand || !kit) return { inverter: '', battery: '', gateway: '', evCharger: '' };
    const firstInv =
      kit.microinverters[0]?.id ||
      kit.stringInverters[0]?.id ||
      kit.optimizers[0]?.id ||
      '';
    const firstBattery = includeBattery ? (kit.batteries[0]?.id || '') : '';
    const firstGateway = kit.monitoringGateways[0]?.id || '';
    return { inverter: firstInv, battery: firstBattery, gateway: firstGateway, evCharger: '' };
  }, [expandedBrand, kit, includeBattery]);

  // Sync selections from auto-selection when not in expert mode
  useMemo(() => {
    if (!expertMode) {
      setSelectedInverter(autoSelections.inverter);
      setSelectedBattery(autoSelections.battery);
      setSelectedGateway(autoSelections.gateway);
      setSelectedEvCharger(autoSelections.evCharger);
    }
  }, [autoSelections, expertMode]);

  // Reset sub-selections whenever brand changes
  const handleBrandToggle = (brandId: string) => {
    if (expandedBrand === brandId) {
      setExpandedBrand(null);
      setSelectedInverter('');
      setSelectedBattery('');
      setSelectedGateway('');
      setSelectedEvCharger('');
      return;
    }
    setExpandedBrand(brandId);
    setExpertMode(false);
  };

  const handleApply = () => {
    if (!expandedBrand || !kit || !onApply) return;
    onApply({
      brand: expandedBrand,
      kit,
      selections: {
        inverterId: selectedInverter || undefined,
        batteryId: selectedBattery || undefined,
        gatewayId: selectedGateway || undefined,
        evChargerId: selectedEvCharger || undefined,
      },
    });
  };

  if (hidden) return null;

  return (
    <div className="card p-5 border border-indigo-500/20 bg-gradient-to-br from-indigo-500/5 to-purple-500/5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Sparkles size={16} className="text-indigo-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            System Type / Ecosystem
            <span className="text-xs font-normal text-indigo-300/80 px-2 py-0.5 rounded-full bg-indigo-500/10 border border-indigo-500/20">
              New
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Pick a manufacturer ecosystem to bundle a compatible kit — inverter, battery, monitoring gateway, and EV charger. Manual dropdowns below remain fully available.
          </p>
        </div>
      </div>

      {/* Brand chip selector */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4">
        {ECOSYSTEM_BRANDS.map((b) => {
          const isExpanded = expandedBrand === b.id;
          const isApplied = appliedBrand === b.id;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => handleBrandToggle(b.id)}
              className={`group text-left rounded-lg border p-3 transition-all ${
                isExpanded
                  ? 'bg-indigo-500/20 border-indigo-400 shadow-lg shadow-indigo-500/10'
                  : isApplied
                  ? 'bg-emerald-500/10 border-emerald-500/40'
                  : 'bg-slate-800/60 border-slate-700 hover:border-indigo-500/40 hover:bg-slate-800'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isExpanded
                      ? 'bg-indigo-400'
                      : isApplied
                      ? 'bg-emerald-400'
                      : 'bg-slate-600 group-hover:bg-indigo-500/60'
                  }`}
                />
                <span className="text-sm font-bold text-white">{b.displayName}</span>
                {isApplied ? (
                  <span className="ml-auto flex items-center gap-0.5 text-xs text-emerald-400">
                    <CheckCircle2 size={11} /> active
                  </span>
                ) : null}
              </div>
              <div className="text-xs text-slate-400 leading-snug">{b.description}</div>
            </button>
          );
        })}
      </div>

      {/* Expanded kit preview — simplified or expert mode */}
      {expandedBrand && kit ? (
        expertMode ? (
          <EcosystemKitPanel
            brandId={expandedBrand}
            kit={kit}
            selectedInverter={selectedInverter}
            setSelectedInverter={setSelectedInverter}
            selectedBattery={selectedBattery}
            setSelectedBattery={setSelectedBattery}
            selectedGateway={selectedGateway}
            setSelectedGateway={setSelectedGateway}
            selectedEvCharger={selectedEvCharger}
            setSelectedEvCharger={setSelectedEvCharger}
            onApply={handleApply}
            canApply={Boolean(onApply)}
          />
        ) : (
          <SimplifiedKitPanel
            brandId={expandedBrand}
            kit={kit}
            includeBattery={includeBattery}
            setIncludeBattery={setIncludeBattery}
            autoSelections={autoSelections}
            onApply={handleApply}
            onExpertMode={() => setExpertMode(true)}
            canApply={Boolean(onApply)}
          />
        )
      ) : null}
    </div>
  );
}

// ─── Sub-component: Simplified kit confirmation (Phase 3E) ──────────────────

interface SimplifiedKitPanelProps {
  brandId: string;
  kit: ResolvedBrandEquipment;
  includeBattery: boolean;
  setIncludeBattery: (v: boolean) => void;
  autoSelections: { inverter: string; battery: string; gateway: string; evCharger: string };
  onApply: () => void;
  onExpertMode: () => void;
  canApply: boolean;
}

function SimplifiedKitPanel(props: SimplifiedKitPanelProps) {
  const {
    brandId,
    kit,
    includeBattery,
    setIncludeBattery,
    autoSelections,
    onApply,
    onExpertMode,
    canApply,
  } = props;

  const brandName = ECOSYSTEM_BRANDS.find((b) => b.id === brandId)?.displayName ?? brandId;

  // Resolve display names for auto-selected equipment
  const allInverters = [
    ...kit.microinverters,
    ...kit.stringInverters,
    ...kit.optimizers,
  ];
  const selectedInv = allInverters.find((i) => i.id === autoSelections.inverter);
  const selectedBat = kit.batteries.find((b) => b.id === autoSelections.battery);
  const selectedGw = kit.monitoringGateways.find((g) => g.id === autoSelections.gateway);

  const isBatteryOnlyEcosystem = allInverters.length === 0;
  const hasNonInverterSelection = Boolean(
    autoSelections.battery || autoSelections.gateway || autoSelections.evCharger
  );
  const canActuallyApply = isBatteryOnlyEcosystem
    ? canApply && hasNonInverterSelection
    : canApply && Boolean(autoSelections.inverter);

  return (
    <div className="rounded-xl bg-slate-900/60 border border-indigo-500/20 p-4 space-y-3">
      {/* Brand header */}
      <div className="flex items-center gap-2 text-xs text-indigo-300/80 font-semibold uppercase tracking-wide">
        <Sparkles size={12} />
        Your {brandName} System
      </div>

      {/* Battery toggle — the only user decision besides brand */}
      {kit.batteries.length > 0 ? (
        <label className="flex items-center gap-3 cursor-pointer group">
          <div className={`
            relative w-10 h-5 rounded-full transition-colors
            ${includeBattery ? 'bg-emerald-500' : 'bg-slate-700'}
          `}>
            <div className={`
              absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform
              ${includeBattery ? 'translate-x-5' : 'translate-x-0'}
            `} />
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-white group-hover:text-indigo-200 transition-colors">
              Include battery storage
            </span>
            <span className="text-[11px] text-slate-400">
              {includeBattery
                ? `${selectedBat?.manufacturer ?? brandName} ${selectedBat?.model ?? 'battery'} included`
                : 'No battery — solar only'}
            </span>
          </div>
          <input
            type="checkbox"
            checked={includeBattery}
            onChange={(e) => setIncludeBattery(e.target.checked)}
            className="sr-only"
          />
        </label>
      ) : null}

      {/* Auto-selected equipment confirmation list */}
      <div className="space-y-2">
        {/* Inverter */}
        {selectedInv ? (
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <Cpu size={14} className="text-blue-300 flex-shrink-0" />
            <span className="flex-1">
              {selectedInv.manufacturer} {selectedInv.model}
            </span>
            <span className="text-[11px] text-emerald-400/80 flex items-center gap-1">
              <CheckCircle2 size={10} /> Auto-selected
            </span>
          </div>
        ) : null}

        {/* Battery */}
        {includeBattery && selectedBat ? (
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <Battery size={14} className="text-emerald-300 flex-shrink-0" />
            <span className="flex-1">
              {selectedBat.manufacturer} {selectedBat.model} — {selectedBat.usableCapacityKwh ?? '?'} kWh
            </span>
            <span className="text-[11px] text-emerald-400/80 flex items-center gap-1">
              <CheckCircle2 size={10} /> Auto-selected
            </span>
          </div>
        ) : null}

        {/* Gateway */}
        {selectedGw ? (
          <div className="flex items-center gap-2 text-sm text-slate-200">
            <Wifi size={14} className="text-cyan-300 flex-shrink-0" />
            <span className="flex-1">
              {selectedGw.manufacturer} {selectedGw.model}
            </span>
            <span className="text-[11px] text-emerald-400/80 flex items-center gap-1">
              <CheckCircle2 size={10} /> Auto-selected
            </span>
          </div>
        ) : null}
      </div>

      {/* Compatible racking (read-only, same as expert mode) */}
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1.5">
          <Layers size={11} className="text-violet-300" /> Compatible Racking
        </div>
        {kit.compatibleRacking.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {Array.from(
              kit.compatibleRacking.reduce((map, sys) => {
                map.set(sys.manufacturer, (map.get(sys.manufacturer) || 0) + 1);
                return map;
              }, new Map<string, number>()),
            ).map(([mfg, count]) => (
              <Chip
                key={mfg}
                text={count > 1 ? `${mfg} (${count})` : mfg}
                tone="slate"
              />
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 italic">
            Compatible with major racking systems (IronRidge, Unirac, SnapNrack, etc.).
          </div>
        )}
      </div>

      {/* Battery-only ecosystem hint (same as expert mode) */}
      {isBatteryOnlyEcosystem ? (
        <div className="flex items-start gap-2 text-xs text-cyan-200/90 bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3">
          <Info size={14} className="text-cyan-300 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-semibold text-cyan-200">AC-coupled battery ecosystem</div>
            <div className="text-slate-300/90">
              {brandName} does not provide a solar inverter — it's battery + gateway only.
              Your existing solar inverter selection will be preserved.
            </div>
          </div>
        </div>
      ) : null}

      {/* Apply + Expert mode toggle */}
      <div className="flex flex-col gap-2 pt-1">
        <button
          type="button"
          onClick={onApply}
          disabled={!canActuallyApply}
          className={`flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            !canActuallyApply
              ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
              : 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20'
          }`}
        >
          <Package size={14} />
          Apply {brandName} System
        </button>
        <button
          type="button"
          onClick={onExpertMode}
          className="text-xs text-indigo-300/60 hover:text-indigo-200 transition-colors text-center underline underline-offset-2"
        >
          Customize individually
        </button>
      </div>
    </div>
  );
}

// ─── Sub-component: Kit preview + apply ─────────────────────────────────

interface KitPanelProps {
  brandId: string;
  kit: ResolvedBrandEquipment;
  selectedInverter: string;
  setSelectedInverter: (v: string) => void;
  selectedBattery: string;
  setSelectedBattery: (v: string) => void;
  selectedGateway: string;
  setSelectedGateway: (v: string) => void;
  selectedEvCharger: string;
  setSelectedEvCharger: (v: string) => void;
  onApply: () => void;
  canApply: boolean;
}

function EcosystemKitPanel(props: KitPanelProps) {
  const {
    brandId,
    kit,
    selectedInverter,
    setSelectedInverter,
    selectedBattery,
    setSelectedBattery,
    selectedGateway,
    setSelectedGateway,
    selectedEvCharger,
    setSelectedEvCharger,
    onApply,
    canApply,
  } = props;

  // Merge all inverter categories into one dropdown
  const allInverters = [
    ...kit.microinverters.map((m) => ({
      id: m.id,
      label: `${m.manufacturer} ${m.model}`,
      kind: 'Microinverter',
    })),
    ...kit.stringInverters.map((s) => ({
      id: s.id,
      label: `${s.manufacturer} ${s.model}`,
      kind: 'String Inverter',
    })),
    ...kit.optimizers.map((o) => ({
      id: o.id,
      label: `${o.manufacturer} ${o.model}`,
      kind: 'Optimizer',
    })),
  ];

  const anyBackup =
    kit.batteries.length +
      kit.backupInterfaces.length +
      kit.atsUnits.length +
      kit.generators.length >
    0;

  // v47.401 — Battery-only ecosystems (Tesla: AC-coupled Powerwall + Gateway)
  // have zero inverters in their kit. For these, Apply should still work as
  // long as SOMETHING else is selected. The user's existing solar inverter
  // choice is preserved (parent handler only touches inverterId if present).
  const isBatteryOnlyEcosystem = allInverters.length === 0;
  const hasNonInverterSelection = Boolean(
    selectedBattery || selectedGateway || selectedEvCharger
  );
  const canActuallyApply = isBatteryOnlyEcosystem
    ? canApply && hasNonInverterSelection
    : canApply && Boolean(selectedInverter);

  return (
    <div className="rounded-xl bg-slate-900/60 border border-indigo-500/20 p-4 space-y-3">
      <div className="flex items-center gap-2 text-xs text-indigo-300/80 font-semibold uppercase tracking-wide">
        <ChevronRight size={12} />
        {brandId} Ecosystem — Kit Builder
      </div>

      {/* Inverter / Micro */}
      {allInverters.length > 0 ? (
        <KitRow
          icon={<Cpu size={13} className="text-blue-300" />}
          label="Inverter"
          count={allInverters.length}
        >
          <select
            value={selectedInverter}
            onChange={(e) => setSelectedInverter(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-400"
          >
            <option value="">— None —</option>
            {allInverters.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label} ({i.kind})
              </option>
            ))}
          </select>
        </KitRow>
      ) : null}

      {/* Battery */}
      {kit.batteries.length > 0 ? (
        <KitRow
          icon={<Battery size={13} className="text-emerald-300" />}
          label="Battery Storage"
          count={kit.batteries.length}
        >
          <select
            value={selectedBattery}
            onChange={(e) => setSelectedBattery(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-400"
          >
            <option value="">— None —</option>
            {kit.batteries.map((b) => (
              <option key={b.id} value={b.id}>
                {b.manufacturer} {b.model} — {b.usableCapacityKwh ?? '?'} kWh
              </option>
            ))}
          </select>
        </KitRow>
      ) : null}

      {/* Monitoring Gateway */}
      {kit.monitoringGateways.length > 0 ? (
        <KitRow
          icon={<Wifi size={13} className="text-cyan-300" />}
          label="Monitoring Gateway"
          count={kit.monitoringGateways.length}
        >
          <select
            value={selectedGateway}
            onChange={(e) => setSelectedGateway(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-400"
          >
            <option value="">— None —</option>
            {kit.monitoringGateways.map((g) => (
              <option key={g.id} value={g.id}>
                {g.manufacturer} {g.model}
              </option>
            ))}
          </select>
        </KitRow>
      ) : null}

      {/* EV Charger */}
      {kit.evChargers.length > 0 ? (
        <KitRow
          icon={<Zap size={13} className="text-amber-300" />}
          label="EV Charger"
          count={kit.evChargers.length}
          optional
        >
          <select
            value={selectedEvCharger}
            onChange={(e) => setSelectedEvCharger(e.target.value)}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-400"
          >
            <option value="">— None (optional) —</option>
            {kit.evChargers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.manufacturer} {c.model} — {c.maxOutputKw}kW {c.connectorType}
              </option>
            ))}
          </select>
        </KitRow>
      ) : null}

      {/* v47.429 — Stage 6: Compatible Racking (read-only informational). */}
      <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1.5">
          <Layers size={11} className="text-violet-300" /> Compatible Racking
        </div>
        {kit.compatibleRacking.length > 0 ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {Array.from(
                kit.compatibleRacking.reduce((map, sys) => {
                  map.set(sys.manufacturer, (map.get(sys.manufacturer) || 0) + 1);
                  return map;
                }, new Map<string, number>()),
              ).map(([mfg, count]) => (
                <Chip
                  key={mfg}
                  text={count > 1 ? `${mfg} (${count})` : mfg}
                  tone="slate"
                />
              ))}
            </div>
            <div className="text-[11px] text-slate-500 mt-1.5 italic">
              {kit.compatibleRacking.length} system{kit.compatibleRacking.length === 1 ? '' : 's'}{' '}
              recommended for this ecosystem. Select your rail/mount brand on the Mounting tab.
            </div>
          </>
        ) : (
          <div className="text-[11px] text-slate-400 italic">
            Compatible with major racking systems (IronRidge, Unirac, SnapNrack, etc.). Select
            your rail/mount brand on the Mounting tab.
          </div>
        )}
      </div>

      {/* Backup peripherals (read-only informational) */}
      {anyBackup ? (
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/50 p-3">
          <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold uppercase tracking-wide mb-1.5">
            <Shield size={11} /> Backup & Accessories
          </div>
          <div className="flex flex-wrap gap-1.5">
            {kit.backupInterfaces.map((b) => (
              <Chip key={b.id} text={`${b.model}`} tone="slate" />
            ))}
            {kit.atsUnits.map((a) => (
              <Chip key={a.id} text={`${a.model} (ATS)`} tone="slate" />
            ))}
            {kit.generators.map((g) => (
              <Chip key={g.id} text={`${g.model} (Gen)`} tone="slate" />
            ))}
          </div>
        </div>
      ) : null}

      {/* Empty-state hint — triggered only when NO hardware rows at all. The racking
          section (v47.429) is always rendered, so we still want this hint when
          inverters/batteries/gateways/EV chargers are all empty. */}
      {allInverters.length === 0 &&
        kit.batteries.length === 0 &&
        kit.monitoringGateways.length === 0 &&
        kit.evChargers.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2.5">
            <Info size={12} />
            <span>No ecosystem-tagged hardware found for this brand yet. Use the manual dropdowns below (racking compatibility shown above).</span>
          </div>
        ) : null}

      {/* v47.401 — Battery-only ecosystem hint (e.g. Tesla) */}
      {isBatteryOnlyEcosystem ? (
        <div className="flex items-start gap-2 text-xs text-cyan-200/90 bg-cyan-500/5 border border-cyan-500/20 rounded-lg p-3">
          <Info size={14} className="text-cyan-300 flex-shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-semibold text-cyan-200">AC-coupled battery ecosystem</div>
            <div className="text-slate-300/90">
              {ECOSYSTEM_BRANDS.find((b) => b.id === brandId)?.displayName} does not provide a
              solar inverter — it's battery + gateway + EV charger only. Your existing solar
              inverter selection (Enphase, SolarEdge, etc.) will be preserved. Pick the battery
              and other components you want, then Apply.
            </div>
          </div>
        </div>
      ) : null}

      {/* Apply button */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onApply}
          disabled={!canActuallyApply}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            !canActuallyApply
              ? 'bg-slate-700/50 text-slate-500 cursor-not-allowed'
              : 'bg-indigo-500 hover:bg-indigo-400 text-white shadow-lg shadow-indigo-500/20'
          }`}
        >
          <Package size={14} />
          Apply {ECOSYSTEM_BRANDS.find((b) => b.id === brandId)?.displayName} Ecosystem
        </button>
        <div className="text-xs text-slate-500 italic">
          {isBatteryOnlyEcosystem
            ? 'Your existing solar inverter will be preserved.'
            : 'Existing manual selections will be preserved unless you confirm replacement.'}
        </div>
      </div>
    </div>
  );
}

// ─── Tiny presentational sub-components ─────────────────────────────────

function KitRow({
  icon,
  label,
  count,
  optional,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs font-semibold text-slate-300">{label}</span>
        <span className="text-xs text-slate-500">({count} option{count !== 1 ? 's' : ''})</span>
        {optional ? (
          <span className="text-xs text-amber-400/70 italic ml-1">optional</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: 'slate' | 'emerald' }) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
      : 'bg-slate-700/50 border-slate-600 text-slate-300';
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${toneClass}`}
    >
      {text}
    </span>
  );
}