import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const pageSource = fs.readFileSync(
  path.join(process.cwd(), "app/free-solar-estimate/page.tsx"),
  "utf8",
);

describe("/free-solar-estimate public intake funnel", () => {
  it("posts first-stage intake and second-stage qualification only to canonical homeowner endpoints", () => {
    expect(pageSource).toContain('fetch("/api/intake/homeowner"');
    expect(pageSource).toContain('fetch("/api/intake/homeowner/qualification"');
    expect(pageSource).toContain("original_event_id: intakeReference");
    expect(pageSource).not.toContain("/api/intake/webhook");
    expect(pageSource).not.toContain("/api/admin/network");
    expect(pageSource).not.toContain("/api/network/opportunities");
  });

  it("maps requested form fields into canonical intake payload keys", () => {
    expect(pageSource).toContain("first_name: form.first_name.trim()");
    expect(pageSource).toContain("last_name: form.last_name.trim()");
    expect(pageSource).toContain("phone: form.phone.trim()");
    expect(pageSource).toContain("email: form.email.trim().toLowerCase()");
    expect(pageSource).toContain("address_line1: form.property_address.trim()");
    expect(pageSource).toContain(
      "monthly_bill_amount: normalizeMoney(form.average_monthly_bill)",
    );
    expect(pageSource).toContain("home_ownership: form.homeowner_status");
    expect(pageSource).toContain("roof_age_years: form.roof_age.trim()");
  });

  it("captures post-submit qualification answers without adding them to the first intake payload", () => {
    expect(pageSource).toContain("Quick qualification");
    expect(pageSource).toContain("purchase_intent");
    expect(pageSource).toContain("estimated_credit_band");
    expect(pageSource).toContain("estimated_income_band");
    expect(pageSource).toContain("property_type");
    expect(pageSource).toContain("electrical_panel_size");
    expect(pageSource).toContain("sunlight_confidence");
    expect(pageSource).toContain("prior_quotes");
    expect(pageSource).toContain("Skip for now");
  });

  it("does not expose internal lead grade or contractor intelligence to the homeowner", () => {
    expect(pageSource).toContain("Qualification saved");
    expect(pageSource).not.toContain("qualificationSummary");
    expect(pageSource).not.toContain("contractor_summary");
    expect(pageSource).not.toContain("A-Grade Opportunity");
    expect(pageSource).not.toContain("Lead Grade");
    expect(pageSource).not.toContain("lead_grade");
  });

  it("preserves non-canonical operational fields and submits utility bills through canonical multipart intake", () => {
    expect(pageSource).toContain("Utility provider:");
    expect(pageSource).toContain("Battery interest:");
    expect(pageSource).toContain("Preferred contact method:");
    expect(pageSource).toContain("Timeline:");
    expect(pageSource).toContain("The intake endpoint stores supported PDF/image utility bills and links the attachment metadata to the canonical intake event.");
    expect(pageSource).toContain("const requestBody = new FormData()");
    expect(pageSource).toContain('requestBody.append("payload", JSON.stringify(payload))');
    expect(pageSource).toContain('requestBody.append("utility_bill", billFile)');

    const homeownerFetchStart = pageSource.indexOf('fetch("/api/intake/homeowner",');
    expect(homeownerFetchStart).toBeGreaterThan(-1);
    const requestBodyLine = pageSource.indexOf("body: requestBody", homeownerFetchStart);
    expect(requestBodyLine).toBeGreaterThan(homeownerFetchStart);
    const homeownerFetchBlock = pageSource.slice(
      homeownerFetchStart,
      requestBodyLine + "body: requestBody".length,
    );
    expect(homeownerFetchBlock).toContain("body: requestBody");
    expect(homeownerFetchBlock).not.toContain("Content-Type");

    expect(pageSource).not.toContain("CREATE TABLE");
    expect(pageSource).not.toContain("INSERT INTO network_opportunities");
    expect(pageSource).not.toContain("opportunity_screening_queue");
  });
});
