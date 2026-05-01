// Dynamic route: /engineering/[projectId]
// Redirects to /engineering?projectId=[projectId] so both URL formats work.
// This enables omnidirectional navigation — any module can link directly to
// /engineering/[projectId] without needing to construct query-string URLs.
'use client';
import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

export default function EngineeringProjectPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params?.projectId) {
      router.replace(`/engineering?projectId=${params.projectId}`);
    }
  }, [params?.projectId, router]);

  // Minimal loading state while redirect happens
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center">
      <div className="text-slate-400 text-sm animate-pulse">Loading Engineering Workspace…</div>
    </div>
  );
}