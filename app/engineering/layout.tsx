// ============================================================
// Engineering Route Layout — /app/engineering/layout.tsx
// PHASE 5: This is the designated mount point for the
// Engineering Assistant widget. The assistant is rendered
// inside the Intelligence Panel in page.tsx (which has access
// to the engineering state context). This layout provides the
// Next.js route segment boundary for all /engineering/* pages.
//
// To promote the assistant to a true layout-level component
// (shared across all /engineering/* sub-routes), lift the
// aiQuery / aiResponse / handleAiQuery state into a context
// provider here and consume it in page.tsx.
// ============================================================

export default function EngineeringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // PHASE 5 MOUNT POINT: Engineering Assistant context provider
  // would be instantiated here when promoted from page-level state.
  // Currently the assistant widget lives in page.tsx Intelligence Panel
  // and uses local state — no change to working logic required.
  return <>{children}</>;
}