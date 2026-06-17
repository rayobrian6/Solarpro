/**
 * Marketplace shared React sub-components.
 * Used by network/page.tsx and extracted marketplace modal components.
 */
"use client";

import React from "react";
import {
  type Opportunity,
  type MarketplaceBillVisualsProjection,
  type EnrichmentChip,
  contractorToneClasses,
  evidenceValue,
} from "./marketplaceHelpers";
import {
  buildEnrichmentDetailGroups,
  formatConfidence,
  formatDisplayValue,
} from "@/lib/network/opportunityEnrichmentDisplay";

export function RevenueMetric({
  label,
  value,
  source,
  accent,
}: {
  label: string;
  value: string;
  source?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-950/35 p-3">
      <div className="text-slate-500 text-[10px] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div
        className={`font-black text-lg tabular-nums ${accent ?? "text-white"}`}
      >
        {value}
      </div>
      {source && (
        <div className="mt-1 text-[10px] text-slate-500">{source}</div>
      )}
    </div>
  );
}


export function EvidencePanel({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: { label: string; value: unknown; accent?: string }[];
}) {
  return (
    <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
      <div className="mb-3">
        <p className="text-slate-400 text-[10px] uppercase tracking-[0.2em] font-black">
          {title}
        </p>
        {subtitle && (
          <p className="mt-1 text-[11px] text-slate-600">{subtitle}</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map((item) => (
          <div
            key={`${title}-${item.label}`}
            className="rounded-xl bg-slate-900/55 border border-slate-800/80 p-3"
          >
            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
              {item.label}
            </div>
            <div
              className={`font-semibold text-sm ${item.accent ?? "text-white"}`}
            >
              {evidenceValue(item.value)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function BillVisualsPanel({
  visuals,
}: {
  visuals?: MarketplaceBillVisualsProjection | null;
}) {
  if (
    !visuals ||
    (!visuals.monthly_usage_history.length &&
      !visuals.extracted_fields.length &&
      !visuals.confidence_label &&
      !visuals.parser_method)
  )
    return null;
  const maxUsage = Math.max(...visuals.monthly_usage_history, 1);

  return (
    <section className="mb-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-amber-300 text-[10px] uppercase tracking-[0.2em] font-black">
            Enhanced bill visuals
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Contractor-safe parser output projected from the released
            marketplace payload.
          </p>
        </div>
        {visuals.confidence_label && (
          <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-300">
            {visuals.confidence_label}
          </span>
        )}
      </div>

      {visuals.monthly_usage_history.length ? (
        <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-500">
            <span>Monthly usage history</span>
            <span>{visuals.months_found} months</span>
          </div>
          <div className="space-y-1.5">
            {visuals.monthly_usage_history.slice(0, 12).map((kwh, index) => (
              <div
                key={`marketplace-usage-${index}`}
                className="flex items-center gap-2"
              >
                <span className="w-8 text-[10px] text-slate-500">
                  M{index + 1}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-400"
                    style={{
                      width: `${Math.max(6, Math.round((kwh / maxUsage) * 100))}%`,
                    }}
                  />
                </div>
                <span className="w-16 text-right text-[10px] font-semibold tabular-nums text-slate-300">
                  {Math.round(kwh).toLocaleString()} kWh
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Parser", value: visuals.parser_method },
          { label: "Model", value: visuals.parser_model },
          { label: "Input", value: visuals.parser_input },
          { label: "Bill Type", value: visuals.bill_type },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-xl bg-slate-900/55 border border-slate-800/80 p-3"
          >
            <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
              {item.label}
            </div>
            <div className="font-semibold text-sm text-white truncate">
              {evidenceValue(item.value)}
            </div>
          </div>
        ))}
      </div>

      {visuals.extracted_fields.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {visuals.extracted_fields.slice(0, 12).map((field) => (
            <span
              key={field}
              className="rounded-lg border border-slate-700 bg-slate-900/70 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-300"
            >
              {formatDisplayValue(field)}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ContractorEnrichmentChips({ chips }: { chips: EnrichmentChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={`px-2 py-0.5 rounded-md border text-[10px] font-bold uppercase tracking-wide ${contractorToneClasses(chip.tone)}`}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}
export function ContractorEnrichmentDetails({ opp }: { opp: Opportunity }) {
  const groups = buildEnrichmentDetailGroups(opp);
  if (!groups.length) return null;
  return (
    <section className="mb-5">
      <p className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold mb-3">
        Enriched Opportunity Factors
      </p>
      <div className="space-y-3">
        {groups.map((group) => (
          <div
            key={group.title}
            className="rounded-xl border border-slate-700/50 bg-slate-900/35 p-3"
          >
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {group.title}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {group.items.slice(0, 4).map((item) => (
                <div
                  key={`${group.title}-${item.label}`}
                  className="rounded-lg bg-slate-800/50 p-2"
                >
                  <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
                    {item.label}
                  </div>
                  <div className="font-semibold text-sm text-white">
                    {item.value}
                  </div>
                  <div className="mt-1 text-[10px] text-slate-500">
                    Confidence {formatConfidence(item.confidence)}
                  </div>
                  {item.warnings.length ? (
                    <div className="mt-1 text-[10px] text-amber-300">
                      {item.warnings.join(", ")}
                    </div>
                  ) : null}
                  {item.missing.length ? (
                    <div className="mt-1 text-[10px] text-rose-300">
                      Missing: {item.missing.join(", ")}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
