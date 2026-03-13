'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

function TermsContent() {
  const searchParams = useSearchParams()
  const fromSignup = searchParams.get('from') === 'signup'

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      {/* Header */}
      <header style={{
        background: 'linear-gradient(135deg, #0a1628 0%, #0f2044 100%)',
        borderBottom: '3px solid #f97316',
      }}>
        <div style={{ maxWidth: 860, margin: '0 auto', padding: '40px 32px 36px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            background: 'rgba(249,115,22,0.15)', border: '1px solid rgba(249,115,22,0.4)',
            borderRadius: 20, padding: '4px 14px',
            fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
            color: '#fbbf24', marginBottom: 18,
          }}>
            ⚖ Legal Document
          </div>
          <h1 style={{
            fontFamily: 'Arial, sans-serif', fontSize: 32, fontWeight: 800,
            color: '#ffffff', lineHeight: 1.2, marginBottom: 10,
          }}>
            Terms of Service &amp; <span style={{ color: '#f97316' }}>Confidentiality Agreement</span>
          </h1>
          <p style={{
            fontFamily: 'Arial, sans-serif', fontSize: 15,
            color: 'rgba(255,255,255,0.70)', fontWeight: 400, marginBottom: 24,
          }}>
            SolarPro Platform — Under The Sun Solar
          </p>
          <div style={{
            display: 'flex', flexWrap: 'wrap' as const, gap: 24,
            fontFamily: 'Arial, sans-serif', fontSize: 12,
            color: 'rgba(255,255,255,0.55)',
          }}>
            <span><strong style={{ color: 'rgba(255,255,255,0.85)' }}>Effective Date:</strong> March 13, 2026</span>
            <span><strong style={{ color: 'rgba(255,255,255,0.85)' }}>Last Updated:</strong> March 13, 2026</span>
            <span><strong style={{ color: 'rgba(255,255,255,0.85)' }}>Jurisdiction:</strong> State of Illinois, United States</span>
            <span><strong style={{ color: 'rgba(255,255,255,0.85)' }}>Platform Owner:</strong> Raymond O&apos;Brian</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 860, margin: '0 auto', padding: '48px 32px 80px' }}>

        {fromSignup && (
          <div style={{
            background: '#f0f9ff', border: '1px solid #bae6fd',
            borderLeft: '4px solid #0284c7', borderRadius: 8,
            padding: '16px 20px', marginBottom: 32,
          }}>
            <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#0c4a6e', margin: 0 }}>
              Please review this agreement carefully before creating your account. You must scroll through and accept these terms to complete registration.
            </p>
          </div>
        )}

        {/* Table of Contents */}
        <nav style={{
          background: '#ffffff', border: '1px solid #e2e8f0',
          borderLeft: '4px solid #f97316', borderRadius: 8,
          padding: '28px 32px', marginBottom: 48,
          boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        }}>
          <div style={{
            fontFamily: 'Arial, sans-serif', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase' as const,
            color: '#f97316', marginBottom: 16,
          }}>Table of Contents</div>
          <ol style={{ listStyle: 'decimal', paddingLeft: 20, columns: 2, gap: 32, fontFamily: 'Arial, sans-serif', fontSize: 13, color: '#475569' }}>
            <li style={{ lineHeight: 2 }}><a href="#definitions" style={{ color: '#475569', textDecoration: 'none' }}>Definitions</a></li>
            <li style={{ lineHeight: 2 }}><a href="#acceptance" style={{ color: '#475569', textDecoration: 'none' }}>Acceptance of Terms</a></li>
            <li style={{ lineHeight: 2 }}><a href="#ownership" style={{ color: '#475569', textDecoration: 'none' }}>Ownership of Intellectual Property</a></li>
            <li style={{ lineHeight: 2 }}><a href="#confidentiality" style={{ color: '#475569', textDecoration: 'none' }}>Confidentiality &amp; Non-Disclosure</a></li>
            <li style={{ lineHeight: 2 }}><a href="#restrictions" style={{ color: '#475569', textDecoration: 'none' }}>Restrictions on Use</a></li>
            <li style={{ lineHeight: 2 }}><a href="#license" style={{ color: '#475569', textDecoration: 'none' }}>Limited License</a></li>
            <li style={{ lineHeight: 2 }}><a href="#outputs" style={{ color: '#475569', textDecoration: 'none' }}>Protection of Automated Outputs</a></li>
            <li style={{ lineHeight: 2 }}><a href="#disclaimer" style={{ color: '#475569', textDecoration: 'none' }}>Engineering &amp; Proposal Disclaimer</a></li>
            <li style={{ lineHeight: 2 }}><a href="#termination" style={{ color: '#475569', textDecoration: 'none' }}>Account Termination</a></li>
            <li style={{ lineHeight: 2 }}><a href="#liability" style={{ color: '#475569', textDecoration: 'none' }}>Limitation of Liability</a></li>
            <li style={{ lineHeight: 2 }}><a href="#data" style={{ color: '#475569', textDecoration: 'none' }}>Data Usage &amp; Privacy</a></li>
            <li style={{ lineHeight: 2 }}><a href="#updates" style={{ color: '#475569', textDecoration: 'none' }}>Updates to Terms</a></li>
            <li style={{ lineHeight: 2 }}><a href="#governing-law" style={{ color: '#475569', textDecoration: 'none' }}>Governing Law &amp; Disputes</a></li>
            <li style={{ lineHeight: 2 }}><a href="#electronic-acceptance" style={{ color: '#475569', textDecoration: 'none' }}>Electronic Acceptance</a></li>
          </ol>
        </nav>

        {/* Alert Box */}
        <div style={{
          background: '#fff7ed', border: '1px solid #fed7aa',
          borderLeft: '4px solid #f97316', borderRadius: 8,
          padding: '20px 24px', marginBottom: 40,
        }}>
          <div style={{
            fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.10em', textTransform: 'uppercase' as const,
            color: '#f97316', marginBottom: 8,
          }}>⚠ Important — Please Read Before Using SolarPro</div>
          <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#92400e', lineHeight: 1.6, margin: 0 }}>
            This Terms of Service and Confidentiality Agreement (&quot;Agreement&quot;) is a legally binding contract between you (&quot;User&quot;) and Raymond O&apos;Brian, the owner of SolarPro, operated by Under The Sun Solar. By creating an account or accessing the platform in any way, you acknowledge that you have read, understood, and agreed to be bound by all terms contained herein. If you do not agree to these terms, you must not access or use the platform.
          </p>
        </div>

        {/* ── DEFINITIONS ── */}
        <section id="definitions" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{
            display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11,
            fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const,
            color: '#f97316', marginBottom: 6,
          }}>Definitions</span>
          <h2 style={{
            fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800,
            color: '#0a1628', marginBottom: 16, paddingBottom: 12,
            borderBottom: '2px solid #e2e8f0', lineHeight: 1.3,
          }}>📖 Defined Terms</h2>
          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            Throughout this Agreement, the following terms shall have the meanings set forth below:
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, margin: '16px 0', fontSize: 14.5 }}>
            <tbody>
              {[
                ['"Platform"', 'The SolarPro software application, including all web interfaces, APIs, databases, automation workflows, algorithms, and related systems, whether accessed via browser, API, or any other means.'],
                ['"Owner"', "Raymond O'Brian, the sole owner of the Platform software, underlying code, algorithms, and all associated intellectual property."],
                ['"Operator"', 'Under The Sun Solar, the company developing and operating the Platform on behalf of the Owner.'],
                ['"User" / "you"', 'Any individual or entity who creates an account, accesses, or uses the Platform in any capacity, including solar installers, sales professionals, engineers, and company administrators.'],
                ['"Proprietary Technology"', 'All algorithms, automation workflows, OCR extraction logic, system sizing methods, proposal generation processes, engineering workflows, data models, and any other technical processes embodied in the Platform.'],
                ['"Confidential Information"', 'All non-public information relating to the Platform, including but not limited to its Proprietary Technology, source code, system architecture, business logic, output formats, pricing models, and internal processes.'],
                ['"Output(s)"', 'Any data, reports, proposals, system designs, calculations, engineering recommendations, or other materials generated by or through the Platform.'],
                ['"Agreement"', 'This Terms of Service and Confidentiality Agreement, as updated from time to time, together with any supplemental policies incorporated herein by reference.'],
              ].map(([term, def], i) => (
                <tr key={i}>
                  <td style={{
                    padding: '10px 16px 10px 0', borderBottom: '1px solid #e2e8f0',
                    verticalAlign: 'top', fontFamily: 'Arial, sans-serif',
                    fontWeight: 700, color: '#0a1628', whiteSpace: 'nowrap' as const,
                    width: '28%', lineHeight: 1.6,
                  }}>{term}</td>
                  <td style={{
                    padding: '10px 16px', borderBottom: '1px solid #e2e8f0',
                    verticalAlign: 'top', color: '#475569', lineHeight: 1.6,
                    fontFamily: 'Georgia, serif', fontSize: 14.5,
                  }}>{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── SECTION 1: ACCEPTANCE ── */}
        <section id="acceptance" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 1</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>✅ Acceptance of Terms</h2>

          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            By accessing, registering for, or using the SolarPro Platform in any manner, you (&quot;User&quot;) agree to be legally bound by this Agreement in its entirety. This Agreement is effective immediately upon your creation of an account or your first access to the Platform, whichever occurs earlier.
          </p>
          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            Your acceptance is required before an account may be created. The Platform will present this Agreement to you during the registration process and will require your affirmative electronic acknowledgment. Accessing or using the Platform without completing this acknowledgment is a material breach of this Agreement.
          </p>

          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderLeft: '4px solid #0284c7', borderRadius: 8, padding: '20px 24px', margin: '20px 0' }}>
            <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#0c4a6e', margin: 0, lineHeight: 1.65 }}>
              <strong>Mandatory Acknowledgment:</strong> You represent and warrant that (a) you are at least 18 years of age; (b) you have the legal capacity and authority to enter into this Agreement, or if acting on behalf of an organization, that you are authorized to bind that organization; and (c) your use of the Platform will comply fully with all applicable laws and regulations.
            </p>
          </div>

          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            If you are using the Platform on behalf of a company, organization, or other legal entity, &quot;you&quot; includes both you individually and that entity, and both you and the entity agree to be bound by this Agreement. You represent that you have the authority to bind such entity. If you do not have such authority, you must not use the Platform.
          </p>
        </section>

        {/* ── SECTION 2: INTELLECTUAL PROPERTY ── */}
        <section id="ownership" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 2</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>🏛 Ownership of Intellectual Property</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>2.1 — Sole Ownership</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The SolarPro Platform, including without limitation all source code, object code, software architecture, database schemas, algorithms, automation workflows, OCR extraction systems, solar system sizing models, proposal generation logic, engineering calculation methods, user interface designs, documentation, and all other components thereof (collectively, the &quot;Platform&quot;), is the exclusive proprietary intellectual property of <strong>Raymond O&apos;Brian</strong>. All rights, title, and interest in and to the Platform are and shall remain vested exclusively in Raymond O&apos;Brian.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>2.2 — Development and Operation</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The Platform is developed, maintained, and operated by <strong>Under The Sun Solar</strong>, a company acting under the authority and on behalf of Raymond O&apos;Brian. The involvement of Under The Sun Solar in the Platform&apos;s development and operation does not convey any ownership interest to any User or third party.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>2.3 — Scope of Proprietary Rights</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The following components constitute proprietary intellectual property protected under applicable United States copyright, trade secret, patent, and other intellectual property laws:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'All software source code, compiled code, and object code comprising the Platform',
                'Utility bill OCR extraction algorithms and logic, including preprocessing pipelines and text parsing methods',
                'Energy usage analysis models, seasonal adjustment algorithms, and consumption estimation methods',
                'Solar system sizing algorithms, irradiance models, and system performance calculation methods',
                'Automated proposal generation workflows, template structures, and output formatting logic',
                'Engineering workflow automation, bill-of-materials generation, and permit package preparation systems',
                'Utility rate database structures, rate matching algorithms, and avoided-cost calculation logic',
                'Project data management schemas, client relationship data models, and project lifecycle workflows',
                'All user interface designs, visual layouts, color schemes, and user experience flows',
                'All training data, model weights, fine-tuning datasets, and AI/ML configurations utilized by the Platform',
                'All internal documentation, technical specifications, and engineering notes',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>2.4 — No Transfer of Ownership</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              This Agreement does not transfer to you any ownership interest, intellectual property right, or title in or to the Platform or any component thereof. Any rights not expressly granted herein are reserved exclusively to Raymond O&apos;Brian.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>2.5 — Trademarks</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The names &quot;SolarPro,&quot; &quot;Under The Sun Solar,&quot; and all related logos, service marks, and trade names are trademarks and service marks owned by Raymond O&apos;Brian and/or Under The Sun Solar. You are not granted any right or license to use any trademark, service mark, or trade name of the Owner or Operator without prior written consent.
            </p>
          </div>
        </section>

        {/* ── SECTION 3: CONFIDENTIALITY / NDA ── */}
        <div id="confidentiality" style={{
          background: 'linear-gradient(135deg, #0a1628 0%, #1e3a5f 100%)',
          borderRadius: 8, padding: '32px 36px', margin: '40px 0 52px',
          color: '#fff', border: '1px solid rgba(249,115,22,0.3)',
          scrollMarginTop: 24,
        }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#fbbf24', marginBottom: 6 }}>Section 3</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 22, fontWeight: 800, color: '#ffffff', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid rgba(255,255,255,0.15)', lineHeight: 1.3 }}>🔒 Confidentiality &amp; Non-Disclosure Agreement</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.1 — Acknowledgment of Confidential Nature</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 0 }}>
              You acknowledge and agree that by accessing the Platform, you are exposed to Confidential Information belonging exclusively to Raymond O&apos;Brian. The Platform, its Proprietary Technology, and all information relating thereto constitute valuable confidential trade secrets, the disclosure of which would cause irreparable harm to the Owner and Operator that could not be adequately compensated by monetary damages alone.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.2 — Confidentiality Obligation</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              You agree to hold all Confidential Information in strict confidence. You shall not, directly or indirectly, at any time during or after your use of the Platform:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                "Disclose, reveal, publish, or communicate Confidential Information to any third party without the prior written consent of Raymond O'Brian",
                'Use Confidential Information for any purpose other than your authorized, permitted use of the Platform as a paying subscriber',
                'Copy, reproduce, summarize, abstract, or otherwise reduce Confidential Information to writing or electronic form for any unauthorized purpose',
                'Remove, circumvent, disable, or otherwise interfere with any security, watermarking, or proprietary notices on the Platform',
                'Permit any third party to access, observe, or use the Platform in a manner that would constitute a breach of this Section',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.3 — Protected Architecture and Processes</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              The following specific elements of the Platform are classified as Confidential Information and are afforded the highest degree of protection under this Agreement:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                ['Platform Architecture:', 'The overall system design, microservice topology, API structure, data flow pipelines, and integration architecture of the Platform'],
                ['Automation Processes:', 'All automated workflows including bill intake, OCR processing, data extraction, system sizing, proposal generation, and engineering preparation sequences'],
                ['Algorithms and Engineering Methods:', 'All mathematical models, calculation methodologies, machine learning pipelines, heuristic rules, and engineering logic employed by the Platform to produce Outputs'],
                ['Software Workflows:', 'The sequence, logic, and interdependencies of all software processes, including prompt engineering, AI model configurations, and data transformation pipelines'],
                ['Proprietary Data:', 'Utility rate databases, benchmark datasets, regional solar irradiance models, and any other data compilations maintained by the Platform'],
              ].map(([label, desc], i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15, color: 'rgba(255,255,255,0.85)', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  <strong>{label}</strong> {desc}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.4 — Non-Reverse Engineering</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 0 }}>
              You expressly agree not to reverse engineer, decompile, disassemble, decrypt, or otherwise attempt to derive or reconstruct the source code, algorithms, methods, or Proprietary Technology of the Platform by any means, including by analysis of the Platform&apos;s behavior, Outputs, response patterns, timing, or any other observable characteristic. This prohibition applies regardless of whether you believe such activities are permitted under applicable law.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.5 — Permitted Disclosure</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 0 }}>
              Your confidentiality obligations do not apply to information that (a) is or becomes publicly available through no breach of this Agreement by you; (b) you can demonstrate was rightfully known to you prior to access without restriction; or (c) is required to be disclosed by applicable law or court order, provided you give the Owner prompt written notice and cooperate with any effort to obtain protective treatment.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.6 — Duration of Confidentiality Obligation</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 0 }}>
              Your confidentiality obligations under this Section 3 survive the termination or expiration of this Agreement and your use of the Platform indefinitely, or for the maximum period permitted under applicable law, whichever is longer.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 12, fontWeight: 700, color: '#fbbf24', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>3.7 — Injunctive Relief</div>
            <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 0 }}>
              You acknowledge that any breach or threatened breach of your confidentiality obligations would cause immediate and irreparable injury to the Owner for which monetary damages would be an inadequate remedy. Accordingly, Raymond O&apos;Brian and Under The Sun Solar shall be entitled to seek injunctive relief, specific performance, or other equitable relief in any court of competent jurisdiction without the requirement to post bond or other security, and without prejudice to any other rights and remedies that may be available.
            </p>
          </div>
        </div>

        {/* ── SECTION 4: RESTRICTIONS ON USE ── */}
        <section id="restrictions" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 4</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>🚫 Restrictions on Use</h2>

          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            Your right to access the Platform is subject to strict limitations. You agree that you will not, under any circumstances, do any of the following:
          </p>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>4.1 — Prohibited Technical Activities</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                ['Reverse Engineer:', 'Attempt to derive, reconstruct, or reproduce the source code, algorithms, methods, or operational logic of the Platform through any means including behavioral analysis, traffic inspection, timing attacks, output analysis, or any other method'],
                ['Data Scraping:', 'Use automated tools, bots, spiders, crawlers, scrapers, or any other automated means to extract, collect, harvest, or aggregate data, Outputs, or content from the Platform without express written authorization'],
                ['Unauthorized API Access:', 'Access any non-public API, internal endpoint, or backend service of the Platform through means other than those expressly authorized'],
                ['Security Circumvention:', 'Probe, scan, test, or circumvent any security feature, authentication system, or access control mechanism of the Platform'],
                ['Traffic Interception:', 'Intercept, monitor, or analyze network traffic between the Platform and its servers for any unauthorized purpose'],
              ].map(([label, desc], i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#dc2626', fontSize: 13, top: 3 }}>✗</span>
                  <strong>{label}</strong> {desc}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>4.2 — Prohibited Copying and Replication</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                ['Template Copying:', "Copy, reproduce, or replicate proposal templates, report formats, system design layouts, or any other Output format for use outside the Platform or for incorporation into competing systems"],
                ['Workflow Documentation:', "Document, transcribe, map, or systematically record the Platform's workflows, processes, decision logic, or user interface flows for purposes beyond authorized personal use"],
                ['Code Reproduction:', 'Copy any portion of the Platform\'s code, configuration, or logic, whether by direct access, screen capture, or any other method'],
                ['Database Extraction:', 'Extract, export, or replicate any dataset, database content, or data structure from the Platform for unauthorized use'],
              ].map(([label, desc], i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#dc2626', fontSize: 13, top: 3 }}>✗</span>
                  <strong>{label}</strong> {desc}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>4.3 — Prohibited Competitive Activities</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                ['Competing Platform Development:', 'Use access to the Platform, its Outputs, or your knowledge of its Proprietary Technology to develop, build, design, fund, or assist in the creation of any competing software platform, tool, or service that performs any of the same or substantially similar functions as the Platform'],
                ['Feature Benchmarking:', 'Access the Platform primarily for the purpose of competitive intelligence, feature benchmarking, or technology assessment for a competing product'],
                ["Competitive Assistance:", "Share information about the Platform's Proprietary Technology, workflows, or Outputs with any person or entity developing or operating a competing product"],
              ].map(([label, desc], i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#dc2626', fontSize: 13, top: 3 }}>✗</span>
                  <strong>{label}</strong> {desc}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>4.4 — Prohibited Distribution</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                ['Screenshots and Recordings:', "Distribute, publish, post, or share screenshots, screen recordings, or other visual captures of the Platform's internal interfaces, workflows, calculation results, or engineering logic to any third party outside of your own organization's internal use"],
                ['Output Redistribution:', 'Sell, license, sublicense, transfer, or commercially redistribute Platform Outputs without written authorization from the Owner'],
                ['Unauthorized Access Grants:', 'Share your account credentials or provide access to the Platform to any person or entity not authorized under your subscription'],
              ].map(([label, desc], i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#dc2626', fontSize: 13, top: 3 }}>✗</span>
                  <strong>{label}</strong> {desc}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '20px 24px', margin: '20px 0' }}>
            <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#7f1d1d', margin: 0, lineHeight: 1.65 }}>
              <strong>Enforcement:</strong> Any violation of the restrictions set forth in this Section 4 constitutes a material breach of this Agreement and will result in immediate account termination, pursuit of injunctive relief, and civil damages to the full extent permitted by law. The Owner reserves all rights to pursue criminal prosecution for trade secret misappropriation under the Defend Trade Secrets Act, 18 U.S.C. § 1836, and the Illinois Trade Secrets Act, 765 ILCS 1065.
            </p>
          </div>
        </section>

        {/* ── SECTION 5: LIMITED LICENSE ── */}
        <section id="license" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 5</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>📋 Limited License</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>5.1 — Grant of License</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              Subject to your full and ongoing compliance with this Agreement, Raymond O&apos;Brian, through Under The Sun Solar, grants you a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to access and use the Platform solely for your internal business purposes in connection with the installation, sale, design, and project management of solar energy systems. This license is personal to you and your authorized organization and may not be assigned or transferred.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>5.2 — Scope of Permitted Use</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              Your licensed use of the Platform is limited to the following activities:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'Uploading client utility bills for energy usage analysis',
                'Generating solar system sizing recommendations for your clients',
                'Creating and delivering sales proposals to prospective solar customers',
                "Managing your organization's solar project pipeline and client data",
                'Accessing engineering preparation workflows for projects you manage',
                'Generating and downloading proposal documents for direct client delivery',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#16a34a', fontSize: 13, top: 3 }}>✓</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>5.3 — Revocability</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              This license is revocable at any time, with or without cause, at the sole discretion of Raymond O&apos;Brian or Under The Sun Solar. Revocation of your license results in immediate termination of your right to access and use the Platform. Raymond O&apos;Brian expressly reserves all rights in and to the Platform not expressly granted in this Section 5.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>5.4 — No Implied Rights</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              Nothing in this Agreement shall be construed to grant you any rights in the Platform other than the limited license expressly set forth in Section 5.1. No implied licenses are granted. The license does not include the right to modify, adapt, translate, create derivative works from, or prepare improvements to the Platform or any component thereof.
            </p>
          </div>
        </section>

        {/* ── SECTION 6: PROTECTION OF AUTOMATED OUTPUTS ── */}
        <section id="outputs" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 6</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>⚙️ Protection of Automated Outputs</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>6.1 — Ownership of Outputs</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              All Outputs generated by the Platform, including but not limited to solar system proposals, system design specifications, energy calculations, financial projections, equipment bill-of-materials, engineering workflow documents, and permit preparation packages, are produced by Proprietary Technology owned exclusively by Raymond O&apos;Brian. The format, structure, methodology, and logic embodied in such Outputs remain the confidential and proprietary intellectual property of the Owner, regardless of whether the Output incorporates your client&apos;s data.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>6.2 — Limited Rights in Outputs</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              You are granted a limited, non-exclusive right to use, present, and deliver specific Outputs to your own clients solely in connection with the solar installation projects for which they were generated. This limited right does not extend to:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'Using Output formats or templates as the basis for any other software system or tool',
                'Reverse engineering the calculation methodology embodied in any Output',
                'Reproducing Output templates or structural formats in any competing product',
                'Sublicensing, selling, or commercially distributing Outputs independent of the solar installation services you provide',
                'Publishing Outputs or Output formats in any public forum, academic paper, or industry publication without written consent',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#dc2626', fontSize: 13, top: 3 }}>✗</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>6.3 — Confidentiality of Output Methodology</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The algorithms, models, data sources, and engineering logic that produce Platform Outputs constitute trade secrets of Raymond O&apos;Brian. You agree not to analyze, deconstruct, or attempt to replicate the methodology by which Outputs are produced, including through repeated testing, statistical analysis of results, or comparison with other tools or methodologies.
            </p>
          </div>
        </section>

        <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '48px 0' }} />

        {/* ── SECTION 7: ENGINEERING DISCLAIMER ── */}
        <section id="disclaimer" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 7</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>⚠️ Engineering &amp; Proposal Disclaimer</h2>

          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderLeft: '4px solid #dc2626', borderRadius: 8, padding: '20px 24px', margin: '20px 0' }}>
            <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#7f1d1d', margin: 0, lineHeight: 1.65 }}>
              <strong>Important:</strong> All calculations, system designs, proposals, and engineering recommendations generated by SolarPro are automated estimates for informational and sales purposes only. They do not constitute licensed engineering advice, certified design documents, or final project specifications.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>7.1 — Informational Estimates Only</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              All solar system sizing calculations, energy production estimates, financial projections, payback analyses, equipment specifications, and related Outputs produced by the Platform are automated informational estimates based on generalized models, publicly available data, and the information you provide. They are not, and shall not be construed as, certified engineering documents, licensed structural calculations, code-compliant design drawings, or professional engineering opinions.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>7.2 — Installer Responsibility</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              The installer, contractor, or solar professional using the Platform bears sole and exclusive responsibility for:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'Conducting all site-specific engineering assessments and structural evaluations required for the actual installation',
                'Verifying that the proposed system design complies with all applicable federal, state, and local building codes, electrical codes, fire codes, and utility interconnection requirements',
                'Obtaining all required permits, licenses, inspections, and utility approvals prior to and following installation',
                'Engaging licensed engineers, electricians, and contractors as required by applicable law and project specifications',
                'Verifying the accuracy of all energy usage data, utility rate information, and financial assumptions before presenting proposals to clients',
                'Making final installation decisions based on independent professional judgment, not solely on Platform Outputs',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>7.3 — No Professional Relationship</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              Use of the Platform does not create any professional, fiduciary, engineering, legal, or advisory relationship between you, your clients, Raymond O&apos;Brian, or Under The Sun Solar. No Output from the Platform should be relied upon as the sole basis for any installation, permitting, or financial decision.
            </p>
          </div>
        </section>

        {/* ── SECTION 8: ACCOUNT TERMINATION ── */}
        <section id="termination" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 8</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>🔑 Account Termination</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>8.1 — Termination for Cause</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              Raymond O&apos;Brian and Under The Sun Solar reserve the right, in their sole discretion, to immediately suspend, restrict, or permanently terminate your account and access to the Platform, without prior notice and without liability to you, upon the occurrence of any of the following:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'Any actual or suspected violation of this Agreement, including any breach of the confidentiality or use restriction provisions',
                'Any actual or suspected reverse engineering, data scraping, unauthorized access, or competitive misappropriation of Platform technology',
                'Non-payment of applicable subscription fees or chargebacks',
                'Use of the Platform for any unlawful purpose or in violation of any applicable law or regulation',
                'Provision of false, inaccurate, or misleading information during account registration or use',
                "Any conduct that, in the Owner's or Operator's reasonable judgment, could harm the Platform, other users, or the business interests of Raymond O'Brian or Under The Sun Solar",
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>8.2 — Termination for Convenience</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              Either party may terminate this Agreement for any reason upon written notice. You may close your account at any time through the Platform settings. Raymond O&apos;Brian or Under The Sun Solar may terminate any account with or without cause upon reasonable notice, except where immediate termination is warranted under Section 8.1.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>8.3 — Effect of Termination</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              Upon termination of your account for any reason: (a) your license to use the Platform immediately ceases; (b) you must immediately cease all use of the Platform and destroy any copies of Confidential Information in your possession; (c) the following provisions of this Agreement survive indefinitely: Section 2 (Ownership), Section 3 (Confidentiality), Section 4 (Restrictions), Section 6 (Output Protection), Section 10 (Limitation of Liability), and Section 12 (Governing Law).
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>8.4 — Data Retention Post-Termination</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              Upon account termination, we may retain your project and usage data for up to ninety (90) days to allow you to request an export of your non-proprietary data. After this period, your data may be permanently deleted. We reserve the right to retain anonymized, aggregated data for platform improvement purposes in accordance with Section 10.
            </p>
          </div>
        </section>

        {/* ── SECTION 9: LIMITATION OF LIABILITY ── */}
        <section id="liability" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 9</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>⚖️ Limitation of Liability</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>9.1 — Disclaimer of Warranties</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              THE PLATFORM IS PROVIDED ON AN &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; BASIS WITHOUT ANY WARRANTY OF ANY KIND, EXPRESS OR IMPLIED. TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, RAYMOND O&apos;BRIAN AND UNDER THE SUN SOLAR EXPRESSLY DISCLAIM ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND ANY WARRANTIES ARISING FROM COURSE OF DEALING OR USAGE OF TRADE.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>9.2 — Exclusion of Consequential Damages</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL RAYMOND O&apos;BRIAN, UNDER THE SUN SOLAR, OR THEIR RESPECTIVE OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, OR LICENSORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'Financial losses or lost profits arising from reliance on Platform Outputs or proposals',
                'Errors in solar system sizing, energy production estimates, or financial projections',
                'Installation defects, structural failures, or code violations arising from or related to Platform Outputs',
                'Permitting delays, regulatory non-compliance, or utility interconnection failures',
                'Loss of client contracts, business opportunities, or reputation resulting from Platform use',
                'Data loss, system downtime, or Platform unavailability',
                'Any third-party claims arising from your use of Platform Outputs',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>9.3 — Cap on Liability</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE TOTAL CUMULATIVE LIABILITY OF RAYMOND O&apos;BRIAN AND UNDER THE SUN SOLAR FOR ANY CLAIMS ARISING OUT OF OR RELATING TO THIS AGREEMENT OR YOUR USE OF THE PLATFORM, REGARDLESS OF THE FORM OF ACTION, SHALL NOT EXCEED THE TOTAL AMOUNT PAID BY YOU TO UNDER THE SUN SOLAR IN THE THREE (3) MONTHS IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>9.4 — Basis of the Bargain</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              You acknowledge that Raymond O&apos;Brian and Under The Sun Solar have relied on the limitations of liability set forth in this Section 9 as a material basis for determining the consideration to charge for your access to the Platform, and that such limitations form an essential element of the basis of the bargain between the parties.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>9.5 — Indemnification</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              You agree to defend, indemnify, and hold harmless Raymond O&apos;Brian, Under The Sun Solar, and their respective officers, directors, employees, agents, contractors, and successors from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys&apos; fees) arising out of or relating to: (a) your use of or access to the Platform; (b) your violation of this Agreement; (c) your violation of any applicable law or regulation; (d) your reliance on Platform Outputs for installation, permitting, or client-facing decisions; or (e) any claim by a third party arising from your use of the Platform.
            </p>
          </div>
        </section>

        {/* ── SECTION 10: DATA USAGE & PRIVACY ── */}
        <section id="data" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 10</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>🗄️ Data Usage &amp; Privacy</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>10.1 — Data You Provide</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              In the course of using the Platform, you may submit client utility bills, project addresses, energy usage data, customer information, and other materials (&quot;User Data&quot;). You represent and warrant that you have obtained all necessary consents and permissions to submit such data to the Platform and to authorize the processing described in this Section.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>10.2 — How We Use Your Data</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              User Data submitted to the Platform may be used for the following purposes:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'Processing your requests and generating Outputs as described in this Agreement',
                'Storing your project data to enable project management features',
                'Improving Platform accuracy, algorithms, and features through aggregated, anonymized analysis',
                'Maintaining security, preventing fraud, and ensuring Platform integrity',
                'Complying with legal obligations and responding to lawful government requests',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>10.3 — Data Security</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              We implement industry-standard technical and organizational measures to protect User Data against unauthorized access, disclosure, alteration, or destruction. However, no method of electronic transmission or storage is completely secure, and we cannot guarantee absolute security. You are responsible for maintaining the confidentiality of your account credentials.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>10.4 — Third-Party Services</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The Platform may utilize third-party service providers (including but not limited to cloud infrastructure providers, database services, AI model providers, and payment processors) to deliver its features. Such providers are contractually bound to maintain appropriate data protections. We are not responsible for the privacy practices of third-party services beyond our contractual obligations with them.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>10.5 — Data Ownership</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              You retain ownership of the raw client data you submit to the Platform (e.g., your clients&apos; utility bills and contact information). The Owner retains all rights in the Outputs produced by the Platform&apos;s Proprietary Technology, including the formats, structures, and methodology embodied therein.
            </p>
          </div>
        </section>

        {/* ── SECTION 11: UPDATES TO TERMS ── */}
        <section id="updates" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 11</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>🔄 Updates to Terms</h2>

          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            Raymond O&apos;Brian and Under The Sun Solar reserve the right to modify, amend, or update this Agreement at any time in their sole discretion. Changes to this Agreement are effective upon posting to the Platform or as otherwise specified at the time of posting.
          </p>
          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            When material changes are made to this Agreement, we will notify you by one or more of the following methods: (a) displaying a prominent notice within the Platform; (b) sending an email to the address associated with your account; or (c) requiring you to re-acknowledge the updated Agreement upon your next login.
          </p>

          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderLeft: '4px solid #0284c7', borderRadius: 8, padding: '20px 24px', margin: '20px 0' }}>
            <p style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#0c4a6e', margin: 0, lineHeight: 1.65 }}>
              <strong>Continued Use = Acceptance:</strong> Your continued access to or use of the Platform after updated Terms have been posted constitutes your binding acceptance of the modified Agreement. If you do not agree to the updated Terms, you must immediately cease all use of the Platform and close your account.
            </p>
          </div>

          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginTop: 16 }}>
            We encourage you to review this Agreement periodically. The &quot;Last Updated&quot; date at the top of this document indicates when the most recent changes were made. Historical versions of the Agreement may be made available upon written request.
          </p>
        </section>

        {/* ── SECTION 12: GOVERNING LAW ── */}
        <section id="governing-law" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 12</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>⚖️ Governing Law &amp; Dispute Resolution</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>12.1 — Governing Law</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              This Agreement and all disputes, claims, or controversies arising out of or relating to this Agreement, the Platform, or your use thereof shall be governed by and construed in accordance with the laws of the <strong>State of Illinois, United States of America</strong>, without regard to its conflict of law principles.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>12.2 — Jurisdiction and Venue</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              You irrevocably consent to the exclusive personal jurisdiction and venue of the state and federal courts located within the State of Illinois for the resolution of any dispute arising under or in connection with this Agreement, and you waive any objection to the laying of venue of any such proceeding in such courts. You also waive any objection that such courts are an inconvenient forum.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>12.3 — Applicable Statutes</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              Without limiting the generality of Section 12.1, the parties acknowledge that the following statutes may apply to disputes arising under this Agreement:
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
              {[
                'The Illinois Trade Secrets Act, 765 ILCS 1065/1 et seq.',
                'The federal Defend Trade Secrets Act of 2016, 18 U.S.C. § 1836 et seq.',
                'The Computer Fraud and Abuse Act, 18 U.S.C. § 1030',
                'The Illinois Consumer Fraud and Deceptive Business Practices Act, 815 ILCS 505/1',
                'Applicable federal copyright law under Title 17 of the United States Code',
              ].map((item, i) => (
                <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                  <span style={{ position: 'absolute', left: 0, color: '#f97316', fontSize: 12, top: 4 }}>▸</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>12.4 — Waiver of Jury Trial</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, EACH PARTY HEREBY IRREVOCABLY WAIVES ANY AND ALL RIGHTS TO A TRIAL BY JURY IN ANY LEGAL PROCEEDING ARISING OUT OF OR RELATING TO THIS AGREEMENT OR THE TRANSACTIONS CONTEMPLATED HEREBY.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>12.5 — Class Action Waiver</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              You agree that any dispute resolution proceedings will be conducted only on an individual basis and not in a class, consolidated, or representative action. You waive any right to participate in a class action lawsuit or class-wide arbitration against Raymond O&apos;Brian or Under The Sun Solar.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>12.6 — Attorneys&apos; Fees</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              In any action to enforce the terms of this Agreement, the prevailing party shall be entitled to recover its reasonable attorneys&apos; fees, court costs, and other litigation expenses from the non-prevailing party.
            </p>
          </div>
        </section>

        {/* ── SECTION 13: ELECTRONIC ACCEPTANCE ── */}
        <section id="electronic-acceptance" style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 13</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>🖊️ Electronic Acceptance</h2>

          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            Pursuant to the Electronic Signatures in Global and National Commerce Act (15 U.S.C. § 7001, et seq.) and the Illinois Electronic Commerce Security Act (5 ILCS 175), your electronic acceptance of this Agreement during the account registration process constitutes a legally binding signature with the same legal force and effect as a handwritten signature on a paper agreement.
          </p>
          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            By checking the acceptance checkbox during account creation and clicking &quot;Create Account&quot; (or similar affirmative action), you are electronically signing this Agreement and acknowledging that:
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 16px 0' }}>
            {[
              'You have read and understood this Agreement in its entirety',
              'You agree to be legally bound by all terms and conditions contained herein',
              'You are authorized to enter into this Agreement on behalf of yourself and, where applicable, your organization',
              'You understand that violation of this Agreement may result in civil and criminal liability',
              'You consent to receive Agreement updates electronically and acknowledge that continued Platform use after updates constitutes acceptance',
            ].map((item, i) => (
              <li key={i} style={{ position: 'relative', paddingLeft: 22, marginBottom: 10, fontSize: 15.5, color: '#1e293b', lineHeight: 1.7, fontFamily: 'Georgia, serif' }}>
                <span style={{ position: 'absolute', left: 0, color: '#16a34a', fontSize: 13, top: 3 }}>✓</span>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: 16, color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
            A record of your acceptance, including the date, time, and version of this Agreement accepted, will be maintained by the Platform and may be used as evidence in any dispute arising under this Agreement.
          </p>
        </section>

        {/* ── SECTION 14: MISCELLANEOUS ── */}
        <section style={{ marginBottom: 52, scrollMarginTop: 24 }}>
          <span style={{ display: 'inline-block', fontFamily: 'Arial, sans-serif', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' as const, color: '#f97316', marginBottom: 6 }}>Section 14</span>
          <h2 style={{ fontFamily: 'Arial, sans-serif', fontSize: 20, fontWeight: 800, color: '#0a1628', marginBottom: 16, paddingBottom: 12, borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>📌 Miscellaneous Provisions</h2>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>14.1 — Entire Agreement</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              This Agreement, together with any supplemental policies or agreements incorporated herein by reference, constitutes the entire agreement between you and Raymond O&apos;Brian and Under The Sun Solar with respect to the subject matter hereof, and supersedes all prior and contemporaneous understandings, agreements, representations, and warranties, whether written or oral.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>14.2 — Severability</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              If any provision of this Agreement is held by a court of competent jurisdiction to be invalid, illegal, or unenforceable, such provision shall be modified to the minimum extent necessary to make it enforceable, and the remaining provisions of this Agreement shall continue in full force and effect.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>14.3 — No Waiver</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8 }}>
              The failure of Raymond O&apos;Brian or Under The Sun Solar to enforce any right or provision of this Agreement shall not constitute a waiver of such right or provision. No waiver of any term of this Agreement shall be deemed a further or continuing waiver of such term or any other term.
            </p>
          </div>

          <div style={{ marginTop: 20, marginBottom: 20 }}>
            <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 14, fontWeight: 700, color: '#1e293b', textTransform: 'uppercase' as const, letterSpacing: '0.06em', marginBottom: 10 }}>14.4 — Contact Information</div>
            <p style={{ color: '#1e293b', fontSize: 15.5, fontFamily: 'Georgia, serif', lineHeight: 1.8, marginBottom: 8 }}>
              For legal notices, questions about this Agreement, or to report violations, please contact:
            </p>
            <div style={{ marginLeft: 20, marginTop: 8, fontFamily: 'Arial, sans-serif', fontSize: 14, color: '#475569', lineHeight: 2 }}>
              <strong>Under The Sun Solar</strong><br />
              Attention: Legal / Compliance<br />
              Platform: SolarPro<br />
              Jurisdiction: State of Illinois, United States<br />
              Email: <em>[legal contact email to be inserted]</em>
            </div>
          </div>
        </section>

        {/* Back to signup link if coming from signup */}
        {fromSignup && (
          <div style={{ textAlign: 'center', marginTop: 40, marginBottom: 20 }}>
            <Link
              href="/signup"
              style={{
                display: 'inline-block',
                background: '#f97316', color: '#fff',
                padding: '12px 32px', borderRadius: 8,
                fontFamily: 'Arial, sans-serif', fontWeight: 700,
                fontSize: 15, textDecoration: 'none',
              }}
            >
              ← Return to Sign Up
            </Link>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer style={{
        background: '#0a1628', color: 'rgba(255,255,255,0.55)',
        padding: 32, textAlign: 'center' as const,
        fontFamily: 'Arial, sans-serif', fontSize: 12, lineHeight: 2,
      }}>
        <p>
          <strong style={{ color: 'rgba(255,255,255,0.85)' }}>SolarPro</strong> — Proprietary Platform &nbsp;|&nbsp;
          Operated by <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Under The Sun Solar</strong> &nbsp;|&nbsp;
          Intellectual Property of <strong style={{ color: 'rgba(255,255,255,0.85)' }}>Raymond O&apos;Brian</strong>
        </p>
        <p style={{ marginTop: 6 }}>
          © 2026 Raymond O&apos;Brian. All rights reserved. &nbsp;|&nbsp;
          Governed by the laws of the State of Illinois &nbsp;|&nbsp;
          Effective: March 13, 2026
        </p>
        <p style={{ marginTop: 6, fontSize: 11 }}>
          This document is available at: <strong style={{ color: 'rgba(255,255,255,0.85)' }}>/terms</strong> &nbsp;·&nbsp; <strong style={{ color: 'rgba(255,255,255,0.85)' }}>/confidentiality</strong>
        </p>
      </footer>
    </div>
  )
}

export default function TermsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-gray-500 font-sans">Loading Terms of Service...</div>
      </div>
    }>
      <TermsContent />
    </Suspense>
  )
}