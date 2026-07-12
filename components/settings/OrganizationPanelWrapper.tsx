// ============================================================================
// components/settings/OrganizationPanelWrapper.tsx
//
// Phase 1B — Organization Authority Foundation
// Commit 7: Feature-Flagged Organization UI
//
// Server component that conditionally renders the new
// OrganizationAuthorityPanel (when ENTERPRISE_ORG_AUTHORITY_ENABLED is on)
// or the legacy OrganizationPanel (when it's off).
//
// This is the single integration point for the settings page — it replaces
// the direct <OrganizationPanel /> import. The settings page should import
// this wrapper instead.
// ============================================================================

import { isOrgAuthorityEnabled } from '@/lib/organizations';
import OrganizationPanel from './OrganizationPanel';
import OrganizationAuthorityPanel from './OrganizationAuthorityPanel';

export default function OrganizationPanelWrapper({ userId }: { userId: string }) {
  if (isOrgAuthorityEnabled()) {
    return <OrganizationAuthorityPanel userId={userId} />;
  }
  return <OrganizationPanel userId={userId} />;
}
