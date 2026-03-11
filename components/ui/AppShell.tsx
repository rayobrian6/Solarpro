'use client';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sun, LayoutDashboard, Users, FolderOpen, Zap,
  FileText, Settings, ChevronLeft, ChevronRight,
  Bell, Search, Menu, X,
  Cpu, BarChart3, Map, Home, Sprout, Fence,
  LogOut, HelpCircle, ExternalLink, Wrench,
  CreditCard, ArrowRight, Clock, AlertTriangle, Star, ChevronDown,
  Shield
} from 'lucide-react';
import SubscriptionBanner from './SubscriptionBanner';
import { hasPlatformAccess } from '@/lib/permissions';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import { useUser, getAccountBadge, isAdminRole } from '@/contexts/UserContext';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  color?: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard',  href: '/dashboard', icon: <LayoutDashboard size={17} /> },
  { label: 'Clients',    href: '/clients',   icon: <Users size={17} /> },
  { label: 'Projects',   href: '/projects',  icon: <FolderOpen size={17} />, color: 'text-amber-400' },
  { label: 'Analytics',  href: '/analytics', icon: <BarChart3 size={17} /> },
  { label: 'Settings',   href: '/settings',  icon: <Settings size={17} /> },
];

// Secondary tools — accessible from within Projects, kept here for direct access
const toolItems: NavItem[] = [
  { label: 'Design Studio', href: '/design',    icon: <Map size={17} />,      color: 'text-amber-400' },
  { label: 'Proposals',     href: '/proposals', icon: <FileText size={17} />, color: 'text-blue-400' },
];

const adminItems: NavItem[] = [
  { label: 'Equipment Library', href: '/admin/hardware', icon: <Cpu size={17} /> },
  { label: 'Pricing',           href: '/admin/pricing',  icon: <Settings size={17} /> },
];

const systemTypes = [
  { label: 'Roof',   icon: <Home size={11} />,   color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
  { label: 'Ground', icon: <Sprout size={11} />, color: 'text-teal-400 bg-teal-500/10 border-teal-500/20' },
  { label: 'Fence',  icon: <Fence size={11} />,  color: 'text-purple-400 bg-purple-500/10 border-purple-500/20' },
];

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

function UserDropdown({ onLogout }: { onLogout: () => void }) {
  const { user, loading } = useUser();
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const badge = getAccountBadge(user);
  const initials = user ? getInitials(user.name) : '…';
  const displayName = user?.name || '…';
  const showAdminPortal = isAdminRole(user?.role);
  const showUpgrade = !isAdminRole(user?.role) && !user?.isFreePass && user?.subscriptionStatus !== 'active';

  return (
    <div className="relative">
      <div
        onClick={() => setOpen(!open)}
        className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-700/40 cursor-pointer transition-colors group"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-900 font-black text-xs flex-shrink-0">
          {loading ? '…' : initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white truncate">
            {loading ? 'Loading...' : displayName}
          </div>
          <div className={`text-xs truncate font-medium ${badge.color}`}>
            {loading ? '…' : badge.label}
          </div>
        </div>
        <ChevronDown size={13} className={`text-slate-500 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-20 overflow-hidden">
            {/* User info */}
            <div className="px-3 py-3 border-b border-slate-700/50">
              <div className="text-white font-semibold text-sm truncate">{displayName}</div>
              <div className="text-slate-500 text-xs truncate">{user?.email}</div>
              <div className={`text-xs font-medium mt-0.5 ${badge.color}`}>{badge.label}</div>
            </div>

            {/* Menu items */}
            <div className="py-1">
              {showAdminPortal && (
                <Link
                  href="/admin"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                >
                  <Shield size={14} /> Admin Portal
                </Link>
              )}
              <Link
                href="/account/billing"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
              >
                <CreditCard size={14} className="text-slate-500" /> Billing
              </Link>
              {showUpgrade && (
                <Link
                  href="/subscribe"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-amber-400 hover:text-amber-300 hover:bg-slate-700/50 transition-colors"
                >
                  <ArrowRight size={14} /> Upgrade Plan
                </Link>
              )}
              <Link
                href="/settings"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors"
              >
                <Settings size={14} className="text-slate-500" /> Settings
              </Link>
            </div>

            {/* Logout */}
            <div className="border-t border-slate-700/50 py-1">
              <button
                onClick={() => { setOpen(false); onLogout(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');

  // Global user state from UserContext — single source of truth
  const { user, loading: userLoading, refreshUser } = useUser();

  // Auto-reload when a new deployment is detected — fixes Vercel alias caching
  useVersionCheck();

  const isActive = (href: string) => pathname?.startsWith(href);

  // Close mobile menu on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  // Redirect unauthenticated users
  useEffect(() => {
    if (!userLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, userLoading, router]);

  // Trial expiration redirect — admin and free pass users are NEVER redirected
  useEffect(() => {
    if (!user) return;
    if (isAdminRole(user.role)) return;
    if (user.isFreePass) return;

    const allowedPaths = ['/subscribe', '/auth', '/enterprise', '/account/billing'];
    if (allowedPaths.some(p => pathname?.startsWith(p))) return;

    // Use hasPlatformAccess — single source of truth for all access decisions
    const access = hasPlatformAccess(user);
    if (!access) {
      router.push('/subscribe?expired=1');
    }
  }, [user, pathname, router]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    router.push('/auth/login');
  }

  const initials = user ? getInitials(user.name) : '…';
  const displayName = user?.name || '…';
  const badge = getAccountBadge(user);
  const isAdmin = isAdminRole(user?.role);
  const isFreePassUser = user?.isFreePass === true;
  const showSubscriptionCTA = !isAdmin && !isFreePassUser;

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-slate-700/50 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-9 h-9 rounded-xl solar-gradient flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/20 group-hover:shadow-amber-500/40 transition-shadow">
            <Sun size={19} className="text-slate-900" />
          </div>
          {!collapsed && (
            <div>
              <div className="font-black text-white text-sm leading-tight tracking-tight">SolarPro</div>
              <div className="text-xs text-amber-400/80 font-medium">Design Platform</div>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {!collapsed && (
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">Main</div>
        )}
        {navItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${collapsed ? 'justify-center px-2' : ''}
                ${active
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50 border border-transparent'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className={`flex-shrink-0 ${active ? 'text-amber-400' : item.color || ''}`}>
                {item.icon}
              </span>
              {!collapsed && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="bg-amber-500 text-slate-900 text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {item.badge}
                    </span>
                  )}
                  {item.href === '/design' && !active && (
                    <span className="text-xs text-amber-500/60 font-normal">Studio</span>
                  )}
                </>
              )}
            </Link>
          );
        })}

        {/* Tools section — quick access to Design Studio & Proposals */}
        <div className={`${collapsed ? 'border-t border-slate-700/50 my-3' : 'mt-5 mb-2'}`}>
          {!collapsed && (
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">Tools</div>
          )}
        </div>
        {toolItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${collapsed ? 'justify-center px-2' : ''}
                ${active
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50 border border-transparent'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className={`flex-shrink-0 ${active ? 'text-amber-400' : item.color || ''}`}>
                {item.icon}
              </span>
              {!collapsed && (
                <span className="flex-1">{item.label}</span>
              )}
            </Link>
          );
        })}

        <div className={`${collapsed ? 'border-t border-slate-700/50 my-3' : 'mt-5 mb-2'}`}>
          {!collapsed && (
            <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">Admin</div>
          )}
        </div>

        {adminItems.map((item) => {
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${collapsed ? 'justify-center px-2' : ''}
                ${active
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50 border border-transparent'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className="flex-shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}

        {/* Admin Portal link — only for admin/super_admin */}
        {isAdmin && (
          <>
            <div className={`${collapsed ? 'border-t border-slate-700/50 my-3' : 'mt-3 mb-2'}`}>
              {!collapsed && (
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">System</div>
              )}
            </div>
            <Link
              href="/admin"
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${collapsed ? 'justify-center px-2' : ''}
                ${isActive('/admin')
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
                  : 'text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/10 border border-transparent hover:border-amber-500/20'
                }
              `}
              title={collapsed ? 'Admin Portal' : undefined}
            >
              <span className="flex-shrink-0"><Shield size={17} /></span>
              {!collapsed && <span>Admin Portal</span>}
            </Link>
          </>
        )}
      </nav>

      {/* System Type Legend */}
      {!collapsed && (
        <div className="px-3 py-3 border-t border-slate-700/50">
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2 px-1">System Types</div>
          <div className="flex gap-1.5">
            {systemTypes.map(t => (
              <div key={t.label} className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium ${t.color}`}>
                {t.icon} {t.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscription CTA — hidden for admins and free pass users */}
      {!collapsed && showSubscriptionCTA && user && (
        <div className="px-3 pb-2">
          {user.subscriptionStatus === 'active' ? (
            <Link href="/account/billing" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors">
              <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <CreditCard size={11} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-emerald-400 capitalize">{user.plan} Plan</div>
                <div className="text-xs text-slate-500">Manage billing</div>
              </div>
            </Link>
          ) : (
            <Link href="/subscribe" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors">
              <div className="w-6 h-6 rounded-lg bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <ArrowRight size={11} className="text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-amber-400">Upgrade Plan</div>
                <div className="text-xs text-slate-500">
                  {user.subscriptionStatus === 'trialing' && user.trialEndsAt
                    ? `Trial: ${Math.max(0, Math.ceil((new Date(user.trialEndsAt).getTime() - Date.now()) / 86400000))} days left`
                    : 'Unlock all features'}
                </div>
              </div>
            </Link>
          )}
        </div>
      )}

      {/* Free Pass badge — shown for free pass non-admin users */}
      {!collapsed && isFreePassUser && !isAdmin && user && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
              <Star size={11} className="text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-emerald-400">Free Pass</div>
              <div className="text-xs text-slate-500">Full access granted</div>
            </div>
          </div>
        </div>
      )}

      {/* Admin badge — shown for admin/super_admin */}
      {!collapsed && isAdmin && user && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20">
            <div className="w-6 h-6 rounded-lg bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <Shield size={11} className="text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-purple-400">
                {user.role === 'super_admin' ? 'Super Admin' : 'Admin'}
              </div>
              <div className="text-xs text-slate-500">Full system access</div>
            </div>
          </div>
        </div>
      )}

      {/* User Profile */}
      <div className={`px-3 py-3 border-t border-slate-700/50 flex-shrink-0 ${collapsed ? 'flex justify-center' : ''}`}>
        {collapsed ? (
          <div
            onClick={handleLogout}
            className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-900 font-black text-xs cursor-pointer hover:scale-110 transition-transform"
            title={`${displayName} — click to logout`}
          >
            {userLoading ? '…' : initials}
          </div>
        ) : (
          <UserDropdown onLogout={handleLogout} />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-slate-950 overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col bg-slate-900 border-r border-slate-700/50 transition-all duration-300 flex-shrink-0 relative ${
          collapsed ? 'w-[60px]' : 'w-60'
        }`}
      >
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 w-6 h-6 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-all z-10 shadow-lg"
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 bg-slate-900 border-r border-slate-700/50 flex flex-col z-10 shadow-2xl">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 btn-ghost p-1.5 rounded-lg z-20"
            >
              <X size={16} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SubscriptionBanner />
        <header className="h-14 bg-slate-900/90 border-b border-slate-700/50 flex items-center gap-3 px-4 lg:px-5 flex-shrink-0 backdrop-blur-sm">
          <button
            className="lg:hidden btn-ghost p-2 rounded-lg"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            <Menu size={18} />
          </button>

          <div className="flex-1 max-w-sm">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search clients, projects..."
                value={searchVal}
                onChange={e => setSearchVal(e.target.value)}
                className="w-full bg-slate-800/60 border border-slate-700/50 rounded-lg pl-8 pr-4 py-1.5 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/40 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="hidden md:flex items-center gap-1.5 mr-1">
              <Link href="/clients/new" className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white flex items-center gap-1.5">
                <Users size={12} /> New Client
              </Link>
              <Link href="/projects/new" className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white flex items-center gap-1.5">
                <FolderOpen size={12} /> New Project
              </Link>
            </div>

            <div className="hidden md:block w-px h-5 bg-slate-700" />

            <button className="btn-ghost p-2 rounded-lg relative group">
              <Bell size={16} />
              <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-amber-500 rounded-full" />
            </button>

            <button className="btn-ghost p-2 rounded-lg hidden md:flex">
              <HelpCircle size={16} />
            </button>

            <div
              onClick={handleLogout}
              className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-900 font-black text-xs cursor-pointer hover:scale-110 transition-transform"
              title={`${displayName} — click to logout`}
            >
              {userLoading ? '…' : initials}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}