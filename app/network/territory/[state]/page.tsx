"use client";

import AppShell from "@/components/ui/AppShell";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Zap,
  DollarSign,
  Battery,
  Award,
  Loader2,
  MapPin,
  TrendingUp,
  Users,
  Building2,
  ChevronRight,
  Lock,
  ShieldCheck,
  Sparkles,
  Flame,
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

type Bar = { label: string; count: number; value: number };
type County = {
  fips: string;
  name: string;
  count: number;
  value: number;
  gradeA: number;
};
type CountyLead = {
  id: string;
  city: string;
  county: string;
  grade: string;
  systemKw: number | null;
  projectValue: number | null;
  askingPrice: number | null;
  monthlyBill: number | null;
  annualSavings: number | null;
  paybackYrs: number | null;
  utility: string;
  ownership: string;
  financing: string;
  intent: string;
  incomeBand: string;
  creditBand: string;
  sunlight: string;
  roof: string;
  timeline: string;
  battery: boolean;
  complexAhj: boolean;
};
type Territory = {
  state: string;
  total: number;
  economics: Record<string, number>;
  distributions: Record<string, Bar[]>;
  counties: County[];
  county?: { fips: string; name: string };
  countyLeads?: CountyLead[];
};

const usdShort = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1000
      ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
      : `$${Math.round(n)}`;
const usdFull = (n: number) => `$${Math.round(n).toLocaleString()}`;

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
  showValue,
}: {
  title: string;
  subtitle?: string;
  rows: Bar[];
  total: number;
  showValue?: boolean;
}) {
  if (!rows || rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-4">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-300">
        {title}
      </p>
      {subtitle && <p className="mt-0.5 text-[11px] text-slate-600">{subtitle}</p>}
      <div className="mt-3 space-y-2">
        {rows.slice(0, 8).map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-[11px] text-slate-400">
              {r.label}
            </span>
            <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-800/70">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </div>
            <span className="w-8 shrink-0 text-right text-[11px] font-semibold tabular-nums text-slate-200">
              {r.count}
            </span>
            <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-slate-500">
              {Math.round((r.count / total) * 100)}%
            </span>
            {showValue && r.value > 0 && (
              <span className="hidden w-12 shrink-0 text-right text-[10px] tabular-nums text-emerald-400/80 sm:inline">
                {usdShort(r.value)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Category({
  icon,
  title,
  blurb,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-emerald-400">{icon}</span>
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
          {title}
        </h2>
        <span className="text-[11px] text-slate-600">— {blurb}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

// ── Value formatting — turn raw band strings into human copy ────────────────
const isEmpty = (v?: string | null) =>
  !v || v === "—" || /^unknown$/i.test(v);

function rangeFmt(v: string, money = false): string {
  if (isEmpty(v)) return "";
  const toks = v.replace(/[_–-]/g, " ").split(/\s+/).filter(Boolean);
  if (toks.length >= 2) {
    const a = money ? `$${toks[0]}` : toks[0];
    const b = money ? `$${toks[1]}` : toks[1];
    return `${a}–${b}`;
  }
  return money ? `$${v}` : v;
}
function yesish(v: string): string {
  if (isEmpty(v)) return "";
  if (/^(true|yes|interested|ready)$/i.test(v)) return "Interested";
  if (/^(false|no)$/i.test(v)) return "Not yet";
  return v;
}
function timelineFmt(v: string): string {
  if (isEmpty(v)) return "";
  if (/asap|immediate|now/i.test(v)) return "ASAP";
  return v;
}

function leadScore(l: CountyLead): number {
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

function scoreColor(score: number): string {
  return score >= 85
    ? "#34d399"
    : score >= 70
      ? "#fbbf24"
      : score >= 55
        ? "#fb923c"
        : "#f87171";
}

const TONE: Record<string, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
  blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
};

const GRADE_TONE: Record<string, string> = {
  "Grade A": "bg-emerald-400 text-slate-900",
  "Grade B": "bg-amber-400 text-slate-900",
  "Grade C": "bg-orange-400 text-slate-900",
  "Grade D": "bg-slate-500 text-white",
};

// Compact marketplace listing — teases quality and links to the full lead
// product page. Quick-claim is available here too (jumps straight to checkout).
function LeadCard({
  lead,
  onClaim,
  claiming,
}: {
  lead: CountyLead;
  onClaim: (id: string) => void;
  claiming: boolean;
}) {
  const score = leadScore(lead);
  const gradeTone = GRADE_TONE[lead.grade] ?? "bg-slate-500 text-white";
  const col = scoreColor(score);

  const chips: { label: string; tone: keyof typeof TONE }[] = [];
  if (lead.battery) chips.push({ label: "Battery", tone: "violet" });
  if (/interest|ready|yes|true/i.test(lead.financing))
    chips.push({ label: "Finance-ready", tone: "emerald" });
  if (/asap|immediate|now/i.test(lead.timeline))
    chips.push({ label: "Ready now", tone: "amber" });
  if (/full|high|good/i.test(lead.sunlight))
    chips.push({ label: "Strong sun", tone: "amber" });

  const income = rangeFmt(lead.incomeBand, true);
  const credit = rangeFmt(lead.creditBand);
  const teaser =
    [
      /own/i.test(lead.ownership) ? "Homeowner" : lead.ownership,
      income ? `${income} income` : "",
      credit ? `${credit} credit` : "",
      lead.intent && !isEmpty(lead.intent) ? `${lead.intent} intent` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "Qualified solar homeowner";

  return (
    <Link
      href={`/network/lead/${lead.id}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-700/60 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_42%),#0f1623] p-4 transition-all hover:-translate-y-0.5 hover:border-emerald-400/40 hover:shadow-lg hover:shadow-emerald-950/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-lg px-2 py-0.5 text-[11px] font-black uppercase ${gradeTone}`}
          >
            {lead.grade}
          </span>
          {score >= 85 && (
            <span className="flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 text-[9px] font-black uppercase text-orange-300">
              <Flame size={9} /> Hot
            </span>
          )}
        </div>
        <div className="text-right">
          <div className="text-xl font-black leading-none text-white">
            {lead.askingPrice != null ? usdFull(lead.askingPrice) : "—"}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">
            exclusive
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border"
          style={{ borderColor: `${col}55` }}
        >
          <span className="text-base font-black leading-none" style={{ color: col }}>
            {score}
          </span>
          <span className="text-[7px] font-bold uppercase tracking-wider text-slate-500">
            score
          </span>
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm font-bold text-white">
            <MapPin size={13} className="text-emerald-400" />
            {lead.county} County
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-400">{teaser}</div>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c.label}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${TONE[c.tone]}`}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <span className="inline-flex items-center gap-1 text-[12px] font-bold text-emerald-300 transition-all group-hover:gap-2">
          View details <ChevronRight size={14} />
        </span>
        <button
          type="button"
          disabled={claiming}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClaim(lead.id);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-400 px-3 py-1.5 text-[12px] font-black text-slate-900 transition-colors hover:bg-emerald-300 disabled:opacity-60"
        >
          {claiming ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <ShieldCheck size={13} />
          )}
          Claim
        </button>
      </div>

      <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-600">
        <Lock size={10} /> Contact unlocks on claim
      </div>
    </Link>
  );
}

function TerritoryView() {
  const params = useParams();
  const search = useSearchParams();
  const router = useRouter();
  const state = String(params.state ?? "").toUpperCase();
  const countyParam = search.get("county") ?? "";
  const stateName = STATE_NAMES[state] ?? state;

  const [data, setData] = useState<Territory | null>(null);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string>("");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = countyParam ? `?county=${countyParam}` : "";
    fetch(`/api/network/territory/${state}${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setData(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [state, countyParam]);

  const claim = useCallback(async (id: string) => {
    setClaimingId(id);
    try {
      const res = await fetch(`/api/network/opportunities/${id}/checkout`, {
        method: "POST",
      });
      const d = await res.json();
      if (res.ok && d.url) {
        window.location.href = d.url as string;
        return;
      }
      alert(d.error || "Could not start checkout.");
    } finally {
      setClaimingId("");
    }
  }, []);

  const econ = data?.economics ?? {};
  const dists = data?.distributions ?? {};
  const total = data?.total ?? 0;

  const topCountyValue = useMemo(
    () => Math.max(1, ...(data?.counties ?? []).map((c) => c.value)),
    [data],
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg-base, #0b1120)" }}>
      <div className="mx-auto max-w-6xl px-6 py-6">
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
              {data?.county ? `${data.county.name} County` : stateName}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {data?.county
                ? `Available opportunities in ${data.county.name} County, ${stateName} — full quality, claim to unlock contact.`
                : `Market intelligence for ${stateName} — every signal that moves a sale.`}
            </p>
          </div>
          {data?.county ? (
            <Link
              href={`/network/territory/${state}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800/60 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500"
            >
              <ArrowLeft size={14} /> {stateName} overview
            </Link>
          ) : (
            <Link
              href={`/network?state=${state}`}
              className="rounded-xl bg-emerald-400 px-4 py-2 text-sm font-bold text-slate-900 transition-colors hover:bg-emerald-300"
            >
              Browse &amp; claim {state} leads →
            </Link>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={30} className="animate-spin text-emerald-500" />
          </div>
        ) : !data || total === 0 ? (
          <div className="mt-10 rounded-2xl border border-slate-800 bg-slate-950/30 p-10 text-center">
            <p className="text-slate-300">
              No available opportunities in {stateName} right now.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              New leads land here as homeowners qualify.
            </p>
          </div>
        ) : data.county && data.countyLeads ? (
          /* ---------------- COUNTY VIEW (gated leads) ---------------- */
          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi
                icon={<MapPin size={16} />}
                label="Leads in county"
                value={String(data.countyLeads.length)}
                accent="text-emerald-400"
              />
              <Kpi
                icon={<Sparkles size={16} />}
                label="Avg lead score"
                value={
                  data.countyLeads.length
                    ? String(
                        Math.round(
                          data.countyLeads.reduce((s, l) => s + leadScore(l), 0) /
                            data.countyLeads.length,
                        ),
                      )
                    : "—"
                }
                accent="text-emerald-400"
              />
              <Kpi
                icon={<Award size={16} />}
                label="Grade A / B"
                value={String(
                  data.countyLeads.filter((l) => /A|B/.test(l.grade)).length,
                )}
                accent="text-amber-400"
              />
              <Kpi
                icon={<Battery size={16} />}
                label="Battery interest"
                value={String(data.countyLeads.filter((l) => l.battery).length)}
                accent="text-violet-400"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.countyLeads.map((l) => (
                <LeadCard
                  key={l.id}
                  lead={l}
                  onClaim={claim}
                  claiming={claimingId === l.id}
                />
              ))}
            </div>
          </div>
        ) : (
          /* ---------------- STATE INTELLIGENCE ---------------- */
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
              <Kpi
                icon={<MapPin size={16} />}
                label="Available leads"
                value={String(total)}
                accent="text-emerald-400"
              />
              <Kpi
                icon={<TrendingUp size={16} />}
                label="Pipeline value"
                value={usdShort(econ.pipelineValue ?? 0)}
                sub="installed $"
                accent="text-amber-400"
              />
              <Kpi
                icon={<DollarSign size={16} />}
                label="Lead revenue"
                value={usdShort(econ.leadRevenue ?? 0)}
                sub="if all claimed"
                accent="text-emerald-400"
              />
              <Kpi
                icon={<DollarSign size={16} />}
                label="Avg bill"
                value={econ.avgMonthlyBill ? `$${econ.avgMonthlyBill}/mo` : "—"}
                accent="text-rose-400"
              />
              <Kpi
                icon={<TrendingUp size={16} />}
                label="Avg savings"
                value={econ.avgAnnualSavings ? usdShort(econ.avgAnnualSavings) : "—"}
                sub="per year"
                accent="text-emerald-400"
              />
              <Kpi
                icon={<Zap size={16} />}
                label="Avg payback"
                value={econ.avgPaybackYrs ? `${econ.avgPaybackYrs} yr` : "—"}
                accent="text-blue-400"
              />
              <Kpi
                icon={<Zap size={16} />}
                label="Avg system"
                value={econ.avgSystemKw ? `${econ.avgSystemKw} kW` : "—"}
                accent="text-blue-400"
              />
            </div>

            <Category
              icon={<TrendingUp size={16} />}
              title="Market Economics"
              blurb="the money picture of the territory"
            >
              <Breakdown
                title="Jobs by project value"
                subtitle="Estimated installed system cost"
                rows={dists.projectValue ?? []}
                total={total}
                showValue
              />
              <Breakdown
                title="Jobs by system size"
                rows={dists.systemSize ?? []}
                total={total}
              />
            </Category>

            <Category
              icon={<Users size={16} />}
              title="Homeowner Quality"
              blurb="how closeable the leads are"
            >
              <Breakdown
                title="Quality grade"
                rows={dists.grade ?? []}
                total={total}
                showValue
              />
              <Breakdown title="Purchase intent" rows={dists.intent ?? []} total={total} />
              <Breakdown title="Income band" rows={dists.incomeBand ?? []} total={total} />
              <Breakdown title="Credit band" rows={dists.creditBand ?? []} total={total} />
              <Breakdown
                title="Ownership"
                subtitle="Own vs PPA / lease"
                rows={dists.ownership ?? []}
                total={total}
              />
              <Breakdown
                title="Financing readiness"
                rows={dists.financing ?? []}
                total={total}
              />
            </Category>

            <Category
              icon={<Building2 size={16} />}
              title="Utilities & Permitting"
              blurb="operational difficulty"
            >
              <Breakdown title="Utility provider" rows={dists.utility ?? []} total={total} />
              <Breakdown
                title="Permitting (AHJ)"
                subtitle="Complex jurisdictions cost time"
                rows={dists.ahj ?? []}
                total={total}
              />
              <Breakdown title="Roof type" rows={dists.roof ?? []} total={total} />
              <Breakdown title="Timeline" rows={dists.timeline ?? []} total={total} />
              <Breakdown
                title="Battery attach"
                subtitle="Storage interest = upsell"
                rows={dists.battery ?? []}
                total={total}
              />
              <Breakdown
                title="Sunlight confidence"
                rows={dists.sunlight ?? []}
                total={total}
              />
            </Category>

            {/* County rollups — click to drill into gated leads */}
            <section className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-emerald-400">
                  <MapPin size={16} />
                </span>
                <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white">
                  County Rollups
                </h2>
                <span className="text-[11px] text-slate-600">
                  — click a county to reveal its leads
                </span>
              </div>
              {data.counties.length === 0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/25 p-6 text-sm text-slate-500">
                  Leads here aren&apos;t mapped to a county yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {data.counties.map((c) => (
                    <button
                      key={c.fips}
                      type="button"
                      onClick={() =>
                        router.push(
                          `/network/territory/${state}?county=${c.fips}`,
                        )
                      }
                      className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/30 p-4 text-left transition-colors hover:border-emerald-500/40"
                    >
                      <div>
                        <div className="text-sm font-semibold text-white">
                          {c.name} County
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {usdShort(c.value)} pipeline
                          {c.gradeA > 0 && ` · ${c.gradeA} grade A`}
                        </div>
                        <div className="mt-2 h-1.5 w-32 overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-full rounded-full bg-emerald-400"
                            style={{ width: `${(c.value / topCountyValue) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <div className="text-xl font-bold tabular-nums text-emerald-400">
                            {c.count}
                          </div>
                          <div className="text-[10px] uppercase text-slate-600">
                            leads
                          </div>
                        </div>
                        <ChevronRight
                          size={16}
                          className="text-slate-600 transition-colors group-hover:text-emerald-400"
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default function TerritoryPage() {
  return (
    <AppShell>
      <Suspense
        fallback={
          <div
            className="flex min-h-screen items-center justify-center"
            style={{ background: "var(--bg-base, #0b1120)" }}
          >
            <Loader2 size={30} className="animate-spin text-emerald-500" />
          </div>
        }
      >
        <TerritoryView />
      </Suspense>
    </AppShell>
  );
}
