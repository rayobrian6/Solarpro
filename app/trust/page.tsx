// Trust Center — public posture page at /trust. Server component; the only
// client island is the relative "last updated" stamp.
import type { Metadata } from 'next';
import { Shield, Clock, Calendar, Lock, Mail, FileText, Users, ArrowRight, AlertCircle, Database, KeyRound, ScanSearch, RefreshCw } from 'lucide-react';
import trust from '@/compliance/trust.json';
import { TrustClientStamp } from './TrustClientStamp';

export const metadata: Metadata = {
  title: 'Trust Center — Security & Compliance | SolarPro',
  description: 'SolarPro security and compliance posture: SOC 2, ISO 27001, ISO 27701, and ISO 27017 in progress, security practices, subprocessor list, and policies.',
};

const SECURITY_EMAIL = 'security@solarpro.app';
const POLICY_REQUEST_BODY = "Hi SolarPro security team,%0A%0AI'm completing a vendor security review and would like to request a copy of the following policies:%0A%0A[ ] Information Security%0A[ ] Acceptable Use%0A[ ] Access Control%0A[ ] Data Classification & Handling%0A[ ] Incident Response%0A[ ] Change Management%0A[ ] Vulnerability Management%0A[ ] Logging & Monitoring%0A[ ] Backup & Recovery%0A[ ] Vendor Risk Management%0A%0ACompany:%0AUse case:%0A%0AThanks!";
const SOC2_REQUEST_BODY = "Hi Solarpro security team,%0A%0AOur company is evaluating Solarpro and we'd like to request a copy of your most recent SOC 2 report under NDA.%0A%0ACompany:%0AProcurement contact:%0A%0AThanks!";
const VENDORS_CSV_URL = 'https://github.com/rayobrian6/Solarpro/blob/main/compliance/vendors.csv';

type FrameworkStatus = 'planned' | 'in_progress' | 'achieved';
const STATUS: Record<FrameworkStatus, { label: string; cls: string; dot: string }> = {
  achieved:    { label: 'Achieved',    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50 text-amber-800 border-amber-200',       dot: 'bg-amber-500' },
  planned:     { label: 'Planned',     cls: 'bg-slate-100 text-slate-700 border-slate-200',       dot: 'bg-slate-400' },
};

const PRACTICES: { icon: typeof Lock; title: string; detail: string }[] = [
  { icon: Lock,        title: 'Encryption at rest and in transit', detail: 'AES-256 at rest; TLS 1.2+ in transit.' },
  { icon: KeyRound,    title: 'MFA on all admin access',           detail: 'TOTP enforced for every admin account.' },
  { icon: Users,       title: 'Quarterly access reviews',          detail: 'Reviewed every 90 days; stale grants revoked.' },
  { icon: Database,    title: 'Daily encrypted backups',          detail: 'Point-in-time recovery; backups stored separately.' },
  { icon: ScanSearch,  title: 'Continuous vulnerability scanning', detail: 'Dependabot on every dependency; secret scanning on every commit.' },
  { icon: AlertCircle, title: 'Documented incident response plan', detail: 'Severity-graded playbooks; quarterly tabletop exercises.' },
  { icon: Mail,        title: '24-hour breach notification',       detail: 'Confirmed incidents reported to customers within 24 hours.' },
];

export default function TrustCenterPage() {
  const lastUpdated = new Date(trust.last_updated);
  const lastUpdatedLabel = lastUpdated.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Hero */}
      <section className="text-white" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #0f2044 60%, #1e3a5f 100%)', borderBottom: '3px solid #f97316' }}>
        <div className="max-w-5xl mx-auto px-6 pt-16 pb-14">
          <div className="inline-flex items-center gap-2 bg-amber-500/15 border border-amber-500/40 rounded-full px-3.5 py-1 text-[11px] font-bold tracking-widest uppercase text-amber-300 mb-6">
            <Shield size={13} /> Trust Center
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold leading-tight mb-4">Solarpro Security &amp; Compliance</h1>
          <p className="text-lg text-slate-300 max-w-3xl leading-relaxed">
            We&apos;re building toward SOC 2 Type 2, ISO 27001, ISO 27701, and ISO 27017. This page is the on-the-record summary of where we are today, what we already have in place, and what&apos;s next.
          </p>
          <p className="mt-6 text-xs text-slate-500 uppercase tracking-widest">
            <TrustClientStamp iso={trust.last_updated} fallback={lastUpdatedLabel} />
          </p>
        </div>
      </section>

      {/* Certifications in progress */}
      <section className="py-16 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Certifications in progress</h2>
          <p className="text-slate-600 mb-8 max-w-3xl">We publish the framework, current status, target window, and the evidence we have today. Updates land here as we ship, not on a marketing site six months later.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3 pr-4">Framework</th>
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3 pr-4">Status</th>
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3 pr-4">Target</th>
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3">Current evidence</th>
                </tr>
              </thead>
              <tbody>
                {trust.frameworks.map((fw) => {
                  const meta = STATUS[fw.status as FrameworkStatus];
                  return (
                    <tr key={fw.id} className="border-b border-slate-100 last:border-0 align-top">
                      <td className="py-4 pr-4 font-semibold text-slate-900">{fw.name}</td>
                      <td className="py-4 pr-4">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${meta.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-slate-700 whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><Calendar size={13} className="text-slate-400" />{fw.target}</span></td>
                      <td className="py-4 text-slate-600 leading-relaxed">{fw.evidence ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Security practices */}
      <section className="py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Security practices</h2>
          <p className="text-slate-600 mb-10 max-w-3xl">The controls already operating in production. None of these are aspirational.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {PRACTICES.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.title} className="flex gap-4 bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center"><Icon size={18} /></div>
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-1">{p.title}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{p.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Subprocessors */}
      <section className="py-16 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Subprocessors</h2>
          <p className="text-slate-600 mb-8 max-w-3xl">Third parties that process customer data on our behalf. We notify customers of material changes at least 30 days in advance.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3 pr-4">Subprocessor</th>
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3 pr-4">Purpose</th>
                  <th className="text-left font-semibold text-slate-500 uppercase tracking-wider text-xs py-3">Data accessed</th>
                </tr>
              </thead>
              <tbody>
                {trust.subprocessors.map((sp) => (
                  <tr key={sp.name} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 pr-4 font-semibold text-slate-900">{sp.name}</td>
                    <td className="py-3 pr-4 text-slate-700">{sp.purpose}</td>
                    <td className="py-3 text-slate-600">{sp.data}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-5">
            Full subprocessor register (DPA status, cert dates, last reviewed) at{' '}
            <a className="text-amber-700 hover:text-amber-800 underline underline-offset-2" href={VENDORS_CSV_URL} rel="noopener noreferrer" target="_blank">compliance/vendors.csv</a>.
          </p>
        </div>
      </section>

      {/* Policies */}
      <section className="py-16 bg-slate-50 border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Policies</h2>
          <p className="text-slate-600 mb-8 max-w-3xl">Our full policy library covers SOC 2, ISO 27001, 27701, and 27017. Customer copies are available on request.</p>
          <ul className="grid sm:grid-cols-2 gap-3">
            {trust.policies.map((policy) => (
              <li key={policy} className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-4 py-3">
                <FileText size={16} className="text-slate-400 flex-shrink-0" />
                <span className="text-slate-800 text-sm font-medium">{policy}</span>
              </li>
            ))}
          </ul>
          <a href={`mailto:${SECURITY_EMAIL}?subject=Policy%20Copy%20Request&body=${POLICY_REQUEST_BODY}`} className="inline-flex items-center gap-2 mt-8 text-sm font-semibold text-amber-700 hover:text-amber-800">
            Request a full copy <ArrowRight size={15} />
          </a>
        </div>
      </section>

      {/* Contact + SOC 2 CTA */}
      <section className="py-16">
        <div className="max-w-5xl mx-auto px-6 grid md:grid-cols-2 gap-10">
          <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-3">Contact</h2>
            <p className="text-slate-600 mb-5">For security questions, vulnerability reports, or to coordinate a vendor review, reach the security team directly.</p>
            <ul className="space-y-2.5 text-sm">
              <li className="flex items-center gap-2.5 text-slate-700"><Mail size={15} className="text-slate-400" /><a className="text-amber-700 hover:text-amber-800 font-semibold" href={`mailto:${SECURITY_EMAIL}`}>{SECURITY_EMAIL}</a></li>
              <li className="flex items-center gap-2.5 text-slate-700"><Shield size={15} className="text-slate-400" /><a className="text-amber-700 hover:text-amber-800 font-semibold" href={`mailto:${SECURITY_EMAIL}?subject=Vulnerability%20Report`}>Report a vulnerability</a></li>
              <li className="flex items-center gap-2.5 text-slate-700"><Clock size={15} className="text-slate-400" />Acknowledgement within 24 hours, triage within 72 hours</li>
            </ul>
          </div>
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl p-7 border border-slate-700">
            <h3 className="text-lg font-bold mb-2">Request our SOC 2 report</h3>
            <p className="text-sm text-slate-300 mb-5 leading-relaxed">We share our latest SOC 2 report under NDA with current and prospective customers. Email us with your procurement contact and we&apos;ll send it the same business day.</p>
            <a href={`mailto:${SECURITY_EMAIL}?subject=SOC%202%20Report%20Request&body=${SOC2_REQUEST_BODY}`} className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-900 font-semibold text-sm px-5 py-2.5 rounded-lg transition-colors">
              Request our SOC 2 report <ArrowRight size={15} />
            </a>
          </div>
        </div>
      </section>

      {/* Footer stamp */}
      <footer className="border-t border-slate-200 py-6">
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>Last updated <span className="font-semibold text-slate-700">{lastUpdatedLabel}</span>.</span>
          <span className="inline-flex items-center gap-1.5"><RefreshCw size={11} className="text-slate-400" />Re-renders on every deploy from <code className="text-slate-600">compliance/trust.json</code>.</span>
        </div>
      </footer>
    </main>
  );
}
