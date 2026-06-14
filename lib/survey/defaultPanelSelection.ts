/**
 * lib/survey/defaultPanelSelection.ts
 * Phase 2H: Default panel selection from ecosystem catalog.
 *
 * Recommends a solar panel based on system type, region, and project
 * characteristics. Uses the equipment-db catalog as the single source
 * of truth for panel specifications.
 *
 * Selection logic:
 *   - Fence systems → bifacial vertical panel (panel-fence-ps1)
 *   - Roof residential → highest-efficiency monofacial panel (best ROI)
 *   - Ground mount / commercial → highest-wattage bifacial panel
 *   - All recommendations shown to user for approval (never auto-applied)
 */

import { SOLAR_PANELS, getPanelById } from '@/lib/equipment-db';
import type { SolarPanel } from '@/lib/equipment-db';

export interface PanelRecommendation {
  panelId: string;
  panel: SolarPanel;
  confidence: 'high' | 'medium' | 'low';
  source: 'ecosystem';
  reason: string;
}

/**
 * Select the default panel for a given system type.
 * Returns null if no suitable panel is found in the catalog.
 */
export function recommendDefaultPanel(systemType?: string): PanelRecommendation | null {
  // Fence systems always use the dedicated bifacial fence panel
  if (systemType === 'fence') {
    const fencePanel = getPanelById('panel-fence-ps1');
    if (fencePanel) {
      return {
        panelId: fencePanel.id,
        panel: fencePanel,
        confidence: 'high',
        source: 'ecosystem',
        reason: 'Fence systems require bifacial vertical panels optimized for E-W mounting',
      };
    }
  }

  // Ground mount → prefer bifacial for albedo gain
  if (systemType === 'ground') {
    const bifacialPanels = SOLAR_PANELS.filter(
      p => p.bifacial && p.active !== false && p.id !== 'panel-fence-ps1'
    );
    // Sort by wattage descending (highest production per panel)
    bifacialPanels.sort((a, b) => (b.watts || 0) - (a.watts || 0));
    const best = bifacialPanels[0];
    if (best) {
      return {
        panelId: best.id,
        panel: best,
        confidence: 'high',
        source: 'ecosystem',
        reason: `Ground mount benefits from bifacial gain. ${best.watts}W ${best.cellType || ''} panel recommended.`,
      };
    }
  }

  // Roof / default → prefer highest-efficiency monofacial panel
  const roofCandidates = SOLAR_PANELS.filter(
    p => !p.bifacial && p.active !== false && p.id !== 'panel-fence-ps1'
  );

  // Sort by efficiency descending, then wattage as tiebreaker
  roofCandidates.sort((a, b) => {
    const effDiff = (b.efficiency || 0) - (a.efficiency || 0);
    if (Math.abs(effDiff) > 0.5) return effDiff;
    return (b.watts || 0) - (a.watts || 0);
  });

  const bestRoof = roofCandidates[0];
  if (bestRoof) {
    return {
      panelId: bestRoof.id,
      panel: bestRoof,
      confidence: systemType === 'roof' ? 'high' : 'medium',
      source: 'ecosystem',
      reason: `Highest efficiency roof panel: ${bestRoof.watts}W at ${bestRoof.efficiency}% (${bestRoof.cellType || 'Mono'})`,
    };
  }

  // Absolute fallback: first active panel in catalog
  const anyPanel = SOLAR_PANELS.find(p => p.active !== false && p.id !== 'panel-fence-ps1');
  if (anyPanel) {
    return {
      panelId: anyPanel.id,
      panel: anyPanel,
      confidence: 'low',
      source: 'ecosystem',
      reason: 'Default panel from ecosystem catalog',
    };
  }

  return null;
}

/**
 * Get a short display label for a panel recommendation.
 */
export function getPanelLabel(panel: SolarPanel): string {
  return `${panel.manufacturer} ${panel.model}`;
}
