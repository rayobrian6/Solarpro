export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDbReady, handleRouteDbError } from "@/lib/db-neon";
import zip2fips from "@/lib/geo/zip2fips.json";
import countyNames from "@/lib/geo/countyNames.json";

const ZIP2FIPS = zip2fips as Record<string, string>;
const COUNTY_NAMES = countyNames as Record<string, string>;

// ---------------------------------------------------------------------------
// GET /api/network/territory/[state]
// Server-side aggregated "territory intelligence" for a state — built to scale
// (aggregation happens here, not in the browser). With ?county=FIPS it also
// returns that county's leads as QUALITY-ONLY DTOs (no address/contact — those
// stay behind payment).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const s = (v: unknown): string => (v == null ? "" : String(v));
const fips5 = (z: string): string => {
  const f = ZIP2FIPS[z];
  return f ? String(f).padStart(5, "0") : "";
};
const countyOf = (row: Row): string => {
  const zip = s(row.zip).trim().slice(0, 5);
  return zip ? fips5(zip) : "";
};

// Generic distribution over a label function, with an optional $ accumulator.
function dist(
  rows: Row[],
  keyOf: (r: Row) => string,
  valueOf?: (r: Row) => number | null,
) {
  const m = new Map<string, { count: number; value: number }>();
  for (const r of rows) {
    const k = keyOf(r) || "Unknown";
    const cur = m.get(k) ?? { count: 0, value: 0 };
    cur.count += 1;
    if (valueOf) cur.value += valueOf(r) ?? 0;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, count: v.count, value: Math.round(v.value) }))
    .sort((a, b) => b.count - a.count);
}

const avg = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const titleize = (v: string) =>
  !v ? "Unknown" : v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");

function valueBand(r: Row): string {
  const v = num(r.project_value);
  if (v == null) return "Unknown";
  if (v < 15_000) return "Under $15k";
  if (v < 25_000) return "$15k–25k";
  if (v < 40_000) return "$25k–40k";
  if (v < 60_000) return "$40k–60k";
  return "$60k+";
}
function sizeBand(r: Row): string {
  const v = num(r.system_kw);
  if (v == null) return "Unknown";
  if (v < 5) return "Under 5 kW";
  if (v < 8) return "5–8 kW";
  if (v < 12) return "8–12 kW";
  if (v < 20) return "12–20 kW";
  return "20 kW+";
}
function gradeLabel(r: Row): string {
  const g = s(r.grade).toUpperCase().trim();
  return g && "ABCDEF".includes(g[0]) ? `Grade ${g[0]}` : "Ungraded";
}
function batteryLabel(r: Row): string {
  const bi = s(r.battery_interest).toLowerCase();
  return r.battery_candidate === true || bi === "yes" || bi === "true"
    ? "Battery interested"
    : "Solar only";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ state: string }> } | { params: { state: string } },
) {
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const raw = await (ctx as { params: Promise<{ state: string }> }).params;
    const state = String(raw.state ?? "").toUpperCase();
    const countyParam = new URL(req.url).searchParams.get("county") ?? "";

    const sql = await getDbReady();

    // Slim pull of live/approved marketplace leads in this state — same
    // visibility rules as the discovery feed. Capped; SQL GROUP BY is the
    // hardening path beyond a few thousand leads per state.
    const rows = (await sql`
      SELECT
        no.id,
        no.location_city          AS city,
        no.location_zip           AS zip,
        no.opportunity_grade      AS grade,
        no.estimated_system_size_kw AS system_kw,
        no.estimated_project_value  AS project_value,
        no.asking_price,
        no.monthly_bill_amount    AS monthly_bill,
        no.estimated_annual_savings AS annual_savings,
        no.estimated_payback_yrs  AS payback_yrs,
        no.utility_provider       AS utility,
        no.utility_rate_per_kwh   AS utility_rate,
        no.homeowner_ownership    AS ownership,
        no.homeowner_timeline     AS timeline,
        no.homeowner_financing_interest AS financing,
        no.roof_material          AS roof,
        no.battery_candidate,
        (COALESCE(no.ahj_complexity_score, 0) >= 70) AS complex_ahj,
        no.ahj_name,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'estimated_income_band',
          no.intake_metadata->'qualification'->>'estimated_income_band',
          no.intake_metadata->'qualification'->>'income_band'
        ) AS income_band,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'estimated_credit_band',
          no.intake_metadata->'qualification'->>'estimated_credit_band'
        ) AS credit_band,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'purchase_intent',
          no.intake_metadata->'qualification'->>'purchase_intent'
        ) AS intent,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'sunlight_confidence',
          no.intake_metadata->'qualification'->>'sunlight_confidence'
        ) AS sunlight,
        COALESCE(
          no.intake_metadata->'qualification'->'normalized'->>'property_type',
          no.intake_metadata->'qualification'->>'property_type',
          no.raw_payload->>'property_type'
        ) AS property_type,
        COALESCE(
          no.raw_payload->>'battery_interest',
          no.intake_metadata->>'battery_interest'
        ) AS battery_interest
      FROM network_opportunities no
      WHERE no.location_state = ${state}
        AND no.status = 'live'
        AND COALESCE(no.marketplace_status, 'live')
            NOT IN ('claimed','paused','archived','withdrawn','rejected')
        AND COALESCE((no.intake_metadata->'operational'->>'archived')::boolean, false) = false
        AND COALESCE((no.intake_metadata->'operational'->>'rejected')::boolean, false) = false
        AND COALESCE((no.intake_metadata->>'is_test')::boolean, false) = false
        AND COALESCE((no.intake_metadata->>'is_simulated')::boolean, false) = false
        AND (
          no.screening_status = 'approved'
          OR EXISTS (
            SELECT 1 FROM opportunity_screening_queue osq
            WHERE osq.opportunity_id = no.id
              AND (osq.auto_decision = 'pass' OR osq.override_decision = 'pass')
          )
        )
      ORDER BY no.released_at DESC NULLS LAST, no.created_at DESC
      LIMIT 5000
    `) as Row[];

    const total = rows.length;

    // ---- Economics --------------------------------------------------------
    const pipelineValue = rows.reduce((a, r) => a + (num(r.project_value) ?? 0), 0);
    const leadRevenue = rows.reduce((a, r) => a + (num(r.asking_price) ?? 0), 0);
    const economics = {
      pipelineValue: Math.round(pipelineValue),
      leadRevenue: Math.round(leadRevenue),
      avgAskingPrice: Math.round(
        avg(rows.map((r) => num(r.asking_price)).filter((v): v is number => v != null)),
      ),
      avgMonthlyBill: Math.round(
        avg(rows.map((r) => num(r.monthly_bill)).filter((v): v is number => v != null)),
      ),
      avgAnnualSavings: Math.round(
        avg(rows.map((r) => num(r.annual_savings)).filter((v): v is number => v != null)),
      ),
      avgPaybackYrs:
        Math.round(
          avg(rows.map((r) => num(r.payback_yrs)).filter((v): v is number => v != null)) *
            10,
        ) / 10,
      avgUtilityRate:
        Math.round(
          avg(
            rows.map((r) => num(r.utility_rate)).filter((v): v is number => v != null),
          ) * 1000,
        ) / 1000,
      avgSystemKw:
        Math.round(
          avg(rows.map((r) => num(r.system_kw)).filter((v): v is number => v != null)) *
            10,
        ) / 10,
    };

    // ---- Distributions (grouped by category on the page) ------------------
    const distributions = {
      // Homeowner quality
      grade: dist(rows, gradeLabel, (r) => num(r.asking_price)),
      incomeBand: dist(rows, (r) => titleize(s(r.income_band))),
      creditBand: dist(rows, (r) => titleize(s(r.credit_band))),
      intent: dist(rows, (r) => titleize(s(r.intent))),
      ownership: dist(rows, (r) => titleize(s(r.ownership))),
      financing: dist(rows, (r) => titleize(s(r.financing))),
      sunlight: dist(rows, (r) => titleize(s(r.sunlight))),
      // Market economics
      projectValue: dist(rows, valueBand, (r) => num(r.project_value)),
      systemSize: dist(rows, sizeBand),
      battery: dist(rows, batteryLabel),
      // Utilities & permitting
      utility: dist(rows, (r) => s(r.utility) || "Unknown"),
      ahj: dist(rows, (r) => (r.complex_ahj ? "Complex AHJ" : "Standard AHJ")),
      propertyType: dist(rows, (r) => titleize(s(r.property_type))),
      roof: dist(rows, (r) => titleize(s(r.roof))),
      timeline: dist(rows, (r) => titleize(s(r.timeline))),
    };

    // ---- County rollups ---------------------------------------------------
    const countyMap = new Map<
      string,
      { count: number; value: number; gradeA: number }
    >();
    let unmapped = 0;
    for (const r of rows) {
      const fips = countyOf(r);
      if (!fips) {
        unmapped++;
        continue;
      }
      const cur = countyMap.get(fips) ?? { count: 0, value: 0, gradeA: 0 };
      cur.count += 1;
      cur.value += num(r.project_value) ?? 0;
      if (s(r.grade).toUpperCase().startsWith("A")) cur.gradeA += 1;
      countyMap.set(fips, cur);
    }
    const counties = [...countyMap.entries()]
      .map(([fips, v]) => ({
        fips,
        name: COUNTY_NAMES[fips] ?? fips,
        count: v.count,
        value: Math.round(v.value),
        gradeA: v.gradeA,
      }))
      .sort((a, b) => b.count - a.count);

    // ---- Gated county leads (quality only, NO address/contact) ------------
    let countyLeads:
      | {
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
        }[]
      | undefined;

    if (countyParam) {
      const want = String(countyParam).padStart(5, "0");
      countyLeads = rows
        .filter((r) => countyOf(r) === want)
        .map((r) => ({
          id: s(r.id),
          city: s(r.city),
          county: COUNTY_NAMES[want] ?? want,
          grade: gradeLabel(r),
          systemKw: num(r.system_kw),
          projectValue: num(r.project_value),
          askingPrice: num(r.asking_price),
          monthlyBill: num(r.monthly_bill),
          annualSavings: num(r.annual_savings),
          paybackYrs: num(r.payback_yrs),
          utility: s(r.utility),
          ownership: titleize(s(r.ownership)),
          financing: titleize(s(r.financing)),
          intent: titleize(s(r.intent)),
          incomeBand: titleize(s(r.income_band)),
          creditBand: titleize(s(r.credit_band)),
          sunlight: titleize(s(r.sunlight)),
          roof: titleize(s(r.roof)),
          timeline: titleize(s(r.timeline)),
          battery: batteryLabel(r) === "Battery interested",
          complexAhj: r.complex_ahj === true,
        }));
    }

    return NextResponse.json({
      success: true,
      state,
      total,
      capped: total >= 5000,
      unmapped,
      economics,
      distributions,
      counties,
      ...(countyLeads ? { county: want_safe(countyParam), countyLeads } : {}),
    });
  } catch (err: unknown) {
    return handleRouteDbError("[GET /api/network/territory/[state]]", err);
  }
}

function want_safe(c: string): { fips: string; name: string } {
  const fips = String(c).padStart(5, "0");
  return { fips, name: COUNTY_NAMES[fips] ?? fips };
}
