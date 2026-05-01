// ============================================================================
// /mobile-login
//
// Browser bridge page for the SolarPro → mobile app SSO handoff.
//
// Flow:
//   1. Mobile app opens https://solarpro.solutions/mobile-login in a browser
//   2. If user is not logged in → shows "Sign in to SolarPro first" message
//   3. If user is logged in → calls POST /api/auth/mobile-session
//   4. Receives JWT → redirects to sitesurvey://login?token=<jwt>
//   5. Mobile app catches the deep link → calls POST /api/users/solarpro-sso
//   6. User is logged in to mobile app — no password entry required
//
// This page is intentionally minimal — it exists purely to hand the token
// to the mobile app and should complete in under 2 seconds.
// ============================================================================

'use client';

import { useEffect, useState } from 'react';

type Status = 'loading' | 'redirecting' | 'error' | 'unauthenticated';

export default function MobileLoginPage() {
  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        // Call the mobile-session endpoint — it will 401 if not logged in
        const res = await fetch('/api/auth/mobile-session', {
          method: 'POST',
          credentials: 'include',
        });

        if (cancelled) return;

        if (res.status === 401) {
          setStatus('unauthenticated');
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg = (body as { error?: string }).error ?? `Server error (${res.status})`;
          setErrorMsg(msg);
          setStatus('error');
          return;
        }

        const { token } = (await res.json()) as { token: string };

        if (!token) {
          setErrorMsg('No token returned from server');
          setStatus('error');
          return;
        }

        setStatus('redirecting');

        // Redirect to the mobile app via deep link
        const deepLink = `sitesurvey://login?token=${encodeURIComponent(token)}`;
        window.location.href = deepLink;
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setErrorMsg(msg);
        setStatus('error');
      }
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <img
          src="https://img1.wsimg.com/isteam/ip/b4ef19f7-7f46-446b-bbe2-755512fcd4f8/UNDER%20THE%20SUN%20LOGO.jpg/:/rs=w:300,h:300,m"
          alt="Under the Sun Solar"
          style={styles.logo}
        />

        {status === 'loading' && (
          <>
            <div style={styles.spinner} />
            <p style={styles.message}>Preparing your session…</p>
          </>
        )}

        {status === 'redirecting' && (
          <>
            <div style={{ ...styles.spinner, borderTopColor: '#22c55e' }} />
            <p style={styles.message}>Opening Site Survey app…</p>
            <p style={styles.sub}>If the app doesn't open automatically, make sure it's installed on your device.</p>
          </>
        )}

        {status === 'unauthenticated' && (
          <>
            <p style={styles.message}>You need to be signed in to SolarPro first.</p>
            <p style={styles.sub}>Please log in at <a href="https://solarpro.solutions/auth/login" style={styles.link}>solarpro.solutions</a> and then tap "Use SolarPro Account" again.</p>
          </>
        )}

        {status === 'error' && (
          <>
            <p style={{ ...styles.message, color: '#ef4444' }}>Something went wrong</p>
            <p style={styles.sub}>{errorMsg}</p>
            <button
              style={styles.retryBtn}
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1220',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  card: {
    backgroundColor: '#151E2F',
    border: '1px solid #1E2D45',
    borderRadius: 16,
    padding: '36px 32px',
    maxWidth: 400,
    width: '100%',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  logo: {
    width: 120,
    height: 50,
    objectFit: 'contain',
    marginBottom: 24,
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #1E2D45',
    borderTop: '3px solid #F5C842',
    borderRadius: '50%',
    margin: '0 auto 20px',
    animation: 'spin 0.8s linear infinite',
  },
  message: {
    fontSize: 16,
    fontWeight: 600,
    color: '#E8EDF5',
    margin: '0 0 10px',
  },
  sub: {
    fontSize: 13,
    color: '#7A8FA6',
    margin: '0 0 16px',
    lineHeight: 1.5,
  },
  link: {
    color: '#F5C842',
    textDecoration: 'none',
  },
  retryBtn: {
    marginTop: 8,
    padding: '10px 24px',
    backgroundColor: '#F5C842',
    color: '#0B1220',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
};