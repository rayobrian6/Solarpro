import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = {
  title: 'My Solar Project | Under the Sun Solar',
  description: 'Track your solar installation progress, view projected savings, and stay updated every step of the way.',
};

export const viewport: Viewport = {
  themeColor: '#07070e',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#07070e] text-white antialiased">
      {children}
    </div>
  );
}