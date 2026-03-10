'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Users, Building2, FolderOpen,
  Cpu, Zap, Database, HardDrive, Activity,
  Shield, ChevronRight, LogOut, Sun,
} from 'lucide-react';

const NAV = [
  { href: '/admin',             label: 'Dashboard',      icon: LayoutDashboard },
  { href: '/admin/users',       label: 'Users',          icon: Users },
  { href: '/admin/companies',   label: 'Companies',      icon: Building2 },
  { href: '/admin/projects',    label: 'Projects',       icon: FolderOpen },
  { href: '/admin/engineering', label: 'Engineering',    icon: Cpu },
  { href: '/admin/incentives',  label: 'Incentives',     icon: Zap },
  { href: '/admin/utilities',   label: 'Utilities',      icon: Activity },
  { href: '/admin/database',    label: 'Database',       icon: Database },
  { href: '/admin/files',       label: 'File Storage',   icon: HardDrive },
  { href: '/admin/health',      label: 'System Health',  icon: Activity },
];

export default function AdminShell({
  admin,
  children,
}: {
  admin: { name: string; email: string; role: string };
  children: React.ReactNode;
}) {
  const path = usePathname();

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
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/admin' ? path === '/admin' : path.startsWith(href);
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
                {active && <ChevronRight size={12} className="ml-auto opacity-60" />}
              </Link>
            );
          })}
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
            <span className="text-white">{NAV.find(n => n.href === '/admin' ? path === '/admin' : path.startsWith(n.href))?.label ?? 'Admin'}</span>
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