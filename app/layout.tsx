// BUILD v47.48 — Layout pipeline debug + roofPlanes restore fix
import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';
import { StoreProvider } from '@/store/StoreProvider';
import { UserProvider } from '@/contexts/UserContext';
import SolarDogWithTour from '@/components/support/SolarDogWithTour';
import { Suspense } from 'react';
import ImpersonationBanner from '@/components/ui/ImpersonationBanner';
import ClientMonitoringInit from '@/components/ClientMonitoringInit';
import { BUILD_VERSION } from '@/lib/version';

export const metadata: Metadata = {
  title: 'SolarPro Design Platform',
  description: 'Professional solar design and proposal platform for roof, ground mount, and vertical fence systems',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
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
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <ToastProvider>
          <StoreProvider>
            {/* UserProvider wraps entire app — single source of truth for user state */}
            <UserProvider>
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
            </UserProvider>
          </StoreProvider>
        </ToastProvider>
      </body>
    </html>
  );
}