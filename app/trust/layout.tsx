// Trust Center layout — minimal pass-through. Stays out of the authenticated
// app chrome (sidebar, SolarDog, build-version watermark) so the public
// posture page reads like a Vercel/Cloudflare trust page, not an app screen.
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Trust Center — Security & Compliance | SolarPro',
  description:
    'SolarPro security and compliance posture: SOC 2, ISO 27001, ISO 27701, and ISO 27017 certifications in progress, security practices, subprocessor list, and policies.',
  robots: { index: true, follow: true },
};

export default function TrustLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
