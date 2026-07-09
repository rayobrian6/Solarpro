import { describe, it, expect } from 'vitest';
import { generatePermitHTML } from '@/lib/permit';
import { escapeH } from '@/lib/permit/utils/drawing';
import { roofProject } from '../../test-fixtures/roofProject';

describe('generated document XSS escaping', () => {
  it('escapeH escapes bare markup and is idempotent on existing entities', () => {
    expect(escapeH('<script>')).toBe('&lt;script&gt;');
    expect(escapeH('a & b')).toBe('a &amp; b');
    expect(escapeH('x &amp; y')).toBe('x &amp; y');                        // no double-escape
    expect(escapeH('ANSI B &mdash; 17"')).toBe('ANSI B &mdash; 17&quot;'); // named entity preserved
    expect(escapeH('"><img src=x onerror=1>')).toBe('&quot;&gt;&lt;img src=x onerror=1&gt;');
  });

  it('user-supplied project fields cannot inject live markup into the package', () => {
    const p = JSON.parse(JSON.stringify(roofProject));
    p.project = p.project || {};
    p.project.projectName = '<script>alert(1)</script>';
    p.project.address = '"><img src=x onerror=alert(2)>, Granite City & Co';
    p.project.clientName = '<b>owner</b>';
    const html = generatePermitHTML(p);
    // no LIVE markup: script tag, attribute break, or img tag must not appear
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"><img src=x');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).not.toContain('<b>owner</b>');
    // payload survives only as inert, escaped text
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('&amp;amp;');            // no double-escape leaked
    expect(html).not.toContain('&amp;mdash;');          // named entities preserved
  });
});
