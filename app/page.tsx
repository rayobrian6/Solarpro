'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Sun, Zap, Map, FileText, BarChart3, ArrowRight,
  CheckCircle, Star, Cpu, Shield,
  TrendingUp, Users, Leaf, Sparkles,
  Lock, Mail, Wrench,
  HardHat, Ruler, Package, AlertTriangle,
  Upload, Layout, GitBranch, ClipboardList, FileCheck,
  ChevronRight, Camera, Smartphone, Home,
  MessageSquare, DollarSign, ClipboardCheck, Battery,
  UserPlus, PieChart,
} from 'lucide-react';

// ─── DATA ───────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <Map size={22} />,
    title: '3D Design Studio',
    desc: 'Draw roof zones, ground arrays, and Sol Fence layouts on real satellite imagery. Google Solar API auto-detects roof segments and optimizes panel placement.',
    color: 'from-amber-500/20 to-orange-500/10 border-amber-500/20',
    iconColor: 'text-amber-400 bg-amber-500/10',
    tag: 'Core Tool',
  },
  {
    icon: <Zap size={22} />,
    title: 'Electrical Engineering',
    desc: 'Full NEC-compliant single-line diagrams, conductor sizing, AC/DC disconnect specs, and interconnection rules for 19 utilities — auto-generated in seconds.',
    color: 'from-blue-500/20 to-cyan-500/10 border-blue-500/20',
    iconColor: 'text-blue-400 bg-blue-500/10',
    tag: 'NEC Compliant',
  },
  {
    icon: <Smartphone size={22} />,
    title: 'Site Survey Mobile App',
    desc: 'Field teams conduct surveys, capture roof photos, and submit measurements from their phone. Results sync instantly to the project — no paper, no back-and-forth.',
    color: 'from-cyan-500/20 to-teal-500/10 border-cyan-500/20',
    iconColor: 'text-cyan-400 bg-cyan-500/10',
    tag: 'Field Ready',
  },
  {
    icon: <Home size={22} />,
    title: 'Homeowner Portal',
    desc: 'Every client gets a branded progress dashboard — from lead submission to system going live. They see exactly where their project stands without calling your office.',
    color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/20',
    iconColor: 'text-emerald-400 bg-emerald-500/10',
    tag: 'Client Facing',
  },
  {
    icon: <UserPlus size={22} />,
    title: 'Lead & Pipeline Management',
    desc: 'Capture leads, assign reps, track deals through every stage of your pipeline. Convert a lead to a full project in one click — no separate CRM needed.',
    color: 'from-violet-500/20 to-purple-500/10 border-violet-500/20',
    iconColor: 'text-violet-400 bg-violet-500/10',
    tag: 'Built-in CRM',
  },
  {
    icon: <Ruler size={22} />,
    title: 'Sol Fence Solar',
    desc: 'Design vertical bifacial Sol Fence systems with specialized layout algorithms. Unique to SolarPro — no other platform supports fence-mounted solar design.',
    color: 'from-purple-500/20 to-violet-500/10 border-purple-500/20',
    iconColor: 'text-purple-400 bg-purple-500/10',
    tag: 'Exclusive',
  },
  {
    icon: <FileText size={22} />,
    title: 'Permit Outputs',
    desc: 'Generate AHJ-ready permit packages with structural calculations, electrical diagrams, and equipment specs. Reduce permit rejections to near zero.',
    color: 'from-rose-500/20 to-pink-500/10 border-rose-500/20',
    iconColor: 'text-rose-400 bg-rose-500/10',
    tag: 'AHJ Ready',
  },
  {
    icon: <BarChart3 size={22} />,
    title: 'Production Analysis',
    desc: 'Real-time energy production estimates using NREL PVWatts data. Monthly breakdowns, performance ratios, shading analysis, and 25-year degradation modeling.',
    color: 'from-teal-500/20 to-cyan-500/10 border-teal-500/20',
    iconColor: 'text-teal-400 bg-teal-500/10',
    tag: 'NREL Powered',
  },
  {
    icon: <Battery size={22} />,
    title: 'Battery & Storage Design',
    desc: 'Size battery systems alongside solar arrays. Backup load calculations, time-of-use optimization, and full BOM generation for storage-integrated projects.',
    color: 'from-orange-500/20 to-amber-500/10 border-orange-500/20',
    iconColor: 'text-orange-400 bg-orange-500/10',
    tag: 'Storage Ready',
  },
];

const WORKFLOW_STEPS = [
  {
    step: '01',
    icon: <Upload size={20} />,
    title: 'Upload Utility Bill',
    desc: 'Drop a PDF or image — AI extracts usage, rate schedule, and account info automatically.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10 border-amber-500/30',
  },
  {
    step: '02',
    icon: <Cpu size={20} />,
    title: 'System Sizing',
    desc: 'Usage data drives automatic kW sizing, offset targets, and production estimates via NREL PVWatts.',
    color: 'text-orange-400',
    bg: 'bg-orange-500/10 border-orange-500/30',
  },
  {
    step: '03',
    icon: <Camera size={20} />,
    title: 'Site Survey',
    desc: 'Field team completes mobile survey — roof photos, measurements, and notes sync to the project instantly.',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10 border-cyan-500/30',
  },
  {
    step: '04',
    icon: <Map size={20} />,
    title: 'Layout Design',
    desc: 'Place panels on satellite imagery. Google Solar API detects roof planes and optimizes placement.',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10 border-blue-500/30',
  },
  {
    step: '05',
    icon: <GitBranch size={20} />,
    title: 'Single-Line Diagram',
    desc: 'NEC-compliant SLD auto-generated with conductor sizing, disconnects, and utility specs.',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10 border-purple-500/30',
  },
  {
    step: '06',
    icon: <ClipboardList size={20} />,
    title: 'Bill of Materials',
    desc: 'Full BOM with part numbers, quantities, and pricing exported from your actual layout.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10 border-emerald-500/30',
  },
  {
    step: '07',
    icon: <FileCheck size={20} />,
    title: 'Permit Package',
    desc: 'One-click AHJ-ready permit package: structural calcs, SLD, equipment specs, and proposal.',
    color: 'text-teal-400',
    bg: 'bg-teal-500/10 border-teal-500/30',
  },
];

const PRODUCT_SCREENS = [
  {
    id: 'design',
    label: 'Design Studio',
    tag: 'SATELLITE IMAGERY',
    tagColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    accent: 'amber',
    title: '3D Panel Layout on Real Satellite Maps',
    desc: 'Draw roof zones and ground arrays directly on Google Maps imagery. Auto-detect roof segments, place panels with drag-and-drop, and see production estimates update in real time.',
    bullets: ['Google Solar API roof detection', 'Drag-and-drop panel placement', 'Shade analysis overlay', 'Ground mount & Sol Fence support'],
    mockType: 'design',
  },
  {
    id: 'portal',
    label: 'Homeowner Portal',
    tag: 'CLIENT FACING',
    tagColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    accent: 'emerald',
    title: 'Your Clients Always Know Where Their Project Stands',
    desc: 'Every homeowner gets a branded portal showing their project roadmap from lead to installation — stage by stage, with completed milestones, next steps, and document uploads. No more "where are we?" calls.',
    bullets: ['Branded homeowner dashboard', 'Real-time stage progress', 'Completed milestones shown automatically', 'Document upload & receipt confirmation'],
    mockType: 'portal',
  },
  {
    id: 'survey',
    label: 'Site Survey App',
    tag: 'MOBILE FIELD TOOL',
    tagColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    accent: 'cyan',
    title: 'Conduct Surveys From the Field — No Paperwork',
    desc: 'Your field team opens the app, captures roof photos and measurements on-site, and submits the survey from their phone. Results sync directly to the project in SolarPro — no calls, no emails, no lost data.',
    bullets: ['Mobile-first survey flow', 'Photo capture & annotation', 'Instant sync to project', 'Works on any iOS or Android device'],
    mockType: 'survey',
  },
  {
    id: 'sld',
    label: 'Electrical Engineering',
    tag: 'NEC COMPLIANT',
    tagColor: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    accent: 'blue',
    title: 'Auto-Generated Single-Line Diagrams',
    desc: 'Every project generates a complete NEC-compliant SLD. Conductor sizing, AC/DC disconnects, and interconnection specs for 19 utilities — no manual drafting required.',
    bullets: ['19 utility interconnection rules', 'Conductor sizing auto-calculated', 'AC & DC disconnect specs', 'Printable for AHJ submission'],
    mockType: 'sld',
  },
  {
    id: 'solfence',
    label: 'Sol Fence',
    tag: 'EXCLUSIVE FEATURE',
    tagColor: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    accent: 'purple',
    title: 'The Only Platform That Designs Sol Fence Systems',
    desc: 'Vertical bifacial fence-mounted solar requires a completely different design approach. SolarPro is the only software that natively supports Sol Fence layout, electrical engineering, and permitting.',
    bullets: ['Vertical bifacial panel layout', 'Fence post spacing calculator', 'Sol Fence SLD template', 'Revenue modeling for fence arrays'],
    mockType: 'solfence',
  },
  {
    id: 'bom',
    label: 'Bill of Materials',
    tag: 'AUTO-GENERATED',
    tagColor: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
    accent: 'teal',
    title: 'Complete BOM from Your Actual Layout',
    desc: 'No more manual counting. Every panel, string, conductor run, and combiner box from your design exports directly into a structured BOM with part numbers and quantities.',
    bullets: ['Panels, inverters, racking counted', 'Part numbers & quantities', 'CSV / PDF export', 'Distributor pricing integration'],
    mockType: 'bom',
  },
];

// ─── Landing page pricing — sourced from lib/pricing.config.ts ─────────────
// All prices and features are imported from the single source of truth.
// Do NOT hardcode prices here.
import { PRICING_PLANS as _PP, PLAN_FEATURES as _PF, formatSeatLimit as _fsl, formatExtraSeatMsg as _fem } from '@/lib/pricing.config';

const PRICING = [
  {
    id: 'starter',
    name: 'Starter',
    trialBadge: '3-Day Free Trial',
    price: `$${_PP.starter.price}`,
    period: '/mo after trial',
    desc: 'For solo installers getting started.',
    trialNote: 'Free for 3 days — no credit card required.',
    seatLabel: _fsl('starter'),
    extraSeatMsg: _fem('starter'),
    features: _PF.starter.included,
    notIncluded: _PF.starter.notIncluded,
    cta: 'Start 3-Day Trial',
    highlight: false,
    badge: null as string | null,
    isTrial: true,
    checkoutHref: '/auth/register',
    replacementMsg: null as string | null,
  },
  {
    id: 'professional',
    name: 'Professional',
    trialBadge: null,
    price: `$${_PP.professional.price}`,
    period: '/mo',
    desc: 'For growing installers running real volume.',
    trialNote: null,
    seatLabel: _fsl('professional'),
    extraSeatMsg: _fem('professional'),
    features: _PF.professional.included,
    notIncluded: _PF.professional.notIncluded,
    cta: 'Get Started',
    highlight: false,
    badge: null as string | null,
    isTrial: false,
    checkoutHref: '/auth/subscribe?plan=professional',
    replacementMsg: null as string | null,
  },
  {
    id: 'contractor',
    name: 'Contractor',
    trialBadge: null,
    price: `$${_PP.contractor.price}`,
    period: '/mo',
    desc: 'Full platform for serious solar companies.',
    trialNote: null,
    seatLabel: _fsl('contractor'),
    extraSeatMsg: _fem('contractor'),
    features: _PF.contractor.included,
    notIncluded: _PF.contractor.notIncluded,
    cta: 'Get Started',
    highlight: true,
    badge: 'Most Popular' as string | null,
    isTrial: false,
    checkoutHref: '/auth/subscribe?plan=contractor',
    replacementMsg: 'Replace $300–$1,000/month in solar software tools with one platform' as string | null,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    trialBadge: null,
    price: 'Custom',
    period: ' pricing',
    desc: 'For large teams and multi-location companies.',
    trialNote: null,
    seatLabel: 'Unlimited users',
    extraSeatMsg: null as string | null,
    features: _PF.enterprise.included,
    notIncluded: _PF.enterprise.notIncluded,
    cta: 'Contact Sales',
    highlight: false,
    badge: null as string | null,
    isTrial: false,
    checkoutHref: 'mailto:sales@underthesun.solutions',
    replacementMsg: null as string | null,
  },
];

const TESTIMONIALS = [
  {
    name: 'Ryan B.',
    role: 'Owner',
    company: 'Under the Sun Solar',
    location: 'Midwest',
    quote: 'We built SolarPro because every tool we tried was designed for salespeople, not installers. Now our field team surveys from their phones, our office generates permits in minutes, and our clients can see their project progress without calling us.',
    rating: 5,
  },
  {
    name: 'James C.',
    role: 'Lead Installer',
    company: 'Independent Contractor',
    location: 'Arizona',
    quote: "The site survey app alone saved us hours every week. Photos sync directly to the project, the SLD comes out NEC-compliant on the first try, and our AHJ approval rate went through the roof.",
    rating: 5,
  },
  {
    name: 'Sarah M.',
    role: 'Project Manager',
    company: 'Residential Solar Co.',
    location: 'California',
    quote: "Our homeowners used to call constantly asking for updates. Now they log into their portal and see exactly where their project stands. It's changed how we run the business.",
    rating: 5,
  },
];

const STATS = [
  { value: '7+', label: 'Modules', sub: 'Design to install' },
  { value: '19', label: 'Utilities', sub: 'Interconnection rules' },
  { value: '15 min', label: 'Avg Workflow', sub: 'Bill to permit package' },
  { value: '98%', label: 'Permit Approval', sub: 'First submission rate' },
];

// ─── MOCK UI COMPONENTS ─────────────────────────────────────────────────────

function DesignStudioMock() {
  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500/70" />
          <div className="w-2 h-2 rounded-full bg-amber-500/70" />
          <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
        </div>
        <div className="text-xs text-slate-400 font-mono">Design Studio — 8.4 kW System</div>
        <div className="text-xs text-emerald-400 font-semibold">● Live</div>
      </div>
      <div className="relative" style={{ height: 'calc(100% - 40px)' }}>
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #1a2332 0%, #0f1923 40%, #1c2e1a 70%, #151f15 100%)' }}
        />
        <div className="absolute border-2 border-amber-400/50 rounded"
          style={{ top: '18%', left: '18%', width: '55%', height: '45%', background: 'rgba(80,60,20,0.3)' }}>
          <div className="absolute grid gap-px"
            style={{ top: '38%', left: '8%', right: '8%', bottom: '8%', gridTemplateColumns: 'repeat(6, 1fr)', gridTemplateRows: 'repeat(3, 1fr)' }}>
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className={`rounded-sm border ${i < 15 ? 'bg-blue-500/50 border-blue-400/40' : 'bg-slate-700/30 border-slate-600/20'}`} />
            ))}
          </div>
          <div className="absolute -top-5 right-0 text-xs font-bold text-amber-400 bg-slate-900/90 px-1.5 py-0.5 rounded border border-amber-500/30">
            15 panels
          </div>
        </div>
        <div className="absolute bottom-3 left-3 right-3 flex gap-2">
          {[{ label: 'System Size', value: '8.4 kW' }, { label: 'Annual Prod.', value: '11,200 kWh' }, { label: 'Offset', value: '94%' }].map(s => (
            <div key={s.label} className="flex-1 bg-slate-900/90 border border-slate-700/60 rounded-lg px-2 py-1.5 text-center">
              <div className="text-xs text-slate-500">{s.label}</div>
              <div className="text-sm font-bold text-amber-400">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HomeownerPortalMock() {
  return (
    <div className="relative w-full h-full bg-[#07070e] rounded-xl overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-3 py-2 bg-[#0a0a14]/80 border-b border-white/[0.06]">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-amber-500/20 border border-amber-500/25 flex items-center justify-center">
            <Sun size={10} className="text-amber-400" />
          </div>
          <span className="text-xs text-white font-semibold">Your Solar Project</span>
        </div>
        <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Active
        </div>
      </div>
      <div className="p-4" style={{ height: 'calc(100% - 40px)', overflowY: 'auto' }}>
        {/* Roadmap */}
        <div className="flex items-center justify-between mb-3">
          {['Request', 'Review', 'Survey', 'Design', 'Proposal', 'Install', 'Done'].map((step, i) => (
            <div key={step} className="flex flex-col items-center flex-1">
              {i > 0 && <div className={`absolute h-px w-full ${i <= 3 ? 'bg-emerald-500/40' : 'bg-white/[0.06]'}`} />}
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold z-10 ${
                i < 3 ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-400'
                : i === 3 ? 'bg-amber-500 text-slate-900'
                : 'bg-white/[0.04] border border-white/[0.08] text-white/20'
              }`}>
                {i < 3 ? '✓' : i === 3 ? '◆' : '○'}
              </div>
              <span className={`text-[7px] mt-1 text-center leading-tight ${i <= 3 ? i === 3 ? 'text-amber-300' : 'text-emerald-400/60' : 'text-white/15'}`}>
                {step}
              </span>
            </div>
          ))}
        </div>
        {/* Current stage */}
        <div className="rounded-xl border border-amber-500/[0.12] bg-amber-500/[0.04] px-3 py-3 mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <div className="w-1 h-1 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-500/60">Current Stage</span>
          </div>
          <p className="text-sm font-black text-white mb-1">We're designing your system.</p>
          <p className="text-[10px] text-slate-400 mb-2">Our team is building a solar layout specifically for your home.</p>
          {/* Completed so far */}
          <div className="border-t border-white/[0.05] pt-2">
            <p className="text-[8px] font-black uppercase tracking-widest text-slate-500 mb-1.5">Completed so far</p>
            {['Survey appointment set', 'Site photos uploaded', 'Survey reviewed'].map(item => (
              <div key={item} className="flex items-center gap-1.5 mb-1">
                <span className="text-emerald-400 text-[10px]">✔</span>
                <span className="text-[10px] text-slate-300">{item}</span>
              </div>
            ))}
          </div>
        </div>
        {/* Project details */}
        <div className="grid grid-cols-3 gap-1.5">
          {[{ label: 'Property', value: '123 Main St' }, { label: 'System', value: '8.4 kW' }, { label: 'Progress', value: '57%' }].map(d => (
            <div key={d.label} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2">
              <p className="text-[8px] text-slate-600 uppercase tracking-wider">{d.label}</p>
              <p className="text-xs font-bold text-white">{d.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SiteSurveyMock() {
  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500/70" />
          <div className="w-2 h-2 rounded-full bg-amber-500/70" />
          <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
        </div>
        <div className="text-xs text-slate-400 font-mono">Site Survey App</div>
        <div className="text-xs text-cyan-400 font-semibold">● Field</div>
      </div>
      <div className="p-4" style={{ height: 'calc(100% - 40px)' }}>
        <div className="mb-3">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 font-mono">Project</p>
          <p className="text-sm font-bold text-white">123 Main St — Johnson Residence</p>
          <p className="text-xs text-slate-500">Assigned to: James C.</p>
        </div>
        <div className="space-y-2 mb-3">
          {[
            { label: 'Roof Photos', count: '8 captured', done: true },
            { label: 'Measurements', count: '3 sections', done: true },
            { label: 'Electrical Panel', count: '200A confirmed', done: true },
            { label: 'Shading Notes', count: 'None observed', done: true },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between rounded-lg bg-slate-800/50 border border-slate-700/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <CheckCircle size={12} className="text-emerald-400" />
                <span className="text-xs text-white">{item.label}</span>
              </div>
              <span className="text-[10px] text-slate-400">{item.count}</span>
            </div>
          ))}
        </div>
        <button className="w-full py-2 rounded-xl bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 text-xs font-bold">
          Submit Survey →
        </button>
        <p className="text-[9px] text-slate-600 text-center mt-2">Syncs instantly to SolarPro</p>
      </div>
    </div>
  );
}

function SLDMock() {
  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500/70" />
          <div className="w-2 h-2 rounded-full bg-amber-500/70" />
          <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
        </div>
        <div className="text-xs text-slate-400 font-mono">Electrical Engineering — SLD</div>
        <div className="text-xs text-blue-400 font-semibold">NEC 2023</div>
      </div>
      <div className="p-4" style={{ height: 'calc(100% - 40px)' }}>
        <div className="relative w-full h-full flex flex-col items-center justify-center gap-0">
          <div className="flex gap-3 mb-1">
            {[1, 2].map(s => (
              <div key={s} className="flex flex-col items-center">
                <div className="border border-blue-400/50 rounded px-2 py-1 bg-blue-500/10 text-xs text-blue-300 font-mono text-center">
                  <div className="font-bold">String {s}</div>
                  <div className="text-blue-400/60 text-[10px]">8 × 400W</div>
                </div>
                <div className="w-px h-3 bg-blue-400/40" />
              </div>
            ))}
          </div>
          <div className="border border-blue-400/40 rounded px-4 py-1 bg-slate-800/60 text-xs text-slate-300 font-mono mb-1">DC Combiner / Disconnect</div>
          <div className="w-px h-3 bg-blue-400/30" />
          <div className="border-2 border-amber-400/60 rounded-lg px-6 py-2 bg-amber-500/10 text-center mb-1">
            <div className="text-xs font-black text-amber-400">INVERTER</div>
            <div className="text-[10px] text-slate-400 font-mono">8.0 kW · 240V AC</div>
          </div>
          <div className="w-px h-3 bg-amber-400/30" />
          <div className="border border-emerald-400/40 rounded px-4 py-1 bg-slate-800/60 text-xs text-slate-300 font-mono mb-1">AC Disconnect · 60A</div>
          <div className="w-px h-3 bg-emerald-400/30" />
          <div className="border border-emerald-400/50 rounded px-4 py-1 bg-emerald-500/10 text-xs text-emerald-300 font-mono mb-1">Main Service Panel · 200A</div>
          <div className="w-px h-3 bg-slate-500/40" />
          <div className="border border-slate-500/50 rounded px-4 py-1 bg-slate-800/40 text-xs text-slate-400 font-mono">Utility Meter / Grid</div>
          <div className="absolute top-2 right-2 flex flex-col gap-1">
            <div className="text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-300 px-2 py-0.5 rounded font-mono">✓ NEC 690</div>
            <div className="text-[10px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded font-mono">✓ UL Listed</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SolFenceMock() {
  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500/70" />
          <div className="w-2 h-2 rounded-full bg-amber-500/70" />
          <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
        </div>
        <div className="text-xs text-slate-400 font-mono">Sol Fence Designer</div>
        <div className="text-xs text-purple-400 font-semibold">● Exclusive</div>
      </div>
      <div className="p-4" style={{ height: 'calc(100% - 40px)' }}>
        <div className="text-[10px] text-slate-500 mb-2 font-mono uppercase tracking-wider">Elevation View</div>
        <div className="relative bg-slate-800/40 rounded-lg border border-slate-700/40 p-3 mb-3 overflow-hidden">
          <div className="flex justify-around items-end pt-2" style={{ height: '80px' }}>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="flex gap-px mb-1">
                  {[0, 1].map(p => (
                    <div key={p} className="rounded-sm border border-purple-400/40 bg-purple-500/20" style={{ width: '10px', height: '40px' }} />
                  ))}
                </div>
                <div className="w-1.5 h-6 bg-slate-500/60 rounded-sm" />
              </div>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[{ label: 'Fence Length', value: '120 ft' }, { label: 'Panel Count', value: '28 panels' }, { label: 'Orientation', value: 'Bifacial E/W' }, { label: 'Capacity', value: '11.2 kW' }].map(s => (
            <div key={s.label} className="bg-slate-800/40 border border-slate-700/40 rounded-lg px-2 py-1.5">
              <div className="text-[10px] text-slate-500">{s.label}</div>
              <div className="text-xs font-bold text-purple-300">{s.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BOMMock() {
  const items = [
    { qty: 15, part: 'REC400AA Pure-R', cat: 'Module', price: '$312' },
    { qty: 1, part: 'SMA SB7.7-1SP-US', cat: 'Inverter', price: '$1,240' },
    { qty: 1, part: 'IronRidge XR-100', cat: 'Racking', price: '$485' },
    { qty: 2, part: '10AWG PV Wire 50ft', cat: 'Wire', price: '$28' },
    { qty: 1, part: 'Midnite MNPV3 CB', cat: 'Combiner', price: '$95' },
    { qty: 1, part: 'Generac XD 60A', cat: 'Disconnect', price: '$118' },
  ];
  return (
    <div className="relative w-full h-full bg-slate-900 rounded-xl overflow-hidden border border-slate-700/60">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/80 border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500/70" />
          <div className="w-2 h-2 rounded-full bg-amber-500/70" />
          <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
        </div>
        <div className="text-xs text-slate-400 font-mono">Bill of Materials</div>
        <div className="text-xs text-teal-400 font-semibold">Auto-Generated</div>
      </div>
      <div style={{ height: 'calc(100% - 40px)', overflowY: 'auto' }}>
        <div className="grid grid-cols-12 gap-1 px-3 py-1.5 border-b border-slate-700/50 text-[10px] text-slate-500 font-mono uppercase tracking-wider">
          <div className="col-span-1">Qty</div>
          <div className="col-span-6">Part</div>
          <div className="col-span-3">Category</div>
          <div className="col-span-2 text-right">Price</div>
        </div>
        {items.map((item, i) => (
          <div key={i} className={`grid grid-cols-12 gap-1 px-3 py-1.5 text-xs border-b border-slate-800/60 ${i % 2 === 0 ? 'bg-slate-800/20' : ''}`}>
            <div className="col-span-1 text-emerald-400 font-bold">{item.qty}</div>
            <div className="col-span-6 text-slate-200 font-mono text-[11px] truncate">{item.part}</div>
            <div className="col-span-3"><span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-400">{item.cat}</span></div>
            <div className="col-span-2 text-right text-teal-300 font-mono text-[11px]">{item.price}</div>
          </div>
        ))}
        <div className="grid grid-cols-12 gap-1 px-3 py-2 border-t border-teal-500/20 bg-teal-500/5">
          <div className="col-span-10 text-xs font-bold text-white">Total Material Cost</div>
          <div className="col-span-2 text-right text-teal-400 font-black text-sm">$6,842</div>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [email, setEmail] = useState('');
  const [activeScreen, setActiveScreen] = useState(0);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const accentMap: Record<string, string> = {
    amber:   'border-amber-500/40 shadow-amber-500/10',
    emerald: 'border-emerald-500/40 shadow-emerald-500/10',
    cyan:    'border-cyan-500/40 shadow-cyan-500/10',
    blue:    'border-blue-500/40 shadow-blue-500/10',
    purple:  'border-purple-500/40 shadow-purple-500/10',
    teal:    'border-teal-500/40 shadow-teal-500/10',
  };
  const tabAccentMap: Record<string, string> = {
    amber:   'border-amber-400 text-amber-400 bg-amber-500/10',
    emerald: 'border-emerald-400 text-emerald-400 bg-emerald-500/10',
    cyan:    'border-cyan-400 text-cyan-400 bg-cyan-500/10',
    blue:    'border-blue-400 text-blue-400 bg-blue-500/10',
    purple:  'border-purple-400 text-purple-400 bg-purple-500/10',
    teal:    'border-teal-400 text-teal-400 bg-teal-500/10',
  };
  const bulletAccentMap: Record<string, string> = {
    amber:   'text-amber-400',
    emerald: 'text-emerald-400',
    cyan:    'text-cyan-400',
    blue:    'text-blue-400',
    purple:  'text-purple-400',
    teal:    'text-teal-400',
  };

  const currentScreen = PRODUCT_SCREENS[activeScreen];

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">

      {/* ── Navbar ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 shadow-xl' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={20} className="text-slate-900" />
            </div>
            <div>
              <div className="font-bold text-white text-sm leading-tight">SolarPro</div>
              <div className="text-xs text-amber-400/80 font-medium">Design Platform</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#product" className="hover:text-white transition-colors">Product</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-white transition-colors">Reviews</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="hidden md:block text-sm text-slate-400 hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold text-sm px-4 py-2 rounded-xl hover:from-amber-300 hover:to-amber-500 transition-all inline-flex items-center gap-1.5 shadow-lg shadow-amber-500/20">
              Start Designing <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── SECTION 1: Hero ── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
          <div className="absolute inset-0 opacity-[0.03]"
            style={{ backgroundImage: 'linear-gradient(#f59e0b 1px, transparent 1px), linear-gradient(90deg, #f59e0b 1px, transparent 1px)', backgroundSize: '60px 60px' }}
          />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/8 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/8 rounded-full blur-3xl" />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-6 text-center pt-24 pb-16">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-medium mb-8">
            <HardHat size={14} />
            The Complete Solar Business Platform — Design to Installation
          </div>

          <h1 className="text-5xl md:text-7xl font-black text-white mb-6 leading-tight tracking-tight">
            Design, Survey, Engineer,
            <br />
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent">
              and Close Solar Faster
            </span>
          </h1>

          <p className="text-xl md:text-2xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            From utility bill to permitted install — SolarPro runs your entire solar operation. Design studio, field survey app, homeowner portal, lead pipeline, and permit outputs. One platform.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold px-8 py-4 rounded-xl text-base hover:from-amber-300 hover:to-amber-500 transition-all inline-flex items-center justify-center gap-2 shadow-xl shadow-amber-500/20">
              Start Designing Free
              <ArrowRight size={18} />
            </Link>
            <a href="#product" className="px-8 py-4 rounded-xl text-base font-semibold text-slate-300 border border-slate-700 hover:border-slate-500 hover:text-white transition-all inline-flex items-center justify-center gap-2 bg-slate-800/40">
              See It In Action
              <ChevronRight size={18} />
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-500 mb-16">
            {[
              { icon: <Shield size={13} />, text: 'NEC 2023 Compliant' },
              { icon: <CheckCircle size={13} />, text: '98% Permit Approval Rate' },
              { icon: <HardHat size={13} />, text: 'Built by Working Installers' },
              { icon: <Leaf size={13} />, text: '3-Day Free Trial' },
            ].map(item => (
              <div key={item.text} className="flex items-center gap-1.5">
                <span className="text-amber-400/70">{item.icon}</span>
                {item.text}
              </div>
            ))}
          </div>

          {/* Hero Mock UI */}
          <div className="relative max-w-4xl mx-auto">
            <div className="absolute -inset-4 bg-gradient-to-r from-amber-500/10 via-transparent to-blue-500/10 rounded-3xl blur-2xl" />
            <div className="relative rounded-2xl border border-slate-700/60 overflow-hidden shadow-2xl shadow-slate-950/80" style={{ aspectRatio: '16/9' }}>
              <DesignStudioMock />
            </div>
            <div className="absolute -left-4 top-1/3 -translate-y-1/2 hidden lg:block">
              <div className="bg-slate-800/95 border border-emerald-500/30 rounded-xl px-3 py-2 shadow-xl">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-emerald-400 font-semibold">Auto-Sized</span>
                </div>
                <div className="text-white text-sm font-black mt-0.5">8.4 kW</div>
                <div className="text-slate-500 text-xs">94% offset</div>
              </div>
            </div>
            <div className="absolute -right-4 top-1/2 -translate-y-1/2 hidden lg:block">
              <div className="bg-slate-800/95 border border-blue-500/30 rounded-xl px-3 py-2 shadow-xl">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-xs text-blue-400 font-semibold">SLD Ready</span>
                </div>
                <div className="text-white text-sm font-black mt-0.5">NEC 690</div>
                <div className="text-slate-500 text-xs">Auto-generated</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <section className="py-10 border-y border-slate-800/60 bg-slate-900/40">
        <div className="max-w-5xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {STATS.map(stat => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl md:text-4xl font-black mb-1">
                  <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                    {stat.value}
                  </span>
                </div>
                <div className="text-sm font-bold text-white">{stat.label}</div>
                <div className="text-xs text-slate-500">{stat.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 2: Workflow Pipeline ── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: 'radial-gradient(circle, #f59e0b 1px, transparent 1px)', backgroundSize: '32px 32px' }}
        />
        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-4">
              <Sparkles size={12} /> End-to-End Workflow
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              From Bill Upload to
              <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent"> Permitted Install</span>
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Every step of the solar business — design, survey, engineering, BOM, and permits — in one platform. No switching apps. No manual data entry.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            {WORKFLOW_STEPS.map((step, idx) => (
              <div key={step.step} className="relative flex flex-col items-center text-center">
                {idx < WORKFLOW_STEPS.length - 1 && (
                  <div className="hidden lg:block absolute top-7 left-[calc(50%+28px)] right-[-8px] h-px bg-slate-700/60" />
                )}
                <div className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center mb-4 relative z-10 ${step.bg} ${step.color}`}>
                  {step.icon}
                  <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-slate-950 border border-slate-700 flex items-center justify-center">
                    <span className="text-[9px] font-black text-slate-400">{step.step}</span>
                  </div>
                </div>
                <h3 className={`text-sm font-bold ${step.color} mb-2`}>{step.title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-14 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-transparent border border-amber-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center flex-shrink-0">
              <TrendingUp size={26} className="text-amber-400" />
            </div>
            <div className="text-center md:text-left">
              <div className="text-white font-bold text-lg mb-1">From 4 hours to 15 minutes</div>
              <div className="text-slate-400 text-sm">
                The average SolarPro user completes a full design-to-permit workflow in under 15 minutes. Legacy tools — Aurora, Helioscope, manual CAD — average 3–4 hours for the same output.
              </div>
            </div>
            <div className="flex-shrink-0 md:ml-auto">
              <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold text-sm px-5 py-2.5 rounded-xl whitespace-nowrap inline-flex items-center gap-2 hover:from-amber-300 hover:to-amber-500 transition-all">
                Try It Free <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: Product Screenshots ── */}
      <section id="product" className="py-24 bg-slate-900/40 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: 'linear-gradient(#64748b 1px, transparent 1px), linear-gradient(90deg, #64748b 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        />
        <div className="max-w-7xl mx-auto px-6 relative z-10">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
              <Layout size={12} /> Real Product Screens
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              Every screen built for the field
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Not built for salespeople. Not built for software demos. Built for the engineers, installers, and business owners who actually do the work.
            </p>
          </div>

          <div className="flex flex-wrap justify-center gap-2 mb-10">
            {PRODUCT_SCREENS.map((screen, idx) => (
              <button
                key={screen.id}
                onClick={() => setActiveScreen(idx)}
                className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                  activeScreen === idx
                    ? tabAccentMap[screen.accent]
                    : 'border-slate-700/50 text-slate-500 hover:text-slate-300 hover:border-slate-600'
                }`}
              >
                {screen.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div className={`rounded-2xl border shadow-2xl overflow-hidden ${accentMap[currentScreen.accent]}`}
              style={{ aspectRatio: '4/3' }}>
              {currentScreen.mockType === 'design'  && <DesignStudioMock />}
              {currentScreen.mockType === 'portal'  && <HomeownerPortalMock />}
              {currentScreen.mockType === 'survey'  && <SiteSurveyMock />}
              {currentScreen.mockType === 'sld'     && <SLDMock />}
              {currentScreen.mockType === 'solfence'&& <SolFenceMock />}
              {currentScreen.mockType === 'bom'     && <BOMMock />}
            </div>

            <div>
              <div className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-bold mb-4 ${tabAccentMap[currentScreen.accent]}`}>
                {currentScreen.tag}
              </div>
              <h3 className="text-2xl md:text-3xl font-black text-white mb-4 leading-tight">
                {currentScreen.title}
              </h3>
              <p className="text-slate-400 leading-relaxed mb-6">{currentScreen.desc}</p>
              <ul className="space-y-3 mb-8">
                {currentScreen.bullets.map(b => (
                  <li key={b} className="flex items-center gap-3 text-sm text-slate-300">
                    <CheckCircle size={16} className={bulletAccentMap[currentScreen.accent]} />
                    {b}
                  </li>
                ))}
              </ul>
              <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold px-6 py-3 rounded-xl inline-flex items-center gap-2 hover:from-amber-300 hover:to-amber-500 transition-all">
                Try {currentScreen.label} Free <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 4: Homeowner Portal Spotlight ── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-slate-950 to-blue-500/5" />
        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
                <Home size={12} /> Homeowner Portal
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-6 leading-tight">
                Your clients always know
                <br />
                <span className="text-emerald-400">where their project stands.</span>
              </h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                Every homeowner gets a branded portal — no app download required. They log in and see a real-time roadmap of their project: what stage they're in, what's been completed, what's coming next, and what they need to do.
              </p>
              <p className="text-slate-400 leading-relaxed mb-8">
                When your team advances a project stage, the portal updates automatically. No more "where are we?" calls. No more status emails. Your clients feel informed and confident — and your team can focus on the work.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  'Branded with your company name and colors',
                  'Project roadmap from lead to system live',
                  '"Completed so far" milestones per stage',
                  'Document upload — utility bills, contracts',
                  'Auto-advances when admin moves the project forward',
                ].map(pt => (
                  <div key={pt} className="flex items-start gap-3 text-sm text-slate-300">
                    <CheckCircle size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                    {pt}
                  </div>
                ))}
              </div>
              <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold px-6 py-3 rounded-xl inline-flex items-center gap-2 hover:from-amber-300 hover:to-amber-500 transition-all">
                See the Portal in Action <ArrowRight size={16} />
              </Link>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-emerald-500/8 to-transparent rounded-3xl blur-2xl" />
              <div className="relative rounded-2xl border border-emerald-500/20 overflow-hidden shadow-2xl" style={{ aspectRatio: '4/3' }}>
                <HomeownerPortalMock />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: Bill Parsing Feature ── */}
      <section className="py-24 relative overflow-hidden bg-slate-900/40">
        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-6">
                <Upload size={12} /> AI-Powered Bill Parsing
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-6 leading-tight">
                Upload a utility bill.
                <br />
                <span className="text-amber-400">Get a sized system.</span>
              </h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                Drop any utility bill — PDF, photo, or scan — and SolarPro's AI extracts the customer's usage history, rate schedule, and account details automatically. The system size, offset target, and financial analysis are calculated before you've had a chance to close the file.
              </p>
              <p className="text-slate-400 leading-relaxed mb-8">
                Works with all major U.S. utilities. Handles tiered rates, TOU schedules, net metering, and demand charges. No manual data entry. No spreadsheets. Just upload and design.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  'Extracts 12-month usage history automatically',
                  'Identifies rate schedule (tiered, TOU, flat)',
                  'Calculates recommended system size & offset',
                  'Works with any U.S. utility bill format',
                ].map(pt => (
                  <div key={pt} className="flex items-start gap-3 text-sm text-slate-300">
                    <CheckCircle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
                    {pt}
                  </div>
                ))}
              </div>
              <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold px-6 py-3 rounded-xl inline-flex items-center gap-2 hover:from-amber-300 hover:to-amber-500 transition-all">
                Try Bill Upload Free <ArrowRight size={16} />
              </Link>
            </div>

            <div className="relative">
              <div className="absolute -inset-4 bg-gradient-to-r from-amber-500/8 to-transparent rounded-3xl blur-2xl" />
              <div className="relative bg-slate-800/60 rounded-2xl border border-slate-700/60 overflow-hidden shadow-2xl">
                <div className="flex items-center justify-between px-4 py-3 bg-slate-900/80 border-b border-slate-700/50">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500/70" />
                    <div className="w-2 h-2 rounded-full bg-amber-500/70" />
                    <div className="w-2 h-2 rounded-full bg-emerald-500/70" />
                  </div>
                  <div className="text-xs text-slate-400 font-mono">Bill Parser — AI Analysis</div>
                  <div className="text-xs text-amber-400">Processing...</div>
                </div>
                <div className="p-5">
                  <div className="border-2 border-dashed border-amber-500/30 rounded-xl p-4 mb-4 text-center bg-amber-500/5">
                    <Upload size={24} className="text-amber-400/60 mx-auto mb-2" />
                    <div className="text-xs text-amber-400 font-semibold">Edison_Bill_March2024.pdf</div>
                    <div className="text-xs text-slate-500 mt-1">Southern California Edison · Account #4821-0093</div>
                  </div>
                  <div className="text-xs text-slate-500 font-mono uppercase tracking-wider mb-2">Extracted Data</div>
                  <div className="space-y-2 mb-4">
                    {[
                      { label: 'Avg Monthly Usage', value: '1,240 kWh', color: 'text-amber-400' },
                      { label: 'Annual Usage',       value: '14,880 kWh', color: 'text-amber-400' },
                      { label: 'Rate Schedule',      value: 'TOU-D-Prime', color: 'text-blue-400' },
                      { label: 'Avg Monthly Bill',   value: '$248', color: 'text-emerald-400' },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                        <span className="text-slate-400 text-xs">{row.label}</span>
                        <span className={`text-xs font-bold ${row.color}`}>{row.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/5 border border-amber-500/30 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={14} className="text-amber-400" />
                      <span className="text-xs font-bold text-amber-400">AI Recommendation</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      {[{ label: 'System Size', value: '10.5 kW' }, { label: 'Offset', value: '95%' }, { label: 'Payback', value: '6.2 yrs' }].map(rec => (
                        <div key={rec.label} className="text-center">
                          <div className="text-white font-black text-sm">{rec.value}</div>
                          <div className="text-slate-500 text-[10px]">{rec.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 6: Site Survey Mobile App Spotlight ── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-slate-950 to-slate-950" />
        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="relative order-2 lg:order-1">
              <div className="absolute -inset-4 bg-gradient-to-r from-cyan-500/8 to-transparent rounded-3xl blur-2xl" />
              <div className="relative rounded-2xl border border-cyan-500/20 overflow-hidden shadow-2xl" style={{ aspectRatio: '4/3' }}>
                <SiteSurveyMock />
              </div>
            </div>
            <div className="order-1 lg:order-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-6">
                <Smartphone size={12} /> Mobile Field App
              </div>
              <h2 className="text-3xl md:text-4xl font-black text-white mb-6 leading-tight">
                Your field team surveys
                <br />
                <span className="text-cyan-400">from their phone.</span>
              </h2>
              <p className="text-slate-400 leading-relaxed mb-6">
                No clipboards. No paperwork. No "I'll email you the photos later." Your field team opens the site survey app, captures roof photos and measurements on-site, and submits. Results sync instantly into SolarPro — ready for design.
              </p>
              <p className="text-slate-400 leading-relaxed mb-8">
                Field teams log in with their SolarPro credentials. Each surveyor sees their assigned projects. Survey results feed directly into the design workflow — no re-entry, no lost data, no delays.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  'Works on any iOS or Android device',
                  'Photo capture with roof annotations',
                  'Measurements and electrical panel details',
                  'Instant sync to SolarPro project',
                  'Triggers automatic project stage update',
                ].map(pt => (
                  <div key={pt} className="flex items-start gap-3 text-sm text-slate-300">
                    <CheckCircle size={16} className="text-cyan-400 mt-0.5 flex-shrink-0" />
                    {pt}
                  </div>
                ))}
              </div>
              <Link href="/auth/register" className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold px-6 py-3 rounded-xl inline-flex items-center gap-2 hover:from-amber-300 hover:to-amber-500 transition-all">
                See the Survey App <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 7: Trust / Built by Installers ── */}
      <section className="py-24 bg-slate-900/50 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02]"
          style={{ backgroundImage: 'radial-gradient(circle, #f59e0b 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        />
        <div className="max-w-6xl mx-auto px-6 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-6">
                <HardHat size={12} /> Our Story
              </div>
              <blockquote className="text-2xl md:text-3xl font-bold text-white leading-relaxed mb-6">
                "We got tired of explaining to software companies what a{' '}
                <span className="text-amber-400">J-box</span> was. So we built our own."
              </blockquote>
              <p className="text-slate-400 leading-relaxed mb-6">
                SolarPro was founded by a team of working solar installers and electrical engineers who spent years fighting with tools built for salespeople. We know what an AHJ wants to see. We know how a roof mount differs from a ground mount. We know Sol Fence. That knowledge is baked into every screen of this platform.
              </p>
              <p className="text-slate-400 leading-relaxed mb-8">
                When we say "built by installers," we mean the people writing this code have pulled wire, mounted racking, and submitted permit packages that got rejected — and fixed them. We're not a VC-funded startup guessing at what the industry needs. We're it.
              </p>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                  <HardHat size={20} className="text-amber-400" />
                </div>
                <div>
                  <div className="text-white font-semibold">The SolarPro Team</div>
                  <div className="text-slate-500 text-sm">Solar installers turned software builders</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {[
                {
                  icon: <Wrench size={20} />,
                  title: '15+ Years Field Experience',
                  desc: 'Our founders have installed thousands of systems across residential, commercial, and utility-scale projects.',
                  color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
                },
                {
                  icon: <FileText size={20} />,
                  title: 'Permit Experts',
                  desc: "We've submitted permits in 40+ jurisdictions. We know what AHJs want and built it into every output.",
                  color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
                },
                {
                  icon: <Zap size={20} />,
                  title: 'Licensed Electricians on Staff',
                  desc: 'Every electrical engineering feature is reviewed by licensed electricians for NEC compliance.',
                  color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
                },
                {
                  icon: <MessageSquare size={20} />,
                  title: 'Built on Real Installer Feedback',
                  desc: 'Every feature in SolarPro came from a real problem we or our users hit in the field. No feature theater.',
                  color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
                },
              ].map(card => (
                <div key={card.title} className={`border rounded-xl p-5 flex items-start gap-4 ${card.color}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${card.color}`}>
                    {card.icon}
                  </div>
                  <div>
                    <div className="text-white font-semibold text-sm mb-1">{card.title}</div>
                    <div className="text-slate-400 text-xs leading-relaxed">{card.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 8: Feature Grid ── */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-4">
              <Package size={12} /> Full Platform
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              Everything your solar business needs.
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Nine modules covering every phase of the solar project lifecycle — design, engineering, field ops, client communication, and business management. All in one subscription.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(feature => (
              <div
                key={feature.title}
                className={`bg-gradient-to-br ${feature.color} border rounded-2xl p-6 hover:scale-[1.02] transition-all duration-200 hover:shadow-lg group`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${feature.iconColor}`}>
                    {feature.icon}
                  </div>
                  <span className="text-xs font-bold text-slate-500 border border-slate-700/50 px-2 py-0.5 rounded-full">
                    {feature.tag}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2 group-hover:text-amber-100 transition-colors">
                  {feature.title}
                </h3>
                <p className="text-slate-400 text-sm leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Before/After comparison */}
          <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-slate-800/40 border border-slate-700/40 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <AlertTriangle size={16} className="text-rose-400" />
                <h3 className="text-rose-400 font-bold text-sm uppercase tracking-wider">The Old Way</h3>
              </div>
              <div className="space-y-3">
                {[
                  "Sales-focused tools that don't understand field installation",
                  'Separate apps for design, engineering, surveying, and permitting',
                  'No support for Sol Fence or ground mount systems',
                  'Permit packages that get rejected by AHJs',
                  'Homeowners calling your office for status updates',
                  'Field team texting photos instead of syncing data',
                  'Manual BOM counting from layout screenshots',
                ].map(pt => (
                  <div key={pt} className="flex items-start gap-3 text-sm text-slate-500">
                    <span className="text-rose-500 mt-0.5 flex-shrink-0">✕</span>
                    {pt}
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <CheckCircle size={16} className="text-emerald-400" />
                <h3 className="text-emerald-400 font-bold text-sm uppercase tracking-wider">The SolarPro Way</h3>
              </div>
              <div className="space-y-3">
                {[
                  "Built by installers who've done every job type",
                  'Design, survey, engineering, BOM, and permits in one platform',
                  'Native Sol Fence and ground mount support',
                  '98% first-submission AHJ approval rate',
                  'Homeowners see live progress in their branded portal',
                  'Field surveys sync directly from the mobile app',
                  'BOM auto-generated from your actual layout',
                ].map(pt => (
                  <div key={pt} className="flex items-start gap-3 text-sm text-slate-300">
                    <CheckCircle size={15} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                    {pt}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 relative bg-slate-900/30">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium mb-4">
              <Lock size={12} /> Transparent Pricing
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              Start with a 3-Day Trial
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Try Starter free for 3 days. Choose a paid plan to continue — no lock-in, cancel anytime.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5 max-w-7xl mx-auto">
            {PRICING.map(plan => (
              <div
                key={plan.id}
                className={`rounded-2xl border-2 overflow-hidden flex flex-col transition-all ${
                  plan.highlight
                    ? 'border-amber-500/60 shadow-2xl shadow-amber-500/10 scale-[1.02]'
                    : plan.isTrial
                    ? 'border-slate-600/60'
                    : plan.id === 'enterprise'
                    ? 'border-purple-500/30'
                    : 'border-slate-700/50'
                }`}
              >
                {plan.badge ? (
                  <div className={`text-xs font-black text-center py-1.5 ${
                    plan.highlight ? 'bg-amber-500 text-slate-900' : 'bg-slate-600 text-white'
                  }`}>
                    {plan.highlight ? '⭐' : '🏗'} {plan.badge}
                  </div>
                ) : plan.isTrial ? (
                  <div className="bg-emerald-500/20 border-b border-emerald-500/30 text-emerald-400 text-xs font-black text-center py-1.5">
                    ✦ FREE FOR 3 DAYS
                  </div>
                ) : plan.id === 'enterprise' ? (
                  <div className="bg-purple-500/15 border-b border-purple-500/20 text-purple-400 text-xs font-black text-center py-1.5">
                    ◆ CUSTOM PRICING
                  </div>
                ) : (
                  <div className="h-[30px]" />
                )}

                <div className={`p-5 flex flex-col flex-1 ${
                  plan.highlight
                    ? 'bg-gradient-to-br from-amber-500/15 to-orange-500/5'
                    : plan.isTrial
                    ? 'bg-slate-800/30'
                    : plan.id === 'enterprise'
                    ? 'bg-gradient-to-br from-purple-500/8 to-slate-800/40'
                    : 'bg-slate-800/40'
                }`}>
                  <div className="mb-4">
                    <h3 className="text-lg font-black text-white mb-0.5">{plan.name}</h3>
                    <p className="text-slate-500 text-xs leading-relaxed">{plan.desc}</p>
                  </div>

                  <div className="mb-4">
                    {plan.isTrial ? (
                      <div>
                        <div className="flex items-baseline gap-1 mb-1">
                          <span className="text-3xl font-black text-emerald-400">Free</span>
                          <span className="text-slate-500 text-sm">/ 3 days</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          Then{' '}
                          <span className="text-slate-300 font-semibold">{plan.price}{plan.period}</span>
                          {' '}if you subscribe
                        </div>
                      </div>
                    ) : plan.id === 'enterprise' ? (
                      <div>
                        <div className="text-3xl font-black text-purple-300 mb-1">Custom</div>
                        <div className="text-xs text-slate-500">Pricing based on team size</div>
                      </div>
                    ) : (
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-white">{plan.price}</span>
                        <span className="text-slate-400 text-sm">{plan.period}</span>
                      </div>
                    )}
                  </div>

                  {/* Seat info */}
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500 shrink-0"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    <span className="text-slate-500 text-xs">{plan.seatLabel}</span>
                  </div>
                  {plan.extraSeatMsg && (
                    <p className="text-xs text-slate-600 pl-3.5 mb-1">{plan.extraSeatMsg}</p>
                  )}
                  {plan.replacementMsg && (
                    <p className="text-xs text-amber-400/70 mb-2 leading-snug">{plan.replacementMsg}</p>
                  )}

                  {plan.isTrial && (
                    <div className="bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-2 mb-4">
                      <p className="text-xs text-emerald-400 leading-relaxed">
                        No credit card required to start. After 3 days, an active subscription is required to continue.
                      </p>
                    </div>
                  )}

                  <ul className="space-y-1.5 mb-4 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-300">
                        <CheckCircle size={13} className={`flex-shrink-0 mt-0.5 ${plan.isTrial ? 'text-slate-400' : 'text-emerald-400'}`} />
                        {f}
                      </li>
                    ))}
                    {plan.notIncluded && plan.notIncluded.length > 0 && (
                      plan.notIncluded.map((f, i) => (
                        <li key={`no-${i}`} className="flex items-start gap-2 text-xs text-slate-600">
                          <span className="text-slate-700 flex-shrink-0 mt-0.5 text-[11px] leading-[13px]">✕</span>
                          {f}
                        </li>
                      ))
                    )}
                  </ul>

                  {plan.id === 'enterprise' ? (
                    <a href={plan.checkoutHref} className="w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all bg-purple-600/30 hover:bg-purple-600/50 text-purple-300 border border-purple-500/30">
                      {plan.cta} <ArrowRight size={13} />
                    </a>
                  ) : (
                    <Link href={plan.checkoutHref} className={`w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                      plan.highlight
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                        : plan.isTrial
                        ? 'bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 border border-emerald-500/30'
                        : 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
                    }`}>
                      {plan.cta} <ArrowRight size={13} />
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-slate-600 text-xs mt-8">
            Starter trial provides temporary access. Active subscription required after trial period. All prices in USD, billed monthly.<br />
            <span className="text-slate-700">Additional users can be added to any paid plan as your team grows.</span>
          </p>
        </div>
      </section>

      {/* ── Testimonials ── */}
      <section id="testimonials" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
              <Star size={12} /> Trusted by Solar Pros
            </div>
            <h2 className="text-4xl font-black text-white">What installers are saying</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-6">
                <div className="flex gap-1 mb-4">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-slate-300 text-sm leading-relaxed mb-4 italic">&ldquo;{t.quote}&rdquo;</p>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-sm">
                    {t.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div>
                    <div className="text-white text-sm font-semibold">{t.name}</div>
                    <div className="text-slate-500 text-xs">{t.role} · {t.company}</div>
                    <div className="text-slate-600 text-xs">{t.location}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 9: Final CTA ── */}
      <section className="py-28 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-slate-900 to-blue-500/10" />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'linear-gradient(#f59e0b 1px, transparent 1px), linear-gradient(90deg, #f59e0b 1px, transparent 1px)', backgroundSize: '40px 40px' }}
        />
        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-amber-500/30">
            <Sun size={36} className="text-slate-900" />
          </div>
          <h2 className="text-4xl md:text-6xl font-black text-white mb-6 leading-tight">
            Run Your Entire Solar
            <br />
            <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
              Business From One Platform
            </span>
          </h2>
          <p className="text-xl text-slate-400 mb-10 leading-relaxed max-w-2xl mx-auto">
            Design, survey, engineer, permit, and keep your clients informed — all in SolarPro. 3-day free trial, no credit card required.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-6">
            <div className="relative flex-1">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your work email"
                className="w-full bg-slate-800/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
              />
            </div>
            <Link
              href={`/auth/register${email ? `?email=${encodeURIComponent(email)}` : ''}`}
              className="bg-gradient-to-r from-amber-400 to-amber-600 text-slate-900 font-bold px-6 py-3 rounded-xl whitespace-nowrap inline-flex items-center gap-2 justify-center hover:from-amber-300 hover:to-amber-500 transition-all shadow-lg shadow-amber-500/20"
            >
              Start Free Trial
            </Link>
          </div>
          <p className="text-slate-500 text-sm mb-10">3-day free trial · No credit card required · Cancel anytime</p>

          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400">
            {[
              { icon: <Shield size={14} />, text: '256-bit encryption' },
              { icon: <CheckCircle size={14} />, text: 'NEC 2023 compliant' },
              { icon: <Lock size={14} />, text: 'Your data stays yours' },
              { icon: <Star size={14} />, text: '5-star rated' },
            ].map(item => (
              <div key={item.text} className="flex items-center gap-1.5">
                <span className="text-amber-400">{item.icon}</span>
                {item.text}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-800 py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                  <Sun size={18} className="text-slate-900" />
                </div>
                <div>
                  <div className="font-black text-white text-sm">SolarPro</div>
                  <div className="text-amber-400 text-xs">Design Platform</div>
                </div>
              </div>
              <p className="text-slate-500 text-xs leading-relaxed">
                The complete solar design and business platform for installers. Built by the industry, for the industry.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><a href="#features" className="hover:text-slate-300 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-slate-300 transition-colors">Pricing</a></li>
                <li><a href="#product" className="hover:text-slate-300 transition-colors">Product Tour</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Account</h4>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><Link href="/auth/register" className="hover:text-slate-300 transition-colors">Sign Up Free</Link></li>
                <li><Link href="/auth/login" className="hover:text-slate-300 transition-colors">Sign In</Link></li>
                <li><Link href="/auth/subscribe" className="hover:text-slate-300 transition-colors">Subscription</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Resources</h4>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><a href="https://seia.org" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">SEIA</a></li>
                <li><a href="https://dsire.org" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">State Incentives (DSIRE)</a></li>
                <li><a href="https://pvwatts.nrel.gov" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition-colors">NREL PVWatts</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-600 text-xs">© 2025 SolarPro Design Platform. All rights reserved.</p>
            <div className="flex gap-4 text-xs text-slate-600">
              <Link href="/privacy" className="hover:text-slate-400 transition-colors">Privacy Policy</Link>
              <Link href="/terms" className="hover:text-slate-400 transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}