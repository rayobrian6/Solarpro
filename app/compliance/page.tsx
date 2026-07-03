import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security & Compliance | SolarPro',
  description: 'SolarPro security practices, compliance certifications, and trust center.',
};

export default function CompliancePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-800 text-white py-20">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-6">Security & Compliance</h1>
          <p className="text-xl text-slate-300 max-w-3xl mx-auto">
            Your data security is our foundation. SolarPro is building toward SOC 2 Type II and ISO 27001 certification, with enterprise-grade security practices already in place.
          </p>
        </div>
      </section>

      {/* Compliance Status */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-slate-900 mb-8">Compliance Roadmap</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="border border-green-200 bg-green-50 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-green-600 text-2xl">✓</span>
                <h3 className="text-lg font-semibold text-green-800">SOC 2 Readiness</h3>
              </div>
              <p className="text-sm text-green-700">
                All Trust Services Criteria controls implemented. Tamper-evident audit logging, MFA enforcement, RBAC, and incident response procedures are in place. Preparing for Type I audit.
              </p>
            </div>
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-blue-600 text-2xl">◐</span>
                <h3 className="text-lg font-semibold text-blue-800">ISO 27001 Prep</h3>
              </div>
              <p className="text-sm text-blue-700">
                Information Security Management System (ISMS) framework established. 11 security policies, risk register, and asset inventory complete. 80% control overlap with SOC 2.
              </p>
            </div>
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-slate-500 text-2xl">○</span>
                <h3 className="text-lg font-semibold text-slate-700">GDPR / CCPA</h3>
              </div>
              <p className="text-sm text-slate-600">
                Data export and deletion APIs implemented. Consent tracking, data classification, and retention policies in place. Sub-processor register maintained.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Security Practices */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-slate-900 mb-8">Security Practices</h2>
          <div className="grid md:grid-cols-2 gap-6">
            {[
              {
                title: 'Authentication & Access',
                items: [
                  'JWT-based authentication with HS256 algorithm',
                  'MFA (TOTP) enforced for all admin and staff accounts',
                  'Role-based access control (5 roles, least privilege)',
                  'Timing-safe credential comparison',
                  'Session timeout enforcement (8hr admin, 24hr homeowner)',
                ],
              },
              {
                title: 'Data Protection',
                items: [
                  'AES-256-GCM encryption for sensitive data at rest',
                  'TLS 1.2+ for all data in transit',
                  'bcrypt (cost 12) password hashing',
                  'Data classification (4-tier: Restricted → Public)',
                  'GDPR/CCPA data export and deletion APIs',
                ],
              },
              {
                title: 'Infrastructure Security',
                items: [
                  'Rate limiting on 37+ endpoint categories',
                  'CSRF protection on all state-changing endpoints',
                  'HMAC webhook signature verification',
                  'Vercel-hosted with automatic security patches',
                  'Neon PostgreSQL with encrypted connections',
                ],
              },
              {
                title: 'Monitoring & Audit',
                items: [
                  'Tamper-evident audit logging (hash-chained entries)',
                  'SHA-256 chain integrity verification',
                  'Sentry error monitoring and alerting',
                  'Automated vulnerability scanning',
                  'Incident response plan with 4-tier severity',
                ],
              },
            ].map((section) => (
              <div key={section.title} className="bg-white rounded-lg border p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">{section.title}</h3>
                <ul className="space-y-2">
                  {section.items.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="text-green-500 mt-0.5">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Policies */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-slate-900 mb-8">Security Policies</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { id: 'POL-SEC-001', name: 'Information Security Policy', desc: 'Top-level security governance' },
              { id: 'POL-SEC-002', name: 'Acceptable Use Policy', desc: 'System and network use rules' },
              { id: 'POL-SEC-003', name: 'Access Control Policy', desc: 'RBAC and provisioning' },
              { id: 'POL-SEC-004', name: 'Data Classification Policy', desc: '4-tier data handling' },
              { id: 'POL-SEC-005', name: 'Incident Response Plan', desc: '4-tier severity response' },
              { id: 'POL-SEC-006', name: 'Change Management Policy', desc: 'Deployment controls' },
              { id: 'POL-SEC-007', name: 'Data Retention & Disposal', desc: 'Retention schedules' },
              { id: 'POL-SEC-008', name: 'Vendor Risk Management', desc: 'Sub-processor oversight' },
              { id: 'POL-SEC-009', name: 'Password & Authentication', desc: 'MFA and session management' },
              { id: 'POL-SEC-010', name: 'Encryption Policy', desc: 'Algorithm and key management' },
              { id: 'POL-SEC-011', name: 'Business Continuity & DR', desc: 'RPO/RTO and recovery' },
            ].map((policy) => (
              <div key={policy.id} className="border rounded-lg p-4 hover:shadow-md transition">
                <span className="text-xs font-mono text-slate-500">{policy.id}</span>
                <h3 className="font-medium text-slate-900 mt-1">{policy.name}</h3>
                <p className="text-sm text-slate-600 mt-1">{policy.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sub-processors */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">Sub-Processors</h2>
          <p className="text-slate-600 mb-8">
            SolarPro uses the following sub-processors to process customer data. We maintain a sub-processor register and notify customers of material changes.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-200">
                  <th className="text-left p-3 font-semibold">Sub-Processor</th>
                  <th className="text-left p-3 font-semibold">Purpose</th>
                  <th className="text-left p-3 font-semibold">Location</th>
                  <th className="text-left p-3 font-semibold">Certifications</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: 'Vercel', purpose: 'Application hosting & CDN', location: 'US', certs: 'SOC 2 Type II, ISO 27001' },
                  { name: 'Neon', purpose: 'PostgreSQL database hosting', location: 'US/EU', certs: 'SOC 2 Type II' },
                  { name: 'Stripe', purpose: 'Payment processing', location: 'US', certs: 'PCI DSS Level 1, SOC 1/2' },
                  { name: 'Upstash', purpose: 'Redis rate limiting', location: 'US/EU', certs: 'SOC 2 Type II' },
                  { name: 'Sentry', purpose: 'Error monitoring', location: 'US/EU', certs: 'SOC 2 Type II' },
                  { name: 'Anthropic', purpose: 'AI processing', location: 'US', certs: 'SOC 2 Type II' },
                  { name: 'OpenAI', purpose: 'AI processing', location: 'US', certs: 'SOC 2 Type II' },
                  { name: 'Resend', purpose: 'Email delivery', location: 'US', certs: 'SOC 2' },
                  { name: 'Google Cloud', purpose: 'File storage (GCS)', location: 'US', certs: 'ISO 27001, SOC 1/2/3' },
                ].map((vendor) => (
                  <tr key={vendor.name} className="border-b">
                    <td className="p-3 font-medium">{vendor.name}</td>
                    <td className="p-3 text-slate-600">{vendor.purpose}</td>
                    <td className="p-3 text-slate-600">{vendor.location}</td>
                    <td className="p-3 text-slate-600">{vendor.certs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-4">
            Last updated: July 2025. For the complete sub-processor register with DPA status and data classification exposure, contact security@solarpro.com.
          </p>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-6 text-center">
          <h2 className="text-3xl font-bold text-slate-900 mb-4">Security Inquiries</h2>
          <p className="text-slate-600 mb-6">
            For security questions, vulnerability reports, or to request our security questionnaire response, contact our security team.
          </p>
          <a
            href="mailto:security@solarpro.com"
            className="inline-block bg-slate-900 text-white px-8 py-3 rounded-lg font-medium hover:bg-slate-800 transition"
          >
            Contact Security Team
          </a>
        </div>
      </section>
    </div>
  );
}
