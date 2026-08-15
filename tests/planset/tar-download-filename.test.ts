// ═══════════════════════════════════════════════════════════════════════════
// D1 — THE DOWNLOADED FILE CARRIES THE CANONICAL PROJECT IDENTITY.
//
// The permit route derives the Content-Disposition filename from the canonical
// project record. The Engineering page used to override it with
// `config.projectName` — the engineering_config MIRROR, which on live Braidon
// still reads "BRAIDON M PILLA — Solar TEST" while `projects.name` is
// "BRAIDON M PILLA — Solar".
//
// These tests pin the parser the client now uses, and — critically — pin that
// the FALLBACK is identity-free, so a future regression cannot quietly
// reintroduce a stale name.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import {
  parseContentDispositionFilename,
  downloadFilenameFor,
} from '@/lib/http/contentDisposition';

describe('D1 · parseContentDispositionFilename', () => {
  it('reads the quoted filename the permit route actually emits', () => {
    // Exactly the shape app/api/engineering/permit/route.ts sends.
    const h = 'attachment; filename="PermitPackage-BRAIDON M PILLA  Solar.pdf"';
    expect(parseContentDispositionFilename(h)).toBe('PermitPackage-BRAIDON M PILLA  Solar.pdf');
  });

  it('reads an inline disposition too (the GET preview path)', () => {
    const h = 'inline; filename="permit-BRAIDON M PILLA  Solar.html"';
    expect(parseContentDispositionFilename(h)).toBe('permit-BRAIDON M PILLA  Solar.html');
  });

  it('prefers RFC 5987 filename* over plain filename', () => {
    const h = `attachment; filename="fallback.pdf"; filename*=UTF-8''PermitPackage-BRAIDON%20M%20PILLA%20%E2%80%94%20Solar.pdf`;
    expect(parseContentDispositionFilename(h))
      .toBe('PermitPackage-BRAIDON M PILLA — Solar.pdf');
  });

  it('falls back to plain filename when filename* is malformed', () => {
    const h = `attachment; filename="good.pdf"; filename*=UTF-8''bad%ZZescape`;
    expect(parseContentDispositionFilename(h)).toBe('good.pdf');
  });

  it('handles a bare unquoted filename', () => {
    expect(parseContentDispositionFilename('attachment; filename=report.pdf')).toBe('report.pdf');
  });

  it('unescapes backslash escapes inside a quoted value', () => {
    expect(parseContentDispositionFilename('attachment; filename="a\\"b.pdf"')).toBe('a"b.pdf');
  });

  it('returns null when there is no header or no filename parameter', () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename(undefined)).toBeNull();
    expect(parseContentDispositionFilename('')).toBeNull();
    expect(parseContentDispositionFilename('attachment')).toBeNull();
  });

  // ── SECURITY: a save-as name is attacker-influenced in the general case ──
  it('strips path traversal and separators', () => {
    expect(parseContentDispositionFilename('attachment; filename="../../etc/passwd"')).toBe('passwd');
    expect(parseContentDispositionFilename('attachment; filename="C:\\\\Windows\\\\evil.exe"')).toBe('evil.exe');
    expect(parseContentDispositionFilename('attachment; filename="a/b/c.pdf"')).toBe('c.pdf');
  });

  it('strips control characters and leading dots', () => {
    expect(parseContentDispositionFilename('attachment; filename="..hidden.pdf"')).toBe('hidden.pdf');
    expect(parseContentDispositionFilename('attachment; filename="ok\r\n.pdf"')).toBe('ok.pdf');
  });

  it('returns null when the value sanitizes away to nothing', () => {
    expect(parseContentDispositionFilename('attachment; filename="///"')).toBeNull();
    expect(parseContentDispositionFilename('attachment; filename="..."')).toBeNull();
  });
});

describe('D1 · downloadFilenameFor', () => {
  it('uses the server filename when the header is present', () => {
    const name = downloadFilenameFor({
      header: 'attachment; filename="PermitPackage-BRAIDON M PILLA  Solar.pdf"',
      projectId: '4030b664-bebe-433b-a11c-cda05ead2f7d',
      kind: 'PermitPackage', extension: 'pdf',
    });
    expect(name).toBe('PermitPackage-BRAIDON M PILLA  Solar.pdf');
  });

  it('FALLBACK IS IDENTITY-FREE — never a project name', () => {
    const name = downloadFilenameFor({
      header: null,
      projectId: '4030b664-bebe-433b-a11c-cda05ead2f7d',
      kind: 'PermitPackage', extension: 'pdf', suffix: '-DRAFT',
    });
    expect(name).toBe('PermitPackage-4030b664-bebe-433b-a11c-cda05ead2f7d-DRAFT.pdf');
    // The whole point of the repair: no stale mirror text can reach the name.
    expect(name).not.toMatch(/TEST/i);
    expect(name).not.toMatch(/BRAIDON/i);
  });

  it('falls back with no project scope when the id is unavailable', () => {
    expect(downloadFilenameFor({ header: null, projectId: null, kind: 'SLD', extension: 'pdf' }))
      .toBe('SLD.pdf');
  });

  it('a stale mirror name can never be produced from a canonical header', () => {
    // Server sends the canonical name; client must not be able to reintroduce
    // the mirror, regardless of what the mirror says.
    const canonical = 'attachment; filename="PermitPackage-BRAIDON M PILLA  Solar.pdf"';
    const out = downloadFilenameFor({ header: canonical, projectId: 'x', kind: 'PermitPackage', extension: 'pdf' });
    expect(out).not.toMatch(/TEST/);
  });
});
