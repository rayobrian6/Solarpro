export interface FunnelUrlInput {
  slug: string
  canonical_path?: string | null
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
}

export interface FunnelUrlSet {
  canonicalUrl: string
  embedUrl: string | null
  utmReadyUrl: string
}

const PUBLIC_FUNNEL_PATHS: Record<string, string> = {
  'free-solar-estimate': '/free-solar-estimate',
}

export function normalizeBaseUrl(baseUrl?: string | null): string {
  const raw = baseUrl || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}

export function canonicalFunnelPath(slug: string, explicitPath?: string | null): string | null {
  const cleanSlug = slug.trim()
  const cleanPath = explicitPath?.trim()

  if (cleanPath && cleanPath.startsWith('/')) return cleanPath

  if (cleanSlug === 'free-solar-estimate') return '/free-solar-estimate'

  return PUBLIC_FUNNEL_PATHS[cleanSlug] ?? null
}

export function buildUtmParams(input: Pick<FunnelUrlInput, 'utm_source' | 'utm_medium' | 'utm_campaign'>): URLSearchParams {
  const params = new URLSearchParams()
  if (input.utm_source?.trim()) params.set('utm_source', input.utm_source.trim())
  if (input.utm_medium?.trim()) params.set('utm_medium', input.utm_medium.trim())
  if (input.utm_campaign?.trim()) params.set('utm_campaign', input.utm_campaign.trim())
  return params
}

export function appendUtmParams(url: string, input: Pick<FunnelUrlInput, 'utm_source' | 'utm_medium' | 'utm_campaign'>): string {
  const params = buildUtmParams(input)
  const query = params.toString()
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}

export function buildFunnelUrls(input: FunnelUrlInput, baseUrl?: string | null): FunnelUrlSet {
  const path = canonicalFunnelPath(input.slug, input.canonical_path)
  const canonicalUrl = path ? `${normalizeBaseUrl(baseUrl)}${path}` : ''
  return {
    canonicalUrl,
    embedUrl: canonicalUrl || null,
    utmReadyUrl: canonicalUrl ? appendUtmParams(canonicalUrl, input) : '',
  }
}
