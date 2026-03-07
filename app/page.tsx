'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Sun, Zap, Map, FileText, BarChart3, ArrowRight,
  CheckCircle, Star, ChevronDown, Cpu, Shield,
  TrendingUp, Users, Globe, Leaf, Play, Sparkles,
  DollarSign, Lock, Phone, Mail, Building2, Wrench,
  HardHat, Ruler, Package, AlertTriangle
} from 'lucide-react';

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
    desc: 'Full NEC-compliant single-line diagrams, conductor sizing, AC/DC disconnect specs, and interconnection rules for 19 utilities including 8 major utilities — auto-generated.',
    color: 'from-blue-500/20 to-cyan-500/10 border-blue-500/20',
    iconColor: 'text-blue-400 bg-blue-500/10',
    tag: 'NEC Compliant',
  },
  {
    icon: <HardHat size={22} />,
    title: 'Installer Workflow',
    desc: 'Built around how installers actually work — from site survey to permit submission. BOM, structural calcs, and permit packages generated automatically.',
    color: 'from-emerald-500/20 to-teal-500/10 border-emerald-500/20',
    iconColor: 'text-emerald-400 bg-emerald-500/10',
    tag: 'Field Ready',
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
];

const PAIN_POINTS = [
  { icon: <AlertTriangle size={18} />, text: 'Sales-focused tools that don\'t understand field installation' },
  { icon: <AlertTriangle size={18} />, text: 'Separate apps for design, engineering, and permitting' },
  { icon: <AlertTriangle size={18} />, text: 'No support for Sol Fence or ground mount systems' },
  { icon: <AlertTriangle size={18} />, text: 'Permit packages that get rejected by AHJs' },
];

const SCREENSHOTS = [
  {
    title: 'Design Studio',
    desc: 'Satellite imagery with real-time panel layout',
    color: 'from-amber-500/20 to-orange-500/5',
    border: 'border-amber-500/20',
    accent: 'bg-amber-500',
    panels: true,
  },
  {
    title: 'Sol Fence Layout',
    desc: 'Vertical bifacial fence system designer',
    color: 'from-purple-500/20 to-violet-500/5',
    border: 'border-purple-500/20',
    accent: 'bg-purple-500',
    panels: false,
  },
  {
    title: 'Electrical Engineering',
    desc: 'NEC-compliant single-line diagrams',
    color: 'from-blue-500/20 to-cyan-500/5',
    border: 'border-blue-500/20',
    accent: 'bg-blue-500',
    panels: false,
  },
  {
    title: 'Bill of Materials',
    desc: 'Auto-generated BOM with pricing',
    color: 'from-emerald-500/20 to-teal-500/5',
    border: 'border-emerald-500/20',
    accent: 'bg-emerald-500',
    panels: false,
  },
];

const PRICING = [
  {
    name: 'Starter',
    price: '$79',
    annual: '$63',
    period: '/mo',
    desc: 'Perfect for solo installers',
    features: [
      '3D Design Studio',
      'Up to 10 active projects',
      'Up to 25 clients',
      'PDF proposal generation',
      'Production analysis (NREL)',
      'Google Solar API',
    ],
    cta: 'Start Free Trial',
    highlight: false,
  },
  {
    name: 'Professional',
    price: '$149',
    annual: '$119',
    period: '/mo',
    desc: 'For growing install teams',
    features: [
      'Unlimited projects & clients',
      'Electrical engineering (SLD)',
      'Sol Fence design',
      'BOM + structural calcs',
      'Proposal e-signing',
      'White-label branding',
      'Priority support',
    ],
    cta: 'Start Free Trial',
    highlight: true,
    badge: 'Most Popular',
  },
  {
    name: 'Contractor',
    price: '$249',
    annual: '$199',
    period: '/mo',
    desc: 'For large contracting firms',
    features: [
      'Everything in Professional',
      'Unlimited team members',
      'Custom branding & logo upload',
      'Dedicated onboarding',
      'SLA support',
    ],
    cta: 'Start Free Trial',
    highlight: false,
  },
];

const TESTIMONIALS = [
  {
    name: 'James D.',
    role: 'Solar Contractor',
    location: 'Phoenix, AZ',
    quote: 'SolarPro is the first platform built by people who actually install solar. The permit packages come out right the first time — AHJ approved on first submission every time.',
    rating: 5,
  },
  {
    name: 'Maria S.',
    role: 'Lead Installer',
    location: 'San Diego, CA',
    quote: 'The Sol Fence designer is incredible. No other software even supports fence-mounted systems. We\'ve added a whole new revenue stream thanks to SolarPro.',
    rating: 5,
  },
  {
    name: 'Tom R.',
    role: 'Solar Designer',
    location: 'Austin, TX',
    quote: 'The electrical engineering module alone is worth the price. NEC-compliant SLDs auto-generated in seconds. What used to take me 3 hours now takes 5 minutes.',
    rating: 5,
  },
];

const STATS = [
  { value: '500+', label: 'Contractors', sub: 'Active users' },
  { value: '12k+', label: 'Projects', sub: 'Designed & permitted' },
  { value: '3×', label: 'Faster', sub: 'Than legacy tools' },
  { value: '98%', label: 'Permit Approval', sub: 'First submission rate' },
];

export default function LandingPage() {
  const [scrolled, setScrolled] = useState(false);
  const [annual, setAnnual] = useState(false);
  const [email, setEmail] = useState('');
  const [countersStarted, setCountersStarted] = useState(false);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler);
    return () => window.removeEventListener('scroll', handler);
  }, []);

  useEffect(() => {
    if (!statsRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setCountersStarted(true); },
      { threshold: 0.3 }
    );
    observer.observe(statsRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-white overflow-x-hidden">

      {/* ── Navbar ── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 shadow-xl' : 'bg-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl solar-gradient flex items-center justify-center shadow-lg shadow-amber-500/30">
              <Sun size={20} className="text-slate-900" />
            </div>
            <div>
              <div className="font-bold text-white text-sm leading-tight">SolarPro</div>
              <div className="text-xs text-amber-400/80 font-medium">Design Platform</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-slate-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#screenshots" className="hover:text-white transition-colors">Product</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#testimonials" className="hover:text-white transition-colors">Reviews</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auth/login" className="hidden md:block text-sm text-slate-400 hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="/auth/register" className="btn-primary btn-sm">
              Start Designing <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950" />
          <div className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: 'linear-gradient(#f59e0b 1px, transparent 1px), linear-gradient(90deg, #f59e0b 1px, transparent 1px)',
              backgroundSize: '60px 60px'
            }}
          />
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-6 text-center pt-24 pb-16">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-medium mb-8">
            <HardHat size={14} />
            Solar Design Software Built by Installers, for Installers
          </div>

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-black text-white mb-4 leading-tight tracking-tight">
            Solar Design Software
            <br />
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500 bg-clip-text text-transparent">
              Built by Installers
            </span>
          </h1>

          <p className="text-2xl md:text-3xl font-bold text-slate-300 mb-6 tracking-wide">
            Design. Engineer. Permit. Install.
          </p>

          <p className="text-lg text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            The only solar platform with a full 3D design studio, NEC-compliant electrical engineering,
            Sol Fence support, and AHJ-ready permit packages — all in one place.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-4">
            <Link href="/auth/register" className="btn-primary text-base px-8 py-3.5 rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/30 transition-shadow inline-flex items-center gap-2 justify-center">
              <Play size={18} /> Start Designing Free
            </Link>
            <Link href="/auth/login" className="btn-secondary text-base px-8 py-3.5 rounded-xl inline-flex items-center gap-2 justify-center">
              Book a Demo <ArrowRight size={16} />
            </Link>
          </div>
          <p className="text-slate-500 text-sm mb-14">No credit card required · 3-day free trial · Cancel anytime</p>

          {/* Social proof */}
          <div className="flex items-center justify-center gap-3 mb-12">
            <div className="flex -space-x-2">
              {['JD','MS','TR','AK','BL'].map((initials, i) => (
                <div key={i} className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 border-2 border-slate-950 flex items-center justify-center text-xs font-bold text-slate-900">
                  {initials}
                </div>
              ))}
            </div>
            <div className="text-sm text-slate-400">
              <span className="text-white font-semibold">500+ contractors</span> trust SolarPro
            </div>
          </div>

          {/* Design Studio Mock UI */}
          <div className="relative max-w-4xl mx-auto">
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent z-10 pointer-events-none" style={{ top: '60%' }} />
            <div className="bg-slate-800/60 backdrop-blur-sm border border-slate-700/50 rounded-2xl overflow-hidden shadow-2xl shadow-black/50">
              {/* Window chrome */}
              <div className="flex items-center gap-2 px-4 py-3 bg-slate-900/80 border-b border-slate-700/50">
                <div className="w-3 h-3 rounded-full bg-red-500/70" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                <div className="w-3 h-3 rounded-full bg-green-500/70" />
                <div className="flex-1 mx-4 bg-slate-800 rounded-md px-3 py-1 text-xs text-slate-500">
                  app.solarpro.design/design?projectId=proj_abc123
                </div>
              </div>
              {/* App layout */}
              <div className="flex h-64">
                {/* Sidebar */}
                <div className="w-48 bg-slate-900/80 border-r border-slate-700/50 p-3 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Tools</div>
                  {['Panel Layout','Roof Zones','Sol Fence','Electrical','BOM','Permits'].map((tool, i) => (
                    <div key={tool} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs ${i === 0 ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'text-slate-400 hover:text-white'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${i === 0 ? 'bg-amber-400' : 'bg-slate-600'}`} />
                      {tool}
                    </div>
                  ))}
                </div>
                {/* Map area */}
                <div className="flex-1 relative bg-slate-800 overflow-hidden">
                  <div className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage: 'linear-gradient(#4ade80 1px, transparent 1px), linear-gradient(90deg, #4ade80 1px, transparent 1px)',
                      backgroundSize: '20px 20px'
                    }}
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative">
                      {/* Roof outline */}
                      <div className="w-48 h-32 border-2 border-amber-400/60 rounded-lg bg-amber-500/5 relative">
                        {/* Solar panels grid */}
                        <div className="absolute inset-2 grid grid-cols-6 gap-0.5">
                          {Array.from({ length: 24 }).map((_, i) => (
                            <div key={i} className="bg-blue-500/40 border border-blue-400/30 rounded-sm" />
                          ))}
                        </div>
                      </div>
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-amber-500 text-slate-900 text-xs font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                        24 panels · 9.6 kW
                      </div>
                    </div>
                  </div>
                </div>
                {/* Right stats panel */}
                <div className="w-40 bg-slate-900/80 border-l border-slate-700/50 p-3 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">System</div>
                  {[
                    { label: 'Capacity', value: '9.6 kW', color: 'text-amber-400' },
                    { label: 'Annual', value: '13,440 kWh', color: 'text-emerald-400' },
                    { label: 'Offset', value: '94%', color: 'text-blue-400' },
                    { label: 'Payback', value: '6.2 yrs', color: 'text-purple-400' },
                  ].map(stat => (
                    <div key={stat.label} className="bg-slate-800/60 rounded-lg p-2">
                      <div className="text-xs text-slate-500">{stat.label}</div>
                      <div className={`text-xs font-bold ${stat.color}`}>{stat.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats Bar ── */}
      <div ref={statsRef} className="py-12 bg-slate-900/60 border-y border-slate-800">
        <div className="max-w-5xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-6">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-3xl md:text-4xl font-black text-amber-400 mb-1">{stat.value}</div>
              <div className="text-sm font-semibold text-white">{stat.label}</div>
              <div className="text-xs text-slate-500">{stat.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Problem Section ── */}
      <section className="py-24 relative">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium mb-6">
                <AlertTriangle size={12} /> The Problem
              </div>
              <h2 className="text-4xl md:text-5xl font-black text-white mb-6 leading-tight">
                Most solar software was built for{' '}
                <span className="bg-gradient-to-r from-red-400 to-rose-400 bg-clip-text text-transparent">
                  sales teams
                </span>
              </h2>
              <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                Not installers. Not engineers. Not the people who actually show up on the roof.
                The result? Tools that look great in demos but fall apart in the field.
              </p>
              <div className="space-y-3">
                {PAIN_POINTS.map((p, i) => (
                  <div key={i} className="flex items-start gap-3 text-slate-400">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">{p.icon}</span>
                    <span className="text-sm">{p.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-gradient-to-br from-amber-500/10 to-emerald-500/10 border border-amber-500/20 rounded-2xl p-8">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-4">
                <CheckCircle size={12} /> The SolarPro Difference
              </div>
              <h3 className="text-2xl font-black text-white mb-4">Built from the ground up for installers</h3>
              <p className="text-slate-400 text-sm leading-relaxed mb-6">
                We started by talking to hundreds of solar installers, engineers, and permit technicians.
                Every feature in SolarPro exists because someone in the field needed it.
              </p>
              <div className="space-y-3">
                {[
                  'AHJ-ready permit packages on first submission',
                  'NEC-compliant electrical diagrams auto-generated',
                  'Sol Fence vertical bifacial system support',
                  'Field-tested BOM with real supplier pricing',
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <CheckCircle size={16} className="text-emerald-400 flex-shrink-0" />
                    <span className="text-sm text-slate-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section id="features" className="py-24 bg-slate-900/50 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
              <Zap size={12} /> Full Platform
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              Everything an installer needs
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              From first site survey to final permit submission — every tool in one platform.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className={`relative rounded-2xl p-6 bg-gradient-to-br border ${feature.color} hover:scale-[1.02] transition-transform duration-200`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${feature.iconColor}`}>
                    {feature.icon}
                  </div>
                  <span className="text-xs font-semibold text-slate-500 bg-slate-800/60 px-2 py-1 rounded-full">{feature.tag}</span>
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Product Screenshots ── */}
      <section id="screenshots" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-medium mb-4">
              <Play size={12} /> See It In Action
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              Every screen built for the field
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto">
              Clean, fast, and purpose-built for solar professionals who don't have time for bloated software.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SCREENSHOTS.map((screen) => (
              <div key={screen.title} className={`bg-gradient-to-br ${screen.color} border ${screen.border} rounded-2xl p-6 hover:scale-[1.01] transition-transform`}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-2 h-2 rounded-full ${screen.accent}`} />
                  <span className="text-sm font-bold text-white">{screen.title}</span>
                  <span className="text-xs text-slate-500 ml-auto">{screen.desc}</span>
                </div>
                {/* Mock screen content */}
                <div className="bg-slate-900/60 rounded-xl border border-slate-700/50 h-40 flex items-center justify-center overflow-hidden relative">
                  <div className="absolute inset-0 opacity-10"
                    style={{
                      backgroundImage: 'linear-gradient(#64748b 1px, transparent 1px), linear-gradient(90deg, #64748b 1px, transparent 1px)',
                      backgroundSize: '16px 16px'
                    }}
                  />
                  {screen.panels ? (
                    <div className="relative z-10">
                      <div className="w-36 h-24 border-2 border-amber-400/60 rounded-lg bg-amber-500/5 relative">
                        <div className="absolute inset-1.5 grid grid-cols-5 gap-0.5">
                          {Array.from({ length: 20 }).map((_, i) => (
                            <div key={i} className="bg-blue-500/50 border border-blue-400/30 rounded-sm" />
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="relative z-10 w-full px-4">
                      <div className="space-y-2">
                        {[80, 60, 90, 45].map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-slate-700 rounded-full" />
                            <div className={`h-2 rounded-full ${screen.accent} opacity-60`} style={{ width: `${w}px` }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Built by Installers ── */}
      <section className="py-24 bg-slate-900/50 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.02]"
          style={{
            backgroundImage: 'radial-gradient(circle, #f59e0b 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }}
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
              <p className="text-slate-400 leading-relaxed mb-8">
                SolarPro was founded by a team of working solar installers and electrical engineers who
                spent years fighting with tools built for salespeople. We know what an AHJ wants to see.
                We know how a roof mount differs from a ground mount. We know Sol Fence.
                That knowledge is baked into every screen of this platform.
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
                { icon: <Wrench size={20} />, title: '15+ Years Field Experience', desc: 'Our founders have installed thousands of systems across residential, commercial, and utility-scale projects.', color: 'text-amber-400 bg-amber-500/10' },
                { icon: <FileText size={20} />, title: 'Permit Experts', desc: 'We\'ve submitted permits in 40+ jurisdictions. We know what AHJs want and built it into every output.', color: 'text-blue-400 bg-blue-500/10' },
                { icon: <Zap size={20} />, title: 'Licensed Electricians on Staff', desc: 'Every electrical engineering feature is reviewed by licensed electricians for NEC compliance.', color: 'text-emerald-400 bg-emerald-500/10' },
              ].map((card) => (
                <div key={card.title} className="bg-slate-800/40 border border-slate-700/50 rounded-xl p-5 flex items-start gap-4">
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

      {/* ── Pricing ── */}
      <section id="pricing" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-medium mb-4">
              <Lock size={12} /> Simple Pricing
            </div>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
              Start Free, Scale as You Grow
            </h2>
            <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-8">
              3-day free trial on all plans. No credit card required. Cancel anytime.
            </p>
            {/* Billing toggle */}
            <div className="inline-flex items-center gap-3 bg-slate-800/60 border border-slate-700/50 rounded-xl p-1">
              <button
                onClick={() => setAnnual(false)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${!annual ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setAnnual(true)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${annual ? 'bg-amber-500 text-slate-900' : 'text-slate-400 hover:text-white'}`}
              >
                Annual <span className="text-xs ml-1 opacity-80">Save 20%</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {PRICING.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl border-2 overflow-hidden transition-all ${
                  plan.highlight ? 'border-amber-500/60 scale-[1.03] shadow-2xl shadow-amber-500/10' : 'border-slate-700/50'
                }`}
              >
                {plan.badge && (
                  <div className="bg-amber-500 text-slate-900 text-xs font-black text-center py-1.5">
                    ⭐ {plan.badge}
                  </div>
                )}
                <div className={`p-6 ${plan.highlight ? 'bg-gradient-to-br from-amber-500/15 to-orange-500/5' : 'bg-slate-800/40'}`}>
                  <h3 className="text-xl font-black text-white mb-1">{plan.name}</h3>
                  <p className="text-slate-500 text-xs mb-4">{plan.desc}</p>
                  <div className="flex items-end gap-1 mb-6">
                    <span className="text-4xl font-black text-white">{annual ? plan.annual : plan.price}</span>
                    <span className="text-slate-400 text-sm mb-1.5">{plan.period}</span>
                    {annual && <span className="text-xs text-emerald-400 mb-1.5 ml-1">billed annually</span>}
                  </div>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-slate-300">
                        <CheckCircle size={14} className="text-emerald-400 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/auth/register"
                    className={`w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                      plan.highlight
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-900'
                        : 'bg-slate-700 hover:bg-slate-600 text-white border border-slate-600'
                    }`}
                  >
                    {plan.cta} <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust + Testimonials ── */}
      <section id="testimonials" className="py-24 bg-slate-900/50 relative">
        <div className="max-w-7xl mx-auto px-6">
          {/* Trust pillars */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
            {[
              { icon: <Shield size={24} />, title: 'SOC 2 Compliant', desc: 'Your project data is encrypted at rest and in transit. We never sell your data.', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
              { icon: <CheckCircle size={24} />, title: '98% Permit Approval', desc: 'Our permit packages are reviewed by licensed engineers and accepted by AHJs nationwide.', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
              { icon: <HardHat size={24} />, title: 'Built by Installers', desc: 'Every feature was designed with input from working solar installers and electrical engineers.', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
            ].map((pillar) => (
              <div key={pillar.title} className={`bg-gradient-to-br border rounded-2xl p-6 text-center ${pillar.color}`}>
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 ${pillar.color}`}>
                  {pillar.icon}
                </div>
                <h3 className="text-white font-bold text-lg mb-2">{pillar.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">{pillar.desc}</p>
              </div>
            ))}
          </div>

          {/* Testimonials */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium mb-4">
              <Star size={12} /> Trusted by Solar Pros
            </div>
            <h2 className="text-4xl font-black text-white">What installers are saying</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((t) => (
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
                    <div className="text-slate-500 text-xs">{t.role} · {t.location}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/10 via-slate-900 to-blue-500/10" />
        <div className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: 'linear-gradient(#f59e0b 1px, transparent 1px), linear-gradient(90deg, #f59e0b 1px, transparent 1px)',
            backgroundSize: '40px 40px'
          }}
        />
        <div className="relative z-10 max-w-4xl mx-auto px-6 text-center">
          <div className="w-20 h-20 rounded-2xl solar-gradient flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-amber-500/30">
            <Sun size={36} className="text-slate-900" />
          </div>
          <h2 className="text-4xl md:text-5xl font-black text-white mb-4">
            Stop juggling solar software.
          </h2>
          <p className="text-xl text-slate-400 mb-10 leading-relaxed">
            Design, engineer, permit, and install — all from one platform built by people who've done it themselves.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto mb-6">
            <div className="relative flex-1">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full bg-slate-800/60 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/30 transition-all"
              />
            </div>
            <Link
              href={`/auth/register${email ? `?email=${encodeURIComponent(email)}` : ''}`}
              className="btn-primary px-6 py-3 rounded-xl whitespace-nowrap inline-flex items-center gap-2 justify-center"
            >
              Start Designing Free
            </Link>
          </div>
          <p className="text-slate-500 text-sm mb-8">3-day free trial · No credit card required · Cancel anytime</p>

          <div className="flex flex-wrap justify-center gap-6 text-sm text-slate-400">
            {[
              { icon: <Shield size={14} />, text: '256-bit encryption' },
              { icon: <CheckCircle size={14} />, text: 'SOC 2 compliant' },
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
                <div className="w-9 h-9 rounded-xl solar-gradient flex items-center justify-center">
                  <Sun size={18} className="text-slate-900" />
                </div>
                <div>
                  <div className="font-black text-white text-sm">SolarPro</div>
                  <div className="text-amber-400 text-xs">Design Platform</div>
                </div>
              </div>
              <p className="text-slate-500 text-xs leading-relaxed">
                The complete solar design and engineering platform for installers.
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold text-sm mb-3">Product</h4>
              <ul className="space-y-2 text-xs text-slate-500">
                <li><a href="#features" className="hover:text-slate-300 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-slate-300 transition-colors">Pricing</a></li>
                <li><Link href="/dashboard" className="hover:text-slate-300 transition-colors">Dashboard</Link></li>
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
              <a href="#" className="hover:text-slate-400 transition-colors">Privacy Policy</a>
              <a href="#" className="hover:text-slate-400 transition-colors">Terms of Service</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}