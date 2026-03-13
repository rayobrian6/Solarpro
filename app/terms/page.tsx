'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle, Shield, FileText, ArrowRight, Sun, AlertTriangle } from 'lucide-react';
import Link from 'next/link';

// Current ToS version — must match CURRENT_TOS_VERSION in /api/tos-accept/route.ts
const CURRENT_TOS_VERSION = 'v1.0';

export default function TermsPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const required     = searchParams.get('required') === '1';
  const redirectTo   = searchParams.get('redirect') || '/dashboard';

  const [status,    setStatus]    = useState<'loading' | 'accepted' | 'pending'>('loading');
  const [accepting, setAccepting] = useState(false);
  const [error,     setError]     = useState('');
  const [accepted,  setAccepted]  = useState(false);
  const [acceptedAt, setAcceptedAt] = useState<string | null>(null);

  // Check existing acceptance status on mount
  useEffect(() => {
    fetch('/api/tos-accept', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (data.success && data.accepted && !data.needs_reaccept) {
          setStatus('accepted');
          setAcceptedAt(data.tos_accepted_at);
        } else {
          setStatus('pending');
        }
      })
      .catch(() => setStatus('pending'));
  }, []);

  const handleAccept = async () => {
    setAccepting(true);
    setError('');
    try {
      const res = await fetch('/api/tos-accept', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ version: CURRENT_TOS_VERSION }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to record acceptance. Please try again.');
        setAccepting(false);
        return;
      }
      setAccepted(true);
      setAcceptedAt(data.tos_accepted_at);
      setStatus('accepted');
      // Redirect after short delay so user sees confirmation
      setTimeout(() => router.push(redirectTo), 1500);
    } catch {
      setError('Network error. Please check your connection and try again.');
      setAccepting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/dashboard" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="w-8 h-8 rounded-lg solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={16} className="text-slate-900" />
            </div>
            <span className="font-black text-white text-base">SolarPro</span>
          </Link>
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <FileText size={14} />
            <span>Terms of Service &amp; Confidentiality Agreement</span>
          </div>
        </div>
      </header>

      {/* ── Required banner ────────────────────────────────────────── */}
      {required && status === 'pending' && (
        <div className="bg-amber-500/10 border-b border-amber-500/30">
          <div className="max-w-4xl mx-auto px-6 py-3 flex items-center gap-3">
            <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
            <p className="text-amber-300 text-sm font-medium">
              Please read and accept the Terms of Service to continue using SolarPro.
            </p>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-12">

        {/* ── Title block ──────────────────────────────────────────── */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
              <Shield size={20} className="text-amber-400" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-white">Terms of Service &amp; Confidentiality Agreement</h1>
              <p className="text-slate-500 text-xs mt-0.5">SolarPro Platform — Version {CURRENT_TOS_VERSION} — Effective March 13, 2026</p>
            </div>
          </div>
          <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">
            This agreement governs your use of the SolarPro platform operated by{' '}
            <span className="text-white font-medium">Under The Sun Solar</span> and owned by{' '}
            <span className="text-white font-medium">Raymond O&apos;Brian</span>.
            Please read carefully before using the platform.
          </p>
        </div>

        {/* ── Already accepted banner ──────────────────────────────── */}
        {status === 'accepted' && !accepted && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-6 py-4 mb-8 flex items-center gap-4">
            <CheckCircle size={24} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-emerald-300 font-semibold text-sm">You have already accepted this agreement</p>
              {acceptedAt && (
                <p className="text-emerald-500 text-xs mt-0.5">
                  Accepted on {new Date(acceptedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
            <Link href="/dashboard" className="ml-auto btn-primary text-sm px-4 py-2 flex items-center gap-2">
              Go to Dashboard <ArrowRight size={14} />
            </Link>
          </div>
        )}

        {/* ── Acceptance confirmation flash ────────────────────────── */}
        {accepted && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-6 py-4 mb-8 flex items-center gap-4">
            <CheckCircle size={24} className="text-emerald-400 flex-shrink-0" />
            <div>
              <p className="text-emerald-300 font-semibold text-sm">Agreement accepted — redirecting you now…</p>
              <p className="text-emerald-500 text-xs mt-0.5">Thank you. Your acceptance has been recorded.</p>
            </div>
          </div>
        )}

        {/* ── ToS Content ──────────────────────────────────────────── */}
        <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl overflow-hidden mb-8">
          <div className="p-8 space-y-8 text-sm text-slate-300 leading-relaxed max-h-[70vh] overflow-y-auto custom-scroll">

            {/* Section 1 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§1</span>
                Acceptance of Terms
              </h2>
              <p>By accessing, registering for, or using the SolarPro platform ("Platform"), you ("User") agree to be legally bound by these Terms of Service and Confidentiality Agreement ("Agreement"). If you do not agree, you must not access or use the Platform. Use of the Platform constitutes electronic acceptance under the Electronic Signatures in Global and National Commerce Act (E-SIGN Act), 15 U.S.C. § 7001, and the Illinois Electronic Commerce Security Act, 5 ILCS 175.</p>
            </section>

            {/* Section 2 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§2</span>
                Ownership of Intellectual Property
              </h2>
              <p>All source code, algorithms, data models, machine learning logic, design assets, engineering calculation engines, user interface designs, system architectures, and derivative works embodied in or arising from the SolarPro Platform are the exclusive property of <strong className="text-white">Raymond O&apos;Brian</strong> ("Owner"). Under The Sun Solar serves as the operating entity for commercial deployment. Nothing in this Agreement transfers any intellectual property rights to the User. All rights not expressly granted herein are reserved by the Owner.</p>
            </section>

            {/* Section 3 — NDA */}
            <section className="bg-slate-800/80 border border-amber-500/20 rounded-xl p-6">
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§3</span>
                Confidentiality &amp; Non-Disclosure Agreement
              </h2>
              <p className="mb-3">In connection with your use of the Platform, you may have access to Confidential Information, including but not limited to: proprietary solar engineering algorithms, calculation methodologies, pricing engines, system design logic, customer data, business strategies, technical architectures, and non-public platform features ("Confidential Information").</p>
              <p className="mb-3"><strong className="text-white">Non-Disclosure Obligation:</strong> You agree to hold all Confidential Information in strict confidence using at least the same degree of care you use to protect your own confidential information (but no less than reasonable care), and not to disclose any Confidential Information to any third party without the prior written consent of the Owner.</p>
              <p className="mb-3"><strong className="text-white">Non-Use Obligation:</strong> You agree not to use Confidential Information for any purpose other than your authorized use of the Platform for your internal business operations.</p>
              <p className="mb-3"><strong className="text-white">Duration:</strong> Your confidentiality obligations survive termination of this Agreement indefinitely with respect to trade secrets, and for a period of five (5) years with respect to other Confidential Information.</p>
              <p className="mb-3"><strong className="text-white">Injunctive Relief:</strong> You acknowledge that breach of this Section would cause irreparable harm to the Owner for which monetary damages would be inadequate. The Owner shall be entitled to seek injunctive relief without bond in addition to all other remedies at law or equity.</p>
              <p><strong className="text-white">Protected Under:</strong> Illinois Trade Secrets Act (765 ILCS 1065), Defend Trade Secrets Act (18 U.S.C. § 1836), and Computer Fraud and Abuse Act (18 U.S.C. § 1030).</p>
            </section>

            {/* Section 4 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§4</span>
                Restrictions on Use
              </h2>
              <p className="mb-2">You agree not to, directly or indirectly:</p>
              <ul className="list-disc list-inside space-y-1 text-slate-400 ml-2">
                <li>Reverse engineer, decompile, disassemble, or attempt to derive the source code of the Platform</li>
                <li>Scrape, crawl, or extract data from the Platform by automated means</li>
                <li>Use Platform outputs to build, train, or inform a competing product or service</li>
                <li>Share login credentials or allow unauthorized users to access your account</li>
                <li>Reproduce, redistribute, sublicense, sell, or transfer the Platform or any component thereof</li>
                <li>Use the Platform for any unlawful purpose or in violation of applicable laws</li>
                <li>Circumvent, disable, or interfere with security-related features of the Platform</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§5</span>
                Limited License
              </h2>
              <p>Subject to your compliance with this Agreement, the Owner grants you a limited, non-exclusive, non-transferable, revocable license to access and use the Platform solely for your internal business operations as a licensed solar installer or sales professional. This license does not include any right to sublicense, resell, or make the Platform available to third parties.</p>
            </section>

            {/* Section 6 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§6</span>
                Protection of Automated Outputs
              </h2>
              <p>All proposals, system designs, financial projections, engineering calculations, single-line diagrams, and other outputs generated by the Platform ("Outputs") are derived from proprietary algorithms owned by Raymond O&apos;Brian. Outputs may be used by Users for client-facing sales and installation purposes only. Users may not reproduce, redistribute, or commercialize Outputs outside of normal sales activities without prior written consent from the Owner.</p>
            </section>

            {/* Section 7 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§7</span>
                Engineering &amp; Proposal Disclaimer
              </h2>
              <p>All engineering calculations, system sizing recommendations, energy production estimates, financial projections, and permitting-related outputs provided by the Platform are for informational and pre-sales estimation purposes only. They do not constitute licensed professional engineering advice. The licensed solar installer is solely responsible for verifying all calculations, ensuring code compliance, obtaining permits, and performing safe installation. Under The Sun Solar and Raymond O&apos;Brian disclaim all liability for losses arising from reliance on Platform outputs without independent verification.</p>
            </section>

            {/* Section 8 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§8</span>
                Account Termination
              </h2>
              <p>The Owner may suspend or terminate your account immediately and without notice for any material breach of this Agreement, including unauthorized use, disclosure of Confidential Information, or violation of the restrictions in Section 4. Upon termination, all licenses granted herein cease immediately. User data will be retained for up to ninety (90) days following termination, after which it may be permanently deleted. The Owner is not liable for any losses arising from account termination for cause.</p>
            </section>

            {/* Section 9 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§9</span>
                Limitation of Liability
              </h2>
              <p className="mb-2">THE PLATFORM IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.</p>
              <p>TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL RAYMOND O&apos;BRIAN OR UNDER THE SUN SOLAR BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATED TO YOUR USE OF THE PLATFORM. THE AGGREGATE LIABILITY OF THE OWNER SHALL NOT EXCEED THE GREATER OF (A) THE FEES PAID BY YOU IN THE THREE (3) MONTHS PRECEDING THE CLAIM OR (B) ONE HUNDRED DOLLARS ($100).</p>
            </section>

            {/* Section 10 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§10</span>
                Data Usage &amp; Privacy
              </h2>
              <p>You retain ownership of all customer data you input into the Platform. You grant the Owner a limited license to process such data solely to provide the Platform services. The Owner will not sell your customer data to third parties. Usage data, aggregated analytics, and system performance metrics may be used to improve the Platform. The Owner implements industry-standard security measures to protect data in transit and at rest.</p>
            </section>

            {/* Section 11 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§11</span>
                Updates to Terms
              </h2>
              <p>The Owner reserves the right to modify this Agreement at any time. Material changes will be communicated via email or in-platform notification. Continued use of the Platform after the effective date of a revised Agreement constitutes your acceptance of the revised terms. If you do not agree to material changes, you must cease using the Platform.</p>
            </section>

            {/* Section 12 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§12</span>
                Governing Law &amp; Dispute Resolution
              </h2>
              <p className="mb-2">This Agreement is governed by the laws of the State of Illinois, without regard to its conflict of law principles. Any dispute arising out of or relating to this Agreement shall be resolved exclusively in the state or federal courts located in Illinois, and you consent to personal jurisdiction therein.</p>
              <p className="mb-2"><strong className="text-white">Jury Trial Waiver:</strong> TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, BOTH PARTIES WAIVE THE RIGHT TO A JURY TRIAL IN ANY DISPUTE ARISING FROM THIS AGREEMENT.</p>
              <p><strong className="text-white">Class Action Waiver:</strong> You agree to resolve any dispute on an individual basis only and waive the right to participate in any class action, class arbitration, or representative proceeding.</p>
            </section>

            {/* Section 13 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§13</span>
                Electronic Acceptance
              </h2>
              <p>By clicking "I Accept" or by checking the acceptance checkbox during account registration, you acknowledge that you have read, understood, and agree to be legally bound by this Agreement. Your electronic acceptance constitutes a valid and enforceable signature under the E-SIGN Act (15 U.S.C. § 7001) and the Illinois Electronic Commerce Security Act (5 ILCS 175). The date, time, and version of acceptance are recorded in the SolarPro database and constitute the authoritative record of your acceptance.</p>
            </section>

            {/* Section 14 */}
            <section>
              <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                <span className="text-amber-400 text-xs font-black uppercase tracking-widest">§14</span>
                Miscellaneous
              </h2>
              <p className="mb-2"><strong className="text-white">Entire Agreement:</strong> This Agreement constitutes the entire agreement between you and the Owner regarding its subject matter and supersedes all prior agreements, understandings, and representations.</p>
              <p className="mb-2"><strong className="text-white">Severability:</strong> If any provision of this Agreement is held invalid or unenforceable, the remaining provisions shall continue in full force and effect.</p>
              <p className="mb-2"><strong className="text-white">No Waiver:</strong> Failure by the Owner to enforce any provision of this Agreement shall not constitute a waiver of the Owner&apos;s right to enforce it in the future.</p>
              <p><strong className="text-white">Contact:</strong> Questions regarding this Agreement may be directed to Under The Sun Solar.</p>
            </section>

            <div className="border-t border-slate-700 pt-6 text-xs text-slate-600">
              <p>SolarPro Terms of Service &amp; Confidentiality Agreement — Version {CURRENT_TOS_VERSION}</p>
              <p>Owner: Raymond O&apos;Brian | Operator: Under The Sun Solar | Jurisdiction: Illinois</p>
              <p>Effective Date: March 13, 2026</p>
            </div>

          </div>
        </div>

        {/* ── Accept Block ─────────────────────────────────────────── */}
        {status === 'pending' && !accepted && (
          <div className="bg-slate-900/60 border border-slate-700/50 rounded-2xl p-6 mb-8">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <p className="text-white font-semibold text-sm mb-1">Ready to accept this agreement?</p>
                <p className="text-slate-400 text-xs leading-relaxed">
                  By clicking <strong className="text-amber-400">"I Accept the Terms of Service &amp; Confidentiality Agreement"</strong>,
                  you confirm you have read and agree to all sections above. Your acceptance is recorded with a timestamp
                  and is legally binding under Illinois law and the E-SIGN Act.
                </p>
              </div>
            </div>

            {error && (
              <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div className="mt-5 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleAccept}
                disabled={accepting}
                className="btn-primary py-3 px-6 text-sm font-bold flex items-center justify-center gap-2 flex-1 sm:flex-none"
              >
                {accepting ? (
                  <><span className="spinner w-4 h-4" /> Recording acceptance…</>
                ) : (
                  <><CheckCircle size={16} /> I Accept the Terms of Service &amp; Confidentiality Agreement</>
                )}
              </button>
              {!required && (
                <Link
                  href="/dashboard"
                  className="text-slate-500 hover:text-slate-300 text-sm text-center py-3 px-4 transition-colors"
                >
                  Decline — Go back
                </Link>
              )}
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────── */}
        <p className="text-center text-xs text-slate-700 pb-8">
          🔒 SolarPro v1.0 — Terms of Service &amp; Confidentiality Agreement — Under The Sun Solar — Illinois
        </p>

      </div>
    </div>
  );
}