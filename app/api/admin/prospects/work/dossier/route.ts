/**
 * POST /api/admin/prospects/work/dossier
 *
 * The Reading Room's work. For qualified leads that don't yet have a dossier,
 * Claude drafts sales talking points from the facts we already hold (no web
 * search, no contact) — a "why call them", a phone opener, and 3 bullet facts —
 * and stores it in metadata.dossier so the sales rep walks in armed.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { listProspects, setDossier, type Dossier, type InstallerProspect } from "@/lib/network/installerProspects";

type Block = { type: string; text?: string };

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

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 700, system, messages: [{ role: "user", content: facts }] }),
  });
  const j = (await r.json()) as { content?: Block[] };
  if (!r.ok) return null;
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s === -1 || e === -1) return null;
  try {
    const d = JSON.parse(text.slice(s, e + 1));
    return { whyCall: String(d.whyCall ?? ""), opener: String(d.opener ?? ""), facts: Array.isArray(d.facts) ? d.facts.map(String).slice(0, 4) : [] };
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

  try {
    const batch = (await listProspects({ stage: "qualified", limit: 100 }))
      .filter((p) => !(p.metadata && (p.metadata as Record<string, unknown>).dossier))
      .slice(0, 6);
    if (batch.length === 0) return NextResponse.json({ success: true, processed: 0, written: 0, note: "Every qualified lead already has a dossier" });

    const results = await Promise.all(batch.map(async (p) => {
      const d = await draftDossier(p, apiKey).catch(() => null);
      if (d) { await setDossier(p.id, p.metadata as Record<string, unknown>, d); return true; }
      return false;
    }));
    return NextResponse.json({ success: true, processed: batch.length, written: results.filter(Boolean).length });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Dossier job failed", message: (e as Error).message }, { status: 500 });
  }
}
