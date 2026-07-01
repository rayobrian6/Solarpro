"use client";

import Link from "next/link";
import type { EstimateResult } from "@/lib/generatorEstimate";
import { defaultLaborHours } from "@/lib/generatorProposal";

export default function ResultCard({
  estimate,
  appliances,
  formatWatts,
  formatUSD,
}: {
  estimate: EstimateResult;
  appliances: Record<string, number>;
  formatWatts: (w: number) => string;
  formatUSD: (n: number) => string;
}) {
  const { picks, recommendedKw, rawRecommendedKw, catalogCeilingKw, breakdown, totalPeakWatts, totalRunningWatts, largestMotorStartingWatts, installedCostLow, installedCostHigh, billPeakKw, exceedsCatalog, loadProfile, demandFactor } = estimate;
  const totalItems = Object.values(appliances).reduce((s, q) => s + q, 0);
  const best = picks.bestValue;
  const proposalHref =
    `/proposal?brand=${encodeURIComponent(best.brand)}` +
    `&model=${encodeURIComponent(best.model)}` +
    `&kw=${best.kw}` +
    `&msrp=${best.msrp}` +
    `&hours=${defaultLaborHours(best.kw)}`;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-gradient-to-b border-white/[0.07] bg-white/[0.025] p-6 shadow-xl">
      <div className="text-xs uppercase tracking-wider text-slate-500">Recommended size</div>
      <div className="mt-1 text-5xl font-bold text-amber-300">{recommendedKw} kW</div>
      <div className="mt-1 text-sm text-slate-400">
        Standby generator for your home
        {demandFactor < 1 && (
          <span className="ml-2 text-xs text-slate-500">
            ({(demandFactor * 100).toFixed(0)}% demand factor —{" "}
            {loadProfile === "managed" ? "Smart Management" : "essentials only"})
          </span>
        )}
      </div>
      {exceedsCatalog && (
        <p className="mt-3 rounded-md border border-amber-700/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
          <strong>Catalog ceiling: {catalogCeilingKw} kW.</strong> Your load
          actually needs <strong>{rawRecommendedKw} kW</strong> for full
          simultaneous coverage. Options: (1) add a Smart Management Module (SMM)
          to cycle heavy loads like central AC and stay at {catalogCeilingKw} kW,
          or (2) upgrade to a liquid-cooled commercial unit. Most whole-house
          installs use SMM — that&apos;s the Generac-recommended path.
        </p>
      )}

      {totalItems === 0 ? (
        <p className="mt-6 text-sm text-slate-400">
          Select appliances on the left to see your estimate.
        </p>
      ) : (
        <>
          <dl className="mt-6 space-y-2 text-sm">
            <Row label="Running load" value={formatWatts(totalRunningWatts)} />
            <Row label="Largest motor start" value={formatWatts(largestMotorStartingWatts)} />
            <Row label="Peak demand (with 25% margin)" value={formatWatts(totalPeakWatts)} />
          </dl>

          {(breakdown.length > 0 || billPeakKw > 0) && (
            <div className="mt-6">
              <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">By category</div>
              <div className="space-y-1.5">
                {breakdown.map((b) => (
                  <div key={b.category} className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{b.category}</span>
                    <span className="font-mono text-slate-400">{formatWatts(b.runningWatts)}</span>
                  </div>
                ))}
                {billPeakKw > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-amber-300/90">From your bill (baseline)</span>
                    <span className="font-mono text-amber-200">
                      {formatWatts(billPeakKw * 1000)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-6 border-t border-white/[0.07] pt-5">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-3">Top picks</div>
            <div className="space-y-3">
              <PickCard
                label="Best value"
                brand={picks.bestValue.brand}
                model={`${picks.bestValue.series} ${picks.bestValue.kw} kW`}
                sub={`Model ${picks.bestValue.model} · ${picks.bestValue.fuel}`}
                price={picks.bestValue.msrp}
                formatUSD={formatUSD}
              />
              <PickCard
                label="Highest motor starting"
                brand={picks.highestSurge.brand}
                model={`${picks.highestSurge.series} ${picks.highestSurge.kw} kW`}
                sub={`Model ${picks.highestSurge.model} · ${picks.highestSurge.motorStartingAmps ?? "—"} Amps surge`}
                price={picks.highestSurge.msrp}
                formatUSD={formatUSD}
              />
              {picks.alternative.kw !== picks.bestValue.kw && (
                <PickCard
                  label="Alternative"
                  brand={picks.alternative.brand}
                  model={`${picks.alternative.series} ${picks.alternative.kw} kW`}
                  sub={`Model ${picks.alternative.model}`}
                  price={picks.alternative.msrp}
                  formatUSD={formatUSD}
                />
              )}
            </div>
          </div>

          <div className="mt-6 border-t border-white/[0.07] pt-5">
            <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">Estimated installed cost</div>
            <div className="text-2xl font-bold text-white">
              {formatUSD(installedCostLow)} – {formatUSD(installedCostHigh)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Includes generator, automatic transfer switch, and typical install labor. Permits, gas
              line, and electrical upgrades not included.
            </p>
          </div>

          <Link
            href={proposalHref}
            className="mt-5 block w-full text-center rounded-md bg-amber-300 hover:bg-amber-400 text-zinc-950 font-bold py-2.5 text-sm transition"
          >
            Build customer proposal →
          </Link>
        </>
      )}

      <p className="mt-6 text-[10px] text-slate-600 leading-relaxed">
        Estimates only. Sizing follows the industry formula: (running watts + largest
        single largest motor starting surge) × 1.25 safety margin (Generac 80% rule),
        rounded up. Final selection should be
        reviewed by a licensed electrician with an actual load calculation.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-400">{label}</dt>
      <dd className="font-mono text-white">{value}</dd>
    </div>
  );
}

function PickCard({
  label,
  brand,
  model,
  sub,
  price,
  formatUSD,
}: {
  label: string;
  brand: string;
  model: string;
  sub: string;
  price: number;
  formatUSD: (n: number) => string;
}) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
      <div className="flex items-baseline justify-between">
        <div className="text-xs uppercase tracking-wider text-amber-300">{label}</div>
        <div className="font-mono text-sm text-white">{formatUSD(price)}</div>
      </div>
      <div className="mt-1 text-sm font-bold text-white">{brand}</div>
      <div className="text-xs text-slate-400">{model}</div>
      <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}