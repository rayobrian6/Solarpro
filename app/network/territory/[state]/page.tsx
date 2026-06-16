"use client";

import AppShell from "@/components/ui/AppShell";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Zap,
  DollarSign,
  Battery,
  Award,
  Loader2,
  MapPin,
} from "lucide-react";

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan",
  MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota",
  OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee",
  TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

type Lead = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

const usdShort = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : `$${Math.round(n)}`;
const usdFull = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Bucket a set of leads by a key function into ordered {label, count, value}.
function bucket(
  leads: Lead[],
  keyOf: (l: Lead) => string,
  order?: string[],
  valueOf?: (l: Lead) => number | null,
) {
  const map = new Map<string, { count: number; value: number }>();
  for (const l of leads) {
    const k = keyOf(l) || "Unknown";
    const cur = map.get(k) ?? { count: 0, value: 0 };
    cur.count += 1;
    if (valueOf) cur.value += valueOf(l) ?? 0;
    map.set(k, cur);
  }
  let entries = [...map.entries()].map(([label, v]) => ({ label, ...v }));
  if (order) {
    entries.sort((a, b) => {
      const ia = order.indexOf(a.label);
      const ib = order.indexOf(b.label);
      if (ia === -1 && ib === -1) return b.count - a.count;
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  } else {
    entries.sort((a, b) => b.count - a.count);
  }
  return entries;
}

function gradeOf(l: Lead): string {
  const g = str(l.lead_grade).toUpperCase().trim();
  return g && "ABCDEF".includes(g[0]) ? `Grade ${g[0]}` : "Ungraded";
}
function valueBandOf(l: Lead): string {
  const v = num(l.estimated_system_cost);
  if (v == null) return "Unknown";
  if (v < 15_000) return "Under $15k";
  if (v < 25_000) return "$15k–25k";
  if (v < 40_000) return "$25k–40k";
  if (v < 60_000) return "$40k–60k";
  return "$60k+";
}
function sizeBandOf(l: Lead): string {
  const v = num(l.system_size_kw);
  if (v == null) return "Unknown";
  if (v < 5) return "Under 5 kW";
  if (v < 8) return "5–8 kW";
  if (v < 12) return "8–12 kW";
  if (v < 20) return "12–20 kW";
  return "20 kW+";
}
function roofOf(l: Lead): string {
  const r = str(l.roof_material).trim();
  if (!r) return "Unknown";
  return r.charAt(0).toUpperCase() + r.slice(1).replace(/_/g, " ");
}
function timelineOf(l: Lead): string {
  const t = str(l.timeline).trim();
  if (!t) return "Unknown";
  return t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");
}
function batteryOf(l: Lead): string {
  const bi = str(l.battery_interest).toLowerCase();
  if (l.battery_candidate === true || bi === "yes" || bi === "true")
    return "Battery interested";
  return "Solar only";
}

const VALUE_ORDER = [
  "Under $15k",
  "$15k–25k",
  "$25k–40k",
  "$40k–60k",
  "$60k+",
  "Unknown",
];
const SIZE_ORDER = [
  "Under 5 kW",
  "5–8 kW",
  "8–12 kW",
  "12–20 kW",
  "20 kW+",
  "Unknown",
];
const GRADE_ORDER = [
  "Grade A",
  "Grade B",
  "Grade C",
  "Grade D",
  "Grade E",
  "Grade F",
  "Ungraded",
];

function Kpi({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className={`mb-2 ${accent}`}>{icon}</div>
      <div className="text-2xl font-bold tabular-nums text-white">{value}</div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-600">{sub}</div>}
    </div>
  );
}

function Breakdown({
  title,
  subtitle,
  rows,
  total,
}: {
  title: string;
  subtitle: string;
  rows: { label: string; count: number; value: number }[];
  total: number;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
      <div className="mb-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          {title}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-600">{subtitle}</p>
      </div>
      <div className="space-y-2.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-[11px] text-slate-400">
              {r.label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="w-10 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-200">
              {r.count}
            </span>
            <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
              {Math.round((r.count / total) * 100)}%
            </span>
            {r.value > 0 && (
              <span className="hidden w-14 shrink-0 text-right text-[10px] tabular-nums text-emerald-400/80 sm:inline">
                {usdShort(r.value)}
              </span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TerritoryView() {
  const params = useParams();
  const search = useSearchParams();
  const state = String(params.state ?? "").toUpperCase();
  const countyParam = search.get("county") ?? "";
  const stateName = STATE_NAMES[state] ?? state;

  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/network/opportunities?state=${state}&limit=50`)
      .then((r) => (r.ok ? r.json() : { opportunities: [] }))
      .then((d) => {
        if (alive) setLeads((d.opportunities || []) as Lead[]);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [state]);

  const stats = useMemo(() => {
    const pipeline = leads.reduce(
      (s, l) => s + (num(l.estimated_system_cost) ?? 0),
      0,
    );
    const revenue = leads.reduce((s, l) => s + (num(l.asking_price) ?? 0), 0);
    const kwVals = leads.map((l) => num(l.system_size_kw)).filter((v): v is number => v != null);
    const avgKw =
      kwVals.length > 0 ? kwVals.reduce((s, v) => s + v, 0) / kwVals.length : 0;
    const battery = leads.filter((l) => batteryOf(l) === "Battery interested").length;
    const ab = leads.filter((l) => {
      const g = str(l.lead_grade).toUpperCase();
      return g.startsWith("A") || g.startsWith("B");
    }).length;
    return { pipeline, revenue, avgKw, battery, ab };
  }, [leads]);

  return (
    <AppShell>
      <div className="min-h-screen" style={{ background: "var(--bg-base, #0b1120)" }}>
        <div className="mx-auto max-w-6xl px-6 py-6">
          {/* Header */}
          <Link
            href="/network"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-white"
          >
            <ArrowLeft size={15} /> Back to marketplace
          </Link>

          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <MapPin size={15} className="text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                  Territory Intelligence
                </span>
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white lg:text-4xl">
                {stateName}
              </h1>
              <p className="mt-1 text-sm text-slate-400">
                Every available opportunity in {stateName}, broken down by job
                type, size and value.
                {countyParam && (
                  <span className="ml-1 text-slate-500">
                    (entered from a county on the map)
                  </span>
                )}
              </p>
            </div>
            <Link
              href={`/network?state=${state}`}
              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-900 transition-colors hover:bg-emerald-300"
            >
              Browse &amp; claim {state} leads →
            </Link>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 size={30} className="animate-spin text-emerald-500" />
            </div>
          ) : leads.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/30 p-10 text-center">
              <p className="text-slate-300">
                No available opportunities in {stateName} right now.
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Check back soon — new leads land here as homeowners qualify.
              </p>
            </div>
          ) : (
            <>
              {/* KPI strip */}
              <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Kpi
                  icon={<MapPin size={16} />}
                  label="Available leads"
                  value={String(leads.length)}
                  accent="text-emerald-400"
                />
                <Kpi
                  icon={<DollarSign size={16} />}
                  label="Pipeline value"
                  value={usdShort(stats.pipeline)}
                  sub="installed system $"
                  accent="text-amber-400"
                />
                <Kpi
                  icon={<DollarSign size={16} />}
                  label="Lead revenue"
                  value={usdFull(stats.revenue)}
                  sub="if all claimed"
                  accent="text-emerald-400"
                />
                <Kpi
                  icon={<Zap size={16} />}
                  label="Avg system"
                  value={`${stats.avgKw.toFixed(1)} kW`}
                  accent="text-blue-400"
                />
                <Kpi
                  icon={<Battery size={16} />}
                  label="Battery interest"
                  value={`${Math.round((stats.battery / leads.length) * 100)}%`}
                  sub={`${stats.battery} of ${leads.length}`}
                  accent="text-violet-400"
                />
                <Kpi
                  icon={<Award size={16} />}
                  label="Grade A / B"
                  value={`${Math.round((stats.ab / leads.length) * 100)}%`}
                  sub={`${stats.ab} top-tier`}
                  accent="text-amber-400"
                />
              </div>

              {/* Breakdowns */}
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <Breakdown
                  title="Jobs by quality grade"
                  subtitle="Higher grades = more qualified, higher-intent homeowners"
                  total={leads.length}
                  rows={bucket(leads, gradeOf, GRADE_ORDER, (l) =>
                    num(l.asking_price),
                  )}
                />
                <Breakdown
                  title="Jobs by project value"
                  subtitle="Estimated installed system cost"
                  total={leads.length}
                  rows={bucket(leads, valueBandOf, VALUE_ORDER, (l) =>
                    num(l.estimated_system_cost),
                  )}
                />
                <Breakdown
                  title="Jobs by system size"
                  subtitle="Estimated array size in kW"
                  total={leads.length}
                  rows={bucket(leads, sizeBandOf, SIZE_ORDER)}
                />
                <Breakdown
                  title="Jobs by roof type"
                  subtitle="Primary roof material"
                  total={leads.length}
                  rows={bucket(leads, roofOf)}
                />
                <Breakdown
                  title="Jobs by timeline"
                  subtitle="How soon the homeowner wants to move"
                  total={leads.length}
                  rows={bucket(leads, timelineOf)}
                />
                <Breakdown
                  title="Battery attach"
                  subtitle="Storage interest signals upsell"
                  total={leads.length}
                  rows={bucket(leads, batteryOf)}
                />
              </div>

              {/* Lead list */}
              <section className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
                <p className="mb-3 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                  Available opportunities
                </p>
                <div className="space-y-2">
                  {leads.map((l) => (
                    <Link
                      key={str(l.id)}
                      href={`/network?state=${state}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-3 transition-colors hover:border-emerald-500/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-white">
                            {str(l.city) || stateName}
                          </span>
                          {str(l.lead_grade) && (
                            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                              {gradeOf(l)}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {[
                            num(l.system_size_kw) != null
                              ? `${num(l.system_size_kw)} kW`
                              : "",
                            roofOf(l) !== "Unknown" ? roofOf(l) : "",
                            batteryOf(l) === "Battery interested"
                              ? "Battery"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {num(l.asking_price) != null && (
                          <div className="text-sm font-bold text-emerald-300">
                            {usdFull(num(l.asking_price) as number)}
                          </div>
                        )}
                        {num(l.estimated_system_cost) != null && (
                          <div className="text-[10px] text-slate-500">
                            {usdShort(num(l.estimated_system_cost) as number)}{" "}
                            system
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

export default function TerritoryPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div
            className="flex min-h-screen items-center justify-center"
            style={{ background: "var(--bg-base, #0b1120)" }}
          >
            <Loader2 size={30} className="animate-spin text-emerald-500" />
          </div>
        </AppShell>
      }
    >
      <TerritoryView />
    </Suspense>
  );
}
