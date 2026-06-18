"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shield } from "lucide-react";

function PrivacyContent() {
  const searchParams = useSearchParams();
  const fromEstimate = searchParams.get("from") === "estimate";

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header */}
      <header
        style={{
          background: "linear-gradient(135deg, #0a1628 0%, #0f2044 100%)",
          borderBottom: "3px solid #f97316",
        }}
      >
        <div
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "40px 32px 36px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(249,115,22,0.15)",
              border: "1px solid rgba(249,115,22,0.4)",
              borderRadius: 20,
              padding: "4px 14px",
              fontFamily: "Arial, sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase" as const,
              color: "#fbbf24",
              marginBottom: 18,
            }}
          >
            <Shield size={14} />
            Privacy Policy
          </div>
          <h1
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 32,
              fontWeight: 800,
              color: "#ffffff",
              lineHeight: 1.2,
              marginBottom: 10,
            }}
          >
            Privacy Policy &{" "}
            <span style={{ color: "#f97316" }}>Data Practices</span>
          </h1>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 15,
              color: "rgba(255,255,255,0.70)",
              fontWeight: 400,
              marginBottom: 24,
            }}
          >
            SolarPro Platform — Under The Sun Solar
          </p>
          <div
            style={{
              display: "flex" as const,
              flexWrap: "wrap" as const,
              gap: 24,
              fontFamily: "Arial, sans-serif",
              fontSize: 12,
              color: "rgba(255,255,255,0.55)",
            }}
          >
            <span>
              <strong style={{ color: "rgba(255,255,255,0.85)" }}>
                Effective Date:
              </strong>{" "}
              June 2025
            </span>
            <span>
              <strong style={{ color: "rgba(255,255,255,0.85)" }}>
                Last Updated:
              </strong>{" "}
              June 2025
            </span>
            <span>
              <strong style={{ color: "rgba(255,255,255,0.85)" }}>
                Jurisdiction:
              </strong>{" "}
              State of Illinois, United States
            </span>
            <span>
              <strong style={{ color: "rgba(255,255,255,0.85)" }}>
                Platform Owner:
              </strong>{" "}
              Raymond O&apos;Brian
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          maxWidth: 860,
          margin: "0 auto",
          padding: "48px 32px 80px",
        }}
      >
        {fromEstimate ? (
          <div
            style={{
              background: "#f0f9ff",
              border: "1px solid #bae6fd",
              borderLeft: "4px solid #0284c7",
              borderRadius: 8,
              padding: "16px 20px",
              marginBottom: 32,
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              color: "#0369a1",
            }}
          >
            You were directed here from our free estimate form. Your personal
            information is handled with the care described below.
          </div>
        ) : null}

        {/* Section 1 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            1. Information We Collect
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            When you use SolarPro, we may collect the following categories of
            information:
          </p>
          <ul
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 2,
              color: "#475569",
              paddingLeft: 20,
              marginBottom: 12,
            }}
          >
            <li>
              <strong>Identifying information:</strong> Name, email address,
              phone number, and company name when you register or contact us.
            </li>
            <li>
              <strong>Property information:</strong> Property address, utility
              provider, monthly electric bill, roof details, and homeowner status
              when you request a solar estimate.
            </li>
            <li>
              <strong>Account data:</strong> Login credentials (stored as hashed
              passwords), subscription tier, and usage preferences.
            </li>
            <li>
              <strong>Project data:</strong> Solar project details, design
              specifications, engineering calculations, and permit-related
              documents you create or upload.
            </li>
            <li>
              <strong>Usage analytics:</strong> Page views, feature usage,
              browser type, device information, and interaction patterns to
              improve the platform.
            </li>
            <li>
              <strong>Payment information:</strong> Billing details processed
              through Stripe; SolarPro does not store full card numbers on its
              servers.
            </li>
          </ul>
        </section>

        {/* Section 2 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            2. How We Use Your Information
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            We use collected information to:
          </p>
          <ul
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 2,
              color: "#475569",
              paddingLeft: 20,
              marginBottom: 12,
            }}
          >
            <li>
              Provide, maintain, and improve the SolarPro platform and its
              features.
            </li>
            <li>
              Process your solar estimate requests and connect you with qualified
              solar advisors.
            </li>
            <li>
              Generate engineering calculations, proposals, and permit-ready
              documents for your projects.
            </li>
            <li>
              Communicate with you about your account, projects, and platform
              updates.
            </li>
            <li>
              Process subscription payments and manage billing through our
              payment provider.
            </li>
            <li>
              Detect, prevent, and address fraud, abuse, and security issues.
            </li>
            <li>Comply with applicable legal obligations.</li>
          </ul>
        </section>

        {/* Section 3 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            3. Information Sharing
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            We do not sell your personal information. We share information only
            in the following circumstances:
          </p>
          <ul
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 2,
              color: "#475569",
              paddingLeft: 20,
              marginBottom: 12,
            }}
          >
            <li>
              <strong>Solar advisors:</strong> When you request a free solar
              estimate, your contact and property details are shared with a
              trusted solar advisor who will prepare your personalized estimate.
            </li>
            <li>
              <strong>Service providers:</strong> Third-party services that help
              us operate the platform (payment processing via Stripe, email
              delivery, cloud hosting, mapping APIs). Each provider is bound by
              their own privacy obligations.
            </li>
            <li>
              <strong>Team members:</strong> If you belong to an organization on
              SolarPro, your project data may be visible to other members of
              your team based on role permissions.
            </li>
            <li>
              <strong>Legal requirements:</strong> When required by law,
              subpoena, court order, or governmental regulation.
            </li>
          </ul>
        </section>

        {/* Section 4 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            4. Data Storage & Security
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            Your data is stored on secure, encrypted servers hosted in the United
            States. We implement industry-standard security measures including
            encryption at rest and in transit, access controls, and regular
            security reviews. While no system is completely secure, we are
            committed to protecting your information and continuously improve our
            safeguards.
          </p>
        </section>

        {/* Section 5 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            5. Cookies & Tracking
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            SolarPro uses essential cookies to maintain your session and
            authentication state. We may also use analytics tools (such as
            Google Analytics) to understand how visitors interact with the
            platform. You can manage cookie preferences through your browser
            settings. We do not use tracking cookies for advertising purposes.
          </p>
        </section>

        {/* Section 6 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            6. Your Rights
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            Depending on your location, you may have the following rights
            regarding your personal data:
          </p>
          <ul
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 2,
              color: "#475569",
              paddingLeft: 20,
              marginBottom: 12,
            }}
          >
            <li>
              <strong>Access:</strong> Request a copy of the personal data we
              hold about you.
            </li>
            <li>
              <strong>Correction:</strong> Request correction of inaccurate or
              incomplete data.
            </li>
            <li>
              <strong>Deletion:</strong> Request deletion of your personal data,
              subject to legal retention obligations.
            </li>
            <li>
              <strong>Portability:</strong> Request your data in a structured,
              commonly used format.
            </li>
            <li>
              <strong>Opt-out:</strong> Unsubscribe from marketing
              communications at any time via the link in any email.
            </li>
          </ul>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
            }}
          >
            To exercise any of these rights, contact us at the email address
            listed below.
          </p>
        </section>

        {/* Section 7 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            7. Data Retention
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            We retain your personal data for as long as your account is active or
            as needed to provide services. Project data and engineering documents
            are retained for the lifetime of the project unless you request
            deletion. We may retain certain data as required by law or for
            legitimate business purposes such as fraud prevention and legal
            compliance.
          </p>
        </section>

        {/* Section 8 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            8. Children&apos;s Privacy
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            SolarPro is not intended for use by individuals under the age of 18.
            We do not knowingly collect personal information from children. If we
            become aware that we have inadvertently collected data from a minor,
            we will take steps to delete it promptly.
          </p>
        </section>

        {/* Section 9 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            9. Changes to This Policy
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            We may update this Privacy Policy from time to time. We will notify
            you of material changes by posting the updated policy on this page
            and updating the &ldquo;Last Updated&rdquo; date. Continued use of
            the platform after changes constitutes acceptance of the revised
            policy.
          </p>
        </section>

        {/* Section 10 */}
        <section style={{ marginBottom: 40 }}>
          <h2
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 20,
              fontWeight: 700,
              color: "#0f172a",
              marginBottom: 12,
              paddingBottom: 8,
              borderBottom: "2px solid #e2e8f0",
            }}
          >
            10. Contact Us
          </h2>
          <p
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 1.8,
              color: "#475569",
              marginBottom: 12,
            }}
          >
            If you have questions about this Privacy Policy or your personal
            data, please contact:
          </p>
          <div
            style={{
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: "20px 24px",
              fontFamily: "Arial, sans-serif",
              fontSize: 14,
              lineHeight: 2,
              color: "#475569",
            }}
          >
            <strong>SolarPro — Under The Sun Solar</strong>
            <br />
            Attn: Privacy
            <br />
            Illinois, United States
          </div>
        </section>

        {/* Footer nav */}
        <div
          style={{
            marginTop: 48,
            paddingTop: 24,
            borderTop: "2px solid #e2e8f0",
            display: "flex",
            gap: 24,
            fontFamily: "Arial, sans-serif",
            fontSize: 14,
          }}
        >
          <Link
            href="/terms"
            style={{ color: "#f97316", textDecoration: "none" }}
          >
            View Terms of Service →
          </Link>
          <Link
            href="/"
            style={{ color: "#64748b", textDecoration: "none" }}
          >
            Back to SolarPro →
          </Link>
        </div>
      </main>
    </div>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#f8fafc]">
          <p className="text-slate-500">Loading...</p>
        </div>
      }
    >
      <PrivacyContent />
    </Suspense>
  );
}
