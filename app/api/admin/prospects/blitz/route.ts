/**
 * POST /api/admin/prospects/blitz   body: { state: "TX" }
 *
 * The REAL scouting run. Sends Claude (claude-opus-4-8) out with the server-side
 * web_search tool to find actual residential solar installers in the given state,
 * parses the JSON it brings back, and upserts them into installer_prospects. The
 * floor's "Dispatch the scouts" button calls this; new finds land in SCOUTING.
 *
 * Uses the same raw-fetch Anthropic pattern as lib/billClaudeExtractor.ts
 * (ANTHROPIC_API_KEY, no SDK dep). Find-and-enrich only — no outreach.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/adminAuth";
import { upsertProspects, type InstallerProspectInput } from "@/lib/network/installerProspects";

// In-memory rate limit: one blitz per 60s per server instance.
// Prevents accidental credit-burning from rapid repeated requests.
let lastBlitzAt = 0;
const BLITZ_COOLDOWN_MS = 60_000;

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts",
  MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

type Block = { type: string; text?: string };
type ClaudeResp = { stop_reason?: string; content?: Block[]; error?: { message?: string } };

const SYSTEM = (stateName: string) => `You are a B2B prospecting robot for SolarPro, a SaaS + lead marketplace for solar contractors. Find REAL, currently-operating residential solar installation companies headquartered in ${stateName}, USA, so our sales team can pitch them a subscription.

Use the web_search tool. Search multiple metros across the state. For each company capture as many fields as you can VERIFY from a real source. Do NOT invent data — leave a field null if you don't find it. NEVER fabricate email addresses; only include an email explicitly published on the company's own site or a listing.

Return ONLY a JSON array (no prose, no markdown fences) of objects with EXACTLY this shape:
[{"companyName":"string (required)","contactName":null,"email":null,"phone":"string or null","website":"https URL or null","city":"string or null","state":"2-letter code","rating":number or null,"reviewCount":number or null,"sourceUrl":"URL where verified (required)","notes":"short: services, metro, anything notable"}]

Aim for 10-15 real companies, each with a website and ideally a phone. Quality over quantity. Your entire final message must be the JSON array.`;

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ success: false, error: "ANTHROPIC_API_KEY not set" }, { status: 500 });

  let state = "";
  try { state = (((await req.json()) as { state?: string }).state || "").toUpperCase(); } catch { /* */ }
  const stateName = STATE_NAMES[state];
  if (!stateName) return NextResponse.json({ success: false, error: "Provide a valid 2-letter state" }, { status: 400 });

  // Rate limit: prevent blitzing faster than once per minute
  const now = Date.now();
  if (now - lastBlitzAt < BLITZ_COOLDOWN_MS) {
    const wait = Math.ceil((BLITZ_COOLDOWN_MS - (now - lastBlitzAt)) / 1000);
    return NextResponse.json({ success: false, error: `Blitz on cooldown — ${wait}s remaining`, cooldown: wait }, { status: 429 });
  }
  lastBlitzAt = now;

  const system = SYSTEM(stateName);
  let messages: { role: string; content: unknown }[] = [
    { role: "user", content: `Find residential solar installation companies in ${stateName}. Use web search. Return the JSON array only.` },
  ];

  let finalText = "";
  try {
    for (let i = 0; i < 6; i++) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-8",
          max_tokens: 8000,
          system,
          messages,
          tools: [{ type: "web_search_20260209", name: "web_search" }],
        }),
      });
      const j = (await r.json()) as ClaudeResp;
      if (!r.ok) {
        return NextResponse.json({ success: false, error: "Claude error", message: j?.error?.message || JSON.stringify(j) }, { status: 502 });
      }
      if (j.stop_reason === "pause_turn") {
        // Server tool loop hit its limit — resend to resume.
        messages = [messages[0], { role: "assistant", content: j.content }];
        continue;
      }
      finalText = (j.content || []).filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
      break;
    }
  } catch (e) {
    return NextResponse.json({ success: false, error: "Scout run failed", message: (e as Error).message }, { status: 500 });
  }

  // Extract the JSON array from the model's text.
  const start = finalText.indexOf("[");
  const end = finalText.lastIndexOf("]");
  if (start === -1 || end === -1) {
    return NextResponse.json({ success: false, error: "Scouts returned no parseable list", preview: finalText.slice(0, 300) }, { status: 502 });
  }
  let rows: Record<string, unknown>[];
  try {
    rows = JSON.parse(finalText.slice(start, end + 1));
  } catch (e) {
    return NextResponse.json({ success: false, error: "Could not parse scout results", message: (e as Error).message }, { status: 502 });
  }

  const mapped: InstallerProspectInput[] = rows
    .filter((r) => typeof r.companyName === "string" && (r.companyName as string).trim())
    .map((r) => ({
      companyName: r.companyName as string,
      contactName: (r.contactName as string) ?? null,
      email: (r.email as string) ?? null,
      phone: (r.phone as string) ?? null,
      website: (r.website as string) ?? null,
      city: (r.city as string) ?? null,
      state: ((r.state as string) || state).toUpperCase().slice(0, 2),
      rating: typeof r.rating === "number" ? (r.rating as number) : null,
      reviewCount: typeof r.reviewCount === "number" ? (r.reviewCount as number) : null,
      source: "agent_research",
      sourceUrl: (r.sourceUrl as string) ?? null,
      notes: (r.notes as string) ?? null,
    }));

  if (mapped.length === 0) {
    return NextResponse.json({ success: false, error: "Scouts found nobody this run — try again" }, { status: 200 });
  }

  const result = await upsertProspects(mapped);
  return NextResponse.json({ success: true, state, stateName, found: mapped.length, ...result });
}
