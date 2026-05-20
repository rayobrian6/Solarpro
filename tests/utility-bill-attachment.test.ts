import { mkdtemp, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { isUtilityBillStorageFailure, metadataOnlyUtilityBill, storeUtilityBillAttachment } from '@/lib/intake/utilityBillAttachment'

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

function jpegFile(name: string, type: string) {
  return new File([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])], name, { type })
}

async function withLocalUploadTempDir() {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')
  tempDir = await mkdtemp(join(tmpdir(), 'solarpro-bill-upload-'))
  process.chdir(tempDir)
}

describe('utility bill attachment storage', () => {
  it('returns explicit metadata-only status without storing raw binaries in DB', () => {
    const metadata = metadataOnlyUtilityBill(new File(['x'], 'bill.pdf', { type: 'application/pdf' }))
    expect(metadata).toMatchObject({
      filename: 'bill.pdf',
      size_bytes: 1,
      content_type: 'application/pdf',
      original_content_type: 'application/pdf',
      storage_status: 'metadata_only_not_uploaded',
      accessible_url: null,
      download_url: null,
    })
  })

  it('stores utility bills to the existing local public upload fallback when Blob is not configured', async () => {
    await withLocalUploadTempDir()

    const stored = await storeUtilityBillAttachment(pdfFile(), {
      eventId: 'evt_homeowner_test',
      funnelSlug: 'free-solar-estimate',
    })

    expect(stored).toMatchObject({
      filename: 'utility bill.pdf',
      content_type: 'application/pdf',
      original_content_type: 'application/pdf',
      detected_content_type: 'application/pdf',
      file_extension: 'pdf',
      storage_status: 'stored',
      storage_provider: 'local_public_uploads',
      uploaded_at: expect.any(String),
    })
    expect(stored.accessible_url).toMatch(/^\/uploads\/intake\/utility-bills\/free-solar-estimate\/evt_homeowner_test\//)
    expect(stored.download_url).toBe(stored.accessible_url)
    expect(stored.storage_key).toMatch(/^public\/uploads\/intake\/utility-bills\//)
    expect(existsSync(join(tempDir!, stored.storage_key))).toBe(true)
  })

  it.each([
    ['.jiff files reported as image/jiff', 'Braidon Bill.jiff', 'image/jiff'],
    ['.jfif files reported as image/jfif', 'Braidon Bill.jfif', 'image/jfif'],
    ['JPEG bytes reported as octet-stream', 'Braidon Bill.bin', 'application/octet-stream'],
    ['JPEG bytes with no browser MIME', 'Braidon Bill', ''],
  ])('stores %s by detecting JPEG bytes instead of trusting browser MIME', async (_label, name, type) => {
    await withLocalUploadTempDir()

    const stored = await storeUtilityBillAttachment(jpegFile(name, type), {
      eventId: 'evt_homeowner_jiff',
      funnelSlug: 'free-solar-estimate',
    })

    expect(stored).toMatchObject({
      filename: name,
      content_type: 'image/jpeg',
      original_content_type: type || null,
      detected_content_type: 'image/jpeg',
      file_extension: 'jpg',
      storage_status: 'stored',
      storage_provider: 'local_public_uploads',
    })
    expect(stored.accessible_url).toContain('.jpg')
    expect(existsSync(join(tempDir!, stored.storage_key))).toBe(true)
  })

  it('stores arbitrary unknown non-empty files without a MIME allowlist', async () => {
    await withLocalUploadTempDir()

    const stored = await storeUtilityBillAttachment(
      new File(['not a pdf but still homeowner-provided bill evidence'], 'Braidon Bill.fff', { type: 'application/octet-stream' }),
      { eventId: 'evt_homeowner_unknown', funnelSlug: 'free-solar-estimate' },
    )

    expect(stored).toMatchObject({
      filename: 'Braidon Bill.fff',
      content_type: 'application/octet-stream',
      original_content_type: 'application/octet-stream',
      detected_content_type: null,
      file_extension: 'fff',
      storage_status: 'stored',
      storage_provider: 'local_public_uploads',
    })
    expect(existsSync(join(tempDir!, stored.storage_key))).toBe(true)
  })

  it('still rejects empty files before storage and does not classify them as storage failures', async () => {
    try {
      await storeUtilityBillAttachment(new File([], 'empty.jiff', { type: 'image/jiff' }), {
        eventId: 'evt_homeowner_test',
        funnelSlug: 'free-solar-estimate',
      })
      throw new Error('expected validation failure')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/empty/i)
      expect(isUtilityBillStorageFailure(err)).toBe(false)
    }
  })

  it('still rejects oversized files before storage and does not classify them as storage failures', async () => {
    try {
      await storeUtilityBillAttachment(new File([Buffer.alloc(10 * 1024 * 1024 + 1)], 'too-large.bin', { type: 'application/octet-stream' }), {
        eventId: 'evt_homeowner_test',
        funnelSlug: 'free-solar-estimate',
      })
      throw new Error('expected validation failure')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/too large/i)
      expect(isUtilityBillStorageFailure(err)).toBe(false)
    }
  })

  it('classifies production no-Blob failures as recoverable storage failures instead of writing to the deployment filesystem', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '')

    try {
      await storeUtilityBillAttachment(pdfFile(), {
        eventId: 'evt_homeowner_test',
        funnelSlug: 'free-solar-estimate',
      })
      throw new Error('expected storage failure')
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toMatch(/BLOB_READ_WRITE_TOKEN/)
      expect(isUtilityBillStorageFailure(err)).toBe(true)
    }
  })
})
