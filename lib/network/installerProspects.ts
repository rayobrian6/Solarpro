/**
 * lib/network/installerProspects.ts
 *
 * Supply-side prospect pool helpers. The acquisition robots discover solar
 * installers and write them here via `upsertProspects`; the admin floor
 * (/admin/prospects) reads them via `listProspects` / `getProspectStats` and
 * advances them through the pipeline via `updateProspect`.
 *
 * See migration 092_installer_prospects.sql.
 */
import { getDbReady } from "@/lib/db-neon";

export type ProspectStage =
  | "discovered"
  | "enriched"
  | "qualified"
  | "contacted"
  | "signed_up"
  | "rejected";

export const PROSPECT_STAGES: ProspectStage[] = [
  "discovered",
  "enriched",
  "qualified",
  "contacted",
  "signed_up",
  "rejected",
];

export interface InstallerProspectInput {
  companyName: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  serviceStates?: string[] | null;
  licenseNumber?: string | null;
  licenseStatus?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  employeeEstimate?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface InstallerProspect {
  id: string;
  company_name: string;
  dedupe_key: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  service_states: string[];
  license_number: string | null;
  license_status: string | null;
  rating: number | null;
  review_count: number | null;
  employee_estimate: string | null;
  source: string;
  source_url: string | null;
  stage: ProspectStage;
  quality_score: number | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  discovered_at: string;
  contacted_at: string | null;
  converted_user_id: string | null;
  updated_at: string;
}

/** Normalized upsert key so the robots never duplicate a company. */
export function dedupeKeyFor(companyName: string, state?: string | null): string {
  const name = companyName
    .trim()
    .toLowerCase()
    .replace(/\b(llc|inc|co|corp|company|solar|energy|electric|the)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${name}|${(state || "").trim().toUpperCase()}`;
}

/** 0-100 quality score from how complete + credible the record is. */
export function scoreProspect(p: InstallerProspectInput): number {
  let s = 0;
  if (p.email) s += 30;
  if (p.phone) s += 20;
  if (p.website) s += 12;
  if (p.licenseNumber) s += 13;
  if ((p.rating ?? 0) >= 4) s += 10;
  if ((p.reviewCount ?? 0) >= 10) s += 8;
  if (p.contactName) s += 7;
  return Math.min(100, s);
}

/** Initial pipeline stage from what we already know about the prospect. */
function initialStage(p: InstallerProspectInput): ProspectStage {
  if (p.email || p.phone) return "enriched";
  return "discovered";
}

export interface UpsertResult {
  inserted: number;
  updated: number;
  total: number;
}

/**
 * Batch upsert prospects. Conflict on dedupe_key fills in any fields that were
 * previously null (COALESCE) and bumps quality_score / stage upward — so a
 * later, richer pass can enrich an earlier thin discovery without clobbering it.
 */
export async function upsertProspects(
  inputs: InstallerProspectInput[],
): Promise<UpsertResult> {
  const sql = await getDbReady();
  let inserted = 0;
  let updated = 0;

  for (const p of inputs) {
    if (!p.companyName?.trim()) continue;
    const key = dedupeKeyFor(p.companyName, p.state);
    const score = scoreProspect(p);
    const stage = initialStage(p);
    const serviceStates = p.serviceStates ?? [];
    const metadata = p.metadata ?? {};

    const rows = await sql`
      INSERT INTO installer_prospects (
        company_name, dedupe_key, contact_name, email, phone, website,
        address, city, state, zip, service_states,
        license_number, license_status, rating, review_count, employee_estimate,
        source, source_url, stage, quality_score, notes, metadata
      ) VALUES (
        ${p.companyName.trim()}, ${key}, ${p.contactName ?? null}, ${p.email ?? null},
        ${p.phone ?? null}, ${p.website ?? null}, ${p.address ?? null}, ${p.city ?? null},
        ${p.state ?? null}, ${p.zip ?? null}, ${serviceStates},
        ${p.licenseNumber ?? null}, ${p.licenseStatus ?? null}, ${p.rating ?? null},
        ${p.reviewCount ?? null}, ${p.employeeEstimate ?? null},
        ${p.source ?? "agent_research"}, ${p.sourceUrl ?? null}, ${stage}, ${score},
        ${p.notes ?? null}, ${JSON.stringify(metadata)}
      )
      ON CONFLICT (dedupe_key) DO UPDATE SET
        contact_name      = COALESCE(installer_prospects.contact_name, EXCLUDED.contact_name),
        email             = COALESCE(installer_prospects.email, EXCLUDED.email),
        phone             = COALESCE(installer_prospects.phone, EXCLUDED.phone),
        website           = COALESCE(installer_prospects.website, EXCLUDED.website),
        address           = COALESCE(installer_prospects.address, EXCLUDED.address),
        city              = COALESCE(installer_prospects.city, EXCLUDED.city),
        zip               = COALESCE(installer_prospects.zip, EXCLUDED.zip),
        license_number    = COALESCE(installer_prospects.license_number, EXCLUDED.license_number),
        license_status    = COALESCE(installer_prospects.license_status, EXCLUDED.license_status),
        rating            = COALESCE(EXCLUDED.rating, installer_prospects.rating),
        review_count      = COALESCE(EXCLUDED.review_count, installer_prospects.review_count),
        employee_estimate = COALESCE(installer_prospects.employee_estimate, EXCLUDED.employee_estimate),
        source_url        = COALESCE(installer_prospects.source_url, EXCLUDED.source_url),
        quality_score     = GREATEST(COALESCE(installer_prospects.quality_score, 0), EXCLUDED.quality_score),
        updated_at        = NOW()
      RETURNING (xmax = 0) AS inserted
    `;
    if (rows[0]?.inserted) inserted++;
    else updated++;
  }

  return { inserted, updated, total: inputs.length };
}

export interface ListProspectsFilter {
  state?: string;
  stage?: ProspectStage;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function listProspects(
  filter: ListProspectsFilter = {},
): Promise<InstallerProspect[]> {
  const sql = await getDbReady();
  const limit = Math.min(filter.limit ?? 200, 1000);
  const offset = filter.offset ?? 0;
  const state = filter.state?.toUpperCase() || null;
  const stage = filter.stage || null;
  const search = filter.search ? `%${filter.search.toLowerCase()}%` : null;

  const rows = await sql`
    SELECT *
    FROM installer_prospects
    WHERE (${state}::text IS NULL OR state = ${state})
      AND (${stage}::text IS NULL OR stage = ${stage})
      AND (${search}::text IS NULL
           OR lower(company_name) LIKE ${search}
           OR lower(coalesce(email, '')) LIKE ${search}
           OR lower(coalesce(city, '')) LIKE ${search})
    ORDER BY quality_score DESC NULLS LAST, discovered_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return rows as InstallerProspect[];
}

export interface ProspectStats {
  total: number;
  withEmail: number;
  withPhone: number;
  statesCovered: number;
  byStage: Record<string, number>;
  topStates: { state: string; count: number }[];
}

export async function getProspectStats(): Promise<ProspectStats> {
  const sql = await getDbReady();

  const totals = await sql`
    SELECT
      COUNT(*)::int                                              AS total,
      COUNT(*) FILTER (WHERE email IS NOT NULL)::int             AS with_email,
      COUNT(*) FILTER (WHERE phone IS NOT NULL)::int             AS with_phone,
      COUNT(DISTINCT state) FILTER (WHERE state IS NOT NULL)::int AS states_covered
    FROM installer_prospects
  `;
  const stageRows = await sql`
    SELECT stage, COUNT(*)::int AS count FROM installer_prospects GROUP BY stage
  `;
  const stateRows = await sql`
    SELECT state, COUNT(*)::int AS count
    FROM installer_prospects
    WHERE state IS NOT NULL
    GROUP BY state
    ORDER BY count DESC
    LIMIT 10
  `;

  const byStage: Record<string, number> = {};
  for (const r of stageRows as { stage: string; count: number }[]) {
    byStage[r.stage] = r.count;
  }

  const t = totals[0] as {
    total: number;
    with_email: number;
    with_phone: number;
    states_covered: number;
  };
  return {
    total: t.total,
    withEmail: t.with_email,
    withPhone: t.with_phone,
    statesCovered: t.states_covered,
    byStage,
    topStates: (stateRows as { state: string; count: number }[]).map((r) => ({
      state: r.state,
      count: r.count,
    })),
  };
}

/** Score an existing DB row (maps row → input shape, reuses scoreProspect). */
export function scoreRow(p: InstallerProspect): number {
  return scoreProspect({
    companyName: p.company_name,
    contactName: p.contact_name,
    email: p.email,
    phone: p.phone,
    website: p.website,
    licenseNumber: p.license_number,
    rating: p.rating,
    reviewCount: p.review_count,
  });
}

export type LeadTier = 'hot' | 'warm' | 'cold';
/** Sales-priority tier derived from quality_score. */
export function prospectTier(score: number | null): LeadTier {
  const s = score ?? 0;
  return s >= 70 ? 'hot' : s >= 40 ? 'warm' : 'cold';
}

export interface Dossier { whyCall: string; opener: string; facts: string[] }
/** Merge a generated dossier into the prospect's metadata jsonb. */
export async function setDossier(id: string, currentMeta: Record<string, unknown> | null, dossier: Dossier): Promise<void> {
  const sql = await getDbReady();
  const merged = { ...(currentMeta ?? {}), dossier };
  await sql`UPDATE installer_prospects SET metadata = ${JSON.stringify(merged)}, updated_at = NOW() WHERE id = ${id}`;
}

export interface WorkUpdate {
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  licenseNumber?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  stage?: ProspectStage;
  qualityScore?: number;
  notes?: string | null;
}

/**
 * Apply a pipeline-work update: COALESCE-fills contact/vetting fields (never
 * clobbers existing data with null) and sets stage / quality_score outright.
 */
export async function applyWorkUpdate(id: string, p: WorkUpdate): Promise<void> {
  const sql = await getDbReady();
  await sql`
    UPDATE installer_prospects SET
      email          = COALESCE(${p.email ?? null}, email),
      phone          = COALESCE(${p.phone ?? null}, phone),
      website        = COALESCE(${p.website ?? null}, website),
      license_number = COALESCE(${p.licenseNumber ?? null}, license_number),
      rating         = COALESCE(${p.rating ?? null}, rating),
      review_count   = COALESCE(${p.reviewCount ?? null}, review_count),
      stage          = COALESCE(${p.stage ?? null}, stage),
      quality_score  = COALESCE(${p.qualityScore ?? null}, quality_score),
      notes          = COALESCE(${p.notes ?? null}, notes),
      updated_at     = NOW()
    WHERE id = ${id}
  `;
}

export interface CallEntry { at: string; by?: string; action: string; note?: string | null }

/**
 * Record a sales call disposition: append to metadata.calls, move the lead to the
 * stage the outcome implies, and stamp contacted_at on first contact.
 */
export async function recordDisposition(id: string, entry: CallEntry, newStage: ProspectStage): Promise<boolean> {
  const sql = await getDbReady();
  const rows = await sql`SELECT metadata FROM installer_prospects WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return false;
  const meta = ((rows[0] as { metadata: Record<string, unknown> }).metadata) || {};
  const calls = Array.isArray((meta as { calls?: unknown }).calls) ? (meta as { calls: unknown[] }).calls : [];
  const merged = { ...meta, calls: [...calls, entry] };
  await sql`
    UPDATE installer_prospects
    SET stage = ${newStage}, metadata = ${JSON.stringify(merged)},
        contacted_at = COALESCE(contacted_at, NOW()), updated_at = NOW()
    WHERE id = ${id}
  `;
  return true;
}

export interface UpdateProspectPatch {
  stage?: ProspectStage;
  notes?: string;
  email?: string;
  phone?: string;
  contactName?: string;
}

export async function updateProspect(
  id: string,
  patch: UpdateProspectPatch,
): Promise<InstallerProspect | null> {
  const sql = await getDbReady();
  const markContacted = patch.stage === "contacted";

  const rows = await sql`
    UPDATE installer_prospects SET
      stage        = COALESCE(${patch.stage ?? null}, stage),
      notes        = COALESCE(${patch.notes ?? null}, notes),
      email        = COALESCE(${patch.email ?? null}, email),
      phone        = COALESCE(${patch.phone ?? null}, phone),
      contact_name = COALESCE(${patch.contactName ?? null}, contact_name),
      contacted_at = CASE WHEN ${markContacted} AND contacted_at IS NULL THEN NOW() ELSE contacted_at END,
      updated_at   = NOW()
    WHERE id = ${id}
    RETURNING *
  `;
  return (rows[0] as InstallerProspect) ?? null;
}
