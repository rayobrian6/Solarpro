/**
 * components/recommend/index.ts
 * Phase 2 — Compute & Recommend reusable component barrel.
 *
 * Three core components for the three-tier automation framework:
 *   ConfidenceBadge  — inline confidence + source indicator
 *   ComputedField    — form field with computed value + expert override
 *   RecommendationCard — current vs recommended with apply/dismiss
 */

export { ConfidenceBadge } from './ConfidenceBadge';
export type {
  ConfidenceLevel,
  ConfidenceSource,
  ConfidenceBadgeProps,
} from './ConfidenceBadge';

export { ComputedField } from './ComputedField';
export type {
  ComputedFieldValue,
  ComputedFieldProps,
} from './ComputedField';

export { RecommendationCard } from './RecommendationCard';
export type {
  RecommendationValue,
  RecommendationCardProps,
} from './RecommendationCard';
