export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

// Vercel: geocoding + utility match + sizing — up to 30s
export const maxDuration = 30;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { geocodeAddress } from '@/lib/locationEngine';
import { logEnvStatus } from '@/lib/env-check';

// Log env status once per cold start for deployment observability
logEnvStatus('system-size');
import { detectUtility } from '@/lib/utilityDetector';
import { validateAndCorrectUtilityRate, checkNetMeteringLimit, getProductionFactor } from '@/lib/utility-rules';
import { matchUtility } from '@/lib/utilityMatcher';
import { handleRouteDbError } from '@/lib/db-neon';
// v48.1: Canonical utility rate fallback (in-memory, no DB call)
import { normalizeUtility } from '@/lib/utilityNormalizer';
import { STATE_UTILITY_FALLBACK } from '@/lib/utilityDetector';
import { checkRateLimit, getClientIp } from '@/lib/rateLimiter';

/**
 * POST /api/system-size
 *
 * Receives parsed bill data from the frontend (produced by /api/bill-upload)
 * and performs all the slow async work:
 *   - Geocode service address
 *   - Match utility in DB
 *   - Validate/correct electricity rate
 *   - Calculate recommended system size
 *   - Net-metering guardrail check
 *
 * Returns:
 *   system_kw, estimated_panels, estimated_cost,
 *   locationData, matchedUtility, rateValidation, systemSizing
 *
 * Frontend calls this AFTER /api/bill-upload returns successfully.
 * This keeps /api/bill-upload under ~5s and avoids Vercel timeout.
 */

interface SystemSizeRequest {
  // From parsed bill
  annual_kwh?: number;
  monthly_kwh?: number;
  monthly_usage?: number[];   // monthly kWh history array
  address?: string;           // service address from bill
  utility?: string;           // utility provider name from bill
  rate?: number;              // electricity rate from bill ($/kWh)
  // Sizing params
  offset_target?: number;     // 0-100, default 100
  state_code?: string;        // 2-letter state code if known
}

export async function POST(req: NextRequest) {
  const startMs = Date.now();

  try {
        const rl = await checkRateLimit('system-size', getClientIp(req));
    if (!rl.allowed) {
      return NextResponse.json({ success: false, error: 'Too many requests. Please wait before trying again.' }, { status: 429 });
    }

    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: SystemSizeRequest;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const {
      annual_kwh,
      monthly_kwh,
      monthly_usage = [],
      address,
      utility,
      rate,
      offset_target = 100,
      state_code,
    } = body;

    console.log(`[SYSTEM_SIZE_STARTED] annualKwh=${annual_kwh ?? 'null'} monthlyKwh=${monthly_kwh ?? 'null'} hasAddress=${!!address} hasUtility=${!!utility} stateCode=${state_code ?? 'null'}`);
    // Full input validation log for pipeline audit
    console.log(`[UPLOAD_RECEIVED] route=system-size annualKwh=${annual_kwh ?? 'null'} monthlyKwh=${monthly_kwh ?? 'null'} monthlyUsageItems=${monthly_usage?.length ?? 0} hasAddress=${!!address} hasUtility=${!!utility} hasRate=${!!rate} offsetTarget=${offset_target}`);
    if (!annual_kwh && !monthly_kwh && (!monthly_usage || monthly_usage.length === 0)) {
      console.warn('[SYSTEM_SIZE_STARTED] WARNING: no kWh data received — sizing will be skipped');
    }
    // v47.163: Log full received kWh payload for debugging
    console.log(`[SYSTEM_SIZE_KWH_PAYLOAD] annual_kwh=${annual_kwh ?? 'null'} monthly_kwh=${monthly_kwh ?? 'null'} monthly_usage_len=${monthly_usage?.length ?? 0} monthly_usage_sum=${monthly_usage?.reduce((s, v) => s + v, 0) ?? 0}`);
    if (!address) {
      console.warn('[SYSTEM_SIZE_STARTED] WARNING: no address received — geocoding will be skipped');
    }

    // ── Geocoding ──────────────────────────────────────────────────────────────
    let locationData = null;
    let utilityData = null;
    let matchedUtility = null;

    if (address) {
      console.log('[system-size] Geocoding address: [redacted]');
      try {
        const geoResult = await geocodeAddress(address);
        if (geoResult.success && geoResult.location) {
          locationData = geoResult.location;
          console.log(`[system-size] Geocoded: ${locationData.city}, ${locationData.stateCode}`);

          // Utility match: parsed name → DB → state fallback
          const parsedUtilityName = utility || null;
          const effectiveStateCode = locationData.stateCode || state_code || null;

          console.log(`[system-size] Matching utility: [redacted] state=${effectiveStateCode}`);
          try {
            matchedUtility = await matchUtility(parsedUtilityName, effectiveStateCode);
            if (matchedUtility) {
              const dbRate = matchedUtility.effectiveRate ?? matchedUtility.defaultResidentialRate;
              console.log(`[system-size] Utility matched via ${matchedUtility.source} effectiveRate=${dbRate}`);
            } else {
              console.warn('[system-size] No utility match found');
            }
          } catch (matchErr: unknown) {
            console.warn('[system-size] Utility matching failed:', matchErr instanceof Error ? (matchErr as Error).message : matchErr);
          }

          // Geo-based utility detection (fallback)
          try {
            const utilityResult = await detectUtility(
              geoResult.location.lat,
              geoResult.location.lng,
              geoResult.location.stateCode,
              geoResult.location.city,
            );
            if (utilityResult.success) {
              utilityData = utilityResult.utility;
            }
          } catch (geoErr: unknown) {
            console.warn('[system-size] detectUtility failed:', geoErr instanceof Error ? (geoErr as Error).message : geoErr);
          }
        } else {
          console.warn('[system-size] Geocoding failed:', geoResult.error);
        }
      } catch (geoErr: unknown) {
        console.warn('[system-size] Geocoding threw:', geoErr instanceof Error ? (geoErr as Error).message : geoErr);
      }
    } else {
      console.warn('[system-size] No service address provided — skipping geocoding');
    }

    // ── Resolve utility name + rate ────────────────────────────────────────────
    let resolvedUtilityName = utility || matchedUtility?.utilityName || utilityData?.utilityName || null;
    let resolvedRate = rate ?? null;

    // Fill rate from matched utility if not provided
    if (!resolvedRate && matchedUtility) {
      const dbRate = matchedUtility.effectiveRate ?? matchedUtility.defaultResidentialRate;
      if (dbRate) {
        resolvedRate = dbRate;
        console.log(`[system-size] Using DB rate: $${dbRate}/kWh from matched utility`);
      }
    }
    if (!resolvedRate && utilityData?.avgRatePerKwh) {
      resolvedRate = utilityData.avgRatePerKwh;
      console.log(`[system-size] Using geo-detected rate: $${resolvedRate}/kWh`);
    }

    // v48.1: Canonical in-memory rate fallback (from utilityNormalizer registry)
    // Runs only when all DB/geo sources failed — zero latency, no external call
    if (!resolvedRate && utility) {
      const effectiveSC = locationData?.stateCode || state_code || null;
      const canonical = normalizeUtility(utility, effectiveSC);
      if (canonical?.avgRate) {
        resolvedRate = canonical.avgRate;
        console.log(`[system-size] Using canonical rate: $${canonical.avgRate}/kWh for ${canonical.id}`);
      } else if (effectiveSC && STATE_UTILITY_FALLBACK[effectiveSC.toUpperCase()]) {
        const stateFallback = STATE_UTILITY_FALLBACK[effectiveSC.toUpperCase()];
        resolvedRate = stateFallback.avgRate;
        console.log(`[system-size] Using state fallback rate: $${stateFallback.avgRate}/kWh for ${effectiveSC}`);
      }
    }

    // Log rate priority decision for audit trail
    // Priority: bill-extracted (from OCR/parse) > DB retail (matched utility) > state/geo average > canonical/state-fallback > national default
    const ratePrioritySource =
      (rate != null && rate > 0)               ? 'bill_extracted'    :
      (matchedUtility?.effectiveRate)          ? 'db_retail'         :
      (matchedUtility?.defaultResidentialRate) ? 'db_legacy'         :
      (utilityData?.avgRatePerKwh)             ? 'state_geo_avg'     :
      (resolvedRate != null)                   ? 'canonical_fallback' :
                                                 'national_default';
    console.log(
      `[RATE_PRIORITY_DECISION] priority_source=${ratePrioritySource}` +
      ` bill_rate=${rate ?? 'null'}` +
      ` db_effective_rate=${matchedUtility?.effectiveRate ?? 'null'}` +
      ` db_legacy_rate=${matchedUtility?.defaultResidentialRate ?? 'null'}` +
      ` geo_rate=${utilityData?.avgRatePerKwh ?? 'null'}` +
      ` resolved_rate=${resolvedRate ?? 'null'}`
    );


    // ── Rate Validation ────────────────────────────────────────────────────────
    const rateValidation = validateAndCorrectUtilityRate(resolvedRate, resolvedUtilityName);
    const finalRate = rateValidation.rate;
    console.log(`[UTILITY_RATE_SELECTED] source=${rateValidation.source} rate=$${finalRate.toFixed(3)}/kWh corrected=${rateValidation.corrected} suspect=${rateValidation.suspect}`);

    // ── System Sizing ──────────────────────────────────────────────────────────
    const effectiveStateCode = locationData?.stateCode || state_code || null;
    const productionFactor = getProductionFactor(resolvedUtilityName, effectiveStateCode);

    // Determine annual kWh for sizing
    let annualKwhForSizing = 0;
    if (annual_kwh && annual_kwh > 0) {
      annualKwhForSizing = annual_kwh;
    } else if (monthly_kwh && monthly_kwh > 0) {
      annualKwhForSizing = monthly_kwh * 12;
      console.log(`[system-size] Extrapolating annual from monthly: ${monthly_kwh} * 12 = ${annualKwhForSizing}`);
    } else if (monthly_usage && monthly_usage.length > 0) {
      const usageSum = monthly_usage.reduce((s, v) => s + v, 0);
      if (monthly_usage.length >= 10) {
        annualKwhForSizing = usageSum;
      } else {
        annualKwhForSizing = Math.round((usageSum / monthly_usage.length) * 12);
      }
      console.log(`[system-size] Extrapolating annual from ${monthly_usage.length} months: ${annualKwhForSizing}`);
    }

    let systemSizeKw: number | null = null;
    let estimatedPanels: number | null = null;
    let estimatedCost: number | null = null;

    if (annualKwhForSizing > 0) {
      const offsetFraction = (offset_target || 100) / 100;
      systemSizeKw = Math.round((annualKwhForSizing * offsetFraction / productionFactor) * 10) / 10;
      // Typical 400W panel = 0.4 kW
      estimatedPanels = Math.ceil(systemSizeKw / 0.4);
      // Typical installed cost ~$3/W = $3000/kW
      estimatedCost = Math.round(systemSizeKw * 3000);

      console.log(`[SIZING_COMPLETE] annualKwh=${annualKwhForSizing} offset=${offset_target}% productionFactor=${productionFactor} systemKw=${systemSizeKw} panels=${estimatedPanels} cost=$${estimatedCost}`);

      // Net-metering guardrail
      const netMeteringWarning = checkNetMeteringLimit(systemSizeKw, resolvedUtilityName);
      if (netMeteringWarning) {
        console.warn(`[system-size] Net metering warning: ${netMeteringWarning}`);
      }
    } else {
      console.warn(`[SIZING_SKIPPED] annualKwhForSizing=${annualKwhForSizing} annual_kwh=${annual_kwh ?? 'null'} monthly_kwh=${monthly_kwh ?? 'null'} monthly_usage_len=${monthly_usage?.length ?? 0} — cannot size system`);
    }

    const elapsedMs = Date.now() - startMs;
    console.log(`[SYSTEM_SIZE_RETURNING] systemKw=${systemSizeKw} elapsedMs=${elapsedMs}`);

    return NextResponse.json({
      success: true,
      system_kw: systemSizeKw,
      estimated_panels: estimatedPanels,
      estimated_cost: estimatedCost,
      annual_kwh_used: annualKwhForSizing,
      production_factor: productionFactor,
      locationData,
      utilityData,
      matchedUtility: matchedUtility ? {
        id: matchedUtility.id,
        utilityName: matchedUtility.utilityName,
        state: matchedUtility.state,
        defaultResidentialRate: matchedUtility.defaultResidentialRate,
        retailRate: matchedUtility.retailRate,
        effectiveRate: matchedUtility.effectiveRate,
        netMetering: matchedUtility.netMetering,
        source: matchedUtility.source,
      } : null,
      rateValidation: {
        corrected: rateValidation.corrected,
        suspect: rateValidation.suspect,
        originalRate: rateValidation.originalRate,
        correctedRate: finalRate,
        source: rateValidation.source,
        message: rateValidation.corrected
          ? `Rate ${rateValidation.suspect ? 'suspect (supply-only)' : 'out of range'}: $${rateValidation.originalRate?.toFixed(3) ?? 'null'}/kWh → $${finalRate.toFixed(3)}/kWh (${rateValidation.source})`
          : null,
      },
      systemSizing: systemSizeKw ? {
        recommendedKw: systemSizeKw,
        annualKwh: annualKwhForSizing,
        offsetPercent: offset_target,
        estimatedPanels,
        estimatedCost,
        note: `Based on ${offset_target}% offset. Production factor: ${productionFactor} kWh/kW/yr.`,
      } : null,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? (err as Error).message : 'Unknown error';
    console.error('[SYSTEM_SIZE_ERROR] Fatal:', msg);

    // DB errors get proper retry-friendly response
    if (msg.includes('database') || msg.includes('DB') || msg.includes('connect')) {
      return handleRouteDbError('system-size', err);
    }

    return NextResponse.json({
      success: false,
      error: 'System sizing failed. Please try again.',
    }, { status: 500 });
  }
}