/**
 * Public exports for the Create Design modal slice.
 */

export { default as CreateDesignModal } from './CreateDesignModal';
export type { CreateDesignModalProps } from './CreateDesignModal';

export {
  appendDesign,
  DEFAULT_COST_PER_WATT,
  DEFAULT_NAME_PREFIX,
  generateDesignId,
  listDesignsForProject,
  NAME_MAX_LEN,
  NAME_MIN_LEN,
  readDesigns,
  suggestDesignName,
  validateDesignDraft,
  writeDesigns,
  COST_MAX,
  COST_MIN,
  __resetDesignsForTesting,
} from './Design';
export type { Design, DesignDraft, DesignValidation } from './Design';
