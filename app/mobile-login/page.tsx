// ============================================================================
// /mobile-login — DISABLED
//
// This page previously served as an SSO bridge to log the user into the
// mobile survey app from SolarPro. Per MASTER DIRECTIVE (field-first
// architecture), SolarPro does not control mobile app authentication.
// The mobile app manages its own auth independently.
// ============================================================================

'use client';

export default function MobileLoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <h1 className="text-white font-bold text-lg">Mobile Login Unavailable</h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          Mobile app authentication is managed directly in the field app.
          Please log in through the mobile app.
        </p>
      </div>
    </div>
  );
}