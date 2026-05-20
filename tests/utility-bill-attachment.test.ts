import { mkdtemp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { metadataOnlyUtilityBill, storeUtilityBillAttachment } from '@/lib/intake/utilityBillAttachment'

const originalCwd = process.cwd()
let tempDir: string | null = null

afterEach(async () => {
  vi.unstubAllEnvs()
  process.chdir(originalCwd)
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = null
  }
})

function pdfFile(name = 'utility bill.pdf') {
  return new File([Buffer.from('%PDF-1.7\nmock utility bill\n%%EOF')], name, { type: 'application/pdf' })
}

describe('utility bill attachment storage', () => {
  it('returns explicit metadata-only status without storing raw binaries in DB', () => {
    const metadata = metadataOnlyUtilityBill(new File(['x'], 'bill.pdf', { type: 'application/pdf' }))
    expect(metadata).toMatchObject({
      filename: 'bill.pdf',
      size_bytes: 1,
      content_type: 'application/pdf',
      storage_status: 'metadata_only_not_uploaded',
      accessible_url: null,
      download_url: null,
    })
  })

  it('stores supported utility bills to the existing local public upload fallback when Blob is not configured', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
    tempDir = await mkdtemp(join(tmpdir(), 'solarpro-bill-upload-'))
    process.chdir(tempDir)

    const stored = await storeUtilityBillAttachment(pdfFile(), {
      eventId: 'evt_homeowner_test',
      funnelSlug: 'free-solar-estimate',
    })

    expect(stored).toMatchObject({
      filename: 'utility bill.pdf',
      content_type: 'application/pdf',
      storage_status: 'stored',
      storage_provider: 'local_public_uploads',
      uploaded_at: expect.any(String),
    })
    expect(stored.accessible_url).toMatch(/^\/uploads\/intake\/utility-bills\/free-solar-estimate\/evt_homeowner_test\//)
    expect(stored.download_url).toBe(stored.accessible_url)
    expect(stored.storage_key).toMatch(/^public\/uploads\/intake\/utility-bills\//)
    expect(existsSync(join(tempDir, stored.storage_key))).toBe(true)
  })

  it('fails fast in production when Blob storage is not configured instead of writing to the deployment filesystem', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')

    await expect(
      storeUtilityBillAttachment(pdfFile(), {
        eventId: 'evt_homeowner_test',
        funnelSlug: 'free-solar-estimate',
      }),
    ).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/)
  })

  it('rejects spoofed files before storage', async () => {
    await expect(
      storeUtilityBillAttachment(new File(['not a pdf'], 'bill.pdf', { type: 'application/pdf' }), {
        eventId: 'evt_homeowner_test',
        funnelSlug: 'free-solar-estimate',
      }),
    ).rejects.toThrow(/does not match/)
  })
})
