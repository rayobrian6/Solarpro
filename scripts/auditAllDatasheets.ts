/**
 * Stage 4 Full Audit — All datasheetUrl fields across lib/equipment-db.ts
 *
 * Extracts every datasheetUrl, performs an HTTP HEAD, and reports status.
 * Flags broken URLs (non-2xx) and HTML responses (likely redirect-to-home pages).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, '..', 'lib', 'equipment-db.ts');

interface Row {
  id: string;
  url: string;
}

function extractRows(): Row[] {
  const content = fs.readFileSync(DB_PATH, 'utf8');
  const lines = content.split('\n');
  const rows: Row[] = [];
  let currentId: string | null = null;

  for (const line of lines) {
    const idm = line.match(/^\s*id:\s*'([^']+)'/);
    if (idm) {
      currentId = idm[1];
      continue;
    }
    const dsm = line.match(/datasheetUrl:\s*'([^']+)'/);
    if (dsm && currentId) {
      rows.push({ id: currentId, url: dsm[1] });
    }
  }
  return rows;
}

interface CheckResult {
  id: string;
  url: string;
  status: number | 'ERROR';
  contentType: string;
  ok: boolean;
  reason?: string;
}

async function check(url: string, redirectCount = 0): Promise<{ status: number | 'ERROR'; contentType: string; finalUrl?: string; reason?: string }> {
  if (redirectCount > 5) {
    return { status: 'ERROR', contentType: '', reason: 'too many redirects' };
  }

  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (SolarPro datasheet audit)',
          'Accept': '*/*',
        },
        timeout: 15000,
      }, (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers['content-type'] ?? '');
        if (status >= 300 && status < 400 && res.headers.location) {
          // Resolve redirect and follow
          const nextUrl = new URL(res.headers.location, parsed).toString();
          res.resume();
          check(nextUrl, redirectCount + 1).then(resolve);
          return;
        }
        res.resume();
        resolve({ status, contentType });
      });
      req.on('error', (err) => resolve({ status: 'ERROR', contentType: '', reason: err.message }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 'ERROR', contentType: '', reason: 'timeout' }); });
      req.end();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({ status: 'ERROR', contentType: '', reason: msg });
    }
  });
}

async function main() {
  const rows = extractRows();
  console.log(`\n═══ Full DB Datasheet URL Audit ═══`);
  console.log(`Total rows with datasheetUrl: ${rows.length}\n`);

  const results: CheckResult[] = [];
  let done = 0;

  // Run checks with concurrency = 6
  const concurrency = 6;
  const queue = [...rows];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length > 0) {
      const row = queue.shift()!;
      const r = await check(row.url);
      const isPdf = /application\/pdf|application\/octet-stream/.test(r.contentType);
      const isOk =
        typeof r.status === 'number' && r.status >= 200 && r.status < 300;
      results.push({
        id: row.id,
        url: row.url,
        status: r.status,
        contentType: r.contentType,
        ok: isOk,
        reason: !isOk ? r.reason : isPdf ? undefined : 'HTML response (product page?)',
      });
      done++;
      if (done % 20 === 0) process.stdout.write(`  ... checked ${done}/${rows.length}\n`);
    }
  });

  await Promise.all(workers);

  console.log(`\n═══ Results ═══\n`);

  // Sort: errors first, then HTML responses, then OK
  const errors = results.filter((r) => !r.ok);
  const htmlButOk = results.filter((r) => r.ok && r.reason === 'HTML response (product page?)');
  const okPdfs = results.filter((r) => r.ok && !r.reason);

  console.log(`✅ OK PDFs (verified): ${okPdfs.length}`);
  console.log(`⚠️  HTML responses (may be product pages): ${htmlButOk.length}`);
  console.log(`❌ Broken / errors: ${errors.length}\n`);

  if (errors.length > 0) {
    console.log(`─── BROKEN URLS ───`);
    for (const r of errors) {
      console.log(`  ❌ ${r.id}`);
      console.log(`     status: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
      console.log(`     url:    ${r.url}`);
    }
    console.log('');
  }

  if (htmlButOk.length > 0) {
    console.log(`─── HTML RESPONSES (review needed) ───`);
    for (const r of htmlButOk) {
      console.log(`  ⚠️  ${r.id}`);
      console.log(`     content-type: ${r.contentType}`);
      console.log(`     url:          ${r.url}`);
    }
    console.log('');
  }

  // Write CSV for follow-up
  const csvPath = path.join(path.dirname(DB_PATH), '..', 'docs', 'datasheet-audit-snapshot.csv');
  const csvRows = ['id,url,status,content_type,ok,reason'];
  for (const r of results) {
    csvRows.push([
      r.id,
      `"${r.url}"`,
      r.status,
      `"${r.contentType}"`,
      r.ok,
      `"${r.reason ?? ''}"`,
    ].join(','));
  }
  fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
  console.log(`📝 Wrote audit CSV: ${csvPath}`);
}

main();