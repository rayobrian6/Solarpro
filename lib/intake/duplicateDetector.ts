/**
 * duplicateDetector.ts
 *
 * SolarPro Intake & Acquisition Infrastructure — 6-Tier Duplicate Detection
 *
 * Checks inbound intake against existing network_opportunities using a
 * tiered confidence scoring system:
 *
 *   Tier 1: email + phone     → score 1.00 (definite duplicate)
 *   Tier 2: email + address   → score 0.95 (very likely duplicate)
 *   Tier 3: phone + zip       → score 0.90 (likely duplicate)
 *   Tier 4: phone only        → score 0.78 (probable duplicate)
 *   Tier 5: email only        → score 0.72 (possible duplicate)
 *   Tier 6: address + name    → score 0.70 (possible duplicate)
 *
 * A score >= BLOCK_THRESHOLD blocks the lead as a duplicate.
 * A score >= FLAG_THRESHOLD flags it for review but allows entry.
 */

import { getDbReady } from '@/lib/db-neon'
import type { ValidatedIntakePayload } from './intakeValidator'

async function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  const db = await getDbReady()
  return (db as any)(strings, ...values)
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

export const BLOCK_THRESHOLD = 0.90  // block if score >= this
export const FLAG_THRESHOLD  = 0.70  // flag if score >= this

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export interface DuplicateMatch {
  opportunity_id: string
  score: number
  tier: number
  tier_name: string
  matched_fields: string[]
  existing_status: string
  existing_created_at: string
}

export interface DuplicateCheckResult {
  is_duplicate: boolean
  is_blocked: boolean
  is_flagged: boolean
  score: number
  best_match: DuplicateMatch | null
  all_matches: DuplicateMatch[]
}

// ────────────────────────────────────────────────────────────────────────────
// Normalizers (for comparison only)
// ────────────────────────────────────────────────────────────────────────────

function normalizeNameForMatch(name: string | null | undefined): string {
  if (!name) return ''
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

// ────────────────────────────────────────────────────────────────────────────
// Main dedup function
// ────────────────────────────────────────────────────────────────────────────

export async function checkForDuplicates(
  payload: ValidatedIntakePayload
): Promise<DuplicateCheckResult> {
  const matches: DuplicateMatch[] = []

  try {
    // Tier 1: email + phone (1.00)
    if (payload.email && payload.phone) {
      const rows = await sql`
        SELECT id, status, created_at
        FROM network_opportunities
        WHERE email = ${payload.email}
          AND phone = ${payload.phone}
          AND status NOT IN ('archived', 'spam')
        LIMIT 5
      `
      for (const row of rows) {
        matches.push({
          opportunity_id: row.id as string,
          score: 1.00,
          tier: 1,
          tier_name: 'email_phone',
          matched_fields: ['email', 'phone'],
          existing_status: row.status as string,
          existing_created_at: row.created_at as string,
        })
      }
    }

    // Tier 2: email + address (0.95)
    if (payload.email && payload.address_line1 && payload.zip) {
      const rows = await sql`
        SELECT id, status, created_at
        FROM network_opportunities
        WHERE email = ${payload.email}
          AND LOWER(TRIM(address_line1)) = LOWER(TRIM(${payload.address_line1}))
          AND zip = ${payload.zip}
          AND status NOT IN ('archived', 'spam')
        LIMIT 5
      `
      for (const row of rows) {
        if (!matches.find(m => m.opportunity_id === row.id)) {
          matches.push({
            opportunity_id: row.id as string,
            score: 0.95,
            tier: 2,
            tier_name: 'email_address',
            matched_fields: ['email', 'address_line1', 'zip'],
            existing_status: row.status as string,
            existing_created_at: row.created_at as string,
          })
        }
      }
    }

    // Tier 3: phone + zip (0.90)
    if (payload.phone && payload.zip) {
      const rows = await sql`
        SELECT id, status, created_at
        FROM network_opportunities
        WHERE phone = ${payload.phone}
          AND zip = ${payload.zip}
          AND status NOT IN ('archived', 'spam')
        LIMIT 5
      `
      for (const row of rows) {
        if (!matches.find(m => m.opportunity_id === row.id)) {
          matches.push({
            opportunity_id: row.id as string,
            score: 0.90,
            tier: 3,
            tier_name: 'phone_zip',
            matched_fields: ['phone', 'zip'],
            existing_status: row.status as string,
            existing_created_at: row.created_at as string,
          })
        }
      }
    }

    // Tier 4: phone only (0.78)
    if (payload.phone) {
      const rows = await sql`
        SELECT id, status, created_at
        FROM network_opportunities
        WHERE phone = ${payload.phone}
          AND status NOT IN ('archived', 'spam')
        LIMIT 5
      `
      for (const row of rows) {
        if (!matches.find(m => m.opportunity_id === row.id)) {
          matches.push({
            opportunity_id: row.id as string,
            score: 0.78,
            tier: 4,
            tier_name: 'phone_only',
            matched_fields: ['phone'],
            existing_status: row.status as string,
            existing_created_at: row.created_at as string,
          })
        }
      }
    }

    // Tier 5: email only (0.72)
    if (payload.email) {
      const rows = await sql`
        SELECT id, status, created_at
        FROM network_opportunities
        WHERE email = ${payload.email}
          AND status NOT IN ('archived', 'spam')
        LIMIT 5
      `
      for (const row of rows) {
        if (!matches.find(m => m.opportunity_id === row.id)) {
          matches.push({
            opportunity_id: row.id as string,
            score: 0.72,
            tier: 5,
            tier_name: 'email_only',
            matched_fields: ['email'],
            existing_status: row.status as string,
            existing_created_at: row.created_at as string,
          })
        }
      }
    }

    // Tier 6: address + name (0.70)
    if (payload.address_line1 && payload.zip && (payload.first_name || payload.last_name)) {
      const rows = await sql`
        SELECT id, status, created_at, first_name, last_name
        FROM network_opportunities
        WHERE LOWER(TRIM(address_line1)) = LOWER(TRIM(${payload.address_line1}))
          AND zip = ${payload.zip}
          AND status NOT IN ('archived', 'spam')
        LIMIT 10
      `
      for (const row of rows) {
        if (!matches.find(m => m.opportunity_id === row.id)) {
          const dbFirst = normalizeNameForMatch(row.first_name as string)
          const dbLast = normalizeNameForMatch(row.last_name as string)
          const inFirst = normalizeNameForMatch(payload.first_name)
          const inLast = normalizeNameForMatch(payload.last_name)
          const nameMatch =
            (inFirst && dbFirst && (inFirst === dbFirst || dbFirst.startsWith(inFirst))) ||
            (inLast && dbLast && (inLast === dbLast))
          if (nameMatch) {
            matches.push({
              opportunity_id: row.id as string,
              score: 0.70,
              tier: 6,
              tier_name: 'address_name',
              matched_fields: ['address_line1', 'zip', 'name'],
              existing_status: row.status as string,
              existing_created_at: row.created_at as string,
            })
          }
        }
      }
    }
  } catch (err) {
    // Fail SAFE, not open: a transient DB error during dedup must not silently
    // treat a possible duplicate as brand-new. Don't block (that would lose
    // legitimate leads), but FLAG the lead for manual review.
    console.error('[duplicateDetector] DB error — flagging lead for review:', err)
    return {
      is_duplicate: false,
      is_blocked: false,
      is_flagged: true,
      score: 0,
      best_match: null,
      all_matches: [],
    }
  }

  // Sort by score desc, take best
  matches.sort((a, b) => b.score - a.score)
  const bestMatch = matches[0] || null
  const score = bestMatch?.score ?? 0

  return {
    is_duplicate: score >= FLAG_THRESHOLD,
    is_blocked: score >= BLOCK_THRESHOLD,
    is_flagged: score >= FLAG_THRESHOLD && score < BLOCK_THRESHOLD,
    score,
    best_match: bestMatch,
    all_matches: matches,
  }
}
