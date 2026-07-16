import AppShell from "@/components/ui/AppShell";

export default function GeneratorEstimatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Generator-estimator is a standalone sizing tool. Wrap all sub-routes
  // (/engineering/generator-estimator, .../bill, .../proposal) in the
  // standard Solarpro AppShell so users get the sidebar + global chrome.
  return <AppShell>{children}</AppShell>;
}
