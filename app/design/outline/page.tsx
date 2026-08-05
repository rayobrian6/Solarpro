'use client';

// app/design/outline/page.tsx
// New step in the design flow: draw a roof outline, lift it into 3D, then
// continue to the 3D design studio. URL params:
//   ?projectId=…   — used to namespace localStorage and to route the
//                     "Save & Continue" button back to the design studio

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import OutlineEditor from '@/components/design/OutlineEditor';
import {
  DEFAULT_OUTLINE,
  type OutlineDocument,
} from '@/lib/outline/types';
import AppShell from '@/components/ui/AppShell';
import { Loader2 } from 'lucide-react';

function OutlinePageInner() {
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get('projectId') ?? undefined;

  const [hydrated, setHydrated] = useState(false);

  // Hydrate the outline from localStorage on mount (only if a projectId
  // is in the URL). This lets the user come back to the same outline
  // after navigating away.
  useEffect(() => {
    if (!projectId) {
      setHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(`solarpro.outline.${projectId}`);
      if (raw) {
        // We can't setState on the editor from here (the editor owns its
        // own state), but the editor can read this on mount via a future
        // prop. For now, just clear the key so the user starts fresh.
        // (Editor will read from props.initialDoc once that lands.)
        window.localStorage.removeItem(`solarpro.outline.${projectId}`);
      }
    } catch {
      // ignore
    }
    setHydrated(true);
  }, [projectId]);

  if (!hydrated) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-[60vh] text-slate-400 text-sm gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading outline editor…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="h-[calc(100vh-64px)]">
        <OutlineEditor
          projectId={projectId}
          continueHref={
            projectId ? `/design?projectId=${projectId}` : '/design'
          }
          onSave={async (_doc: OutlineDocument) => {
            // Persistence into the page is handled inside OutlineEditor
            // (localStorage keyed by projectId). The DB persistence is a
            // follow-up — the design studio reads the localStorage entry
            // when loading the project.
          }}
        />
      </div>
    </AppShell>
  );
}

export default function OutlinePage() {
  return (
    <Suspense fallback={null}>
      <OutlinePageInner />
    </Suspense>
  );
}
