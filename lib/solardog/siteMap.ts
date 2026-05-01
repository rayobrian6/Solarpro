/**
 * lib/solardog/siteMap.ts
 *
 * Canonical site map for SolarDog's navigation agent.
 * Every route the app has, with aliases and a description the LLM can use.
 *
 * Used by resolveRoute.ts to match user intent → route.
 */

export interface SiteRoute {
  /** The actual Next.js route path */
  route: string;
  /** Short label shown in confirmation messages */
  label: string;
  /** One-line description for LLM context */
  description: string;
  /** All aliases (lowercase, no punctuation) that should map here */
  aliases: string[];
  /** Whether this route needs a projectId appended */
  projectScoped?: boolean;
  /** Optional tab parameter */
  defaultTab?: string;
}

/**
 * Full canonical site map.
 * IMPORTANT: aliases must be lowercase, no punctuation.
 * Resolver will normalize user input the same way before matching.
 */
export const SITE_MAP: SiteRoute[] = [
  {
    route: '/dashboard',
    label: 'Dashboard',
    description: 'Main command center — pipeline stats, revenue, project counts, quick actions',
    aliases: [
      'dashboard', 'home', 'main', 'command center', 'command centre',
      'headquarters', 'hq', 'start', 'overview', 'hub', 'control',
      'mission control', 'control panel', 'front page', 'main page',
      'index', 'landing', 'base', 'base camp',
    ],
  },
  {
    route: '/projects',
    label: 'Projects',
    description: 'All projects — leads, active jobs, completed installs, status tracking',
    aliases: [
      'projects', 'project list', 'project manager', 'jobs', 'job list',
      'all projects', 'my projects', 'installs', 'leads', 'pipeline',
      'work', 'contracts', 'clients projects', 'project board', 'project overview',
    ],
  },
  {
    route: '/projects/new',
    label: 'New Project',
    description: 'Create a brand new solar project',
    aliases: [
      'new project', 'create project', 'add project', 'start project',
      'new job', 'add job', 'create job', 'new install', 'new lead',
      'add a project', 'start a new project', 'new client project',
    ],
  },
  {
    route: '/engineering',
    label: 'Engineering',
    description: 'String sizing, wire sizing, NEC validation, BOM, shading — full engineering suite',
    aliases: [
      'engineering', 'engineer', 'string sizing', 'string calc', 'wire sizing',
      'nec', 'nec validation', 'string config', 'electrical', 'electrical design',
      'sizing', 'system design', 'tech', 'technical', 'calcs', 'calculations',
      'config', 'configuration', 'mppt', 'inverter config', 'panel config',
      'voltage', 'current', 'dc', 'system specs', 'specs',
    ],
    projectScoped: true,
  },
  {
    route: '/engineering',
    label: 'BOM',
    description: 'Bill of materials — all equipment, quantities, and costs',
    aliases: [
      'bom', 'bill of materials', 'materials', 'equipment list', 'parts list',
      'hardware list', 'parts', 'equipment', 'material list', 'parts summary',
      'hardware', 'components', 'what do i need', 'what equipment',
    ],
    projectScoped: true,
    defaultTab: 'bom',
  },
  {
    route: '/design',
    label: 'Design',
    description: 'Roof layout tool — place panels, optimise strings, satellite imagery',
    aliases: [
      'design', 'roof design', 'panel layout', 'roof layout', 'layout',
      'roof', 'panels on roof', 'place panels', 'roof map', 'aerial',
      'satellite', 'roof tool', 'layout tool', 'cad', 'drawing',
      'roof plan', 'panel placement', 'panel map', 'visual design',
      'map', 'roof view', 'panel designer',
    ],
    projectScoped: true,
  },
  {
    route: '/proposals',
    label: 'Proposals',
    description: 'Branded customer proposals with production estimates, financing, ITC 30%',
    aliases: [
      'proposals', 'proposal', 'quote', 'quotes', 'customer proposal',
      'branded proposal', 'sales doc', 'sales document', 'sales proposal',
      'offer', 'presentation', 'pitch', 'customer doc', 'client proposal',
      'estimate', 'price quote', 'financing', 'customer presentation',
      'sales pitch',
    ],
  },
  {
    route: '/clients',
    label: 'Clients',
    description: 'Client database — contact info, project history, communication',
    aliases: [
      'clients', 'client', 'customers', 'customer', 'contacts', 'contact list',
      'client list', 'customer list', 'crm', 'client database', 'customer database',
      'people', 'homeowners', 'homeowner', 'addresses',
    ],
  },
  {
    route: '/clients/new',
    label: 'New Client',
    description: 'Add a new client to the system',
    aliases: [
      'new client', 'add client', 'create client', 'new customer', 'add customer',
      'new contact', 'add contact',
    ],
  },
  {
    route: '/hardware',
    label: 'Hardware Catalog',
    description: 'Panel, inverter, battery catalog — browse and select equipment',
    aliases: [
      'hardware', 'hardware catalog', 'catalog', 'catalogue', 'equipment catalog',
      'panels', 'panel catalog', 'inverters', 'inverter list', 'batteries',
      'battery list', 'products', 'product catalog', 'solar panels',
      'panel library', 'inverter catalog', 'battery catalog', 'equipment library',
    ],
  },
  {
    route: '/analytics',
    label: 'Analytics',
    description: 'Business analytics — revenue trends, install volume, performance metrics',
    aliases: [
      'analytics', 'analytics page', 'stats', 'statistics', 'metrics',
      'reports', 'reporting', 'performance', 'kpi', 'kpis', 'business metrics',
      'revenue', 'trends', 'data', 'charts', 'graphs', 'numbers',
      'insights', 'business insights',
    ],
  },
  {
    route: '/settings',
    label: 'Settings',
    description: 'Account and company settings — profile, branding, pricing config',
    aliases: [
      'settings', 'setting', 'account', 'account settings', 'profile',
      'preferences', 'config', 'configuration', 'company settings',
      'my settings', 'user settings', 'admin settings', 'prefs',
      'options', 'setup', 'company profile', 'branding',
    ],
  },
  {
    route: '/account/billing',
    label: 'Billing',
    description: 'Subscription, billing, payment method',
    aliases: [
      'billing', 'billing page', 'subscription', 'payment', 'payments',
      'invoice', 'invoices', 'plan', 'my plan', 'upgrade', 'pricing page',
      'account billing', 'pay',
    ],
  },
  {
    route: '/operations',
    label: 'Operations',
    description: 'Field operations — installation tracking, scheduling, field crews',
    aliases: [
      'operations', 'ops', 'field ops', 'field operations', 'scheduling',
      'schedule', 'installation', 'install tracking', 'field', 'crews',
      'field crew', 'workers', 'installers',
    ],
  },
  {
    route: '/engineering/permit',
    label: 'Permit Package',
    description: 'Permit documents — SLD, plans, permit-ready package',
    aliases: [
      'permit', 'permits', 'permit package', 'sld', 'single line diagram',
      'single line', 'permit docs', 'permit documents', 'ahj', 'permit set',
      'interconnect', 'interconnection', 'utility interconnect', 'plan set',
      'permit drawings', 'fire setbacks', 'permit application',
    ],
  },
  {
    route: '/survey',
    label: 'Site Survey',
    description: 'Site survey tools — customer-facing survey links and responses',
    aliases: [
      'survey', 'site survey', 'customer survey', 'survey link', 'survey tool',
      'site assessment', 'assessment', 'site visit', 'site report',
    ],
  },
];

/**
 * Build a flat lookup map: alias → SiteRoute
 * Used by resolveRoute for O(1) lookup after normalization.
 */
export function buildAliasMap(routes: SiteRoute[] = SITE_MAP): Map<string, SiteRoute> {
  const map = new Map<string, SiteRoute>();
  for (const route of routes) {
    for (const alias of route.aliases) {
      map.set(alias.toLowerCase().trim(), route);
    }
  }
  return map;
}

/** Normalize a user phrase for alias matching */
export function normalizePhrase(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}