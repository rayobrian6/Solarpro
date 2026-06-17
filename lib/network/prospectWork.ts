/**
 * lib/network/prospectWork.ts
 *
 * The shared pipeline-work engine. One source of truth used by both the manual
 * room buttons and the automatic pipeline tick: enrich raw leads, vet enriched
 * leads, and draft dossiers for qualified leads. All lead-PREP only — never
 * contacts a prospect, never creates an account.
 */
import {
  listProspects, applyWorkUpdate, scoreProspect, scoreRow, setDossier,
  type InstallerProspect, type Dossier,
} from "@/lib/network/installerProspects";

type Block = { type: string; text?: string };

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
function headers(apiKey: string) {
  return { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
}

// ── Enrich one raw lead via web search ──────────────────────────────────────
async function enrichOne(p: InstallerProspect, apiKey: string): Promise<boolean> {
  const where = [p.city, p.state].filter(Boolean).join(", ");
  const system = `You are a contact-research robot. Find the official website, a public business email, and phone number for the solar company below. Use the web_search tool. Do NOT invent an email — only return one explicitly published on the company's own site or a reputable listing. Return ONLY JSON: {"website":string|null,"email":string|null,"phone":string|null}. Nothing else.`;
  let messages: { role: string; content: unknown }[] = [
    { role: "user", content: `Company: ${p.company_name}${where ? ` (${where})` : ""}. Find its website, public email, and phone.` },
  ];
  let text = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch(ANTHROPIC, {
      method: "POST", headers: headers(apiKey),
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 1200, system, messages, tools: [{ type: "web_search_20260209", name: "web_search" }] }),
    });
    const j = (await r.json()) as { stop_reason?: string; content?: Block[] };
    if (!r.ok) return false;
    if (j.stop_reason === "pause_turn") { messages = [messages[0], { role: "assistant", content: j.content }]; continue; }
    text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
    break;
  }
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s === -1 || e === -1) return false;
  let found: { website?: string | null; email?: string | null; phone?: string | null };
  try { found = JSON.parse(text.slice(s, e + 1)); } catch { return false; }
  const merged = {
    companyName: p.company_name, contactName: p.contact_name,
    email: found.email ?? p.email, phone: found.phone ?? p.phone, website: found.website ?? p.website,
    licenseNumber: p.license_number, rating: p.rating, reviewCount: p.review_count,
  };
  await applyWorkUpdate(p.id, {
    email: found.email ?? null, phone: found.phone ?? null, website: found.website ?? null,
    stage: "enriched", qualityScore: scoreProspect(merged), notes: "Auto-enriched from web research",
  });
  return true;
}

export async function enrichBatch(apiKey: string, limit = 5): Promise<{ processed: number; enriched: number }> {
  const batch = (await listProspects({ stage: "discovered", limit: 50 })).filter((p) => !p.email || !p.website).slice(0, limit);
  if (batch.length === 0) return { processed: 0, enriched: 0 };
  const res = await Promise.all(batch.map((p) => enrichOne(p, apiKey).catch(() => false)));
  return { processed: batch.length, enriched: res.filter(Boolean).length };
}

// ── Vet all enriched leads (deterministic) ──────────────────────────────────
export async function qualifyAll(): Promise<{ processed: number; qualified: number; rejected: number }> {
  const batch = await listProspects({ stage: "enriched", limit: 500 });
  let qualified = 0, rejected = 0;
  for (const p of batch) {
    const score = scoreRow(p);
    const findable = !!(p.phone || p.email || p.website);
    if (!findable) { await applyWorkUpdate(p.id, { stage: "rejected", qualityScore: score, notes: "Auto-vet: no contact details found" }); rejected++; }
    else { await applyWorkUpdate(p.id, { stage: "qualified", qualityScore: score }); qualified++; }
  }
  return { processed: batch.length, qualified, rejected };
}

// ── Draft a dossier for one qualified lead (no web search) ──────────────────
async function draftDossier(p: InstallerProspect, apiKey: string): Promise<Dossier | null> {
  const facts = [
    `Company: ${p.company_name}`,
    p.city || p.state ? `Location: ${[p.city, p.state].filter(Boolean).join(", ")}` : "",
    p.rating != null ? `Rating: ${p.rating}${p.review_count != null ? ` (${p.review_count} reviews)` : ""}` : "",
    p.website ? `Website: ${p.website}` : "",
    p.license_number ? `License: ${p.license_number}` : "",
    p.notes ? `Notes: ${p.notes}` : "",
  ].filter(Boolean).join("\n");
  const system = `You are a sales-prep clerk for SolarPro, a lead marketplace + SaaS for solar contractors. A salesperson is about to cold-call this solar installer to pitch them on buying exclusive homeowner leads. Using ONLY the facts provided (do not invent specifics like owner names or numbers you weren't given), return JSON: {"whyCall": one sentence on why they're a strong prospect, "opener": a warm 1-2 sentence phone opener the rep can say, "facts": [3 short bullet talking points]}. Return ONLY the JSON object.`;
  const r = await fetch(ANTHROPIC, {
    method: "POST", headers: headers(apiKey),
    // Haiku — dossiers are templated talking points from data we already hold,
    // so the cheap model is plenty (~5x cheaper than Opus). Quality stays in scouting.
    body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 700, system, messages: [{ role: "user", content: facts }] }),
  });
  const j = (await r.json()) as { content?: Block[] };
  if (!r.ok) return null;
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    const d = JSON.parse(text.slice(s, e + 1));
    return { whyCall: String(d.whyCall ?? ""), opener: String(d.opener ?? ""), facts: Array.isArray(d.facts) ? d.facts.map(String).slice(0, 4) : [] };
  } catch { return null; }
}

export async function dossierBatch(apiKey: string, limit = 5): Promise<{ processed: number; written: number }> {
  const batch = (await listProspects({ stage: "qualified", limit: 100 }))
    .filter((p) => !(p.metadata && (p.metadata as Record<string, unknown>).dossier)).slice(0, limit);
  if (batch.length === 0) return { processed: 0, written: 0 };
  const res = await Promise.all(batch.map(async (p) => {
    const d = await draftDossier(p, apiKey).catch(() => null);
    if (d) { await setDossier(p.id, p.metadata as Record<string, unknown>, d); return true; }
    return false;
  }));
  return { processed: batch.length, written: res.filter(Boolean).length };
}
