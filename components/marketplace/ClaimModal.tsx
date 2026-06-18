"use client";

import React from "react";
import { X, Shield, Loader2, CheckCircle } from "lucide-react";
import {
  type Opportunity,
  fmtKw,
  fmtRate,
  fmtCurrency,
} from "@/lib/network/marketplaceHelpers";

export default function ClaimModal({
  opp,
  onConfirm,
  onCancel,
  loading,
}: {
  opp: Opportunity;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-[#0f1623] border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-white font-bold text-lg">
              Claim This Opportunity
            </h2>
            <button
              onClick={onCancel}
              className="text-slate-500 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-5">
            {[
              {
                label: "Location",
                value:
                  opp.city && opp.state_code
                    ? `${opp.city}, ${opp.state_code}`
                    : opp.state_code || "—",
              },
              {
                label: "System Size",
                value: fmtKw(opp.system_size_kw),
                highlight: true,
              },
              {
                label: "Annual Usage",
                value: opp.annual_kwh
                  ? `${Math.round(opp.annual_kwh).toLocaleString()} kWh`
                  : "—",
              },
              {
                label: "Utility Rate",
                value: fmtRate(opp.utility_rate_per_kwh),
              },
            ].map((item) => (
              <div key={item.label} className="bg-slate-800/60 rounded-xl p-3">
                <div className="text-slate-500 text-[10px] uppercase tracking-wider mb-1">
                  {item.label}
                </div>
                <div
                  className={`font-semibold text-sm ${item.highlight ? "text-amber-400" : "text-white"}`}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-start gap-2.5 bg-emerald-500/8 border border-emerald-500/25 rounded-xl p-3.5 mb-5">
            <Shield
              size={15}
              className="text-emerald-400 flex-shrink-0 mt-0.5"
            />
            <p className="text-emerald-300 text-xs leading-relaxed">
              <strong>
                {opp.claim_mode === "shared"
                  ? "Shared claim."
                  : "Exclusive claim."}
              </strong>{" "}
              {opp.claim_mode === "shared"
                ? "Once claimed, this opportunity moves to My Claims for you while remaining available until shared capacity is full."
                : "Once claimed, this opportunity is removed from the discovery feed. Only you will see the homeowner's full address and contact details."}
            </p>
          </div>

          {opp.asking_price ? (
            <div className="flex items-center justify-between mb-5 px-1">
              <span className="text-slate-400 text-sm">Opportunity price</span>
              <span className="text-emerald-400 font-bold text-xl">
                {fmtCurrency(opp.asking_price)}
              </span>
            </div>
          ) : null}

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 text-sm font-medium text-slate-400 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={loading}
              className="flex-1 py-2.5 text-sm font-bold text-slate-900 bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle size={15} />
              )}
              {loading ? "Starting checkout…" : "Pay & claim"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
