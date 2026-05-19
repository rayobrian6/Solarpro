import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const pageSource = fs.readFileSync(
  path.join(process.cwd(), 'app/free-solar-estimate/page.tsx'),
  'utf8'
)

describe('/free-solar-estimate public intake funnel', () => {
  it('posts only to the canonical homeowner intake endpoint', () => {
    expect(pageSource).toContain("fetch('/api/intake/homeowner'")
    expect(pageSource).not.toContain('/api/intake/webhook')
    expect(pageSource).not.toContain('/api/admin/network')
    expect(pageSource).not.toContain('/api/network/opportunities')
  })

  it('maps requested form fields into canonical intake payload keys', () => {
    expect(pageSource).toContain('first_name: form.first_name.trim()')
    expect(pageSource).toContain('last_name: form.last_name.trim()')
    expect(pageSource).toContain('phone: form.phone.trim()')
    expect(pageSource).toContain('email: form.email.trim().toLowerCase()')
    expect(pageSource).toContain('address_line1: form.property_address.trim()')
    expect(pageSource).toContain('monthly_bill_amount: normalizeMoney(form.average_monthly_bill)')
    expect(pageSource).toContain('home_ownership: form.homeowner_status')
    expect(pageSource).toContain('roof_age_years: form.roof_age.trim()')
  })

  it('preserves non-canonical operational fields in notes without direct schema changes', () => {
    expect(pageSource).toContain('Utility provider:')
    expect(pageSource).toContain('Battery interest:')
    expect(pageSource).toContain('Preferred contact method:')
    expect(pageSource).toContain('Timeline:')
    expect(pageSource).toContain('File metadata only')
    expect(pageSource).not.toContain('CREATE TABLE')
    expect(pageSource).not.toContain('INSERT INTO network_opportunities')
    expect(pageSource).not.toContain('opportunity_intelligence')
    expect(pageSource).not.toContain('opportunity_screening_queue')
  })
})
