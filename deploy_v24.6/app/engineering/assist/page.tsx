'use client';
// Engineering Assist has been merged into the Engineering Intelligence Panel.
// This page redirects to the main engineering page.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function EngineeringAssistRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/engineering');
  }, [router]);
  return (
    <div className="flex items-center justify-center h-screen bg-slate-900">
      <div className="text-slate-400 text-sm">Redirecting to Engineering Intelligence Panel…</div>
    </div>
  );
}