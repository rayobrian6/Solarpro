'use client';

/**
 * ============================================================
 * ConfidenceBadge.tsx — Phase 2 UX Reusable Component
 *
 * Displays the confidence level and source of a computed or
 * recommended field value. Used inside ComputedField and
 * RecommendationCard, but also available standalone.
 *
 * Confidence Levels:
 *   high   → green  — derived from authoritative source (bill OCR, PVWatts API)
 *   medium → amber  — derived from state/regional averages
 *   low    → red    — fallback estimate, needs user verification
 *
 * HARD RULES:
 *   - Never hide low-confidence indicators
 *   - Source label must always be visible
 *   - Compact enough for inline use in form fields
 * ============================================================
 */

import React from 'react';
import { Badge } from '@/components/ui/Badge';
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Calculator,
  Cpu,
  FileText,
  MapPin,
  Sun,
  Zap,
  Database,
  ClipboardList,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ConfidenceSource =
  | 'bill-ocr'        // Extracted from uploaded utility bill
  | 'pvwatts'         // NREL PVWatts API computation
  | 'local_calc'      // Local PVWatts-method calculation (no API call)
  | 'state-avg'       // State-level average/fallback
  | 'ahj'             // Authority Having Jurisdiction database
  | 'nec'             // NEC code calculation
  | 'utility-db'      // Utility database lookup
  | 'address-lookup'  // Geocoded from address
  | 'ecosystem'       // Ecosystem catalog default
  | 'satellite'       // Satellite imagery analysis
  | 'registry'        // Business registry lookup (OpenCorporates, etc.)
  | 'datasheet'       // Manufacturer datasheet extraction
  | 'survey'          // Field survey observation
  | 'fallback'        // Rough fallback when computation fails
  | 'user'            // User-entered (overrides computation)
  | 'manual';         // Manual entry (no computation)

export interface ConfidenceBadgeProps {
  /** Confidence level of the value */
  confidence: ConfidenceLevel;
  /** Source of the computation/extraction */
  source: ConfidenceSource;
  /** Optional detail text (e.g. "12 months of data") */
  detail?: string;
  /** Size variant — xs for inline in field labels, sm for cards */
  size?: 'xs' | 'sm';
  /** Whether the user has overridden this value */
  overridden?: boolean;
  /** Additional CSS classes */
  className?: string;
}

// ── Source Labels & Icons ──────────────────────────────────────
const SOURCE_LABELS: Record<ConfidenceSource, string> = {
  'bill-ocr':       'Bill OCR',
  'pvwatts':        'PVWatts',
  'local_calc':     'Local Calc',
  'state-avg':      'State Avg',
  'ahj':            'AHJ',
  'nec':            'NEC Calc',
  'utility-db':     'Utility DB',
  'address-lookup': 'Address',
  'ecosystem':      'Ecosystem',
  'satellite':      'Satellite',
  'registry':       'Registry',
  'datasheet':      'Datasheet',
  'survey':         'Survey',
  'fallback':       'Fallback',
  'user':           'User',
  'manual':         'Manual',
};

const SOURCE_ICONS: Record<ConfidenceSource, React.ElementType> = {
  'bill-ocr':       FileText,
  'pvwatts':        Sun,
  'local_calc':     Calculator,
  'state-avg':      MapPin,
  'ahj':            Database,
  'nec':            Zap,
  'utility-db':     Database,
  'address-lookup': MapPin,
  'ecosystem':      Cpu,
  'satellite':      MapPin,
  'registry':       Database,
  'datasheet':      FileText,
  'survey':         ClipboardList,
  'fallback':       HelpCircle,
  'user':           CheckCircle2,
  'manual':         HelpCircle,
};

// ── Confidence Visual Mapping ──────────────────────────────────
const CONFIDENCE_VARIANT: Record<ConfidenceLevel, 'success' | 'warning' | 'danger'> = {
  high:   'success',
  medium: 'warning',
  low:    'danger',
};

const CONFIDENCE_ICON: Record<ConfidenceLevel, React.ElementType> = {
  high:   CheckCircle2,
  medium: AlertTriangle,
  low:    HelpCircle,
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high:   'High',
  medium: 'Med',
  low:    'Low',
};

// ── Component ──────────────────────────────────────────────────
export function ConfidenceBadge({
  confidence,
  source,
  detail,
  size = 'xs',
  overridden = false,
  className = '',
}: ConfidenceBadgeProps) {
  const SourceIcon = SOURCE_ICONS[source];
  const ConfIcon = CONFIDENCE_ICON[confidence];
  const variant = CONFIDENCE_VARIANT[confidence];

  // When user has overridden the computed value, show a muted "overridden" state
  if (overridden) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-slate-700/60 text-slate-400 border border-slate-600/40 ${className}`}
        title={`Originally from ${SOURCE_LABELS[source]} — overridden by user`}
      >
        <SourceIcon size={10} className="text-slate-500" />
        <span className="line-through">{SOURCE_LABELS[source]}</span>
        <span>· User</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      title={`${CONFIDENCE_LABEL[confidence]} confidence from ${SOURCE_LABELS[source]}${detail ? ` — ${detail}` : ''}`}
    >
      <Badge
        variant={variant}
        size={size}
        dot
        icon={<ConfIcon size={size === 'xs' ? 10 : 12} />}
      >
        {SOURCE_LABELS[source]}
      </Badge>
      {detail && (
        <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
          {detail}
        </span>
      )}
    </span>
  );
}

export default ConfidenceBadge;
