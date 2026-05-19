import { describe, expect, it } from 'vitest'
import {
  appendUtmParams,
  buildFunnelUrls,
  buildUtmParams,
  canonicalFunnelPath,
  normalizeBaseUrl,
} from './funnelUrls'

describe('funnel URL helpers', () => {
  it('normalizes base URLs without trailing slashes', () => {
    expect(normalizeBaseUrl('https://solar.example.com///')).toBe('https://solar.example.com')
  })

  it('returns the canonical public path for the homeowner estimate funnel', () => {
    expect(canonicalFunnelPath('free-solar-estimate')).toBe('/free-solar-estimate')
    expect(canonicalFunnelPath(' free-solar-estimate ')).toBe('/free-solar-estimate')
    expect(canonicalFunnelPath('free-solar-estimate', '/free-solar-estimate')).toBe('/free-solar-estimate')
    expect(canonicalFunnelPath('free-solar-estimate', '  /free-solar-estimate  ')).toBe('/free-solar-estimate')
    expect(canonicalFunnelPath('unknown-funnel')).toBeNull()
  })

  it('keeps the homeowner fallback mapped even when row metadata is missing', () => {
    expect(buildFunnelUrls({
      slug: 'free-solar-estimate',
      canonical_path: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
    }, 'https://018hr.app.super.myninja.ai')).toEqual({
      canonicalUrl: 'https://018hr.app.super.myninja.ai/free-solar-estimate',
      embedUrl: 'https://018hr.app.super.myninja.ai/free-solar-estimate',
      utmReadyUrl: 'https://018hr.app.super.myninja.ai/free-solar-estimate',
    })
  })

  it('builds only populated UTM attribution params', () => {
    const params = buildUtmParams({
      utm_source: ' facebook ',
      utm_medium: 'cpc',
      utm_campaign: ' austin_solar_q3 ',
    })

    expect(params.toString()).toBe('utm_source=facebook&utm_medium=cpc&utm_campaign=austin_solar_q3')
  })

  it('appends UTM params to URLs while preserving existing query strings', () => {
    expect(appendUtmParams('https://solar.example.com/free-solar-estimate', {
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'austin_solar_q3',
    })).toBe('https://solar.example.com/free-solar-estimate?utm_source=facebook&utm_medium=cpc&utm_campaign=austin_solar_q3')

    expect(appendUtmParams('https://solar.example.com/free-solar-estimate?ref=partner', {
      utm_source: 'google',
      utm_medium: '',
      utm_campaign: 'brand',
    })).toBe('https://solar.example.com/free-solar-estimate?ref=partner&utm_source=google&utm_campaign=brand')
  })

  it('builds canonicalUrl, embedUrl, and utmReadyUrl from the canonical homeowner URL', () => {
    expect(buildFunnelUrls({
      slug: 'free-solar-estimate',
      utm_source: 'facebook',
      utm_medium: 'cpc',
      utm_campaign: 'austin_solar_q3',
    }, 'https://solar.example.com/')).toEqual({
      canonicalUrl: 'https://solar.example.com/free-solar-estimate',
      embedUrl: 'https://solar.example.com/free-solar-estimate',
      utmReadyUrl: 'https://solar.example.com/free-solar-estimate?utm_source=facebook&utm_medium=cpc&utm_campaign=austin_solar_q3',
    })
  })
})
