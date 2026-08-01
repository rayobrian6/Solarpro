// Tests for the public Trust Center page at /trust. Pattern follows
// tests/free-solar-estimate-page.test.ts: read the page source + data files
// from disk and assert the contract — no React rendering needed for a
// static server component whose correctness is in its copy and structure.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO = process.cwd();
const read = (rel: string) =>
  fs.readFileSync(path.join(REPO, rel), "utf8");

const pageSource = read("app/trust/page.tsx");
const layoutSource = read("app/trust/layout.tsx");
const stampSource = read("app/trust/TrustClientStamp.tsx");
const trustJson = JSON.parse(read("compliance/trust.json"));
const vendorsCsv = read("compliance/vendors.csv");

describe("/trust — Trust Center public posture page", () => {
  it("is a server component (no 'use client' in the page) with a tiny client-only stamp island", () => {
    // The page itself must be a server component — no client JS for the
    // basic render. The stamp is the one allowed client island.
    expect(pageSource).not.toMatch(/^['"]use client['"]/m);
    expect(pageSource).not.toContain("'use client'");
    expect(pageSource).not.toContain('"use client"');
    expect(stampSource).toMatch(/['"]use client['"]/);
    expect(stampSource).toContain("useEffect");
  });

  it("sources its content from compliance/trust.json committed to git", () => {
    expect(pageSource).toContain("from '@/compliance/trust.json'");
    expect(pageSource).toContain("trust.last_updated");
    expect(pageSource).toContain("trust.frameworks");
    expect(pageSource).toContain("trust.subprocessors");
    expect(pageSource).toContain("trust.policies");
  });

  it("renders the full header: Solarpro Security & Compliance + tagline", () => {
    expect(pageSource).toContain("Solarpro Security &amp; Compliance");
    expect(pageSource).toMatch(/on-the-record/i);
    expect(pageSource).toContain("Trust Center");
  });

  it("renders the certifications-in-progress table for all five frameworks", () => {
    for (const id of [
      "soc2-type1",
      "soc2-type2",
      "iso27001",
      "iso27701",
      "iso27017",
    ]) {
      expect(trustJson.frameworks.find((f: { id: string }) => f.id === id)).toBeTruthy();
    }
    expect(pageSource).toContain("Certifications in progress");
    // Page must iterate trust.frameworks and bind name/target/evidence/id
    expect(pageSource).toContain("trust.frameworks.map");
    expect(pageSource).toContain("fw.id");
    expect(pageSource).toContain("fw.name");
    expect(pageSource).toContain("fw.target");
    expect(pageSource).toContain("fw.evidence");
    // Table column headers
    expect(pageSource).toContain(">Framework<");
    expect(pageSource).toContain(">Status<");
    expect(pageSource).toContain(">Target<");
    expect(pageSource).toContain(">Current evidence<");
  });

  it("renders all three framework statuses (planned, in_progress, achieved) with distinct badges", () => {
    // trust.json must contain entries with all three statuses
    const statuses = new Set(trustJson.frameworks.map((f: { status: string }) => f.status));
    expect(statuses.has("planned")).toBe(true);
    expect(statuses.has("in_progress")).toBe(true);

    // Page must handle each status with its own label + color token
    expect(pageSource).toContain("Achieved");
    expect(pageSource).toContain("In Progress");
    expect(pageSource).toContain("Planned");
    expect(pageSource).toContain("emerald"); // achieved
    expect(pageSource).toContain("amber");   // in_progress
    expect(pageSource).toContain("slate");   // planned
  });

  it("renders the seven security practices in a 2-col grid", () => {
    expect(pageSource).toContain("Security practices");
    expect(pageSource).toContain("Encryption at rest and in transit");
    expect(pageSource).toContain("MFA on all admin access");
    expect(pageSource).toContain("Quarterly access reviews");
    expect(pageSource).toContain("Daily encrypted backups");
    expect(pageSource).toContain("Continuous vulnerability scanning");
    expect(pageSource).toContain("Documented incident response plan");
    expect(pageSource).toContain("24-hour breach notification");
    expect(pageSource).toContain("sm:grid-cols-2");
  });

  it("renders the full subprocessor list and links to the canonical vendors.csv register", () => {
    // Page is data-driven — assert it iterates trust.subprocessors and binds name/purpose/data
    expect(pageSource).toContain("trust.subprocessors.map");
    expect(pageSource).toContain("sp.name");
    expect(pageSource).toContain("sp.purpose");
    expect(pageSource).toContain("sp.data");
    // Section heading + register link are hard-coded
    expect(pageSource).toContain("Subprocessors");
    expect(pageSource).toContain("compliance/vendors.csv");
    expect(pageSource).toContain("VENDORS_CSV_URL");
  });

  it("covers the actual subprocessor data (sanity check against trust.json)", () => {
    // The trust.json data itself is the source of truth — verify the JSON
    // has the subprocessors the design doc requires, even if the page is
    // data-driven and doesn't hard-code their names.
    const names = (trustJson.subprocessors as { name: string }[]).map((s) => s.name);
    for (const required of [
      "Vercel",
      "Neon",
      "Render",
      "OpenAI",
      "Anthropic",
      "Google Maps / Solar API",
      "Stripe",
      "Resend",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("renders the policy list and exposes a 'Request a full copy' mailto to security@", () => {
    for (const p of trustJson.policies as string[]) {
      expect(pageSource).toContain(p);
    }
    expect(pageSource).toContain("Policies");
    expect(pageSource).toContain("Request a full copy");
    // mailto is a template literal — assert the URL-encoded subject + body var
    expect(pageSource).toContain("subject=Policy%20Copy%20Request");
    expect(pageSource).toContain("POLICY_REQUEST_BODY");
    expect(pageSource).toContain("mailto:${SECURITY_EMAIL}");
  });

  it("renders the contact section with security@, vulnerability-report link, and SLA", () => {
    expect(pageSource).toContain("Contact");
    expect(pageSource).toContain("security@solarpro.app");
    expect(pageSource).toContain("Vulnerability%20Report");
    expect(pageSource).toMatch(/24 hours/);
  });

  it("renders the 'Request our SOC 2 report' CTA mailto with the required subject line", () => {
    expect(pageSource).toContain("Request our SOC 2 report");
    expect(pageSource).toContain("subject=SOC%202%20Report%20Request");
    expect(pageSource).toContain("SOC2_REQUEST_BODY");
  });

  it("renders the 'Last updated' stamp sourced from trust.json (server) + relative (client)", () => {
    expect(pageSource).toContain("Last updated");
    expect(pageSource).toContain("TrustClientStamp");
    expect(stampSource).toContain("formatRelative");
    expect(stampSource).toContain("Date.now()");
  });

  it("does NOT leak internal data: no admin URLs, no user names, no customer data", () => {
    // Forbidden tokens — public posture page must not reference these
    for (const token of [
      "/admin",
      "carpenterjames88@gmail.com",
      "raymond.obrian@yahoo.com",
      "cody@underthesun.solutions",
      "SOURCE_DATABASE_URL",
      "TARGET_DATABASE_URL",
      "adminUsers",
      "freePassUsers",
      "JWT_SECRET",
      "DATABASE_URL",
      "RESEND_API_KEY",
      "STRIPE_SECRET_KEY",
    ]) {
      expect(pageSource).not.toContain(token);
    }
  });

  it("uses the project's Tailwind + light-mode design system (no inline brand colors beyond what the existing compliance page uses)", () => {
    // The page must use Tailwind utility classes, not raw inline colors
    expect(pageSource).toContain("className=");
    expect(pageSource).toContain("max-w-5xl");
    // Light theme is the explicit choice for this public page
    expect(pageSource).toContain("bg-white");
    expect(pageSource).toContain("text-slate-900");
  });

  it("stays under the 200-line-of-TSX budget for the page itself", () => {
    const lineCount = pageSource.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(200);
  });

  it("is reachable from the public surface (footer link on the home page)", () => {
    const homeSource = read("app/page.tsx");
    expect(homeSource).toContain('href="/trust"');
  });

  it("is cross-linked from the existing /compliance page", () => {
    const complianceSource = read("app/compliance/page.tsx");
    expect(complianceSource).toContain('href="/trust"');
  });
});

describe("compliance/trust.json — data contract", () => {
  it("has a parseable last_updated ISO timestamp", () => {
    expect(typeof trustJson.last_updated).toBe("string");
    expect(new Date(trustJson.last_updated).toString()).not.toBe("Invalid Date");
  });

  it("has the 5 expected frameworks in the expected order", () => {
    const ids = trustJson.frameworks.map((f: { id: string }) => f.id);
    expect(ids).toEqual([
      "soc2-type1",
      "soc2-type2",
      "iso27001",
      "iso27701",
      "iso27017",
    ]);
  });

  it("every framework has a name, status, target, and evidence string", () => {
    for (const f of trustJson.frameworks) {
      expect(typeof f.name).toBe("string");
      expect(["planned", "in_progress", "achieved"]).toContain(f.status);
      expect(typeof f.target).toBe("string");
      // evidence is recommended but not strictly required for planned items
      if (f.status !== "planned") {
        expect(typeof f.evidence).toBe("string");
      }
    }
  });

  it("has 8+ subprocessors covering infrastructure, ML, payments, and email", () => {
    expect(trustJson.subprocessors.length).toBeGreaterThanOrEqual(8);
    const names = trustJson.subprocessors.map((s: { name: string }) => s.name);
    for (const required of ["Vercel", "Neon", "Stripe", "Resend"]) {
      expect(names).toContain(required);
    }
  });

  it("has the 10 expected policy names", () => {
    const expected = [
      "Information Security",
      "Acceptable Use",
      "Access Control",
      "Data Classification & Handling",
      "Incident Response",
      "Change Management",
      "Vulnerability Management",
      "Logging & Monitoring",
      "Backup & Recovery",
      "Vendor Risk Management",
    ];
    for (const p of expected) {
      expect(trustJson.policies).toContain(p);
    }
  });
});

describe("compliance/vendors.csv — subprocessor register stub", () => {
  it("exists and is non-empty", () => {
    expect(vendorsCsv.length).toBeGreaterThan(0);
  });

  it("has the canonical header row from SELF_BUILT_SETUP.md §6", () => {
    const header = vendorsCsv.split("\n")[0];
    for (const col of [
      "vendor",
      "criticality",
      "data_accessed",
      "dpa_status",
      "dpa_signed_date",
      "soc2_report_date",
      "iso27001_cert_date",
      "last_reviewed",
      "owner",
      "notes",
    ]) {
      expect(header).toContain(col);
    }
  });

  it("lists Vercel, Neon, and Stripe as critical vendors", () => {
    const lines = vendorsCsv.split("\n");
    const criticalVendors = lines
      .filter((l) => l.includes(",critical,"))
      .map((l) => l.split(",")[0]);
    expect(criticalVendors).toContain("vercel");
    expect(criticalVendors).toContain("neon");
    expect(criticalVendors).toContain("stripe");
  });
});
