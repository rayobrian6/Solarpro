// ============================================================
// lib/plan-set/title-block.ts
// Reusable title block HTML template for all plan set sheets.
// Renders a professional engineering title block with:
//   - Company logo / name
//   - Project info (address, AHJ, utility)
//   - Sheet info (title, number, revision)
//   - Engineer stamp placeholder
//   - SolarPro branding
// ============================================================

export interface TitleBlockData {
  // Company
  companyName:      string;
  companyAddress:   string;
  companyPhone:     string;
  companyEmail:     string;
  companyLicense?:  string;

  // Project
  projectName:      string;
  clientName:       string;
  siteAddress:      string;
  city:             string;
  state:            string;
  zip:              string;
  ahj:              string;
  utilityName:      string;
  permitNumber?:    string;

  // System
  systemKw:         number;
  panelCount:       number;
  panelModel:       string;
  inverterModel:    string;
  mountType:        string;

  // Sheet
  sheetTitle:       string;
  sheetNumber:      string;   // e.g. "E-1"
  totalSheets:      number;
  revision:         string;   // e.g. "0" or "A"
  preparedBy:       string;
  preparedDate:     string;
  checkedBy?:       string;
  approvedBy?:      string;

  // Codes
  necVersion:       string;
  ibcVersion?:      string;
  asceVersion?:     string;
}

// ─── CSS shared across all sheets ────────────────────────────────────────────
export const PLAN_SET_CSS = `
  /* == Print / wkhtmltopdf page setup == */
  @page {
    size: 11in 8.5in landscape;
    margin: 0;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  html, body {
    font-family: 'Arial', 'Helvetica', sans-serif;
    font-size: 8pt;
    color: #000;
    margin: 0;
    padding: 0;
    background: #fff;
  }

  /* == Each .page = one hard-isolated 11x8.5in landscape sheet ==
     Rules live OUTSIDE @media print so wkhtmltopdf (screen-mode) honours them. */
  .page {
    width: 11in;
    height: 8.5in;
    min-height: 8.5in;
    max-height: 8.5in;
    position: relative;
    overflow: hidden;
    background: #fff;
    padding: 0.25in 0.25in 1.1in 0.25in;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
    display: block;
  }
  .page:last-child {
    page-break-after: avoid;
    break-after: avoid;
  }

  /* == Screen view: paginated cards with shadows == */
  @media screen {
    html, body { background: #c8cdd5; }
    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 72px 0 80px 0;
      gap: 32px;
    }
    .page {
      box-shadow: 0 6px 24px rgba(0,0,0,0.28);
      flex-shrink: 0;
    }
    #sp-toolbar { display: flex !important; }
  }

  /* == Print / wkhtmltopdf: clean output == */
  @media print {
    html, body { background: #fff !important; display: block; padding: 0; }
    .page { box-shadow: none !important; margin: 0; }
    #sp-toolbar { display: none !important; }
  }

  /* ── Title Block (bottom strip) ── */
  .title-block {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1.05in;
    border-top: 2px solid #000;
    display: flex;
    flex-direction: row;
  }
  .tb-company {
    width: 2.2in;
    border-right: 1px solid #000;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }
  .tb-company .co-name {
    font-size: 10pt;
    font-weight: bold;
    color: #1a3a6b;
    line-height: 1.2;
  }
  .tb-company .co-sub {
    font-size: 6.5pt;
    color: #444;
    margin-top: 2px;
    line-height: 1.4;
  }
  .tb-project {
    flex: 1;
    border-right: 1px solid #000;
    padding: 4px 8px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 12px;
    align-content: center;
  }
  .tb-field {
    display: flex;
    flex-direction: column;
  }
  .tb-label {
    font-size: 5.5pt;
    color: #666;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .tb-value {
    font-size: 7.5pt;
    font-weight: 600;
    color: #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tb-system {
    width: 1.8in;
    border-right: 1px solid #000;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
  }
  .tb-system .sys-row {
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
  }
  .tb-system .sys-row .lbl { color: #555; }
  .tb-system .sys-row .val { font-weight: 600; }
  .tb-sheet {
    width: 1.6in;
    border-right: 1px solid #000;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .tb-sheet .sheet-title {
    font-size: 8.5pt;
    font-weight: bold;
    color: #1a3a6b;
    line-height: 1.2;
  }
  .tb-sheet .sheet-meta {
    font-size: 6.5pt;
    color: #444;
  }
  .tb-sheet .sheet-num {
    font-size: 14pt;
    font-weight: bold;
    color: #1a3a6b;
    text-align: right;
  }
  .tb-stamp {
    width: 1.2in;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }
  .tb-stamp .stamp-circle {
    width: 0.7in;
    height: 0.7in;
    border: 2px dashed #999;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 5.5pt;
    color: #999;
    line-height: 1.2;
  }
  .tb-stamp .stamp-label {
    font-size: 5.5pt;
    color: #999;
    text-align: center;
  }

  /* ── Border ── */
  .page-border {
    position: absolute;
    top: 0.15in;
    left: 0.15in;
    right: 0.15in;
    bottom: 1.1in;
    border: 1.5px solid #000;
    pointer-events: none;
  }

  /* ── Sheet header ── */
  .sheet-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1.5px solid #1a3a6b;
  }
  .sheet-header .sh-title {
    font-size: 13pt;
    font-weight: bold;
    color: #1a3a6b;
    letter-spacing: 0.5px;
  }
  .sheet-header .sh-sub {
    font-size: 8pt;
    color: #555;
    margin-top: 2px;
  }
  .sheet-header .sh-badge {
    background: #1a3a6b;
    color: #fff;
    font-size: 8pt;
    font-weight: bold;
    padding: 3px 10px;
    border-radius: 3px;
  }

  /* ── Section headers ── */
  .section-header {
    background: #1a3a6b;
    color: #fff;
    font-size: 7.5pt;
    font-weight: bold;
    padding: 3px 8px;
    margin: 8px 0 4px 0;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .section-header.light {
    background: #e8edf5;
    color: #1a3a6b;
    border-left: 3px solid #1a3a6b;
  }

  /* ── Tables ── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 7pt;
  }
  th {
    background: #e8edf5;
    color: #1a3a6b;
    font-weight: bold;
    padding: 3px 6px;
    border: 0.5px solid #aab;
    text-align: left;
    font-size: 6.5pt;
    text-transform: uppercase;
  }
  td {
    padding: 2.5px 6px;
    border: 0.5px solid #ccd;
    vertical-align: top;
  }
  tr:nth-child(even) td { background: #f7f8fc; }
  tr:hover td { background: #eef0f8; }

  /* ── Info boxes ── */
  .info-box {
    border: 1px solid #1a3a6b;
    border-radius: 3px;
    padding: 6px 10px;
    margin: 4px 0;
    background: #f0f4fa;
  }
  .info-box .ib-title {
    font-size: 7pt;
    font-weight: bold;
    color: #1a3a6b;
    margin-bottom: 3px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .info-box .ib-row {
    display: flex;
    justify-content: space-between;
    font-size: 7pt;
    padding: 1px 0;
  }
  .info-box .ib-row .lbl { color: #555; }
  .info-box .ib-row .val { font-weight: 600; }

  /* ── Warning / note boxes ── */
  .note-box {
    border: 1px solid #e6a817;
    background: #fffbf0;
    border-radius: 3px;
    padding: 4px 8px;
    margin: 4px 0;
    font-size: 6.5pt;
    color: #7a5000;
  }
  .note-box::before { content: '⚠ NOTE: '; font-weight: bold; }
  .code-box {
    border: 1px solid #2a7a2a;
    background: #f0faf0;
    border-radius: 3px;
    padding: 4px 8px;
    margin: 4px 0;
    font-size: 6.5pt;
    color: #1a4a1a;
  }

  /* ── Two-column layout ── */
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .three-col {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 8px;
  }

  /* ── Compliance checkboxes ── */
  .check-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 2px 0;
    font-size: 7pt;
  }
  .check-box {
    width: 10px;
    height: 10px;
    border: 1px solid #333;
    flex-shrink: 0;
    margin-top: 1px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 8pt;
    font-weight: bold;
    color: #1a7a1a;
  }
  .check-box.pass { background: #e8f5e8; border-color: #1a7a1a; }
  .check-box.fail { background: #fde8e8; border-color: #c00; color: #c00; }
  .check-box.na   { background: #f5f5f5; border-color: #999; color: #999; }

  /* ── SLD specific ── */
  .sld-container {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sld-container svg {
    max-width: 100%;
    max-height: 100%;
  }

  /* ── Watermark ── */
  .watermark {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-size: 48pt;
    font-weight: bold;
    color: rgba(200, 200, 200, 0.15);
    pointer-events: none;
    white-space: nowrap;
    z-index: 0;
    letter-spacing: 8px;
  }

  /* ── Print ── */
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
  }
`;

// ─── Title Block HTML ─────────────────────────────────────────────────────────
export function renderTitleBlock(tb: TitleBlockData): string {
  const sheetOf = `${tb.sheetNumber} / ${tb.totalSheets}`;
  return `
  <div class="title-block">
    <!-- Company -->
    <div class="tb-company">
      <div class="co-name">☀ SolarPro</div>
      <div class="co-sub">
        ${escHtml(tb.companyName)}<br>
        ${escHtml(tb.companyAddress)}<br>
        ${escHtml(tb.companyPhone)}<br>
        ${tb.companyLicense ? `Lic: ${escHtml(tb.companyLicense)}` : ''}
      </div>
    </div>

    <!-- Project Info -->
    <div class="tb-project">
      <div class="tb-field">
        <span class="tb-label">Client</span>
        <span class="tb-value">${escHtml(tb.clientName)}</span>
      </div>
      <div class="tb-field">
        <span class="tb-label">Project</span>
        <span class="tb-value">${escHtml(tb.projectName)}</span>
      </div>
      <div class="tb-field">
        <span class="tb-label">Site Address</span>
        <span class="tb-value">${escHtml(tb.siteAddress)}</span>
      </div>
      <div class="tb-field">
        <span class="tb-label">City / State / ZIP</span>
        <span class="tb-value">${escHtml(tb.city)}, ${escHtml(tb.state)} ${escHtml(tb.zip)}</span>
      </div>
      <div class="tb-field">
        <span class="tb-label">AHJ</span>
        <span class="tb-value">${escHtml(tb.ahj)}</span>
      </div>
      <div class="tb-field">
        <span class="tb-label">Utility</span>
        <span class="tb-value">${escHtml(tb.utilityName)}</span>
      </div>
      ${tb.permitNumber ? `
      <div class="tb-field">
        <span class="tb-label">Permit #</span>
        <span class="tb-value">${escHtml(tb.permitNumber)}</span>
      </div>` : ''}
      <div class="tb-field">
        <span class="tb-label">Applicable Codes</span>
        <span class="tb-value">${escHtml(tb.necVersion)}${tb.ibcVersion ? ` · ${tb.ibcVersion}` : ''}${tb.asceVersion ? ` · ${tb.asceVersion}` : ''}</span>
      </div>
    </div>

    <!-- System Summary -->
    <div class="tb-system">
      <div class="sys-row"><span class="lbl">System Size</span><span class="val">${tb.systemKw.toFixed(2)} kW DC</span></div>
      <div class="sys-row"><span class="lbl">Panels</span><span class="val">${tb.panelCount} × ${escHtml(tb.panelModel)}</span></div>
      <div class="sys-row"><span class="lbl">Inverter</span><span class="val">${escHtml(tb.inverterModel)}</span></div>
      <div class="sys-row"><span class="lbl">Mount</span><span class="val">${escHtml(tb.mountType)}</span></div>
    </div>

    <!-- Sheet Info -->
    <div class="tb-sheet">
      <div class="sheet-title">${escHtml(tb.sheetTitle)}</div>
      <div class="sheet-meta">
        Prepared: ${escHtml(tb.preparedDate)}<br>
        By: ${escHtml(tb.preparedBy)}<br>
        Rev: ${escHtml(tb.revision)}
        ${tb.checkedBy ? `<br>Chk: ${escHtml(tb.checkedBy)}` : ''}
      </div>
      <div class="sheet-num">${sheetOf}</div>
    </div>

    <!-- Engineer Stamp -->
    <div class="tb-stamp">
      <div class="stamp-circle">
        ENGINEER<br>STAMP<br>HERE
      </div>
      <div class="stamp-label">PE Stamp Required<br>per AHJ</div>
    </div>
  </div>`;
}

// ─── Full page wrapper ────────────────────────────────────────────────────────
export function wrapPage(content: string, tb: TitleBlockData, watermark?: string): string {
  return `
  <div class="page">
    <div class="page-border"></div>
    ${watermark ? `<div class="watermark">${escHtml(watermark)}</div>` : ''}
    <div style="position:relative; z-index:1; height:100%; padding: 0.1in 0.1in 0 0.1in;">
      ${content}
    </div>
    ${renderTitleBlock(tb)}
  </div>`;
}

// ─── Full HTML document wrapper ───────────────────────────────────────────────
export function wrapDocument(pages: string[], title: string): string {
  const pageCount = pages.length;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <style>${PLAN_SET_CSS}
  /* ── Floating toolbar (screen only, hidden on print) ── */
  #sp-toolbar {
    display: none;
    position: fixed;
    top: 16px;
    right: 20px;
    z-index: 9999;
    align-items: center;
    gap: 10px;
    background: rgba(15,23,42,0.92);
    color: #fff;
    padding: 10px 16px;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.45);
    font-family: Arial, sans-serif;
    font-size: 13px;
    backdrop-filter: blur(6px);
    user-select: none;
  }
  #sp-toolbar .sp-title {
    font-weight: 600;
    letter-spacing: 0.3px;
    color: #e2e8f0;
    margin-right: 6px;
  }
  #sp-toolbar .sp-count {
    font-size: 11px;
    color: #94a3b8;
    margin-right: 8px;
  }
  #sp-toolbar button {
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 7px;
    padding: 7px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: 0.2px;
  }
  #sp-toolbar button:hover { background: #1d4ed8; }
  #sp-toolbar .sp-tip {
    font-size: 10px;
    color: #64748b;
    margin-top: 0;
    margin-left: 2px;
  }
  </style>
</head>
<body>
  <!-- Floating toolbar — visible in browser, hidden when printing -->
  <div id="sp-toolbar">
    <span class="sp-title">SolarPro Plan Set</span>
    <span class="sp-count">${pageCount} sheets</span>
    <button onclick="window.print()">&#128438; Save as PDF</button>
    <span class="sp-tip">Use "Save as PDF" in print dialog</span>
  </div>

  ${pages.join('\n')}

  <script>
    // Auto-open print dialog when file is opened directly in browser
    // (allows immediate Save-as-PDF workflow)
    // Only runs if URL is a file:// or blob:// — not when embedded in the app
    (function() {
      var loc = window.location.href;
      if (loc.startsWith('file://') || loc.startsWith('blob:') || loc.includes('download=')) {
        // Small delay so the page renders first
        setTimeout(function() { window.print(); }, 800);
      }
    })();
  </script>
</body>
</html>`;
}

// ─── Utility ─────────────────────────────────────────────────────────────────
export function escHtml(s: string | number | undefined | null): string {
  if (s === undefined || s === null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtDate(d?: string): string {
  if (!d) return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}