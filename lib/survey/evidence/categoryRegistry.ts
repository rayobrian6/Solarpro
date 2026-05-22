export type SurveyEvidenceDomain = 'electrical' | 'roof' | 'site' | 'general';

export type SurveyEvidenceCategory =
  | 'main_service_panel'
  | 'subpanel'
  | 'meter'
  | 'disconnect'
  | 'grounding'
  | 'utility_connection'
  | 'roof_plane'
  | 'roof_edge'
  | 'ridge'
  | 'attic'
  | 'rafters'
  | 'obstructions'
  | 'roof_surface'
  | 'detached_structures'
  | 'trench_path'
  | 'battery_location'
  | 'inverter_location'
  | 'gateway_location'
  | 'garage_interior_wall'
  | 'attic_access'
  | 'utility_access'
  | 'overview'
  | 'duplicate'
  | 'blurry'
  | 'unusable'
  | 'uncategorized';

export type SurveyEvidenceEngineeringBucket =
  | 'electricalEvidence'
  | 'structuralEvidence'
  | 'roofLayoutEvidence'
  | 'sitePlanEvidence'
  | 'generalEvidence';

export interface SurveyEvidenceCategoryDefinition {
  category: SurveyEvidenceCategory;
  label: string;
  description: string;
  domain: SurveyEvidenceDomain;
  required: boolean;
  engineeringBucket: SurveyEvidenceEngineeringBucket;
  futureWorkerCompatible: boolean;
  aliases: string[];
}

export const SURVEY_EVIDENCE_CATEGORY_REGISTRY: Record<SurveyEvidenceCategory, SurveyEvidenceCategoryDefinition> = {
  main_service_panel: {
    category: 'main_service_panel',
    label: 'Main Service Panel',
    description: 'Photo evidence of the main service panel, open or closed, used for electrical traceability.',
    domain: 'electrical',
    required: true,
    engineeringBucket: 'electricalEvidence',
    futureWorkerCompatible: true,
    aliases: ['main_panel_open', 'main_panel_closed', 'main_panel', 'msp', 'service_panel', 'panel_photo', 'panel'],
  },
  subpanel: {
    category: 'subpanel',
    label: 'Subpanel',
    description: 'Photo evidence of a subpanel or downstream distribution panel.',
    domain: 'electrical',
    required: false,
    engineeringBucket: 'electricalEvidence',
    futureWorkerCompatible: true,
    aliases: ['sub_panel', 'subpanel'],
  },
  meter: {
    category: 'meter',
    label: 'Utility Meter',
    description: 'Photo evidence of the utility meter or meter socket.',
    domain: 'electrical',
    required: true,
    engineeringBucket: 'electricalEvidence',
    futureWorkerCompatible: true,
    aliases: ['meter', 'utility_meter'],
  },
  disconnect: {
    category: 'disconnect',
    label: 'Disconnect',
    description: 'Photo evidence of an AC/DC disconnect or service disconnect location.',
    domain: 'electrical',
    required: false,
    engineeringBucket: 'electricalEvidence',
    futureWorkerCompatible: true,
    aliases: ['disconnect', 'ac_disconnect', 'dc_disconnect'],
  },
  grounding: {
    category: 'grounding',
    label: 'Grounding / Bonding',
    description: 'Photo evidence relevant to grounding and bonding review.',
    domain: 'electrical',
    required: false,
    engineeringBucket: 'electricalEvidence',
    futureWorkerCompatible: true,
    aliases: ['grounding', 'grounding_bonding', 'ground', 'bonding'],
  },
  utility_connection: {
    category: 'utility_connection',
    label: 'Utility Connection',
    description: 'Photo evidence of utility connection, service entrance, or overhead/underground service context.',
    domain: 'electrical',
    required: false,
    engineeringBucket: 'electricalEvidence',
    futureWorkerCompatible: true,
    aliases: ['utility_connection', 'service_entrance', 'utility_access'],
  },
  roof_plane: {
    category: 'roof_plane',
    label: 'Roof Plane',
    description: 'Overview photo evidence of a roof plane used for layout traceability.',
    domain: 'roof',
    required: true,
    engineeringBucket: 'roofLayoutEvidence',
    futureWorkerCompatible: true,
    aliases: ['roof_overview', 'roof_plane', 'roof', 'roof_photo'],
  },
  roof_edge: {
    category: 'roof_edge',
    label: 'Roof Edge',
    description: 'Photo evidence of roof edge, eave, rake, or setback-sensitive boundary.',
    domain: 'roof',
    required: false,
    engineeringBucket: 'roofLayoutEvidence',
    futureWorkerCompatible: true,
    aliases: ['roof_edge', 'eave', 'rake'],
  },
  ridge: {
    category: 'ridge',
    label: 'Ridge',
    description: 'Photo evidence of ridge location or roof peak context.',
    domain: 'roof',
    required: false,
    engineeringBucket: 'roofLayoutEvidence',
    futureWorkerCompatible: true,
    aliases: ['ridge', 'roof_ridge'],
  },
  attic: {
    category: 'attic',
    label: 'Attic',
    description: 'Photo evidence from attic area used for structural context.',
    domain: 'roof',
    required: false,
    engineeringBucket: 'structuralEvidence',
    futureWorkerCompatible: true,
    aliases: ['attic'],
  },
  rafters: {
    category: 'rafters',
    label: 'Rafters',
    description: 'Photo evidence of rafters or framing members.',
    domain: 'roof',
    required: false,
    engineeringBucket: 'structuralEvidence',
    futureWorkerCompatible: true,
    aliases: ['rafters', 'rafter', 'attic_rafter', 'framing'],
  },
  obstructions: {
    category: 'obstructions',
    label: 'Obstructions',
    description: 'Photo evidence of roof obstructions such as vents, skylights, chimneys, or equipment.',
    domain: 'roof',
    required: false,
    engineeringBucket: 'roofLayoutEvidence',
    futureWorkerCompatible: true,
    aliases: ['obstruction', 'obstructions', 'roof_obstruction', 'chimney', 'skylight', 'vent'],
  },
  roof_surface: {
    category: 'roof_surface',
    label: 'Roof Surface',
    description: 'Close-up photo evidence of roof material or roof surface condition.',
    domain: 'roof',
    required: false,
    engineeringBucket: 'roofLayoutEvidence',
    futureWorkerCompatible: true,
    aliases: ['roof_detail', 'roof_surface', 'roof_material'],
  },
  detached_structures: {
    category: 'detached_structures',
    label: 'Detached Structures',
    description: 'Photo evidence of detached garages, accessory structures, or separate mounting locations.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['detached_structures', 'detached_structure', 'detached_garage'],
  },
  trench_path: {
    category: 'trench_path',
    label: 'Trench Path',
    description: 'Photo evidence of proposed trench or underground conduit path.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['trench_path', 'trenching', 'underground_path'],
  },
  battery_location: {
    category: 'battery_location',
    label: 'Battery Location',
    description: 'Photo evidence of proposed battery location.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['battery_location', 'battery'],
  },
  inverter_location: {
    category: 'inverter_location',
    label: 'Inverter Location',
    description: 'Photo evidence of proposed inverter location.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['inverter_location', 'inverter'],
  },
  gateway_location: {
    category: 'gateway_location',
    label: 'Gateway Location',
    description: 'Photo evidence of proposed gateway/controller location.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['gateway_location', 'gateway', 'controller_location'],
  },
  garage_interior_wall: {
    category: 'garage_interior_wall',
    label: 'Garage Interior Wall',
    description: 'Photo evidence of garage interior wall or mounting area.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['garage_interior_wall', 'garage_wall'],
  },
  attic_access: {
    category: 'attic_access',
    label: 'Attic Access',
    description: 'Photo evidence of attic access location.',
    domain: 'site',
    required: false,
    engineeringBucket: 'structuralEvidence',
    futureWorkerCompatible: true,
    aliases: ['attic_access', 'roof_access', 'access'],
  },
  utility_access: {
    category: 'utility_access',
    label: 'Utility Access',
    description: 'Photo evidence of utility access path or service access area.',
    domain: 'site',
    required: false,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['utility_access'],
  },
  overview: {
    category: 'overview',
    label: 'Site Overview',
    description: 'General site overview photo evidence for site-plan traceability.',
    domain: 'general',
    required: true,
    engineeringBucket: 'sitePlanEvidence',
    futureWorkerCompatible: true,
    aliases: ['site', 'site_overview', 'site_exterior', 'overview', 'exterior'],
  },
  duplicate: {
    category: 'duplicate',
    label: 'Duplicate',
    description: 'Photo marked or submitted as duplicate. Automated duplicate detection is not active in v1.',
    domain: 'general',
    required: false,
    engineeringBucket: 'generalEvidence',
    futureWorkerCompatible: true,
    aliases: ['duplicate'],
  },
  blurry: {
    category: 'blurry',
    label: 'Blurry',
    description: 'Photo marked or submitted as blurry. Automated blur scoring is not active in v1.',
    domain: 'general',
    required: false,
    engineeringBucket: 'generalEvidence',
    futureWorkerCompatible: true,
    aliases: ['blurry', 'blurred'],
  },
  unusable: {
    category: 'unusable',
    label: 'Unusable',
    description: 'Photo marked or submitted as unusable. Automated usability scoring is not active in v1.',
    domain: 'general',
    required: false,
    engineeringBucket: 'generalEvidence',
    futureWorkerCompatible: true,
    aliases: ['unusable', 'bad_photo'],
  },
  uncategorized: {
    category: 'uncategorized',
    label: 'Uncategorized',
    description: 'Photo evidence that could not be mapped to a canonical category.',
    domain: 'general',
    required: false,
    engineeringBucket: 'generalEvidence',
    futureWorkerCompatible: true,
    aliases: ['additional', 'unknown', 'uncategorized'],
  },
};

export const SURVEY_EVIDENCE_CATEGORIES = Object.keys(SURVEY_EVIDENCE_CATEGORY_REGISTRY) as SurveyEvidenceCategory[];

export const REQUIRED_SURVEY_EVIDENCE_CATEGORIES = SURVEY_EVIDENCE_CATEGORIES.filter(
  category => SURVEY_EVIDENCE_CATEGORY_REGISTRY[category].required,
);

export const SURVEY_EVIDENCE_CATEGORY_DOMAIN = SURVEY_EVIDENCE_CATEGORIES.reduce(
  (acc, category) => {
    acc[category] = SURVEY_EVIDENCE_CATEGORY_REGISTRY[category].domain;
    return acc;
  },
  {} as Record<SurveyEvidenceCategory, SurveyEvidenceDomain>,
);

export const SURVEY_EVIDENCE_CATEGORY_ALIASES = SURVEY_EVIDENCE_CATEGORIES.reduce(
  (acc, category) => {
    acc[category] = category;
    for (const alias of SURVEY_EVIDENCE_CATEGORY_REGISTRY[category].aliases) {
      acc[normalizeCategoryKey(alias)] = category;
    }
    return acc;
  },
  {} as Record<string, SurveyEvidenceCategory>,
);

export function normalizeCategoryKey(category: string): string {
  return category.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeSurveyEvidenceCategory(category: string | null | undefined): SurveyEvidenceCategory {
  if (!category) return 'uncategorized';
  return SURVEY_EVIDENCE_CATEGORY_ALIASES[normalizeCategoryKey(category)] ?? 'uncategorized';
}

export function inferSurveyEvidenceCategoryFromText(text: string | null | undefined): SurveyEvidenceCategory {
  if (!text) return 'uncategorized';
  const normalizedText = normalizeCategoryKey(text);
  const direct = SURVEY_EVIDENCE_CATEGORY_ALIASES[normalizedText];
  if (direct) return direct;

  const tokens = new Set(normalizedText.split('_').filter(Boolean));
  if (tokens.has('subpanel') || normalizedText.includes('sub_panel')) return 'subpanel';
  if (tokens.has('meter')) return 'meter';
  if (tokens.has('site') || tokens.has('exterior')) return 'overview';
  if (tokens.has('attic') && tokens.has('access')) return 'attic_access';
  if (tokens.has('attic') || tokens.has('rafter') || tokens.has('rafters')) return 'rafters';
  if (tokens.has('obstruction') || tokens.has('chimney') || tokens.has('skylight') || tokens.has('vent')) return 'obstructions';
  if (tokens.has('access')) return 'attic_access';
  if (tokens.has('ground') || tokens.has('bond') || tokens.has('grounding')) return 'grounding';
  if (normalizedText.includes('main_panel') || normalizedText.includes('main_service_panel') || normalizedText.includes('service_panel')) return 'main_service_panel';
  if (tokens.has('roof')) return 'roof_plane';

  return 'uncategorized';
}

export function getSurveyEvidenceDomain(category: SurveyEvidenceCategory): SurveyEvidenceDomain {
  return SURVEY_EVIDENCE_CATEGORY_REGISTRY[category].domain;
}

export function getSurveyEvidenceCategoryDefinition(category: SurveyEvidenceCategory): SurveyEvidenceCategoryDefinition {
  return SURVEY_EVIDENCE_CATEGORY_REGISTRY[category];
}

export function getSurveyEvidenceLabel(category: SurveyEvidenceCategory): string {
  return SURVEY_EVIDENCE_CATEGORY_REGISTRY[category].label;
}
