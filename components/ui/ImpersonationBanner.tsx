'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, X, LogOut } from 'lucide-react';

/**
 * ImpersonationBanner
 * Shows a persistent banner when an admin is impersonating a user.
 * Detects impersonation via:
 *   1. ?impersonating=1 query param (set by the impersonate redirect)
 *   2. sessionStorage flag (persists across navigations within the tab)
 */
export default function ImpersonationBanner() {
  const [visible, setVisible] = useState(false);
  const searchParams = useSearchParams();

  useEffect(() => {
    // Check query param on initial load
    if (searchParams.get('impersonating') === '1') {
      sessionStorage.setItem('solarpro_impersonating', '1');
      setVisible(true);
    } else if (sessionStorage.getItem('solarpro_impersonating') === '1') {
      setVisible(true);
    }
  }, [searchParams]);

  const endImpersonation = async () => {
    sessionStorage.removeItem('solarpro_impersonating');
    setVisible(false);
    // Log out the impersonated session and redirect to admin portal
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/admin/users';
  };

  if (!visible) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] bg-purple-600 text-white px-4 py-2 flex items-center justify-between shadow-lg">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-white/20 rounded-lg px-3 py-1">
          <Eye size={14} />
          <span className="text-sm font-bold">Admin Impersonation Active</span>
        </div>
        <span className="text-sm text-purple-200">
          You are viewing the app as this user. Actions you take will affect their account.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={endImpersonation}
          className="flex items-center gap-2 bg-white/20 hover:bg-white/30 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors"
        >
          <LogOut size={13} />
          End Impersonation
        </button>
        <button
          onClick={() => setVisible(false)}
          className="p-1.5 hover:bg-white/20 rounded-lg transition-colors"
          title="Dismiss banner (impersonation still active)"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}