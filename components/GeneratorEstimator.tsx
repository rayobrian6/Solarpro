"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { APPLIANCES, CATEGORIES, type Appliance } from "@/lib/engineering/generatorData";
import {
  LOAD_PROFILE_LABELS,
  calculateEstimate,
  formatWatts,
  formatUSD,
  type LoadProfile,
} from "@/lib/engineering/generatorEstimate";
import { calculateNec220_83, type HeatingType } from "@/lib/engineering/generatorNec22083";
import GeneratorResultCard from "./GeneratorResultCard";

const LOAD_PROFILES: LoadProfile[] = ["whole-house", "managed", "essentials"];

type Quantities = Record<string, number>;

const STARTER_SELECTIONS: Array<{ id: string; quantity: number }> = [
  { id: "central-ac-4ton", quantity: 1 },
  { id: "furnace-blower", quantity: 1 },
  { id: "electric-water-heater", quantity: 1 },
  { id: "refrigerator", quantity: 1 },
  { id: "freezer", quantity: 1 },
  { id: "electric-dryer", quantity: 1 },
  { id: "washer", quantity: 1 },
  { id: "well-pump-1hp", quantity: 1 },
  { id: "lights-led", quantity: 1 },
  { id: "wifi-router", quantity: 1 },
  { id: "security-system", quantity: 1 },
  { id: "garage-door", quantity: 1 },
];

export default function Estimator() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Initialize directly from the URL so the chip appears on first render
  // (no useEffect tick). Set by the BillParser's "Add to appliance estimator" link.
  const [billPeakKw, setBillPeakKw] = useState<number | null>(() => {
    const peak = searchParams?.get("peak");
    return peak ? parseFloat(peak) : null;
  });
  const [billKwh, setBillKwh] = useState<number | null>(() => {
    const kwh = searchParams?.get("kwh");
    return kwh ? parseFloat(kwh) : null;
  });

  // Keep state in sync if the user navigates between URLs in-session
  // (e.g., parses a new bill while already on /).
  useEffect(() => {
    const peak = searchParams?.get("peak");
    const kwh = searchParams?.get("kwh");
    setBillPeakKw(peak ? parseFloat(peak) : null);
    setBillKwh(kwh ? parseFloat(kwh) : null);
  }, [searchParams]);

  const clearBillBaseline = () => {
    setBillPeakKw(null);
    setBillKwh(null);
    router.replace("/");
  };

  const initial: Quantities = useMemo(() => {
    const m: Quantities = {};
    for (const a of APPLIANCES) m[a.id] = 0;
    for (const s of STARTER_SELECTIONS) m[s.id] = s.quantity;
    return m;
  }, []);

  const [quantities, setQuantities] = useState<Quantities>(initial);
  const [loadProfile, setLoadProfile] = useState<LoadProfile>("whole-house");

  const estimate = useMemo(() => {
    const selected = Object.entries(quantities)
      .filter(([, q]) => q > 0)
      .map(([id, quantity]) => ({ id, quantity }));
    return calculateEstimate({ selected, billPeakKw, loadProfile });
  }, [quantities, billPeakKw, loadProfile]);

  const handleChange = (id: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [id]: Math.max(0, Math.floor(value || 0)) }));
  };

  const grouped = useMemo(() => {
    const m = new Map<string, Appliance[]>();
    for (const cat of CATEGORIES) m.set(cat, []);
    for (const a of APPLIANCES) m.get(a.category)?.push(a);
    return m;
  }, []);

  const totalCount = Object.values(quantities).reduce((s, q) => s + q, 0);

  return (
    <>
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-8 max-w-7xl mx-auto px-6 py-10">
      <section className="space-y-8">
        <header>
          <h1 className="text-3xl font-bold tracking-tight">Standby Generator Estimator</h1>
          <p className="text-slate-400 mt-2">
            Pick the appliances you want to back up. We&apos;ll size a Generac or Briggs &amp; Stratton
            standby unit and estimate the installed cost.
          </p>
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              onClick={() => setQuantities(initial)}
              className="rounded-md border border-white/[0.08] px-3 py-1.5 hover:bg-white/[0.05]"
            >
              Reset to typical home
            </button>
            <button
              type="button"
              onClick={() => {
                const empty: Quantities = {};
                for (const a of APPLIANCES) empty[a.id] = 0;
                setQuantities(empty);
              }}
              className="rounded-md border border-white/[0.08] px-3 py-1.5 hover:bg-white/[0.05]"
            >
              Clear all
            </button>
            <div className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.025] p-1">
              <span className="px-2 text-xs uppercase tracking-wider text-slate-500">
                Load profile
              </span>
              {LOAD_PROFILES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setLoadProfile(p)}
                  data-testid={`profile-${p}`}
                  className={`rounded px-2 py-1 text-xs ${
                    loadProfile === p
                      ? "bg-amber-300 text-zinc-950 font-bold"
                      : "text-slate-300 hover:bg-white/[0.05]"
                  }`}
                >
                  {p === "whole-house" ? "All at once" : p === "managed" ? "SMM" : "Essentials"}
                </button>
              ))}
            </div>
            {(billPeakKw !== null || billKwh !== null) && (
              <span
                data-testid="bill-baseline-chip"
                className="inline-flex items-center gap-2 rounded-md border border-amber-300/40 bg-amber-300/10 px-3 py-1.5 text-amber-200"
              >
                <span className="text-xs uppercase tracking-wider text-amber-300/80">
                  From your bill
                </span>
                {billPeakKw !== null && (
                  <span className="font-mono font-bold">{billPeakKw.toFixed(1)} kW baseline</span>
                )}
                {billKwh !== null && (
                  <span className="text-amber-300/70">
                    {billPeakKw !== null ? "· " : ""}
                    {billKwh.toLocaleString("en-US")} kWh/mo
                  </span>
                )}
                {billPeakKw === null && (
                  <span className="text-[10px] text-amber-300/70 italic">
                    (no peak demand — informational only)
                  </span>
                )}
                <button
                  type="button"
                  onClick={clearBillBaseline}
                  aria-label="Clear bill baseline"
                  className="ml-1 text-amber-300/80 hover:text-amber-100"
                >
                  ×
                </button>
              </span>
            )}
            <span className="ml-auto self-center text-slate-500">
              {totalCount} item{totalCount === 1 ? "" : "s"} selected
            </span>
          </div>
        </header>

        {CATEGORIES.map((cat) => {
          const items = grouped.get(cat) ?? [];
          return (
            <div key={cat} className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5">
              <h2 className="text-lg font-bold mb-4">{cat}</h2>
              <div className="space-y-2">
                {items.map((a) => (
                  <ApplianceRow
                    key={a.id}
                    appliance={a}
                    quantity={quantities[a.id] ?? 0}
                    onChange={(v) => handleChange(a.id, v)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <GeneratorResultCard
          estimate={estimate}
          appliances={quantities}
          formatWatts={formatWatts}
          formatUSD={formatUSD}
        />
      </aside>
    </div>

    <Nec220_83Section billPeakKw={billPeakKw} />
    </>
  );
}

function ApplianceRow({
  appliance,
  quantity,
  onChange,
}: {
  appliance: Appliance;
  quantity: number;
  onChange: (v: number) => void;
}) {
  const selected = quantity > 0;
  return (
    <div
      className={`flex items-center gap-4 rounded-lg p-3 transition-colors ${
        selected ? "bg-amber-300/10 border border-amber-300/40" : "border border-transparent hover:bg-white/[0.05]/50"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm">{appliance.label}</div>
        <div className="text-xs text-slate-500 mt-0.5">
          {appliance.runningWatts.toLocaleString()} W running
          {appliance.startingWatts > appliance.runningWatts && (
            <> &middot; {appliance.startingWatts.toLocaleString()} W starting</>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Decrease ${appliance.label}`}
          onClick={() => onChange(quantity - 1)}
          disabled={quantity === 0}
          className="h-8 w-8 rounded-md border border-white/[0.08] text-slate-300 hover:bg-white/[0.05] disabled:opacity-30"
        >
          −
        </button>
        <input
          type="number"
          min={0}
          value={quantity}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 w-12 rounded-md border border-white/[0.08] bg-white/[0.025] text-center text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          type="button"
          aria-label={`Increase ${appliance.label}`}
          onClick={() => onChange(quantity + 1)}
          className="h-8 w-8 rounded-md border border-white/[0.08] text-slate-300 hover:bg-white/[0.05] disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

type NecInputs = {
  squareFeet: number;
  heatingType: HeatingType;
  heatingWatts: number;
  coolingWatts: number;
  acStartingWatts: number;
  rangeWatts: number;
  dryerWatts: number;
  waterHeaterWatts: number;
  fixedApplianceWatts: number;
};

const DEFAULT_NEC_INPUTS: NecInputs = {
  // Defaults match a typical 2,800 sq ft all-electric home (4-ton AC, electric
  // range/dryer/water heater, heat pump). User can adjust to their actual setup.
  squareFeet: 2800,
  heatingType: "heat-pump",
  heatingWatts: 4700,
  coolingWatts: 4500,
  acStartingWatts: 13500,
  rangeWatts: 8000,
  dryerWatts: 5000,
  waterHeaterWatts: 4500,
  fixedApplianceWatts: 2000, // dishwasher + disposal
};

function Nec220_83Section({ billPeakKw }: { billPeakKw: number | null }) {
  const [inputs, setInputs] = useState<NecInputs>(DEFAULT_NEC_INPUTS);

  const update = <K extends keyof NecInputs>(k: K, v: NecInputs[K]) =>
    setInputs((p) => ({ ...p, [k]: v }));

  const result = useMemo(() => {
    return calculateNec220_83({
      squareFeet: inputs.squareFeet,
      heatingType: inputs.heatingType,
      heatingWatts: inputs.heatingType === "gas" || inputs.heatingType === "none" ? 0 : inputs.heatingWatts,
      coolingWatts: inputs.coolingWatts,
      largestMotorStartingWatts: inputs.acStartingWatts,
      rangeWatts: inputs.rangeWatts,
      dryerWatts: inputs.dryerWatts,
      waterHeaterWatts: inputs.waterHeaterWatts,
      fixedAppliances: [{ name: "dishwasher+disposal", watts: inputs.fixedApplianceWatts }],
    });
  }, [inputs]);

  // Compare to the bill method (if present) and the appliance picker.
  const billRecommended = billPeakKw !== null ? Math.ceil(billPeakKw * 1.25) : null;

  return (
    <section className="max-w-7xl mx-auto px-6 pb-12" data-testid="nec220-83-section">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-5 space-y-4">
        <div>
          <h2 className="text-lg font-bold">NEC 220.83 Optional Method</h2>
          <p className="text-xs text-slate-500 mt-1">
            Code-compliant load calc per NEC 2023 §220.83. This is what an
            inspector would use for service sizing. Compare to your appliance
            picker and bill results.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <NumberField
            label="Square feet"
            value={inputs.squareFeet}
            onChange={(v) => update("squareFeet", v)}
            testId="nec-sqft"
          />
          <SelectField
            label="Heating"
            value={inputs.heatingType}
            onChange={(v) => update("heatingType", v as HeatingType)}
            options={[
              ["gas", "Gas"],
              ["heat-pump", "Heat pump"],
              ["electric-resistance", "Electric strip"],
              ["none", "None"],
            ]}
            testId="nec-heating"
          />
          <NumberField
            label={`Heating W${inputs.heatingType === "gas" || inputs.heatingType === "none" ? " (n/a)" : ""}`}
            value={inputs.heatingWatts}
            onChange={(v) => update("heatingWatts", v)}
            disabled={inputs.heatingType === "gas" || inputs.heatingType === "none"}
            testId="nec-heating-watts"
          />
          <NumberField
            label="Cooling W"
            value={inputs.coolingWatts}
            onChange={(v) => update("coolingWatts", v)}
            testId="nec-cooling"
          />
          <NumberField
            label="AC starting W"
            value={inputs.acStartingWatts}
            onChange={(v) => update("acStartingWatts", v)}
            testId="nec-ac-starting"
          />
          <NumberField
            label="Range W"
            value={inputs.rangeWatts}
            onChange={(v) => update("rangeWatts", v)}
            testId="nec-range"
          />
          <NumberField
            label="Dryer W"
            value={inputs.dryerWatts}
            onChange={(v) => update("dryerWatts", v)}
            testId="nec-dryer"
          />
          <NumberField
            label="Water heater W"
            value={inputs.waterHeaterWatts}
            onChange={(v) => update("waterHeaterWatts", v)}
            testId="nec-water-heater"
          />
        </div>
        <div className="rounded-lg border border-white/[0.07] bg-[#07070e]/40 p-4">
          <div className="flex items-baseline gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">NEC calculated service</div>
              <div className="text-2xl font-bold text-amber-300" data-testid="nec-va">
                {result.totalVa.toLocaleString()} VA
              </div>
            </div>
            <div className="text-slate-500">@ 240V =</div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Service amps</div>
              <div className="text-2xl font-bold text-white" data-testid="nec-amps">
                {result.totalAmps} A
              </div>
            </div>
            <div className="text-slate-500">× 1.25 (80% rule) =</div>
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-500">Recommended generator</div>
              <div className="text-2xl font-bold text-amber-300" data-testid="nec-kw">
                {result.recommendedKw} kW
              </div>
            </div>
          </div>
          <details className="mt-3 text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-300">Show breakdown</summary>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>General lighting (after demand): {result.breakdown.generalLightingAfterDemand.toLocaleString()} VA</li>
              <li>Small appliance (after demand): {result.breakdown.smallApplianceAfterDemand.toLocaleString()} VA</li>
              <li>Laundry: {result.breakdown.laundryAfterDemand.toLocaleString()} VA</li>
              <li>Range (220.55): {result.breakdown.range.toLocaleString()} VA</li>
              <li>Dryer (220.54): {result.breakdown.dryer.toLocaleString()} VA</li>
              <li>Water heater: {result.breakdown.waterHeater.toLocaleString()} VA</li>
              <li>Fixed appliances: {result.breakdown.fixedAppliances.toLocaleString()} VA</li>
              <li>Heating OR cooling: {result.breakdown.heatingOrCooling.toLocaleString()} VA</li>
              <li>Largest motor @ 25% (220.50): {result.breakdown.largestMotor25pct.toLocaleString()} VA</li>
            </ul>
          </details>
        </div>
        {billRecommended !== null && (
          <div className="text-xs text-slate-500">
            Bill method: {billPeakKw!.toFixed(1)} kW peak × 1.25 = <span className="text-amber-300 font-mono">{billRecommended} kW</span> (your
            actual empirical baseline). The NEC value is the code-compliant
            upper bound; the bill is your real-world typical.
          </div>
        )}
      </div>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  testId,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        disabled={disabled}
        data-testid={testId}
        className="mt-1 w-full rounded-md border border-white/[0.08] bg-white/[0.025] px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none disabled:opacity-40"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  testId?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className="mt-1 w-full rounded-md border border-white/[0.08] bg-white/[0.025] px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none"
      >
        {options.map(([v, label]) => (
          <option key={v} value={v}>{label}</option>
        ))}
      </select>
    </label>
  );
}