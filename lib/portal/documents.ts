/**
 * lib/portal/documents.ts
 *
 * 🚨 THE HOMEOWNER'S ACTUAL UTILITY BILL WAS THROWN AWAY.
 *
 * `POST /api/portal/bill-upload` accepted the PDF or photo, forwarded it to the
 * parser, kept FIVE PARSED FIELDS as a ~200-byte JSON blob, and dropped the
 * bytes. The portal then said "Utility bill received ✓" and listed "Utility
 * Bill" in Your Documents — a row that contained no bill. The route returns a
 * `confidence` score with the parse, so when the parse was wrong there was, by
 * construction, nothing left to check it against; and the whole system is sized
 * from that number.
 *
 * Worse, the installer's own engineering page classifies any `utility_bill` file
 * whose name does NOT begin `Bill_Data_` as the **"Original Utility Bill"**
 * (app/engineering/page.tsx). The summary blob was called
 * `Utility_Bill_Summary.json`, so the one artefact labelled "original" in the
 * engineering UI was the derived summary. There was no way to notice from inside
 * the product that the original was gone.
 *
 * This module holds the file-naming contract that fixes it, in one place, so the
 * upload route and its tests cannot drift apart:
 *
 *   • THE ORIGINAL BYTES are stored as `Utility_Bill.<ext>` — no `Bill_Data_`
 *     prefix, so the engineering page classifies it as the Original Utility
 *     Bill, which it now genuinely is.
 *   • THE PARSED SUMMARY is stored as `Bill_Data_Portal.json` — the prefix the
 *     engineering page classifies as "Bill Data".
 *
 * 🚨 THE ORIGINAL'S NAME IS ALSO LOAD-BEARING FOR THE PORTAL. The portal
 * dashboard decides whether to offer the upload control by looking for a
 * document whose normalized label is exactly `Utility Bill`
 * (lib/normalizeDocumentLabel.ts). `Utility_Bill.pdf` normalizes to that;
 * `Bill_Data_Portal.json` deliberately does not. So the control is hidden once
 * the REAL BILL is on file, and stays available if only a summary was ever
 * written — which is the correct behaviour in both directions and is pinned by
 * test rather than left to the next reader to rediscover.
 */

/** Extension for the bytes we were handed, by sniffed/declared content type. */
const MIME_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/tiff': 'tif',
  'image/bmp':  'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'text/plain': 'txt',
  'application/json': 'json',
};

/** The parsed-field summary. Prefixed so engineering calls it "Bill Data". */
export const PORTAL_BILL_SUMMARY_FILE_NAME = 'Bill_Data_Portal.json';

/**
 * The original bytes. NOT prefixed, so engineering calls it what it is — and
 * named so `normalizeDocumentLabel` renders it as exactly "Utility Bill".
 */
export function portalOriginalBillFileName(
  contentType: string | null | undefined,
  originalFileName: string | null | undefined,
): string {
  const mime = (contentType ?? '').trim().toLowerCase();
  const fromMime = MIME_EXTENSION[mime];
  if (fromMime) return `Utility_Bill.${fromMime}`;

  const raw = (originalFileName ?? '').trim().toLowerCase();
  const ext = raw.includes('.') ? raw.split('.').pop() ?? '' : '';
  if (/^[a-z0-9]{1,10}$/.test(ext)) return `Utility_Bill.${ext}`;
  return 'Utility_Bill.bin';
}

/**
 * Should this document appear in the homeowner's "Your Documents" vault?
 *
 * The vault is for things the homeowner GAVE US or can act on. The parsed-bill
 * summary is a machine-readable derivative of a document they already have; it
 * is useful on the engineering page and meaningless to them. It is not secret —
 * it holds five numbers off their own bill — so this is a clarity rule, not a
 * confidentiality one. The confidentiality rule lives in the read route, which
 * only ever selects `utility_bill` and `portal_upload`.
 *
 * Keyed on the NORMALIZED LABEL because that is all the portal payload carries.
 */
export function isHomeownerFacingDocument(doc: { label?: string | null }): boolean {
  const label = (doc.label ?? '').trim();
  if (!label) return false;
  // `Bill_Data_*.json` normalizes to a label starting "Bill Data".
  if (/^bill data\b/i.test(label)) return false;
  return true;
}
