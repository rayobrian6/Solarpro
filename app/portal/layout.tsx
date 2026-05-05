import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'My Solar Project | SolarPro',
  description: 'Track your solar installation progress.',
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {children}
    </div>
  );
}