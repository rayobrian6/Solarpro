// BUILD v47.48 — Layout pipeline debug + roofPlanes restore fix
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';
import { StoreProvider } from '@/store/StoreProvider';
import { UserProvider } from '@/contexts/UserContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import ImpersonationBanner from '@/components/ui/ImpersonationBanner';
import ClientMonitoringInit from '@/components/ClientMonitoringInit';
import { BUILD_VERSION } from '@/lib/version';

// SolarDogWithTour uses inline <style> tags and localStorage — must be client-only
// to prevent React hydration mismatch (#418 / #425)
const SolarDogWithTour = dynamic(
  () => import('@/components/support/SolarDogWithTour'),
  { ssr: false }
);

export const metadata: Metadata = {
  title: 'SolarPro Design Platform',
  description: 'Professional solar design and proposal platform for roof, ground mount, and vertical fence systems. NEC-compliant SLDs, 3D design studio, homeowner portal, and e-signing — built for solar installers.',
  icons: { icon: '/favicon.ico' },
  openGraph: {
    type: 'website',
    siteName: 'SolarPro',
    title: 'SolarPro — Solar Design & Proposal Platform',
    description: 'NEC-compliant electrical engineering, 3D design studio, instant proposals, and a homeowner portal — all in one platform built for solar installers.',
    url: 'https://www.solarpro.solutions',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SolarPro — Solar Design & Proposal Platform',
    description: 'NEC-compliant electrical engineering, 3D design studio, instant proposals, and a homeowner portal — all in one platform built for solar installers.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: prevents false-positive hydration errors from
    // browser extensions (Grammarly, DarkReader, etc.) that modify the DOM
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* PERF v61: Preload CesiumJS so it's in browser cache before 3D view opens */}
        <link rel="preconnect" href="https://cesium.com" />
        <link
          rel="preload"
          href="https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Cesium.js"
          as="script"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Widgets/widgets.css"
          as="style"
          crossOrigin="anonymous"
        />
        {/* PERF v61: Preconnect to Google tile API to reduce DNS/TLS handshake delay */}
        <link rel="preconnect" href="https://tile.googleapis.com" />
        {/* PWA manifest — enables "Add to Home Screen" on mobile */}
        <link rel="manifest" href="/manifest.json" />
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased" suppressHydrationWarning>
        <ToastProvider>
          <StoreProvider>
            {/* UserProvider wraps entire app — single source of truth for user state */}
            <UserProvider>
              <ThemeProvider>
              {/* Impersonation banner — only visible when admin is impersonating a user */}
              <Suspense fallback={null}>
                <ImpersonationBanner />
              </Suspense>
              {children}
              {/* SolarDog 🐾 — AI agent, floating widget, visible on all pages */}
              {/* SolarDogWithTour auto-starts the onboarding tour for new users */}
              <SolarDogWithTour />
              {/* Client-side error monitoring — ships unhandled errors to Sentry when DSN is set */}
              <ClientMonitoringInit />
              {/* Version indicator — always visible for deployment verification */}
              <div style={{
                position: 'fixed', bottom: '4px', left: '4px',
                fontSize: '10px', color: 'rgba(148,163,184,0.6)',
                background: 'rgba(15,23,42,0.8)', padding: '2px 6px',
                borderRadius: '4px', zIndex: 9999, pointerEvents: 'none',
                fontFamily: 'monospace', letterSpacing: '0.02em',
              }}>
                {BUILD_VERSION}
              </div>
              </ThemeProvider>
            </UserProvider>
          </StoreProvider>
        </ToastProvider>
      </body>
    </html>
  );
}