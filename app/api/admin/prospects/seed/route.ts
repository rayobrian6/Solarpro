/**
 * POST /api/admin/prospects/seed
 *
 * "Dispatch the scouts" — bootstraps the installer_prospects table and loads the
 * batch-1 seed WITHOUT the System Tools migration runner (whose ';' splitter
 * choked on the seed). Reads the real migration files (092 schema, 093 seed) and
 * executes them directly via the neon driver: 092 statement-by-statement,
 * 093 as a single INSERT. Idempotent — safe to click repeatedly.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import fs from "fs";
import path from "path";
import { requireAdminApi } from "@/lib/adminAuth";

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => {
      const i = line.indexOf("--");
      return i === -1 ? line : line.substring(0, i);
    })
    .join("\n");
}

export async function POST(req: NextRequest) {
  const admin = await requireAdminApi(req);
  if (!admin) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return NextResponse.json({ success: false, error: "DATABASE_URL not set" }, { status: 500 });
  }

  const sql = neon(dbUrl);
  const dir = path.join(process.cwd(), "lib", "migrations");
  const errors: string[] = [];

  try {
    // 1) Ensure schema (092) — multi-statement, split on ';' (no string-literal ';')
    const schemaSql = stripSqlComments(
      fs.readFileSync(path.join(dir, "092_installer_prospects.sql"), "utf-8"),
    );
    for (const stmt of schemaSql.split(";").map((s) => s.trim()).filter(Boolean)) {
      try {
        await sql(stmt, []);
      } catch (e) {
        const msg = (e as Error).message || "";
        if (!msg.includes("already exists")) errors.push(msg);
      }
    }

    // 2) Load the seed (093) — one INSERT statement, run whole
    const seedRaw = stripSqlComments(
      fs.readFileSync(path.join(dir, "093_seed_installer_prospects_batch1.sql"), "utf-8"),
    ).trim().replace(/;\s*$/, "");
    if (seedRaw) {
      await sql(seedRaw, []);
    }

    // 3) Report the new total
    const rows = await sql("SELECT COUNT(*)::int AS total FROM installer_prospects", []);
    const total = (rows[0] as { total: number })?.total ?? 0;

    return NextResponse.json({
      success: errors.length === 0,
      total,
      ...(errors.length ? { errors } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: "Seed failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
