export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDbReady, handleRouteDbError } from "@/lib/db-neon";
import { gradeDefaultPrice } from "@/lib/network/leadPurchase";
import zip2fips from "@/lib/geo/zip2fips.json";
import countyNames from "@/lib/geo/countyNames.json";

const ZIP2FIPS = zip2fips as Record<string, string>;
const COUNTY_NAMES = countyNames as Record<string, string>;

// ---------------------------------------------------------------------------
// GET /api/network/territory/[state]
// Server-side aggregated "territory intelligence" for a state. Headline KPIs
// and per-county rollups are computed in SQL (scales to 100k+); category
// distributions are derived from a capped sample (representative percentages).
// With ?county=FIPS it returns that county's leads as QUALITY-ONLY DTOs
// (no address/contact — those stay behind payment).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const s = (v: unknown): string => (v == null ? "" : String(v));
const titleize = (v: string) =>
  !v ? "Unknown" : v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");

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

const round1 = (n: number | null) => (n == null ? 0 : Math.round(n * 10) / 10);

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

    // --- Self-heal county_fips: map distinct unmapped ZIPs in this state to a
    // county and persist. Bounded by distinct ZIPs; ~zero work after first view.
    const nullZips = (await sql`
      SELECT DISTINCT location_zip AS zip
      FROM network_opportunities
      WHERE location_state = ${state}
        AND county_fips IS NULL
        AND location_zip IS NOT NULL
      LIMIT 2000
    `) as Row[];
    for (const r of nullZips) {
      const zip = s(r.zip).trim().slice(0, 5);
      const fips = ZIP2FIPS[zip];
      if (fips) {
        await sql`
          UPDATE network_opportunities
          SET county_fips = ${String(fips).padStart(5, "0")}
          WHERE location_state = ${state}
            AND location_zip = ${r.zip}
            AND county_fips IS NULL
        `;
      }
    }

    // --- Headline KPIs (SQL aggregate — accurate at any scale) -------------
    const aggRows = (await sql`
      SELECT
        COUNT(*)::int                              AS total,
        COALESCE(SUM(no.estimated_project_value), 0) AS pipeline_value,
        COALESCE(SUM(no.asking_price), 0)            AS lead_revenue,
        AVG(no.asking_price)                         AS avg_asking,
        AVG(no.monthly_bill_amount)                  AS avg_bill,
        AVG(no.estimated_annual_savings)             AS avg_savings,
        AVG(no.estimated_payback_yrs)                AS avg_payback,
        AVG(no.utility_rate_per_kwh)                 AS avg_rate,
        AVG(no.estimated_system_size_kw)             AS avg_kw
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
    `) as Row[];
    const agg = aggRows[0] ?? {};
    const total = num(agg.total) ?? 0;

    const economics = {
      pipelineValue: Math.round(num(agg.pipeline_value) ?? 0),
      leadRevenue: Math.round(num(agg.lead_revenue) ?? 0),
      avgAskingPrice: Math.round(num(agg.avg_asking) ?? 0),
      avgMonthlyBill: Math.round(num(agg.avg_bill) ?? 0),
      avgAnnualSavings: Math.round(num(agg.avg_savings) ?? 0),
      avgPaybackYrs: round1(num(agg.avg_payback)),
      avgUtilityRate: Math.round((num(agg.avg_rate) ?? 0) * 1000) / 1000,
      avgSystemKw: round1(num(agg.avg_kw)),
    };

    // --- County rollups (SQL GROUP BY county_fips — accurate at any scale) --
    const countyRows = (await sql`
      SELECT
        no.county_fips AS fips,
        COUNT(*)::int  AS count,
        COALESCE(SUM(no.estimated_project_value), 0) AS value,
        COUNT(*) FILTER (WHERE UPPER(LEFT(no.opportunity_grade, 1)) = 'A')::int AS grade_a
      FROM network_opportunities no
      WHERE no.location_state = ${state}
        AND no.county_fips IS NOT NULL
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
      GROUP BY no.county_fips
      ORDER BY count DESC
      LIMIT 500
    `) as Row[];
    const counties = countyRows.map((c) => {
      const fips = s(c.fips).padStart(5, "0");
      return {
        fips,
        name: COUNTY_NAMES[fips] ?? fips,
        count: num(c.count) ?? 0,
        value: Math.round(num(c.value) ?? 0),
        gradeA: num(c.grade_a) ?? 0,
      };
    });

    // --- Category distributions (capped sample → representative percentages) -
    // Neon's tagged template parameterizes every ${...}, so the column list
    // can't be a shared fragment — it's inlined as static SQL in each query.
    const sample = (await sql`
      SELECT
        no.id,
        no.location_city          AS city,
        no.county_fips,
        no.opportunity_grade      AS grade,
        no.estimated_system_size_kw AS system_kw,
        no.estimated_project_value  AS project_value,
        no.asking_price,
        no.monthly_bill_amount    AS monthly_bill,
        no.estimated_annual_savings AS annual_savings,
        no.estimated_payback_yrs  AS payback_yrs,
        no.utility_provider       AS utility,
        no.homeowner_ownership    AS ownership,
        no.homeowner_timeline     AS timeline,
        no.homeowner_financing_interest AS financing,
        no.roof_material          AS roof,
        no.battery_candidate,
        (COALESCE(no.ahj_complexity_score, 0) >= 70) AS complex_ahj,
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

    const distributions = {
      grade: dist(sample, gradeLabel, (r) => num(r.asking_price)),
      incomeBand: dist(sample, (r) => titleize(s(r.income_band))),
      creditBand: dist(sample, (r) => titleize(s(r.credit_band))),
      intent: dist(sample, (r) => titleize(s(r.intent))),
      ownership: dist(sample, (r) => titleize(s(r.ownership))),
      financing: dist(sample, (r) => titleize(s(r.financing))),
      sunlight: dist(sample, (r) => titleize(s(r.sunlight))),
      projectValue: dist(sample, valueBand, (r) => num(r.project_value)),
      systemSize: dist(sample, sizeBand),
      battery: dist(sample, batteryLabel),
      utility: dist(sample, (r) => s(r.utility) || "Unknown"),
      ahj: dist(sample, (r) => (r.complex_ahj ? "Complex AHJ" : "Standard AHJ")),
      propertyType: dist(sample, (r) => titleize(s(r.property_type))),
      roof: dist(sample, (r) => titleize(s(r.roof))),
      timeline: dist(sample, (r) => titleize(s(r.timeline))),
    };

    // --- Gated county leads (quality only, NO address/contact) -------------
    let countyLeads: ReturnType<typeof toLeadDto>[] | undefined;
    let countyMeta: { fips: string; name: string } | undefined;
    if (countyParam) {
      const want = String(countyParam).padStart(5, "0");
      countyMeta = { fips: want, name: COUNTY_NAMES[want] ?? want };
      const leadRows = (await sql`
        SELECT
          no.id,
          no.location_city          AS city,
          no.county_fips,
          no.opportunity_grade      AS grade,
          no.estimated_system_size_kw AS system_kw,
          no.estimated_project_value  AS project_value,
          no.asking_price,
          no.monthly_bill_amount    AS monthly_bill,
          no.estimated_annual_savings AS annual_savings,
          no.estimated_payback_yrs  AS payback_yrs,
          no.utility_provider       AS utility,
          no.homeowner_ownership    AS ownership,
          no.homeowner_timeline     AS timeline,
          no.homeowner_financing_interest AS financing,
          no.roof_material          AS roof,
          no.battery_candidate,
          (COALESCE(no.ahj_complexity_score, 0) >= 70) AS complex_ahj,
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
          AND no.county_fips = ${want}
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
        LIMIT 500
      `) as Row[];
      countyLeads = leadRows.map((r) => toLeadDto(r, countyMeta!.name));
    }

    return NextResponse.json({
      success: true,
      state,
      total,
      capped: total > 5000,
      economics,
      distributions,
      counties,
      ...(countyLeads ? { county: countyMeta, countyLeads } : {}),
    });
  } catch (err: unknown) {
    return handleRouteDbError("[GET /api/network/territory/[state]]", err);
  }
}

function toLeadDto(r: Row, countyName: string) {
  const g = s(r.grade).toUpperCase().trim();
  const bi = s(r.battery_interest).toLowerCase();
  return {
    id: s(r.id),
    city: s(r.city),
    county: countyName,
    grade: g && "ABCDEF".includes(g[0]) ? `Grade ${g[0]}` : "Ungraded",
    systemKw: num(r.system_kw),
    projectValue: num(r.project_value),
    askingPrice: num(r.asking_price) ?? gradeDefaultPrice(r.grade),
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
    battery: r.battery_candidate === true || bi === "yes" || bi === "true",
    complexAhj: r.complex_ahj === true,
  };
}
