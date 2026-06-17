/**
 * POST /api/admin/prospects/work/enrich   body: { limit?: number }
 *
 * The Copying Room's real work. Takes raw `discovered` prospects that are missing
 * contact details, sends Claude (claude-opus-4-8) out with web_search to find each
 * company's website / public email / phone, fills the gaps, and advances them to
 * `enriched`. Never fabricates emails. Raw-fetch Anthropic pattern.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import {
  listProspects, applyWorkUpdate, scoreProspect,
  type InstallerProspect,
} from "@/lib/network/installerProspects";

type Block = { type: string; text?: string };
type ClaudeResp = { stop_reason?: string; content?: Block[]; error?: { message?: string } };

async function enrichOne(p: InstallerProspect, apiKey: string): Promise<boolean> {
  const where = [p.city, p.state].filter(Boolean).join(", ");
  const system = `You are a contact-research robot. Find the official website, a public business email, and phone number for the solar company below. Use the web_search tool. Do NOT invent an email — only return one explicitly published on the company's own site or a reputable listing. Return ONLY JSON: {"website":string|null,"email":string|null,"phone":string|null}. Nothing else.`;
  let messages: { role: string; content: unknown }[] = [
    { role: "user", content: `Company: ${p.company_name}${where ? ` (${where})` : ""}. Find its website, public email, and phone.` },
  ];

  let text = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 1200,
        system,
        messages,
        tools: [{ type: "web_search_20260209", name: "web_search" }],
      }),
    });
    const j = (await r.json()) as ClaudeResp;
    if (!r.ok) return false;
    if (j.stop_reason === "pause_turn") { messages = [messages[0], { role: "assistant", content: j.content }]; continue; }
    text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
    break;
  }

  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s === -1 || e === -1) return false;
  let found: { website?: string | null; email?: string | null; phone?: string | null };
  try { found = JSON.parse(text.slice(s, e + 1)); } catch { return false; }

  const merged = {
    companyName: p.company_name,
    contactName: p.contact_name,
    email: found.email ?? p.email,
    phone: found.phone ?? p.phone,
    website: found.website ?? p.website,
    licenseNumber: p.license_number,
    rating: p.rating,
    reviewCount: p.review_count,
  };
  await applyWorkUpdate(p.id, {
    email: found.email ?? null,
    phone: found.phone ?? null,
    website: found.website ?? null,
    stage: "enriched",
    qualityScore: scoreProspect(merged),
    notes: "Auto-enriched from web research",
  });
  return true;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

  let limit = 5;
  try { limit = Math.min(Math.max(((await req.json()) as { limit?: number }).limit ?? 5, 1), 8); } catch { /* */ }

  try {
    // Raw leads first: those still in `discovered` (missing solid contact).
    const batch = (await listProspects({ stage: "discovered", limit: 50 }))
      .filter((p) => !p.email || !p.website)
      .slice(0, limit);

    if (batch.length === 0) {
      return NextResponse.json({ success: true, processed: 0, enriched: 0, note: "No raw leads need enriching" });
    }

    const results = await Promise.all(batch.map((p) => enrichOne(p, apiKey).catch(() => false)));
    const enriched = results.filter(Boolean).length;
    return NextResponse.json({ success: true, processed: batch.length, enriched });
  } catch (e) {
    return NextResponse.json({ success: false, error: "Enrichment failed", message: (e as Error).message }, { status: 500 });
  }
}
