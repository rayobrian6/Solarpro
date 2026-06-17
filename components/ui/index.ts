// UI Component System — SolarPro
// Import from '@/components/ui' for clean, unified access

export { Card } from './Card';
export { MetricCard } from './MetricCard';
export { Section } from './Section';
export { Grid } from './Grid';
export { Badge } from './Badge';
export { PageHeader } from './PageHeader';

// Existing components (re-exported for convenience)
export { default as AppShell } from './AppShell';
export { useToast } from './Toast';
export { default as PlanGate } from './PlanGate';
export { default as UpgradeModal } from './UpgradeModal';
export { default as SubscriptionBanner } from './SubscriptionBanner';
export { default as SaveStatusBar } from './SaveStatusBar';
// Project pipeline components & helpers
export {
  STATUS_STEPS, STATUS_CONFIG, TYPE_ICONS_JSX, TYPE_BG, TYPE_LABEL,
  getUrgency, getNextAction, PipelineProgress, StatusDropdown,
} from './ProjectPipeline';

// Not-found state
export { NotFoundState } from './NotFoundState';
