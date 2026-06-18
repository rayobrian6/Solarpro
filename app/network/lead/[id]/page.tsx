"use client";

import AppShell from "@/components/ui/AppShell";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
} from "react-simple-maps";
import { geoMercator } from "d3-geo";
import { feature } from "topojson-client";
import {
  ArrowLeft,
  Loader2,
  MapPin,
  Lock,
  ShieldCheck,
  Flame,
  Zap,
  Users,
  Building2,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type Lead = {
  id: string;
  city: string;
  stateCode: string;
  countyFips: string;
  county: string;
  grade: string;
  systemKw: number | null;
  projectValue: number | null;
  askingPrice: number | null;
  monthlyBill: number | null;
  annualSavings: number | null;
  paybackYrs: number | null;
  utility: string;
  utilityRate: number | null;
  ownership: string;
  financing: string;
  intent: string;
  incomeBand: string;
  creditBand: string;
  sunlight: string;
  roof: string;
  propertyType: string;
  timeline: string;
  ahjName: string;
  battery: boolean;
  complexAhj: boolean;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usdShort = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : `$${Math.round(n)}`;
const isEmpty = (v?: string | null) => !v || /^unknown$/i.test(v);

function rangeFmt(v: string, money = false): string {
  if (isEmpty(v)) return "";
  const toks = v.replace(/[_–-]/g, " ").split(/\s+/).filter(Boolean);
  if (toks.length >= 2)
    return `${money ? "$" : ""}${toks[0]}–${money ? "$" : ""}${toks[1]}`;
  return money ? `$${v}` : v;
}
const yesish = (v: string) =>
  isEmpty(v) ? "" : /^(true|yes|interested|ready)$/i.test(v) ? "Interested" : v;
const timelineFmt = (v: string) =>
  isEmpty(v) ? "" : /asap|immediate|now/i.test(v) ? "ASAP" : v;

function leadScore(l: Lead): number {
  const base: Record<string, number> = {
    "Grade A": 90,
    "Grade B": 76,
    "Grade C": 60,
    "Grade D": 44,
  };
  let sc = base[l.grade] ?? 55;
  if (l.battery) sc += 3;
  if (/interest|ready|yes|true/i.test(l.financing)) sc += 2;
  if (/full|high|good/i.test(l.sunlight)) sc += 2;
  if (/asap|immediate|now/i.test(l.timeline)) sc += 3;
  if (/own/i.test(l.ownership)) sc += 1;
  return Math.max(20, Math.min(99, sc));
}

// ── 25-year ROI projection from whatever economics we have, with sane,
// clearly-labelled fallbacks so the chart always tells a story. ──────────────
function projection(l: Lead) {
  const monthlyBill = l.monthlyBill ?? (l.systemKw ? l.systemKw * 22 : 165);
  const annualBill = monthlyBill * 12;
  const inflation = 0.035;
  const offset = 0.9;
  const systemCost =
    l.projectValue ?? (l.systemKw ? l.systemKw * 2800 : 24_000);
  const netCost = systemCost * 0.7; // ~30% federal credit
  const pts: { year: number; savings: number }[] = [];
  let utilCum = 0;
  let solarCum = netCost;
  for (let y = 0; y <= 25; y++) {
    if (y > 0) {
      const yearCost = annualBill * Math.pow(1 + inflation, y - 1);
      utilCum += yearCost;
      solarCum += yearCost * (1 - offset);
    }
    pts.push({ year: y, savings: utilCum - solarCum });
  }
  const breakeven =
    l.paybackYrs ??
    pts.find((p) => p.savings >= 0)?.year ??
    null;
  const total25 = pts[pts.length - 1].savings;
  const solarMonthly = Math.round(
    monthlyBill * (1 - offset) + netCost / 12 / 20,
  );
  return { monthlyBill, systemCost, netCost, pts, breakeven, total25, solarMonthly };
}

function SavingsChart({
  pts,
  breakeven,
}: {
  pts: { year: number; savings: number }[];
  breakeven: number | null;
}) {
  const W = 560;
  const H = 220;
  const padL = 8;
  const padB = 22;
  const maxS = Math.max(...pts.map((p) => p.savings), 1);
  const minS = Math.min(...pts.map((p) => p.savings), 0);
  const span = maxS - minS || 1;
  const x = (yr: number) => padL + (yr / 25) * (W - padL * 2);
  const y = (v: number) => (H - padB) * (1 - (v - minS) / span) + 4;
  const zeroY = y(0);
  const line = pts.map((p) => `${x(p.year)},${y(p.savings)}`).join(" ");
  const area = `${padL},${zeroY} ${line} ${x(25)},${zeroY}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id="sav" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* zero baseline */}
      <line x1={padL} y1={zeroY} x2={W - padL} y2={zeroY} stroke="#334155" strokeWidth="1" strokeDasharray="4 4" />
      <polygon points={area} fill="url(#sav)" />
      <polyline points={line} fill="none" stroke="#34d399" strokeWidth="2.5" />
      {breakeven != null && breakeven <= 25 ? (
        <>
          <line x1={x(breakeven)} y1="4" x2={x(breakeven)} y2={H - padB} stroke="#fbbf24" strokeWidth="1.5" strokeDasharray="3 3" />
          <circle cx={x(breakeven)} cy={zeroY} r="4" fill="#fbbf24" />
          <text x={x(breakeven) + 6} y="16" fontSize="11" fill="#fbbf24" fontWeight="700">
            Payback ~yr {Math.round(breakeven)}
          </text>
        </>
      ) : null}
      {[0, 5, 10, 15, 20, 25].map((yr) => (
        <text key={yr} x={x(yr)} y={H - 6} fontSize="10" fill="#64748b" textAnchor="middle">
          {yr}
        </text>
      ))}
    </svg>
  );
}

interface CountyFeat {
  id?: string | number;
  rsmKey?: string;
  geometry: unknown;
}

function CountyMap({ fips }: { fips: string }) {
  const [stateCounties, setStateCounties] = useState<CountyFeat[] | null>(null);
  const [target, setTarget] = useState<CountyFeat | null>(null);

  useEffect(() => {
    let alive = true;
    import("us-atlas/counties-10m.json").then((mod) => {
      const topo = (mod as { default?: unknown }).default ?? mod;
      const all = (
        feature(
          topo as never,
          (topo as { objects: { counties: never } }).objects.counties,
        ) as unknown as { features: CountyFeat[] }
      ).features;
      if (!alive) return;
      const st = fips.slice(0, 2);
      const t = all.find((f) => String(f.id ?? "").padStart(5, "0") === fips);
      setStateCounties(
        all.filter((f) => String(f.id ?? "").padStart(5, "0").slice(0, 2) === st),
      );
      setTarget(t ?? null);
    });
    return () => {
      alive = false;
    };
  }, [fips]);

  const view = useMemo(() => {
    if (!target) return null;
    const proj = geoMercator().fitExtent(
      [
        [30, 25],
        [530, 235],
      ],
      target as never,
    );
    const center =
      (proj.invert?.([280, 130]) as [number, number] | undefined) ?? [-89, 39];
    return { scale: proj.scale(), center };
  }, [target]);

  if (!stateCounties || !view)
    return <div className="h-52 animate-pulse rounded-2xl bg-slate-800/40" />;

  return (
    <ComposableMap
      projection="geoMercator"
      width={560}
      height={260}
      projectionConfig={{ scale: view.scale, center: view.center }}
      style={{ width: "100%", height: "auto" }}
    >
      <Geographies geography={stateCounties as never}>
        {({ geographies }) =>
          geographies.map((geo) => {
            const isTarget =
              String(geo.id ?? "").padStart(5, "0") === fips;
            return (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                style={{
                  default: {
                    fill: isTarget ? "#10b981" : "#131c2b",
                    stroke: isTarget ? "#34d399" : "#243042",
                    strokeWidth: isTarget ? 1.2 : 0.5,
                    outline: "none",
                  },
                  hover: { fill: isTarget ? "#10b981" : "#131c2b", outline: "none" },
                  pressed: { outline: "none" },
                }}
              />
            );
          })
        }
      </Geographies>
    </ComposableMap>
  );
}

function ScoreRing({ score, size = 92 }: { score: number; size?: number }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  const col =
    score >= 85 ? "#34d399" : score >= 70 ? "#fbbf24" : score >= 55 ? "#fb923c" : "#f87171";
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#1e293b" strokeWidth="7" />
      <circle
        cx={cx}
        cy={cx}
        r={r}
        fill="none"
        stroke={col}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text x={cx} y={cx + 1} textAnchor="middle" fontSize={size * 0.28} fontWeight="800" fill="#fff">
        {score}
      </text>
      <text x={cx} y={cx + size * 0.2} textAnchor="middle" fontSize="9" fill="#64748b" fontWeight="700">
        SCORE
      </text>
    </svg>
  );
}

const GRADE_TONE: Record<string, string> = {
  "Grade A": "bg-emerald-400 text-slate-900",
  "Grade B": "bg-amber-400 text-slate-900",
  "Grade C": "bg-orange-400 text-slate-900",
  "Grade D": "bg-slate-500 text-white",
};

function Stat({ label, value }: { label: string; value: string }) {
  const empty = isEmpty(value) || value === "";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-[13px] font-semibold ${empty ? "text-slate-600" : "text-slate-100"}`}>
        {empty ? "Pending" : value}
      </div>
    </div>
  );
}

function Panel({
  icon,
  title,
  stats,
}: {
  icon: React.ReactNode;
  title: string;
  stats: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3 flex items-center gap-1.5 text-emerald-400">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
          {title}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {stats.map((st) => (
          <Stat key={st.label} label={st.label} value={st.value} />
        ))}
      </div>
    </div>
  );
}

export default function LeadProductPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const [lead, setLead] = useState<Lead | null>(null);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/network/opportunities/${id}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setLead(d?.lead ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await fetch(`/api/network/opportunities/${id}/checkout`, {
        method: "POST",
      });
      const d = await res.json();
      if (res.ok && d.url) {
        window.location.href = d.url as string;
        return;
      }
      toast.error(d.error || "Could not start checkout.");
    } finally {
      setClaiming(false);
    }
  }, [id]);

  const score = lead ? leadScore(lead) : 0;
  const proj = useMemo(() => (lead ? projection(lead) : null), [lead]);

  return (
    <AppShell>
      <div className="min-h-screen" style={{ background: "var(--bg-base, #0b1120)" }}>
        <div className="mx-auto max-w-6xl px-6 py-6">
          <Link
            href={
              lead
                ? `/network/territory/${lead.stateCode}?county=${lead.countyFips}`
                : "/network"
            }
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 transition-colors hover:text-white"
          >
            <ArrowLeft size={15} /> Back to county
          </Link>

          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 size={30} className="animate-spin text-emerald-500" />
            </div>
          ) : !lead || !proj ? (
            <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/30 p-10 text-center text-slate-300">
              This lead is no longer available.
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-3">
              {/* Main column */}
              <div className="space-y-5 lg:col-span-2">
                {/* Hero */}
                <div className="overflow-hidden rounded-3xl border border-slate-700/60 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_40%),#0f1623]">
                  <div className="flex items-start justify-between gap-4 p-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-emerald-400">
                          <MapPin size={13} /> Territory Intelligence
                        </span>
                        {score >= 85 ? (
                          <span className="flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 text-[10px] font-black uppercase text-orange-300">
                            <Flame size={11} /> Hot lead
                          </span>
                        ) : null}
                      </div>
                      <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
                        {lead.county ? `${lead.county} County` : lead.stateCode} Solar Lead
                      </h1>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-lg px-2 py-0.5 text-[11px] font-black uppercase ${GRADE_TONE[lead.grade] ?? "bg-slate-500 text-white"}`}
                        >
                          {lead.grade}
                        </span>
                        {lead.battery ? (
                          <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-300">
                            Battery upsell
                          </span>
                        ) : null}
                        {/interest|ready|yes|true/i.test(lead.financing) ? (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                            Finance-ready
                          </span>
                        ) : null}
                        {/asap|immediate|now/i.test(lead.timeline) ? (
                          <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-300">
                            Ready now
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ScoreRing score={score} />
                  </div>
                  {/* County map */}
                  <div className="border-t border-slate-800 bg-slate-950/30 p-3">
                    {lead.countyFips ? (
                      <CountyMap fips={lead.countyFips} />
                    ) : (
                      <div className="flex h-40 items-center justify-center text-sm text-slate-600">
                        County map unavailable
                      </div>
                    )}
                    <p className="mt-1 text-center text-[11px] text-slate-600">
                      Approximate area only — exact address unlocks after you claim.
                    </p>
                  </div>
                </div>

                {/* ROI money viz */}
                <div className="rounded-3xl border border-slate-800 bg-slate-950/30 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <TrendingUp size={16} className="text-emerald-400" />
                    <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
                      25-Year Savings Projection
                    </h2>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        25-yr savings
                      </div>
                      <div className="text-xl font-bold text-emerald-400">
                        {usdShort(Math.max(0, proj.total25))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        Payback
                      </div>
                      <div className="text-xl font-bold text-amber-400">
                        {proj.breakeven != null ? `~${Math.round(proj.breakeven)} yr` : "—"}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        System value
                      </div>
                      <div className="text-xl font-bold text-white">
                        {usdShort(proj.systemCost)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <SavingsChart pts={proj.pts} breakeven={proj.breakeven} />
                  </div>
                  {/* Bill now vs solar */}
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        Bill today
                      </div>
                      <div className="text-2xl font-bold text-rose-300">
                        ${Math.round(proj.monthlyBill)}/mo
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-rose-500/30" />
                    </div>
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        Est. with solar
                      </div>
                      <div className="text-2xl font-bold text-emerald-300">
                        ${Math.max(0, proj.solarMonthly)}/mo
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-emerald-500/40" style={{ width: `${Math.min(100, (proj.solarMonthly / Math.max(1, proj.monthlyBill)) * 100)}%` }} />
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-slate-600">
                    Estimated from this homeowner&apos;s signals (bill, system size,
                    utility) — final numbers confirmed at site assessment.
                  </p>
                </div>

                {/* Quality panels */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Panel
                    icon={<Users size={13} />}
                    title="Homeowner"
                    stats={[
                      { label: "Ownership", value: lead.ownership },
                      { label: "Income", value: rangeFmt(lead.incomeBand, true) },
                      { label: "Credit", value: rangeFmt(lead.creditBand) },
                      { label: "Intent", value: lead.intent },
                      { label: "Financing", value: yesish(lead.financing) },
                    ]}
                  />
                  <Panel
                    icon={<Zap size={13} />}
                    title="System"
                    stats={[
                      { label: "Size", value: lead.systemKw != null ? `${lead.systemKw} kW` : "" },
                      { label: "Value", value: lead.projectValue != null ? usd(lead.projectValue) : "" },
                      { label: "Annual savings", value: lead.annualSavings != null ? usd(lead.annualSavings) : "" },
                      { label: "Battery", value: lead.battery ? "Yes" : "No" },
                      { label: "Roof", value: lead.roof },
                    ]}
                  />
                  <Panel
                    icon={<Building2 size={13} />}
                    title="Site & Permitting"
                    stats={[
                      { label: "Sunlight", value: lead.sunlight },
                      { label: "Utility", value: lead.utility },
                      { label: "Property", value: lead.propertyType },
                      { label: "Timeline", value: timelineFmt(lead.timeline) },
                      { label: "Permitting", value: lead.complexAhj ? "Complex AHJ" : "Standard" },
                    ]}
                  />
                </div>
              </div>

              {/* Claim sidebar */}
              <div className="lg:col-span-1">
                <div className="lg:sticky lg:top-6 space-y-3 rounded-3xl border border-emerald-500/25 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.16),transparent_45%),#0f1623] p-5">
                  <div className="flex items-center gap-2 text-emerald-300">
                    <ShieldCheck size={16} />
                    <span className="text-xs font-black uppercase tracking-widest">
                      Exclusive lead
                    </span>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-slate-500">
                      Your price
                    </div>
                    <div className="text-4xl font-black text-white">
                      {lead.askingPrice != null ? usd(lead.askingPrice) : "—"}
                    </div>
                    <div className="mt-1 text-[12px] text-slate-400">
                      One-time · exclusive to you
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-[12px] text-slate-300">
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-slate-500">Lead score</span>
                      <span className="font-bold text-emerald-300">{score}/100</span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-slate-500">Est. project value</span>
                      <span className="font-semibold">{usdShort(proj.systemCost)}</span>
                    </div>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-slate-500">25-yr savings</span>
                      <span className="font-semibold text-emerald-300">
                        {usdShort(Math.max(0, proj.total25))}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={claiming}
                    onClick={claim}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-400 px-5 py-3 text-sm font-black text-slate-900 shadow-lg shadow-emerald-950/30 transition-colors hover:bg-emerald-300 disabled:opacity-60"
                  >
                    {claiming ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <ShieldCheck size={16} />
                    )}
                    Claim exclusively
                  </button>

                  <div className="flex items-start gap-1.5 text-[11px] text-slate-500">
                    <Lock size={12} className="mt-0.5 shrink-0" />
                    <span>
                      Homeowner name, phone, email and exact address unlock the
                      instant your payment clears. Once claimed, this lead is
                      removed for every other contractor.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
