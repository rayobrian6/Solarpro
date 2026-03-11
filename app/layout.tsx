// BUILD v40.6 — 2025-03-10
import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';
import { StoreProvider } from '@/store/StoreProvider';
import { UserProvider } from '@/contexts/UserContext';
import SolarAIBot from '@/components/support/SolarAIBot';

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
      </head>
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">
        <ToastProvider>
          <StoreProvider>
            {/* UserProvider wraps entire app — single source of truth for user state */}
            <UserProvider>
              {children}
              {/* Free AI Support Bot — floating widget, visible on all pages */}
              <SolarAIBot />
            </UserProvider>
          </StoreProvider>
        </ToastProvider>
      </body>
    </html>
  );
}