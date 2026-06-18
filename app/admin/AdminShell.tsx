'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard, Users, Building2, FolderOpen,
  Cpu, Zap, Database, HardDrive, Activity,
  Shield, ChevronRight, LogOut, Sun, Wrench,
  ScrollText, Terminal, MessageSquare, Rocket, Layers, DollarSign, PenTool,
  UserPlus, LayoutTemplate, Network, GitBranch, History, Share2, Factory,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [
      { href: '/admin',           label: 'Dashboard',      icon: LayoutDashboard },
      { href: '/admin/roadmap',     label: 'Road to RE+ 26', icon: Rocket },
      { href: '/admin/topography',  label: 'Topography',     icon: Layers },
    ],
  },
  {
    label: 'Platform Users',
    items: [
      { href: '/admin/users',     label: 'Users',         icon: Users },
      { href: '/admin/companies', label: 'Companies',     icon: Building2 },
      { href: '/admin/projects',  label: 'Projects',      icon: FolderOpen },
      { href: '/admin/leads',          label: 'Leads',             icon: UserPlus },
      { href: '/admin/billing',         label: 'Billing',           icon: DollarSign },
      { href: '/admin/portal-dashboard', label: 'Homeowner Dashboard', icon: LayoutTemplate },
    ],
  },
  {
    label: 'Network Intelligence',
    items: [
      { href: '/admin/network', label: 'Control Center', icon: Network },
      { href: '/admin/prospects', label: 'Contractor Acquisition', icon: Factory },
    ],
  },  {
    label: 'Configuration',
    items: [
      { href: '/admin/engineering', label: 'Engineering Monitor', icon: Cpu },
      { href: '/admin/engineering-intelligence', label: 'Engineering Intelligence', icon: Network },
      { href: '/admin/engineering-intelligence', label: 'Project Intelligence Picker', icon: GitBranch },
      { href: '/admin/engineering-intelligence/snapshots', label: 'Snapshot Timeline', icon: History },
      { href: '/admin/engineering-intelligence/graph', label: 'Dependency Graph', icon: Share2 },
      { href: '/admin/incentives',  label: 'Incentives',  icon: Zap },
      { href: '/admin/utilities',   label: 'Utilities',   icon: Activity },
      { href: '/admin/hardware',    label: 'Hardware',    icon: Wrench },
    { href: '/admin/distributor-prices', label: 'Distributor Prices', icon: DollarSign },
      { href: '/admin/sld-emblems',          label: 'SLD Emblems',        icon: PenTool },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/system-tools',  label: 'System Tools',   icon: Terminal },
      { href: '/admin/activity-log',  label: 'Activity Log',   icon: ScrollText },
      { href: '/admin/database',      label: 'Database',       icon: Database },
      { href: '/admin/files',         label: 'File Storage',   icon: HardDrive },
      { href: '/admin/health',        label: 'System Health',  icon: Activity },
      { href: '/admin/feedback',      label: 'Feedback',       icon: MessageSquare },
    ],
  },
];

// Flat list for breadcrumb lookup
const ALL_NAV = NAV_SECTIONS.flatMap(s => s.items);

export default function AdminShell({
  admin,
  children,
}: {
  admin: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const path = usePathname();
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);

  // Fetch new feedback count on mount and every 30 seconds
  useEffect(() => {
    let mounted = true;
    async function fetchCount() {
      try {
        const res = await fetch('/api/admin/feedback/count');
        const data = await res.json();
        if (mounted && typeof data.count === 'number') {
          setNewFeedbackCount(data.count);
        }
      } catch {
        // Fail silently — non-critical
      }
    }
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => { mounted = false; clearInterval(interval); };
  }, []);

  // Reset count when viewing feedback page
  useEffect(() => {
    if (path === '/admin/feedback') {
      setNewFeedbackCount(0);
    }
  }, [path]);

  const isActive = (href: string) =>
    href === '/admin' ? path === '/admin' : path === href || path.startsWith(`${href}/`);

  const currentPage = [...ALL_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find(n => isActive(n.href))?.label ?? 'Admin';

  return (
    <div className="flex h-screen bg-[#0a0f1e] text-white overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-60 flex-shrink-0 bg-[#0d1424] border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
            <Sun size={16} className="text-black" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">SolarPro</div>
            <div className="text-[10px] text-amber-400 font-semibold tracking-widest uppercase">Admin Portal</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-4 overflow-y-auto">
          {NAV_SECTIONS.map(section => (
            <div key={section.label}>
              <div className="px-3 mb-1 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map(({ href, label, icon: Icon }) => {
                  const active = isActive(href);
                  const isFeedback = href === '/admin/feedback';
                  return (
                    <Link
                      key={href}
                      href={href}
                      className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                        active
                          ? 'bg-amber-500/15 text-amber-400 font-medium'
                          : 'text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon size={15} />
                      {label}
                      {/* New feedback badge */}
                      {isFeedback && newFeedbackCount > 0 ? (
                        <span className="ml-auto min-w-[20px] h-5 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5">
                          {newFeedbackCount > 99 ? '99+' : newFeedbackCount}
                        </span>
                      ) : null}
                      {active && !isFeedback && <ChevronRight size={12} className="ml-auto opacity-60" />}
                      {active && isFeedback && newFeedbackCount === 0 && <ChevronRight size={12} className="ml-auto opacity-60" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-xs font-bold">
              {admin.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-white truncate">{admin.name}</div>
              <div className="text-[10px] text-slate-500 truncate">{admin.role}</div>
            </div>
            <Link href="/dashboard" className="text-slate-500 hover:text-white transition-colors" title="Back to app">
              <LogOut size={14} />
            </Link>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <div className="sticky top-0 z-10 bg-[#0a0f1e]/80 backdrop-blur border-b border-white/5 px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Shield size={12} className="text-amber-400" />
            <span className="text-amber-400 font-medium">Admin Portal</span>
            <span>/</span>
            <span className="text-white">{currentPage}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
              admin.role === 'super_admin' ? 'bg-amber-500/20 text-amber-400' : 'bg-blue-500/20 text-blue-400'
            }`}>
              {admin.role === 'super_admin' ? '⚡ SUPER ADMIN' : '🛡 ADMIN'}
            </span>
            <Link href="/dashboard" className="text-xs text-slate-400 hover:text-white transition-colors">
              ← Back to App
            </Link>
          </div>
        </div>

        {/* Page content */}
        <div className="p-8">
          {children}
        </div>
      </main>
    </div>
  );
}