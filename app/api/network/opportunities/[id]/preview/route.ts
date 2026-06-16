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
// GET /api/network/opportunities/[id]/preview
// Gated single-lead detail for the lead product page — full QUALITY + economics
// signals, but NO contact and NO exact address (those unlock on claim/payment).
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const s = (v: unknown): string => (v == null ? "" : String(v));
const titleize = (v: string) =>
  !v ? "" : v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> } | { params: { id: string } },
) {
  const user = getUserFromRequest(req);
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const raw = await (ctx as { params: Promise<{ id: string }> }).params;
    const id = s(raw.id);
    const sql = await getDbReady();

    const rows = (await sql`
      SELECT
        no.id,
        no.location_city          AS city,
        no.location_state         AS state_code,
        no.location_zip           AS zip,
        no.county_fips,
        no.opportunity_grade      AS grade,
        no.estimated_system_size_kw AS system_kw,
        no.estimated_project_value  AS project_value,
        no.asking_price,
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
          no.monthly_bill_amount::text,
          no.raw_payload->'bill_marketplace_projection'->>'current_monthly_bill',
          no.intake_metadata->'bill_marketplace_projection'->>'current_monthly_bill',
          no.raw_payload->'bill_intelligence'->>'monthly_bill',
          no.intake_metadata->'bill_intelligence'->>'monthly_bill',
          no.raw_payload->>'monthly_bill',
          no.raw_payload->>'monthly_electric_bill'
        ) AS monthly_bill_raw,
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
      WHERE no.id = ${id}
        AND no.status = 'live'
        AND COALESCE(no.marketplace_status, 'live')
            NOT IN ('claimed','paused','archived','withdrawn','rejected')
        AND COALESCE((no.intake_metadata->'operational'->>'archived')::boolean, false) = false
        AND COALESCE((no.intake_metadata->'operational'->>'rejected')::boolean, false) = false
        AND COALESCE((no.intake_metadata->>'is_test')::boolean, false) = false
        AND COALESCE((no.intake_metadata->>'is_simulated')::boolean, false) = false
      LIMIT 1
    `) as Row[];

    const r = rows[0];
    if (!r)
      return NextResponse.json(
        { error: "Lead not available" },
        { status: 404 },
      );

    // Self-heal county_fips from ZIP if missing.
    let fips = s(r.county_fips).padStart(5, "0");
    if (!r.county_fips) {
      const zip = s(r.zip).trim().slice(0, 5);
      const mapped = ZIP2FIPS[zip];
      if (mapped) {
        fips = String(mapped).padStart(5, "0");
        await sql`
          UPDATE network_opportunities SET county_fips = ${fips}
          WHERE id = ${id} AND county_fips IS NULL
        `;
      } else {
        fips = "";
      }
    }

    const g = s(r.grade).toUpperCase().trim();
    const bi = s(r.battery_interest).toLowerCase();
    const lead = {
      id: s(r.id),
      city: s(r.city),
      stateCode: s(r.state_code),
      countyFips: fips,
      county: fips ? (COUNTY_NAMES[fips] ?? "") : "",
      grade: g && "ABCDEF".includes(g[0]) ? `Grade ${g[0]}` : "Ungraded",
      systemKw: num(r.system_kw),
      projectValue: num(r.project_value),
      askingPrice: num(r.asking_price) ?? gradeDefaultPrice(r.grade),
      monthlyBill: num(r.monthly_bill_raw),
      annualSavings: num(r.annual_savings),
      paybackYrs: num(r.payback_yrs),
      utility: s(r.utility),
      utilityRate: num(r.utility_rate),
      ownership: titleize(s(r.ownership)),
      financing: titleize(s(r.financing)),
      intent: titleize(s(r.intent)),
      incomeBand: titleize(s(r.income_band)),
      creditBand: titleize(s(r.credit_band)),
      sunlight: titleize(s(r.sunlight)),
      roof: titleize(s(r.roof)),
      propertyType: titleize(s(r.property_type)),
      timeline: titleize(s(r.timeline)),
      ahjName: s(r.ahj_name),
      battery: r.battery_candidate === true || bi === "yes" || bi === "true",
      complexAhj: r.complex_ahj === true,
    };

    return NextResponse.json({ success: true, lead });
  } catch (err: unknown) {
    return handleRouteDbError("[GET /api/network/opportunities/[id]/preview]", err);
  }
}
