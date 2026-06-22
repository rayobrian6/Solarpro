'use client';
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Sun, LayoutDashboard, Users, FolderOpen, Zap,
  FileText, Settings, ChevronLeft, ChevronRight, DollarSign,
  Bell, Search, Menu, X,
  Cpu, BarChart3, Map, Home,
  LogOut, HelpCircle, ExternalLink, Wrench,
  CreditCard, ArrowRight, AlertTriangle, Star, ChevronDown,
  Shield, MessageCircle, Bug, Network, Building2, Sparkles
} from 'lucide-react';
import SubscriptionBanner from './SubscriptionBanner';
import { hasPlatformAccess } from '@/lib/permissions';
import { useVersionCheck } from '@/hooks/useVersionCheck';
import GuidedTourController from '@/components/onboarding/GuidedTourController';
import { useUser, getAccountBadge, isAdminRole } from '@/contexts/UserContext';
import { logClick, logNavigation } from '@/lib/debug/clickAudit';
import { useAppStore } from '@/store/appStore';
import FeedbackModal from '@/components/ui/FeedbackModal';
import type { Project } from '@/types';

// ══════════════════════════════════════════════════════════════════
// NAV CONFIG
// ══════════════════════════════════════════════════════════════════

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
  color?: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard',      href: '/dashboard',  icon: <LayoutDashboard size={17} /> },
  { label: 'Clients',       href: '/clients',    icon: <Users size={17} /> },
  { label: 'Projects',      href: '/projects',   icon: <FolderOpen size={17} />, color: 'text-amber-400' },
  { label: 'Design Studio', href: '/design',     icon: <Map size={17} />,    color: 'text-amber-400' },
  { label: 'Engineering',   href: '/engineering',icon: <Wrench size={17} />, color: 'text-blue-400' },
  { label: 'Proposals',     href: '/proposals',  icon: <FileText size={17} /> },
  { label: 'Marketplace',    href: '/network',    icon: <Network size={17} />, color: 'text-emerald-400' },
  { label: 'Analytics',     href: '/analytics',  icon: <BarChart3 size={17} /> },
  { label: 'Settings',      href: '/settings',   icon: <Settings size={17} /> },
  { label: 'Equipment Library', href: '/hardware', icon: <Cpu size={17} /> },
  { label: 'Pricing',           href: '/pricing',  icon: <DollarSign size={17} /> },
];

function getInitials(name: string): string {
  if (!name) return '?';
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2);
}

// ══════════════════════════════════════════════════════════════════
// MINI TOAST — local to AppShell for header feedback
// ══════════════════════════════════════════════════════════════════

function useMiniToast() {
  const [msg, setMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  function show(text: string, ms = 2500) {
    setMsg(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMsg(null), ms);
  }

  const Toast = msg ? (
    <div className="fixed top-16 right-4 z-50 px-4 py-2 rounded-xl text-xs font-semibold shadow-xl animate-fade-in"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
      {msg}
    </div>
  ) : null;

  return { show, Toast };
}

// ══════════════════════════════════════════════════════════════════
// USER DROPDOWN — sidebar expanded state
// ══════════════════════════════════════════════════════════════════

function UserDropdown({ onLogout }: { onLogout: () => void }) {
  const { user, loading } = useUser();
  const [open, setOpen] = useState(false);

  const badge = getAccountBadge(user);
  const initials = user ? getInitials(user.name) : '…';
  const displayName = user?.name || '…';
  const showAdminPortal = isAdminRole(user?.role);
  const showUpgrade = !isAdminRole(user?.role) && !user?.isFreePass && user?.subscriptionStatus !== 'active';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { logClick('TOGGLE_USER_MENU'); setOpen(!open); }}
        className="w-full flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-slate-700/40 cursor-pointer transition-colors group text-left"
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
      </button>

      {open ? (
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
              {showAdminPortal ? (
                <Link href="/admin" onClick={() => { logNavigation('/admin'); setOpen(false); }}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors">
                  <Shield size={14} /> Admin Portal
                </Link>
              ) : null}
              <Link href="/account/billing" onClick={() => { logNavigation('/account/billing'); setOpen(false); }}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors">
                <CreditCard size={14} className="text-slate-500" /> Billing
              </Link>
              {showUpgrade ? (
                <Link href="/subscribe" onClick={() => { logNavigation('/subscribe'); setOpen(false); }}
                  className="flex items-center gap-2.5 px-3 py-2 text-sm text-amber-400 hover:text-amber-300 hover:bg-slate-700/50 transition-colors">
                  <ArrowRight size={14} /> Upgrade Plan
                </Link>
              ) : null}
              <Link href="/settings" onClick={() => { logNavigation('/settings'); setOpen(false); }}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors">
                <Settings size={14} className="text-slate-500" /> Settings
              </Link>
              <Link href="/onboarding" onClick={() => { logNavigation('/onboarding'); setOpen(false); }}
                className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">
                <Sparkles size={14} className="text-amber-500/60" /> Getting Started
              </Link>
            </div>

            {/* Logout — ONLY intentional path */}
            <div className="border-t border-slate-700/50 py-1">
              <button
                type="button"
                onClick={() => { logClick('USER_LOGOUT'); setOpen(false); onLogout(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <LogOut size={14} /> Sign Out
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// HEADER USER DROPDOWN — top-right avatar in header
// ══════════════════════════════════════════════════════════════════

function HeaderUserDropdown({ initials, displayName, loading, onLogout }: {
  initials: string; displayName: string; loading: boolean; onLogout: () => void;
}) {
  const { user } = useUser();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const badge = getAccountBadge(user);
  const showAdminPortal = isAdminRole(user?.role);

  useEffect(() => { setMounted(true); }, []);

  const handleOpen = useCallback(() => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      });
    }
    logClick('TOGGLE_HEADER_USER_MENU');
    setOpen(prev => !prev);
  }, []);

  const dropdown = open && mounted ? createPortal(
    <>
      <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />
      <div
        className="fixed w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-[9991]"
        style={{ top: dropdownPos.top, right: dropdownPos.right }}
      >
        <div className="px-3 py-3 border-b border-slate-700/50">
          <div className="text-white font-semibold text-sm truncate">{displayName}</div>
          <div className="text-slate-500 text-xs truncate">{user?.email}</div>
          <div className={`text-xs font-medium mt-0.5 ${badge.color}`}>{badge.label}</div>
        </div>
        <div className="py-1">
          {showAdminPortal ? (
            <Link href="/admin" onClick={() => { logNavigation('/admin'); setOpen(false); }}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors">
              <Shield size={14} /> Admin Portal
            </Link>
          ) : null}
          <Link href="/account/billing" onClick={() => { logNavigation('/account/billing'); setOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors">
            <CreditCard size={14} className="text-slate-500" /> Billing
          </Link>
          <Link href="/settings" onClick={() => { logNavigation('/settings'); setOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-300 hover:text-white hover:bg-slate-700/50 transition-colors">
            <Settings size={14} className="text-slate-500" /> Settings
          </Link>
          <Link href="/onboarding" onClick={() => { logNavigation('/onboarding'); setOpen(false); }}
            className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors">
            <Sparkles size={14} className="text-amber-500/60" /> Getting Started
          </Link>
        </div>
        <div className="border-t border-slate-700/50 py-1">
          <button type="button"
            onClick={() => { logClick('HEADER_USER_LOGOUT'); setOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors">
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={handleOpen}
        className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-900 font-black text-xs cursor-pointer hover:scale-110 transition-transform"
        title={displayName}
      >
        {loading ? '…' : initials}
      </button>
      {dropdown}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// NOTIFICATION DROPDOWN — real notifications derived from projects[]
// ══════════════════════════════════════════════════════════════════

function daysSinceDate(dateStr: string | undefined | null): number {
  if (!dateStr) return 0;
  try { return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)); }
  catch { return 0; }
}

function isProjectUrgent(p: Project): boolean {
  const days = daysSinceDate(p.updatedAt || p.createdAt);
  if (p.status === 'proposal' && days > 3) return true;
  if (p.status === 'approved' && days > 5) return true;
  return false;
}

function getProjectNotificationMessage(p: Project): string {
  const days = daysSinceDate(p.updatedAt || p.createdAt);
  if (p.status === 'proposal') return `Proposal stale ${days}d — follow up with client`;
  if (p.status === 'approved') return `Approved ${days}d ago — schedule installation`;
  return `Needs attention`;
}

// PHASE 4: NotificationDropdown with resolve action + mark-as-read.
// ✔ Click notification → opens project
// ✔ Resolve button → touches updatedAt via PATCH (clears urgency timer), dismisses locally
// ✔ Mark as read → dismiss from list without API call
function NotificationDropdown({ projects }: { projects: Project[] }) {
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  // Local dismissed set — items removed after resolve/dismiss without page reload
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [fbCount, setFbCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const loadProjects = useAppStore(s => s.loadProjects);

  // Poll for new feedback count (uses the same endpoint the admin page uses)
  useEffect(() => {
    let active = true;
    const poll = () => {
      fetch('/api/admin/feedback?status=new&limit=1').then(r => r.json()).then(d => {
        if (active && d.success && d.counts) {
          setFbCount(Number(d.counts.new_count) || 0);
        }
      }).catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 60_000);
    return () => { active = false; clearInterval(iv); };
  }, []);

  const notifications = projects
    .filter(p => isProjectUrgent(p) && !dismissed.has(p.id))
    .map(p => ({
      id: p.id,
      projectId: p.id,
      projectName: p.name,
      clientName: p.client?.name,
      message: getProjectNotificationMessage(p),
      status: p.status,
    }))
    .slice(0, 8);

  const count = notifications.length + fbCount;

  // Resolve: touch updatedAt via PATCH → clears urgency timer → dismiss locally
  async function handleResolve(e: React.MouseEvent, projectId: string) {
    e.preventDefault();
    e.stopPropagation();
    setResolving(projectId);
    try {
      await fetch(`/api/projects/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: projects.find(p => p.id === projectId)?.notes ?? '' }),
      });
      setDismissed(prev => new Set([...prev, projectId]));
      loadProjects(true);
    } catch { /* non-fatal */ }
    finally { setResolving(null); }
  }

  // Dismiss locally (mark as read without API call)
  function handleDismiss(e: React.MouseEvent, projectId: string) {
    e.preventDefault();
    e.stopPropagation();
    setDismissed(prev => new Set([...prev, projectId]));
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Compute dropdown position when opened
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 56, right: 16 });

  useLayoutEffect(() => {
    if (open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={btnRef}
        type="button"
        className="btn-ghost p-2 rounded-lg relative group"
        title={count > 0 ? `${count} urgent project${count !== 1 ? 's' : ''}` : 'Notifications'}
        onClick={() => { logClick('NOTIFICATIONS_CLICK'); setOpen(!open); }}
      >
        <Bell size={16} />
        {count > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] font-black flex items-center justify-center"
            style={{ background: '#EF4444', color: '#fff' }}>
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} />
          <div className="fixed w-80 z-[9991] rounded-xl overflow-hidden shadow-2xl"
            style={{
              top: pos.top,
              right: pos.right,
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
            }}>
            {/* Header */}
            <div className="px-4 py-2.5 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--border-color)' }}>
              <div className="flex items-center gap-2">
                <Bell size={13} style={{ color: count > 0 ? '#EF4444' : 'var(--text-muted)' }} />
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                  {count > 0 ? `${count} Urgent` : 'Notifications'}
                </span>
              </div>
              <button type="button" onClick={() => setOpen(false)}
                className="text-slate-500 hover:text-white transition-colors">
                <X size={13} />
              </button>
            </div>

            {/* Feedback banner for admins */}
            {fbCount > 0 ? (
              <Link href="/admin/feedback" onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 hover:bg-amber-500/10 transition-colors"
                style={{ borderBottom: '1px solid var(--border-color)' }}>
                <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                  <Bug size={12} className="text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-amber-400">{fbCount} new bug {fbCount === 1 ? 'report' : 'reports'}</div>
                  <div className="text-[11px] text-slate-500">Click to review in Admin Portal</div>
                </div>
              </Link>
            ) : null}

            {/* Notification list */}
            {notifications.length === 0 && fbCount === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="text-xs font-semibold" style={{ color: '#4ADE80' }}>
                  ✓ All projects on track
                </div>
                <div className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  No urgent items right now
                </div>
              </div>
            ) : notifications.length > 0 ? (
              <div className="max-h-80 overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
                {notifications.map((n, idx) => (
                  <div key={n.id}
                    className="group"
                    style={{ borderBottom: idx < notifications.length - 1 ? '1px solid var(--border-color)' : undefined }}>
                    {/* Top row: dot + name + dismiss */}
                    <Link href={`/projects/${n.projectId}`}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-3 px-4 pt-3 pb-1.5 hover:bg-slate-700/20 transition-colors">
                      <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: '#EF4444' }} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                          {n.clientName || n.projectName}
                        </div>
                        <div className="text-[11px] mt-0.5 leading-snug" style={{ color: 'var(--text-muted)' }}>
                          {n.message}
                        </div>
                      </div>
                      {/* Dismiss (mark read) */}
                      <button
                        type="button"
                        onClick={(e) => handleDismiss(e, n.projectId)}
                        className="flex-shrink-0 text-slate-600 hover:text-slate-400 transition-colors mt-0.5 opacity-0 group-hover:opacity-100"
                        title="Dismiss">
                        <X size={11} />
                      </button>
                    </Link>
                    {/* Action row: Resolve + Open */}
                    <div className="flex items-center gap-2 px-7 pb-2.5">
                      <button
                        type="button"
                        onClick={(e) => handleResolve(e, n.projectId)}
                        disabled={resolving === n.projectId}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-md transition-colors disabled:opacity-50"
                        style={{ background: 'rgba(34,197,94,0.12)', color: '#4ADE80', border: '1px solid rgba(34,197,94,0.2)' }}>
                        {resolving === n.projectId ? '...' : '✓ Resolve'}
                      </button>
                      <Link
                        href={`/projects/${n.projectId}`}
                        onClick={() => setOpen(false)}
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-md transition-colors"
                        style={{ background: 'rgba(59,130,246,0.10)', color: '#60A5FA', border: '1px solid rgba(59,130,246,0.2)' }}>
                        Open →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* Footer */}
            <div className="px-4 py-2.5" style={{ borderTop: '1px solid var(--border-color)' }}>
              <Link href="/projects" onClick={() => setOpen(false)}
                className="text-[11px] font-semibold hover:opacity-80 transition-opacity flex items-center gap-1"
                style={{ color: 'var(--accent-amber)' }}>
                View all projects <ArrowRight size={10} />
              </Link>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN SHELL
// ══════════════════════════════════════════════════════════════════

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchVal, setSearchVal] = useState('');
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const toast = useMiniToast();

  // ── Responsive auto-collapse ─────────────────────────────────────────────
  // On screens narrower than 1280px (xl breakpoint) the sidebar auto-collapses
  // to icon-only mode so the content area has room to breathe.
  // Once the user manually toggles the sidebar we stop auto-adjusting for the
  // remainder of the session (userToggledRef guards the resize handler).
  const userToggledRef = useRef(false);
  useLayoutEffect(() => {
    // Initial collapse on narrow screens (runs before first paint — no flicker)
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setCollapsed(true);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      // Only auto-adjust when the user has NOT manually toggled
      if (userToggledRef.current) return;
      setCollapsed(window.innerWidth < 1280);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  // Carry projectId through design↔engineering navigation
  const navHref = (baseHref: string) => {
    if (baseHref === '/design' || baseHref === '/engineering') {
      const projectId = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('projectId')
        : null;
      if (projectId) return `${baseHref}?projectId=${projectId}`;
    }
    return baseHref;
  };

  // Global user state from UserContext — single source of truth
  const { user, loading: userLoading, refreshUser } = useUser();

  // Projects from store — used for real notification counts
  const projects = useAppStore(s => s.projects);
  const projectsState = useAppStore(s => s.projectsState);
  const loadProjects = useAppStore(s => s.loadProjects);

  // Load projects if not yet loaded (needed for notification count)
  useEffect(() => {
    if (projectsState === 'idle') loadProjects(false);
  }, [projectsState, loadProjects]);

  // Auto-reload when a new deployment is detected
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

    const access = hasPlatformAccess(user);
    if (!access) {
      // Diagnostic log — helps identify why a user is being redirected.
      // Fields: userId, role, isFreePass, subscriptionStatus, trialEndsAt, hasAccess
      console.warn('[AppShell] Access denied → redirecting to /subscribe?expired=1', {
        userId:             user.id,
        role:               user.role,
        isFreePass:         user.isFreePass,
        subscriptionStatus: user.subscriptionStatus,
        trialEndsAt:        user.trialEndsAt,
        hasAccess:          access,
        pathname,
      });
      router.push('/subscribe?expired=1');
    }
  }, [user, pathname, router]);

  async function handleLogout() {
    logClick('LOGOUT_EXECUTE');
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {}
    // Refresh UserContext so it clears the in-memory user state immediately.
    // Without this, the stale user object persists in React state until the
    // next /api/auth/me call returns 401, causing a flash of logged-in UI.
    await refreshUser();
    router.push('/auth/login');
  }

  const initials = user ? getInitials(user.name) : '…';
  const displayName = user?.name || '…';
  const badge = getAccountBadge(user);
  const isAdmin = isAdminRole(user?.role);
  const isFreePassUser = user?.isFreePass === true;
  const showSubscriptionCTA = !isAdmin && !isFreePassUser;

  // ── Header search: placeholder behavior ──
  // Search state is captured but not yet wired to a global search backend.
  // On Enter, navigate to /projects with search param (best-effort).
  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!searchVal.trim()) return;
    logClick('HEADER_SEARCH', { query: searchVal });
    router.push(`/projects?search=${encodeURIComponent(searchVal.trim())}`);
    setSearchVal('');
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 flex-shrink-0 ${collapsed ? 'justify-center' : ''}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <Link href="/" className="flex items-center gap-3 group">
          <div className="relative w-9 h-9 rounded-xl solar-gradient flex items-center justify-center flex-shrink-0 shadow-lg shadow-amber-500/30 group-hover:shadow-amber-500/50 transition-all duration-300 group-hover:scale-105"><div className="absolute inset-0 rounded-xl bg-amber-400/20 blur-md -z-10 group-hover:bg-amber-400/30 transition-all" />
            <Sun size={19} className="text-slate-900" />
          </div>
          {!collapsed ? (
            <div>
              <div className="font-black text-white text-sm leading-tight tracking-tight">SolarPro</div>
              <div className="text-xs text-amber-400/80 font-medium">Design Platform</div>
            </div>
          ) : null}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {!collapsed ? (
          <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">Main</div>
        ) : null}
        {navItems.map((item) => {
          const active = isActive(item.href);
          const href = navHref(item.href);
          // Extract tour key from href: '/clients' -> 'clients', '/design' -> 'design'
          const tourKey = item.href.replace(/^\//, '') || 'dashboard';
          return (
            <Link
              key={item.href}
              href={href}
              onClick={() => logNavigation(item.href)}
              data-tour={tourKey}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${collapsed ? 'justify-center px-2' : ''}
                ${active
                  ? 'bg-amber-500/12 text-amber-400 border border-amber-500/25 shadow-[0_0_12px_rgba(251,191,36,0.12)] relative'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50 border border-transparent'
                }
              `}
              title={collapsed ? item.label : undefined}
            >
              <span className={`flex-shrink-0 ${active ? 'text-amber-400' : item.color || ''}`}>
                {item.icon}
              </span>
              {!collapsed ? (
                <>
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="bg-amber-500 text-slate-900 text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                      {item.badge}
                    </span>
                  ) : null}
                  {item.href === '/design' && !active ? (
                    <span className="text-xs text-amber-500/60 font-normal">Studio</span>
                  ) : null}
                </>
              ) : null}
            </Link>
          );
        })}

        {/* Admin Portal link — only for admin/super_admin */}
        {isAdmin ? (
          <>
            <div className={`${collapsed ? 'border-t border-slate-700/50 my-3' : 'mt-3 mb-2'}`}>
              {!collapsed ? (
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider px-3 mb-2">System</div>
              ) : null}
            </div>
            <Link
              href="/admin"
              onClick={() => logNavigation('/admin')}
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
              {!collapsed ? <span>Admin Portal</span> : null}
            </Link>
          </>
        ) : null}
      </nav>

      {/* Subscription CTA — hidden for admins and free pass users */}
      {!collapsed && showSubscriptionCTA && user ? (
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
      ) : null}

      {/* Free Pass badge */}
      {!collapsed && isFreePassUser && !isAdmin && user ? (
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
      ) : null}

      {/* Admin badge */}
      {!collapsed && isAdmin && user ? (
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
      ) : null}

      {/* User Profile — sidebar bottom */}
      <div className={`px-3 py-3 border-t border-slate-700/50 flex-shrink-0 ${collapsed ? 'flex justify-center' : ''}`}>
        {collapsed ? (
          /* Collapsed: non-interactive avatar — no misleading cursor/scale */
          <div
            className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-slate-900 font-black text-xs"
            title={displayName}
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
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--bg-primary)" }}>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col transition-all duration-300 flex-shrink-0 relative ${
          collapsed ? 'w-[60px]' : 'w-60'
        }`}
        style={{
          background: 'rgba(9,18,32,0.97)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          boxShadow: '4px 0 32px rgba(0,0,0,0.4)',
        }}
      >
        <SidebarContent />
        <button
          type="button"
          onClick={() => { logClick('TOGGLE_SIDEBAR'); userToggledRef.current = true; setCollapsed(!collapsed); }}
          className="absolute -right-3 top-20 w-6 h-6 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-full flex items-center justify-center text-slate-400 hover:text-white transition-all z-10 shadow-lg"
        >
          {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      </aside>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen ? (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-64 flex flex-col z-10" style={{ background: "rgba(9,18,32,0.98)", borderRight: "1px solid rgba(255,255,255,0.06)", boxShadow: "4px 0 32px rgba(0,0,0,0.6)" }}>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 btn-ghost p-1.5 rounded-lg z-20"
            >
              <X size={16} />
            </button>
            <SidebarContent />
          </aside>
        </div>
      ) : null}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <SubscriptionBanner />
        <header className="relative h-14 flex items-center gap-3 px-4 lg:px-5 flex-shrink-0" style={{ background: 'rgba(9,18,32,0.92)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)', boxShadow: '0 1px 0 rgba(251,191,36,0.08)', zIndex: 40 }}>
          {/* Accent gradient stripe */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent pointer-events-none" />
          <button
            type="button"
            className="lg:hidden btn-ghost p-2 rounded-lg"
            onClick={() => { logClick('TOGGLE_MOBILE_MENU'); setMobileOpen(!mobileOpen); }}
          >
            <Menu size={18} />
          </button>

          {/* Search — submits to /projects?search= on Enter */}
          <div className="flex-1 max-w-sm">
            <form onSubmit={handleSearchSubmit}>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search projects..."
                  value={searchVal}
                  onChange={e => setSearchVal(e.target.value)}
                  className="w-full bg-slate-800/80 border border-slate-700/60 rounded-xl pl-8 pr-4 py-1.5 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/60 focus:border-amber-500/50 transition-all hover:border-slate-600/80"
                />
              </div>
            </form>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="hidden md:flex items-center gap-1.5 mr-1">
              <Link href="/clients/new" onClick={() => logNavigation('/clients/new')}
                className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white flex items-center gap-1.5">
                <Users size={12} /> New Client
              </Link>
              <Link href="/projects/new" onClick={() => logNavigation('/projects/new')}
                className="btn-ghost px-2.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white flex items-center gap-1.5">
                <FolderOpen size={12} /> New Project
              </Link>
            </div>

            <div className="hidden md:block w-px h-5 bg-slate-700" />

            {/* Notifications — real dropdown from urgent projects */}
            <NotificationDropdown projects={projects} />

            {/* Report a Bug */}
            <button
              type="button"
              className="btn-ghost p-2 rounded-lg hidden md:flex items-center gap-1.5 text-xs text-slate-400 hover:text-amber-400"
              title="Report a bug or suggest an improvement"
              onClick={() => { logClick('FEEDBACK_CLICK'); setFeedbackOpen(true); }}
            >
              <Bug size={14} /> Report a Bug
            </button>

            {/* Help — opens the built-in SolarAI chat bot */}
            <button
              type="button"
              className="btn-ghost p-2 rounded-lg hidden md:flex"
              title="Help — opens AI support chat"
              onClick={() => {
                logClick('HELP_CLICK');
                // Toggle the SolarAIBot by dispatching a custom event it listens for,
                // or fall back to a toast if not available
                const botToggle = document.querySelector('[data-solar-ai-toggle]') as HTMLElement;
                if (botToggle) {
                  botToggle.click();
                } else {
                  toast.show('Use the chat widget in the bottom-right corner for help');
                }
              }}
            >
              <HelpCircle size={16} />
            </button>

            {/* User avatar — opens proper dropdown, NEVER triggers logout */}
            <HeaderUserDropdown
              initials={initials}
              displayName={displayName}
              loading={userLoading}
              onLogout={handleLogout}
            />
          </div>
        </header>

        <main className="flex-1 overflow-auto" style={{ background: "var(--bg-primary)" }}>
          {children}
        </main>
      </div>

      {/* Guided tour overlay — fires once for new users */}
      <GuidedTourController />

      {/* Mini toast for header actions */}
      {toast.Toast}

      {/* Feedback modal */}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}