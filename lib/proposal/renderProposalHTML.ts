// ============================================================
// Proposal PDF HTML Renderer — Server-Side
// lib/proposal/renderProposalHTML.ts
//
// Converts a CanonicalProposal + Proposal snapshot into a
// print-quality HTML string suitable for wkhtmltopdf.
//
// Design principles:
//   • Pure HTML/CSS — no React, no Recharts, no DOM APIs
//   • Inline SVG bar charts replace Recharts for print fidelity
//   • Letter page (8.5×11in) with @page CSS, 0.45in margins
//   • 6–8 pages: Cover → System → Financial → 25yr → Incentives → Equipment → Next Steps
//   • All numbers sourced ONLY from CanonicalProposal (no inline math)
// ============================================================

import type { CanonicalProposal } from './canonicalProposal';
import type { Proposal } from '@/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt$(n: number, decimals = 0): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtKw(n: number): string {
  return n.toFixed(2) + ' kW';
}
function fmtKwh(n: number): string {
  return Math.round(n).toLocaleString('en-US') + ' kWh';
}
function fmtPct(n: number): string {
  return Math.round(n) + '%';
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Inline SVG bar chart ──────────────────────────────────────────────────────
// Renders a simple horizontal bar chart as SVG — no browser JS required.

interface BarChartSVGOptions {
  data: Array<{ label: string; value: number; color?: string }>;
  width?: number;
  height?: number;
  maxValue?: number;
  showValues?: boolean;
  barColor?: string;
}

function renderBarChartSVG(opts: BarChartSVGOptions): string {
  const {
    data,
    width = 480,
    height = 160,
    showValues = true,
    barColor = '#f59e0b',
  } = opts;

  if (!data || data.length === 0) return '';

  const padL = 36;
  const padR = 8;
  const padT = 8;
  const padB = 28;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;
  const barCount = data.length;
  const barW = Math.floor(chartW / barCount) - 4;
  const maxVal = opts.maxValue ?? Math.max(...data.map(d => d.value), 1);

  const bars = data.map((d, i) => {
    const barH = Math.max(2, Math.floor((d.value / maxVal) * chartH));
    const x = padL + i * (chartW / barCount) + 2;
    const y = padT + chartH - barH;
    const color = d.color ?? barColor;
    const valLabel = showValues ? `<text x="${x + barW / 2}" y="${y - 3}" font-size="7" text-anchor="middle" fill="#374151">${Math.round(d.value).toLocaleString()}</text>` : '';
    return `
      <rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="2"/>
      ${valLabel}
      <text x="${x + barW / 2}" y="${padT + chartH + 14}" font-size="7.5" text-anchor="middle" fill="#6b7280">${d.label}</text>
    `;
  }).join('');

  // Y-axis gridlines
  const gridLines = [0.25, 0.5, 0.75, 1.0].map(frac => {
    const y = padT + chartH - Math.floor(frac * chartH);
    const val = Math.round(frac * maxVal);
    return `
      <line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>
      <text x="${padL - 3}" y="${y + 3}" font-size="7" text-anchor="end" fill="#9ca3af">${val >= 1000 ? (val / 1000).toFixed(0) + 'k' : val}</text>
    `;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow:visible">
    ${gridLines}
    ${bars}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#d1d5db" stroke-width="1.5"/>
    <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="#d1d5db" stroke-width="1.5"/>
  </svg>`;
}

// ── Inline SVG line chart (25yr projection) ───────────────────────────────────

interface LineChartSVGOptions {
  series: Array<{ values: number[]; color: string; label: string; dashed?: boolean }>;
  labels: string[];
  width?: number;
  height?: number;
}

function renderLineChartSVG(opts: LineChartSVGOptions): string {
  const { series, labels, width = 520, height = 180 } = opts;
  const padL = 54;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  if (!series.length || !series[0].values.length) return '';
  const n = series[0].values.length;

  const allVals = series.flatMap(s => s.values);
  const maxVal = Math.max(...allVals, 1);
  const minVal = Math.min(...allVals, 0);
  const range = maxVal - minVal || 1;

  function toX(i: number) { return padL + (i / (n - 1)) * chartW; }
  function toY(v: number) { return padT + chartH - ((v - minVal) / range) * chartH; }

  // zero line
  const zeroY = toY(0);
  const zeroLine = (minVal < 0 && maxVal > 0)
    ? `<line x1="${padL}" y1="${zeroY}" x2="${padL + chartW}" y2="${zeroY}" stroke="#9ca3af" stroke-width="1" stroke-dasharray="4,3"/>`
    : '';

  // gridlines
  const gridCount = 4;
  const gridLines = Array.from({ length: gridCount + 1 }, (_, k) => {
    const frac = k / gridCount;
    const val = minVal + frac * range;
    const y = toY(val);
    const label = Math.abs(val) >= 1000 ? (val / 1000).toFixed(0) + 'k' : Math.round(val).toString();
    return `
      <line x1="${padL}" y1="${y}" x2="${padL + chartW}" y2="${y}" stroke="#f3f4f6" stroke-width="1"/>
      <text x="${padL - 4}" y="${y + 3}" font-size="7" text-anchor="end" fill="#9ca3af">${label}</text>
    `;
  }).join('');

  const lines = series.map(s => {
    const pts = s.values.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    const dashAttr = s.dashed ? 'stroke-dasharray="6,3"' : '';
    return `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" ${dashAttr} stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  // x-axis labels (every 5 years)
  const xLabels = labels
    .map((l, i) => i % 5 === 0 ? `<text x="${toX(i).toFixed(1)}" y="${padT + chartH + 14}" font-size="7.5" text-anchor="middle" fill="#6b7280">${l}</text>` : '')
    .join('');

  // legend
  const legend = series.map((s, i) => {
    const lx = padL + i * 160;
    const ly = padT + chartH + 26;
    return `<rect x="${lx}" y="${ly - 7}" width="14" height="4" fill="${s.color}" rx="2"/><text x="${lx + 18}" y="${ly}" font-size="7.5" fill="#374151">${s.label}</text>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 14}" viewBox="0 0 ${width} ${height + 14}" style="overflow:visible">
    ${gridLines}
    ${zeroLine}
    ${lines}
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + chartH}" stroke="#d1d5db" stroke-width="1.5"/>
    <line x1="${padL}" y1="${padT + chartH}" x2="${padL + chartW}" y2="${padT + chartH}" stroke="#d1d5db" stroke-width="1.5"/>
    ${xLabels}
    ${legend}
  </svg>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
  @page { size: letter; margin: 0.45in 0.5in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
         font-size: 10px; color: #111827; background: #fff; line-height: 1.5; }
  .page { page-break-after: always; min-height: 9.6in; padding: 0; }
  .page:last-child { page-break-after: auto; }

  /* Cover page */
  .cover { background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 60%, #0f172a 100%);
           color: white; display: flex; flex-direction: column; justify-content: space-between;
           min-height: 10.1in; padding: 0.6in 0.6in; }
  .cover-logo { font-size: 22px; font-weight: 900; letter-spacing: -0.5px; color: #f59e0b; }
  .cover-headline { font-size: 32px; font-weight: 900; line-height: 1.2; margin: 0.4in 0 12px; }
  .cover-sub { font-size: 14px; color: #94a3b8; margin-bottom: 0.3in; }
  .cover-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 0.25in 0 0.35in; }
  .cover-stat { background: rgba(255,255,255,0.07); border: 1px solid rgba(255,255,255,0.12);
                border-radius: 8px; padding: 16px; text-align: center; }
  .cover-stat-val { font-size: 26px; font-weight: 900; color: #f59e0b; }
  .cover-stat-lbl { font-size: 9px; color: #94a3b8; margin-top: 2px; letter-spacing: 0.5px; text-transform: uppercase; }
  .cover-footer { border-top: 1px solid rgba(255,255,255,0.12); padding-top: 14px;
                  display: flex; justify-content: space-between; align-items: flex-end;
                  font-size: 9px; color: #64748b; }

  /* Section headers */
  .sec-hdr { background: #0f172a; color: white; padding: 6px 10px; font-size: 10px;
             font-weight: 900; letter-spacing: 0.8px; text-transform: uppercase;
             margin-bottom: 8px; }
  .sec-hdr-orange { background: #f59e0b; color: #0f172a; }
  .page-title { font-size: 14px; font-weight: 900; color: #0f172a;
                border-bottom: 2px solid #f59e0b; padding-bottom: 4px; margin-bottom: 12px; }

  /* Info tables */
  .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 9px; }
  .info-table td { padding: 4px 6px; border-bottom: 1px solid #f3f4f6; }
  .info-table td:first-child { font-weight: 700; color: #374151; width: 48%; }
  .info-table td:last-child { color: #1f2937; }
  .info-table tr:nth-child(even) td { background: #f9fafb; }

  /* Metric cards */
  .metric-grid { display: grid; gap: 10px; margin-bottom: 12px; }
  .metric-grid-3 { grid-template-columns: repeat(3, 1fr); }
  .metric-grid-2 { grid-template-columns: repeat(2, 1fr); }
  .metric-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
                 padding: 10px 12px; text-align: center; }
  .metric-val { font-size: 20px; font-weight: 900; color: #0f172a; }
  .metric-val-sm { font-size: 14px; font-weight: 900; color: #0f172a; }
  .metric-val-orange { color: #f59e0b; }
  .metric-val-green { color: #16a34a; }
  .metric-lbl { font-size: 8px; color: #64748b; margin-top: 2px;
               letter-spacing: 0.4px; text-transform: uppercase; }

  /* Two-column layout */
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 10px; }
  .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 10px; }

  /* Highlight box */
  .highlight-box { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px;
                   padding: 10px 14px; margin-bottom: 10px; }
  .highlight-box.green { background: #f0fdf4; border-color: #16a34a; }
  .highlight-box.blue { background: #eff6ff; border-color: #3b82f6; }
  .highlight-box-title { font-size: 9px; font-weight: 900; text-transform: uppercase;
                         letter-spacing: 0.5px; color: #92400e; margin-bottom: 4px; }
  .highlight-box.green .highlight-box-title { color: #14532d; }
  .highlight-box.blue .highlight-box-title { color: #1e3a8a; }
  .highlight-box-val { font-size: 22px; font-weight: 900; color: #92400e; }
  .highlight-box.green .highlight-box-val { color: #16a34a; }
  .highlight-box.blue .highlight-box-val { color: #1d4ed8; }
  .highlight-box-sub { font-size: 8.5px; color: #78716c; margin-top: 3px; line-height: 1.4; }
  .highlight-box.green .highlight-box-sub { color: #4b5563; }

  /* Checklist */
  .checklist { list-style: none; font-size: 9px; }
  .checklist li { padding: 3px 0 3px 18px; position: relative; border-bottom: 1px solid #f3f4f6; }
  .checklist li::before { content: '✓'; position: absolute; left: 0; color: #16a34a; font-weight: 900; }

  /* Footer strip */
  .page-footer { position: fixed; bottom: 0.25in; left: 0.5in; right: 0.5in;
                 border-top: 1px solid #e5e7eb; padding-top: 5px;
                 display: flex; justify-content: space-between; align-items: center;
                 font-size: 7.5px; color: #9ca3af; }
  .note { font-size: 8px; color: #6b7280; line-height: 1.5; margin-top: 6px; }

  /* Equipment table */
  .equip-table { width: 100%; border-collapse: collapse; font-size: 9px; margin-bottom: 10px; }
  .equip-table th { background: #0f172a; color: white; padding: 5px 8px;
                    text-align: left; font-size: 8px; letter-spacing: 0.4px; }
  .equip-table td { padding: 4px 8px; border-bottom: 1px solid #f3f4f6; }
  .equip-table tr:nth-child(even) td { background: #f9fafb; }

  /* Monthly bar section */
  .chart-title { font-size: 9px; font-weight: 700; color: #374151;
                 margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.4px; }
  .chart-wrap { border: 1px solid #e5e7eb; border-radius: 4px; padding: 10px; background: #fff;
                margin-bottom: 10px; }

  /* Savings comparison */
  .compare-row { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; font-size: 9px; }
  .compare-bar-bg { flex: 1; height: 16px; background: #f3f4f6; border-radius: 3px; overflow: hidden; }
  .compare-bar-fill { height: 100%; border-radius: 3px; }
  .compare-lbl { width: 120px; font-weight: 700; }
  .compare-val { width: 80px; text-align: right; font-weight: 900; }

  /* Next steps */
  .step-card { display: flex; gap: 12px; align-items: flex-start; padding: 10px;
               border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 8px; background: #f8fafc; }
  .step-num { width: 28px; height: 28px; border-radius: 50%; background: #f59e0b;
              color: #0f172a; font-weight: 900; font-size: 13px; display: flex;
              align-items: center; justify-content: center; flex-shrink: 0; }
  .step-content h4 { font-size: 10px; font-weight: 900; color: #0f172a; }
  .step-content p { font-size: 8.5px; color: #4b5563; margin-top: 2px; }

  /* Disclaimer */
  .disclaimer { font-size: 7px; color: #9ca3af; line-height: 1.5; margin-top: 8px;
                padding-top: 8px; border-top: 1px solid #e5e7eb; }
`;

// ── Page builders ─────────────────────────────────────────────────────────────

function pageCover(cp: CanonicalProposal, p: Proposal, branding: ProposalBranding): string {
  const project = p.project;
  const clientName = project?.client?.name || project?.name || 'Valued Customer';
  const address = project?.address || '—';
  const date = new Date(p.preparedDate ?? p.createdAt ?? Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const validUntil = new Date(p.validUntil ?? Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `<div class="page cover">
    <div>
      <div class="cover-logo">${branding.companyName}</div>
    </div>
    <div>
      <div class="cover-headline">Solar Energy<br>Proposal</div>
      <div class="cover-sub">Prepared for ${clientName}</div>
      <div class="cover-sub" style="font-size:11px;color:#64748b;">${address}</div>

      <div class="cover-stats">
        <div class="cover-stat">
          <div class="cover-stat-val">${fmtKw(cp.panel.systemSizeKw)}</div>
          <div class="cover-stat-lbl">System Size</div>
        </div>
        <div class="cover-stat">
          <div class="cover-stat-val">${fmtPct(cp.offset.percentage)}</div>
          <div class="cover-stat-lbl">Energy Offset</div>
        </div>
        <div class="cover-stat">
          <div class="cover-stat-val">${fmt$(cp.truth25yr.netDifference)}</div>
          <div class="cover-stat-lbl">25-Year Savings</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px;">
        <div class="cover-stat">
          <div class="cover-stat-val">${cp.panel.count}</div>
          <div class="cover-stat-lbl">Panels</div>
        </div>
        <div class="cover-stat">
          <div class="cover-stat-val">${fmtKwh(cp.production.annualKwh)}</div>
          <div class="cover-stat-lbl">Annual Production</div>
        </div>
      </div>
    </div>

    <div class="cover-footer">
      <div>
        <div>${branding.companyName}${branding.companyAddress ? ' · ' + branding.companyAddress : ''}</div>
        ${branding.companyPhone ? `<div>${branding.companyPhone}</div>` : ''}
      </div>
      <div style="text-align:right;">
        <div>Date: ${date}</div>
        <div>Valid Until: ${validUntil}</div>
        <div>Prepared by: ${p.preparedBy ?? branding.companyName}</div>
      </div>
    </div>
  </div>`;
}

function pageSystem(cp: CanonicalProposal, p: Proposal): string {
  const project = p.project;
  const inv = project?.selectedInverter;
  const invLabel = inv ? `${inv.manufacturer ?? ''} ${inv.model ?? ''}`.trim() : '—';

  // Monthly production chart
  const monthlyData = cp.production.monthlyKwh.map((v, i) => ({
    label: MONTHS_SHORT[i],
    value: v,
    color: '#f59e0b',
  }));
  const monthlyChart = renderBarChartSVG({ data: monthlyData, width: 480, height: 140, showValues: false, barColor: '#f59e0b' });

  return `<div class="page">
    <div class="page-title">System Overview</div>

    <div class="metric-grid metric-grid-3" style="margin-bottom:12px;">
      <div class="metric-card">
        <div class="metric-val metric-val-orange">${fmtKw(cp.panel.systemSizeKw)}</div>
        <div class="metric-lbl">System Size (DC)</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">${cp.panel.count}</div>
        <div class="metric-lbl">${cp.panel.wattage}W Panels</div>
      </div>
      <div class="metric-card">
        <div class="metric-val metric-val-green">${fmtPct(cp.offset.percentage)}</div>
        <div class="metric-lbl">Energy Offset</div>
      </div>
    </div>

    <div class="two-col">
      <div>
        <div class="sec-hdr">Equipment</div>
        <table class="info-table">
          <tr><td>Solar Panel</td><td>${cp.panel.manufacturer} ${cp.panel.model}</td></tr>
          <tr><td>Panel Wattage</td><td>${cp.panel.wattage} Wp</td></tr>
          <tr><td>Panel Count</td><td>${cp.panel.count} panels</td></tr>
          <tr><td>Inverter</td><td>${invLabel}</td></tr>
          <tr><td>Annual Production</td><td>${fmtKwh(cp.production.annualKwh)}</td></tr>
          <tr><td>Peak Power</td><td>${fmtKw(cp.panel.systemSizeKw)} DC</td></tr>
        </table>
      </div>
      <div>
        <div class="sec-hdr">Production & Offset</div>
        <table class="info-table">
          <tr><td>Annual kWh Produced</td><td>${fmtKwh(cp.production.annualKwh)}</td></tr>
          <tr><td>Monthly Average</td><td>${fmtKwh(cp.production.annualKwh / 12)}</td></tr>
          <tr><td>Energy Offset</td><td>${fmtPct(cp.offset.percentage)}</td></tr>
          ${cp.offset.remainingPercentage > 0 ? `<tr><td>Remaining from Grid</td><td>${fmtPct(cp.offset.remainingPercentage)}</td></tr>` : ''}
          <tr><td>Utility Company</td><td>${cp.utility.provider ?? '—'}</td></tr>
          <tr><td>Current Rate</td><td>${(cp.utility.rate * 100).toFixed(2)}¢/kWh</td></tr>
        </table>
      </div>
    </div>

    <div class="sec-hdr">Monthly Production Estimate</div>
    <div class="chart-wrap">
      <div class="chart-title">Estimated Monthly Solar Production (kWh)</div>
      ${monthlyChart}
    </div>

    <div class="note">
      Production estimates based on NREL PVWatts® modeling for the site location.
      Actual production may vary ±10% due to weather, shading, and equipment conditions.
      System designed to offset approximately ${fmtPct(cp.offset.percentage)} of annual electricity consumption.
    </div>
  </div>`;
}

function pageFinancial(cp: CanonicalProposal): string {
  const f = cp.financial;
  const deltaSign = f.ownershipDeltaMonthly >= 0 ? '+' : '';
  const itcEnabled = f.itcRate > 0;

  // Monthly comparison bars
  const compareMax = Math.max(f.currentMonthlyBill, f.totalMonthlyCost, 1);
  const currentBarW = Math.round((f.currentMonthlyBill / compareMax) * 100);
  const solarBarW = Math.round((f.totalMonthlyCost / compareMax) * 100);

  return `<div class="page">
    <div class="page-title">Financial Summary</div>

    <div class="metric-grid metric-grid-3" style="margin-bottom:14px;">
      <div class="metric-card">
        <div class="metric-val metric-val-orange">${fmt$(f.gross_system_cost)}</div>
        <div class="metric-lbl">System Cost</div>
      </div>
      <div class="metric-card">
        <div class="metric-val metric-val-green">${fmt$(f.netCost)}</div>
        <div class="metric-lbl">After Incentives</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">${f.paybackYears.toFixed(1)} yrs</div>
        <div class="metric-lbl">Payback Period</div>
      </div>
    </div>

    <div class="two-col">
      <div>
        <div class="highlight-box green">
          <div class="highlight-box-title">25-Year Net Savings</div>
          <div class="highlight-box-val">${fmt$(cp.truth25yr.netDifference)}</div>
          <div class="highlight-box-sub">Total money saved vs. continuing to pay utility bills over 25 years.</div>
        </div>

        <div class="highlight-box">
          <div class="highlight-box-title">Monthly Impact</div>
          <div class="highlight-box-val">${deltaSign}${fmt$(f.ownershipDeltaMonthly)}/mo</div>
          <div class="highlight-box-sub">Difference between current monthly bill and new solar + remaining utility payment.</div>
        </div>
      </div>

      <div>
        <div class="sec-hdr">Investment Details</div>
        <table class="info-table">
          <tr><td>Gross System Cost</td><td>${fmt$(f.gross_system_cost)}</td></tr>
          ${itcEnabled ? `<tr><td>Federal ITC (${fmtPct(f.itcRate * 100)})</td><td style="color:#16a34a">-${fmt$(f.itcAmount)}</td></tr>` : ''}
          <tr><td>Net System Cost</td><td><strong>${fmt$(f.netCost)}</strong></td></tr>
          <tr><td>Monthly Solar Payment</td><td>${fmt$(f.solarPaymentMonthly)}/mo</td></tr>
          <tr><td>Finance APR</td><td>${(f.financeApr * 100).toFixed(2)}% / ${f.financeTermYears} yr</td></tr>
          <tr><td>Remaining Utility</td><td>${fmt$(f.utilityBillMonthly)}/mo</td></tr>
          <tr><td>Total Monthly Cost</td><td><strong>${fmt$(f.totalMonthlyCost)}/mo</strong></td></tr>
        </table>
      </div>
    </div>

    <div class="sec-hdr">Monthly Cost Comparison</div>
    <div style="padding:10px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;margin-bottom:10px;">
      <div class="compare-row">
        <div class="compare-lbl">Current Bill</div>
        <div class="compare-bar-bg"><div class="compare-bar-fill" style="width:${currentBarW}%;background:#ef4444;"></div></div>
        <div class="compare-val" style="color:#ef4444;">${fmt$(f.currentMonthlyBill)}/mo</div>
      </div>
      <div class="compare-row">
        <div class="compare-lbl">With Solar</div>
        <div class="compare-bar-bg"><div class="compare-bar-fill" style="width:${solarBarW}%;background:#22c55e;"></div></div>
        <div class="compare-val" style="color:#16a34a;">${fmt$(f.totalMonthlyCost)}/mo</div>
      </div>
    </div>

    <div class="two-col">
      <div>
        <div class="sec-hdr">Annual Energy Value</div>
        <table class="info-table">
          <tr><td>Year 1 Self-Consumed</td><td>${fmt$(f.energyValueBreakdown.selfConsumed)}</td></tr>
          <tr><td>Year 1 Exported</td><td>${fmt$(f.energyValueBreakdown.exported)}</td></tr>
          <tr><td>Total Year 1 Value</td><td><strong>${fmt$(f.energyValueBreakdown.total)}</strong></td></tr>
          <tr><td>Annual Energy Value</td><td>${fmt$(f.annualEnergyValue)}</td></tr>
        </table>
      </div>
      <div>
        <div class="sec-hdr">25-Year Breakdown</div>
        <table class="info-table">
          <tr><td>Utility Cost (no solar)</td><td>${fmt$(cp.truth25yr.utilityCostWithoutSolar)}</td></tr>
          <tr><td>Solar Investment Total</td><td>${fmt$(cp.truth25yr.solarCostTotal)}</td></tr>
          <tr><td>Remaining Utility</td><td>${fmt$(cp.truth25yr.remainingUtilityCost)}</td></tr>
          <tr><td style="font-weight:900;">Net 25-Year Savings</td><td style="font-weight:900;color:#16a34a;">${fmt$(cp.truth25yr.netDifference)}</td></tr>
        </table>
      </div>
    </div>
  </div>`;
}

function page25YrProjection(cp: CanonicalProposal): string {
  const projData = cp.truth25yr.projectionChart;
  const yearlyFlow = cp.truth25yr.yearlyFlow;

  // Build two line series: cumulative solar value vs cumulative utility cost.
  // BOTH must be running totals — total_energy_value is a PER-YEAR figure, so
  // accumulate it the same way as the utility line (previously it was plotted
  // un-accumulated, making solar look flat/catastrophic vs the climbing cost).
  const cumulativeSolar: number[] = [];
  const cumulativeUtility: number[] = [];
  let solarRunning = 0;
  let utilRunning = 0;
  const _hasSrec = yearlyFlow.some(y => (y.srec_income ?? 0) > 0);
  for (const y of yearlyFlow) {
    // Solar value = energy value + SREC income as actually scheduled per year
    // (Illinois Shines: 50% at energization + 50% over the following 6 years).
    // Excluding SREC here contradicted the SREC-inclusive break-even + savings.
    solarRunning += (y.total_energy_value ?? 0) + (y.srec_income ?? 0);
    cumulativeSolar.push(solarRunning);
    utilRunning += y.utility_cost_without_solar ?? 0;
    cumulativeUtility.push(utilRunning);
  }
  const labels = yearlyFlow.map((_, i) => `Yr ${i + 1}`);

  const lineChart = renderLineChartSVG({
    series: [
      { values: cumulativeUtility, color: '#ef4444', label: 'Cumulative Utility Cost (No Solar)' },
      { values: cumulativeSolar, color: '#22c55e', label: _hasSrec ? 'Cumulative Solar Value (incl. SREC income)' : 'Cumulative Solar Value' },
    ],
    labels,
    width: 520,
    height: 180,
  });

  // Monthly bill comparison bars
  const monthlyChart = cp.truth25yr.monthlyBillChart ?? [];
  const monthlyBarData = monthlyChart.map(m => ({ label: m.month.slice(0, 3), value: m.savings, color: '#22c55e' }));

  return `<div class="page">
    <div class="page-title">25-Year Financial Projection</div>

    <div class="metric-grid metric-grid-3" style="margin-bottom:14px;">
      <div class="metric-card">
        <div class="metric-val metric-val-green">${fmt$(cp.truth25yr.netDifference)}</div>
        <div class="metric-lbl">25-Year Net Savings</div>
      </div>
      <div class="metric-card">
        <div class="metric-val">${fmt$(cp.truth25yr.estimatedEnergyValue)}</div>
        <div class="metric-lbl">25-Year Energy Value</div>
      </div>
      <div class="metric-card">
        <div class="metric-val metric-val-orange">${cp._meta.payoffYear != null ? `Yr ${cp._meta.payoffYear}` : '> 25yr'}</div>
        <div class="metric-lbl">Break-Even Year</div>
      </div>
    </div>

    <div class="sec-hdr">Cumulative Value vs. Utility Cost — 25 Years</div>
    <div class="chart-wrap">
      ${lineChart}
    </div>

    ${monthlyBarData.length > 0 ? `
    <div class="sec-hdr" style="margin-top:8px;">Monthly Bill Savings (Year 1)</div>
    <div class="chart-wrap">
      <div class="chart-title">Monthly Savings: Before vs. After Solar</div>
      ${renderBarChartSVG({ data: monthlyBarData, width: 480, height: 120, showValues: false, barColor: '#22c55e' })}
    </div>` : ''}

    <div class="two-col" style="margin-top:10px;">
      <div>
        <div class="sec-hdr">Key Assumptions</div>
        <table class="info-table">
          <tr><td>Utility Rate (Year 1)</td><td>${(cp.utility.rate * 100).toFixed(2)}¢/kWh</td></tr>
          <tr><td>Rate Escalation</td><td>${(cp.utility.escalationRate * 100).toFixed(1)}%/yr</td></tr>
          <tr><td>Panel Degradation</td><td>0.5%/yr (industry standard)</td></tr>
          <tr><td>Finance Term</td><td>${cp.financial.financeTermYears} years @ ${(cp.financial.financeApr * 100).toFixed(2)}%</td></tr>
          <tr><td>NEM / Export Policy</td><td>${cp.utility.netMeteringType ?? 'Net Metering'}</td></tr>
        </table>
      </div>
      <div>
        <div class="sec-hdr">25-Year Milestones</div>
        <table class="info-table">
          <tr><td>Break-Even Year</td><td>${cp._meta.payoffYear != null ? `Year ${cp._meta.payoffYear}` : '> 25 years'}</td></tr>
          <tr><td>Total Utility (No Solar)</td><td>${fmt$(cp.truth25yr.utilityCostWithoutSolar)}</td></tr>
          <tr><td>Total Solar Investment</td><td>${fmt$(cp.truth25yr.solarCostTotal)}</td></tr>
          <tr><td>Remaining Utility Bills</td><td>${fmt$(cp.truth25yr.remainingUtilityCost)}</td></tr>
          <tr><td style="font-weight:900;">Net Savings</td><td style="font-weight:900;color:#16a34a;">${fmt$(cp.truth25yr.netDifference)}</td></tr>
          ${cp.truth25yr.srec_income_25yr > 0 ? `<tr><td>SREC Contract Income${(cp.truth25yr.yearlyFlow?.[0]?.srec_income ?? 0) > 0 ? ` <span style="font-weight:400;color:#64748b;">(~${fmt$(cp.truth25yr.yearlyFlow[0].srec_income)} upfront, remainder over 6 yrs)</span>` : ' (25yr)'}</td><td style="color:#16a34a;">${fmt$(cp.truth25yr.srec_income_25yr)}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <div class="note">
      Financial projections are estimates based on current utility rates, assumed annual rate escalation, and standard panel degradation.
      Actual savings will vary with usage patterns, weather, and future utility rate changes.
      ${cp.truth25yr.netDifference > 0 ? `This system is projected to save you ${fmt$(cp.truth25yr.netDifference)} over 25 years compared to paying utility bills without solar.` : ''}
    </div>
  </div>`;
}

function pageIncentives(cp: CanonicalProposal): string {
  const inc = cp.incentives;
  const f = cp.financial;
  const showItc = f.itcRate > 0;

  return `<div class="page">
    <div class="page-title">Incentives & Tax Credits</div>

    <div class="two-col" style="margin-bottom:14px;">
      ${showItc ? `
      <div class="highlight-box green">
        <div class="highlight-box-title">Federal Investment Tax Credit (ITC)</div>
        <div class="highlight-box-val">${fmt$(f.itcAmount)}</div>
        <div class="highlight-box-sub">${fmtPct(f.itcRate * 100)} of system cost (${fmt$(f.gross_system_cost)}).
          Applied as a direct credit against your federal income tax liability in the year of installation.
          Consult your tax advisor for eligibility.</div>
      </div>` : `
      <div class="highlight-box blue">
        <div class="highlight-box-title">Federal ITC</div>
        <div class="highlight-box-val">Not Included</div>
        <div class="highlight-box-sub">Ask your installer about current ITC eligibility. Federal incentives may apply — consult your tax professional.</div>
      </div>`}

      <div class="highlight-box ${cp.policy.srecAvailable ? 'green' : ''}">
        <div class="highlight-box-title">State & Local Incentives</div>
        <div class="highlight-box-val">${inc.total_incentives > 0 ? fmt$(inc.total_incentives) : 'Ask Us'}</div>
        <div class="highlight-box-sub">
          ${cp.policy.policyMessage ?? 'State and local incentives vary. Contact us to learn what programs are available in your area.'}
        </div>
      </div>
    </div>

    ${cp.policy.srecAvailable ? `
    <div class="sec-hdr">SREC Program</div>
    <div style="padding:10px;border:1px solid #e5e7eb;border-radius:4px;background:#f8fafc;margin-bottom:12px;font-size:9px;">
      ${cp.policy.srecSummary
        // Single source of truth: the schedule-aware summary (program name, $/REC,
        // total contract value, 50%-upfront + 6-yr payout) — same text as on-screen.
        ? `<strong>SREC / REC Program</strong> — ${cp.policy.srecSummary}`
        : `<strong>Solar Renewable Energy Certificates (SRECs)</strong> — Your solar system earns 1 SREC for every 1,000 kWh of electricity produced.
      SRECs can be sold to utilities in states with Renewable Portfolio Standards.`}
      ${cp.truth25yr.srec_income_25yr > 0 ? `<br><strong style="color:#16a34a;">Estimated total SREC contract income: ${fmt$(cp.truth25yr.srec_income_25yr)}${(cp.truth25yr.yearlyFlow?.[0]?.srec_income ?? 0) > 0 ? ` — ~${fmt$(cp.truth25yr.yearlyFlow[0].srec_income)} paid after energization, remainder over the following 6 years` : ''}</strong>` : ''}
    </div>` : ''}

    <div class="sec-hdr">Net Energy Metering (NEM)</div>
    <div style="padding:10px;border:1px solid #e5e7eb;border-radius:4px;background:#f8fafc;margin-bottom:12px;">
      <table class="info-table" style="margin:0;">
        <tr><td>NEM Type</td><td>${cp.utility.netMeteringType ?? 'Net Metering'}</td></tr>
        <tr><td>Current Rate</td><td>${(cp.utility.rate * 100).toFixed(2)}¢/kWh</td></tr>
        <tr><td>Rate Confidence</td><td>${cp._meta.truthConfidence}</td></tr>
        ${cp.utility.export_rate_monthly != null ? `<tr><td>Export Rate</td><td>${(cp.utility.export_rate_monthly * 100).toFixed(2)}¢/kWh</td></tr>` : ''}
        ${cp.utility.true_up_period ? `<tr><td>True-Up Period</td><td>${cp.utility.true_up_period}</td></tr>` : ''}
      </table>
    </div>


    ${(cp.policy.utilityPrograms || cp.policy.utilityProgramsNote) ? `
    <div class="sec-hdr">Utility Rate Plans & Incentive Programs</div>
    ${cp.policy.utilityPrograms ? (() => {
      const prog = cp.policy.utilityPrograms;
      const statusBadge = (s: string) => {
        const colors: Record<string, string> = {
          active:   'background:#dcfce7;color:#15803d;border:1px solid #86efac;',
          pilot:    'background:#fef9c3;color:#a16207;border:1px solid #fde047;',
          limited:  'background:#ffedd5;color:#c2410c;border:1px solid #fed7aa;',
          waitlist: 'background:#dbeafe;color:#1d4ed8;border:1px solid #93c5fd;',
          expired:  'background:#f1f5f9;color:#64748b;border:1px solid #cbd5e1;',
        };
        const style = colors[s] ?? colors.active;
        return `<span style="font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;${style}">${s.toUpperCase()}</span>`;
      };
      const rows: string[] = [];
      prog.tou_plans.forEach((p: any) => {
        const typeLabel = p.type === 'hourly_pricing' ? 'Hourly Pricing' : p.solar_friendly ? 'TOU Solar' : p.battery_optimized ? 'TOU Battery' : 'TOU Rate';
        const flags = [p.solar_friendly && 'Solar-friendly', p.battery_optimized && 'Battery-optimized', p.nem_compatible && 'NEM OK'].filter(Boolean).join(' · ');
        rows.push(`<tr style="background:#faf5ff;"><td style="font-weight:600;">${p.plan_name}</td><td>${typeLabel}</td><td style="color:#6b21a8;">${flags || 'Rate Plan'}</td><td>—</td><td>Active</td><td>${p.enrollment_url ? `<a href="${p.enrollment_url}" style="color:#7c3aed;font-size:7px;">Enroll</a>` : '—'}</td></tr>`);
        rows.push(`<tr><td colspan="6" style="font-size:7.5px;color:#374151;padding:3px 6px 6px 14px;"><strong style="color:#92400e;">Rep note:</strong> ${p.solar_pro_note}${p.last_verified ? ` <span style="color:#9ca3af;">(verified ${p.last_verified})</span>` : ''}</td></tr>`);
      });
      prog.battery_incentives.forEach((p: any) => {
        const typeLabel = p.type === 'vpp' ? 'VPP' : p.type === 'demand_response' ? 'Demand Response' : 'Battery Rebate';
        rows.push(`<tr style="background:#f0fdf4;"><td style="font-weight:600;">${p.program_name}</td><td>${typeLabel}</td><td style="color:#15803d;font-weight:600;">${p.value_description}</td><td>${p.max_value != null ? `Up to $${p.max_value.toLocaleString()}` : '—'}</td><td>${statusBadge(p.status)}</td><td>${p.enrollment_url ? `<a href="${p.enrollment_url}" style="color:#7c3aed;font-size:7px;">Enroll</a>` : '—'}</td></tr>`);
        rows.push(`<tr><td colspan="6" style="font-size:7.5px;color:#374151;padding:3px 6px 6px 14px;"><strong style="color:#92400e;">Rep note:</strong> ${p.solar_pro_note}${p.last_verified ? ` <span style="color:#9ca3af;">(verified ${p.last_verified})</span>` : ''}</td></tr>`);
      });
      prog.solar_rebates.forEach((p: any) => {
        rows.push(`<tr style="background:#fefce8;"><td style="font-weight:600;">${p.program_name}</td><td>Solar Rebate</td><td style="color:#15803d;font-weight:600;">${p.value_description}</td><td>${p.max_value != null ? `Up to $${p.max_value.toLocaleString()}` : '—'}</td><td>${statusBadge(p.status)}</td><td>${p.enrollment_url ? `<a href="${p.enrollment_url}" style="color:#7c3aed;font-size:7px;">Enroll</a>` : '—'}</td></tr>`);
        rows.push(`<tr><td colspan="6" style="font-size:7.5px;color:#374151;padding:3px 6px 6px 14px;"><strong style="color:#92400e;">Rep note:</strong> ${p.solar_pro_note}${p.last_verified ? ` <span style="color:#9ca3af;">(verified ${p.last_verified})</span>` : ''}</td></tr>`);
      });
      prog.nem_programs.forEach((p: any) => {
        const exportVal = p.export_rate_per_kwh != null ? `${(p.export_rate_per_kwh * 100).toFixed(1)}¢/kWh credit` : 'See program';
        rows.push(`<tr style="background:#ecfeff;"><td style="font-weight:600;">${p.program_name}</td><td>Net Metering</td><td style="color:#0369a1;">${exportVal}</td><td>${p.tou_export_credit ? 'TOU-based credits' : 'Fixed-rate credits'}</td><td>${statusBadge(p.status)}</td><td>${p.enrollment_url ? `<a href="${p.enrollment_url}" style="color:#7c3aed;font-size:7px;">Details</a>` : '—'}</td></tr>`);
        rows.push(`<tr><td colspan="6" style="font-size:7.5px;color:#374151;padding:3px 6px 6px 14px;"><strong style="color:#92400e;">Rep note:</strong> ${p.solar_pro_note}${p.last_verified ? ` <span style="color:#9ca3af;">(verified ${p.last_verified})</span>` : ''}</td></tr>`);
      });
      if (rows.length === 0) return '';
      return `<div style="margin-bottom:12px;border:1px solid #ddd6fe;border-radius:4px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;font-size:8px;">
          <thead><tr style="background:#7c3aed;color:#fff;">
            <th style="padding:4px 6px;text-align:left;width:22%;">Program / Plan</th>
            <th style="padding:4px 6px;text-align:left;width:11%;">Type</th>
            <th style="padding:4px 6px;text-align:left;width:24%;">Value / Detail</th>
            <th style="padding:4px 6px;text-align:left;width:17%;">Cap / Notes</th>
            <th style="padding:4px 6px;text-align:left;width:11%;">Status</th>
            <th style="padding:4px 6px;text-align:left;width:11%;">Link</th>
          </tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
        <div style="padding:4px 8px;background:#f5f3ff;font-size:7px;color:#6b7280;border-top:1px solid #ddd6fe;">Program details are informational. Enrollment subject to utility eligibility and funding availability. Verify current status before committing to customer.</div>
      </div>`;
    })() : ''}
    ${!cp.policy.utilityPrograms && cp.policy.utilityProgramsNote ? `
    <div style="padding:10px;border:1px solid #ddd6fe;border-radius:4px;background:#faf5ff;margin-bottom:12px;font-size:9px;">
      ${cp.policy.utilityProgramsNote.split('\n').map((line: string) => `<div style="margin-bottom:5px;">${line}</div>`).join('')}
      <div style="margin-top:6px;color:#6b7280;font-size:8px;">Program details are informational. Verify current program status with your utility.</div>
    </div>` : ''}
    ` : ''}

    <div class="sec-hdr">Combined Incentive Summary</div>
    <table class="equip-table">
      <thead><tr><th>Incentive</th><th>Type</th><th>Amount</th><th>Timing</th></tr></thead>
      <tbody>
        ${showItc ? `<tr><td>Federal ITC (${fmtPct(f.itcRate * 100)})</td><td>Tax Credit</td><td style="color:#16a34a;font-weight:700;">${fmt$(f.itcAmount)}</td><td>Year 1 tax filing</td></tr>` : ''}
        ${inc.total_incentives > 0 ? `<tr><td>State Incentive</td><td>Varies</td><td style="color:#16a34a;font-weight:700;">${fmt$(inc.total_incentives)}</td><td>Varies</td></tr>` : ''}
        ${cp.policy.srecAvailable ? `<tr><td>SREC Income</td><td>REC Contract</td><td style="color:#16a34a;font-weight:700;">${cp.truth25yr.srec_income_25yr > 0 ? fmt$(cp.truth25yr.srec_income_25yr) : 'Market Rate'}</td><td>${(cp.truth25yr.yearlyFlow?.[0]?.srec_income ?? 0) > 0 ? '~50% upfront + 6 yrs' : 'Annual'}</td></tr>` : ''}
        <tr style="background:#f0fdf4;font-weight:900;"><td>Total Potential Value</td><td></td><td style="color:#16a34a;">${fmt$(f.itcAmount + inc.total_incentives + (cp.truth25yr.srec_income_25yr ?? 0))}</td><td></td></tr>
      </tbody>
    </table>

    <div class="disclaimer">
      Incentive information is provided for illustrative purposes only and does not constitute tax or legal advice.
      Eligibility for federal, state, and local incentives depends on individual tax situation, system ownership, and applicable program requirements.
      Consult a qualified tax professional before making financial decisions based on incentive estimates.
      ITC information based on current federal law — subject to change.
    </div>
  </div>`;
}

function pageEquipment(cp: CanonicalProposal, p: Proposal): string {
  const project = p.project;
  const layout = project?.layout;
  const selectedInv = project?.selectedInverter;
  const inverters: Array<{ manufacturer?: string; model?: string; type?: string; acOutputKw?: number; maxDcVoltage?: number }> =
    selectedInv ? [{ manufacturer: selectedInv.manufacturer, model: selectedInv.model, type: selectedInv.type, acOutputKw: selectedInv.capacity, maxDcVoltage: undefined }] : [];

  return `<div class="page">
    <div class="page-title">Equipment Specifications</div>

    <div class="sec-hdr">Solar Panel</div>
    <table class="equip-table" style="margin-bottom:12px;">
      <thead><tr><th>Specification</th><th>Value</th><th>Specification</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Manufacturer</td><td>${cp.panel.manufacturer}</td><td>Model</td><td>${cp.panel.model}</td></tr>
        <tr><td>Rated Power (Pmax)</td><td>${cp.panel.wattage} Wp</td><td>Panel Count</td><td>${cp.panel.count} panels</td></tr>
        <tr><td>System Size</td><td>${fmtKw(cp.panel.systemSizeKw)} DC</td><td>Cell Type</td><td>${cp.panel.cellType ?? 'Monocrystalline'}</td></tr>
        <tr><td>Efficiency</td><td>${cp.panel.efficiency != null ? cp.panel.efficiency.toFixed(1) + '%' : '—'}</td><td>Warranty</td><td>${cp.panel.warranty != null ? cp.panel.warranty + ' yr' : '25 yr'}</td></tr>
        <tr><td>Temperature Coeff.</td><td>${cp.panel.temperatureCoeff != null ? cp.panel.temperatureCoeff.toFixed(2) + '%/°C' : '—'}</td><td>Bifacial</td><td>${cp.panel.bifacial ? 'Yes' : 'No'}</td></tr>
      </tbody>
    </table>

    ${inverters.length > 0 ? `
    <div class="sec-hdr">Inverter(s)</div>
    <table class="equip-table" style="margin-bottom:12px;">
      <thead><tr><th>#</th><th>Manufacturer</th><th>Model</th><th>Type</th><th>AC Output</th><th>Max DC V</th></tr></thead>
      <tbody>
        ${inverters.map((inv, i) => `<tr>
          <td>${i + 1}</td>
          <td>${inv.manufacturer ?? '—'}</td>
          <td>${inv.model ?? '—'}</td>
          <td>${inv.type === 'micro' ? 'Microinverter' : inv.type === 'optimizer' ? 'Optimizer' : 'String'}</td>
          <td>${inv.acOutputKw != null ? Number(inv.acOutputKw).toFixed(2) + ' kW' : '—'}</td>
          <td>${inv.maxDcVoltage != null ? inv.maxDcVoltage + 'V' : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : ''}

    <div class="two-col">
      <div>
        <div class="sec-hdr">System Configuration</div>
        <table class="info-table">
          <tr><td>Total DC Power</td><td>${fmtKw(cp.panel.systemSizeKw)}</td></tr>
          <tr><td>Annual Production</td><td>${fmtKwh(cp.production.annualKwh)}</td></tr>
          <tr><td>Energy Offset</td><td>${fmtPct(cp.offset.percentage)}</td></tr>
          <tr><td>System Type</td><td>${project?.systemType ?? 'Roof Mount'}</td></tr>
          ${(layout as any)?.mountType ? `<tr><td>Mount Type</td><td>${(layout as any).mountType}</td></tr>` : ''}
          ${(layout as any)?.tiltAngle != null ? `<tr><td>Tilt Angle</td><td>${(layout as any).tiltAngle}°</td></tr>` : ''}
        </table>
      </div>
      <div>
        <div class="sec-hdr">Certifications & Standards</div>
        <ul class="checklist" style="font-size:9px;">
          <li>UL 61730 / IEC 61215 — Module Safety & Performance</li>
          <li>UL 1741 SA — Inverter Grid Standards</li>
          <li>IEEE 1547-2018 — Interconnection Standards</li>
          <li>UL 2703 — Racking System</li>
          <li>NEC 690 — Solar PV System Installation</li>
          <li>Anti-Islanding Protection (IEEE 1547)</li>
          <li>25-Year Linear Power Warranty</li>
          <li>10-Year Product Warranty</li>
        </ul>
      </div>
    </div>

    <div class="note">
      All equipment is CEC-listed, UL-listed, and approved for grid interconnection.
      Complete manufacturer specification sheets are available upon request.
    </div>
  </div>`;
}

function pageNextSteps(cp: CanonicalProposal, p: Proposal, branding: ProposalBranding): string {
  const project = p.project;
  const clientName = project?.client?.name ?? project?.name ?? 'You';

  return `<div class="page">
    <div class="page-title">Next Steps & Why Go Solar</div>

    <div class="two-col" style="margin-bottom:14px;">
      <div>
        <div class="sec-hdr">Your Next Steps</div>

        <div class="step-card">
          <div class="step-num">1</div>
          <div class="step-content">
            <h4>Review & Sign Proposal</h4>
            <p>Review this proposal and sign the installation agreement. Our team is available to answer any questions.</p>
          </div>
        </div>

        <div class="step-card">
          <div class="step-num">2</div>
          <div class="step-content">
            <h4>Site Survey & Engineering</h4>
            <p>Our engineers will conduct a detailed site survey and prepare permit-ready engineering drawings.</p>
          </div>
        </div>

        <div class="step-card">
          <div class="step-num">3</div>
          <div class="step-content">
            <h4>Permit & HOA Approval</h4>
            <p>We handle all permit applications with your local AHJ and coordinate any required HOA approvals.</p>
          </div>
        </div>

        <div class="step-card">
          <div class="step-num">4</div>
          <div class="step-content">
            <h4>Installation</h4>
            <p>Our certified technicians install your system — typically completed in 1–2 days.</p>
          </div>
        </div>

        <div class="step-card">
          <div class="step-num">5</div>
          <div class="step-content">
            <h4>Inspection & Interconnection</h4>
            <p>Final inspection by AHJ, followed by utility interconnection approval and Permission to Operate (PTO).</p>
          </div>
        </div>
      </div>

      <div>
        <div class="sec-hdr">Why Go Solar Now</div>

        <div class="highlight-box green" style="margin-bottom:10px;">
          <div class="highlight-box-title">Your 25-Year Savings</div>
          <div class="highlight-box-val">${fmt$(cp.truth25yr.netDifference)}</div>
          <div class="highlight-box-sub">Projected net savings vs. continuing to pay utility bills for 25 years.</div>
        </div>

        <div class="highlight-box" style="margin-bottom:10px;">
          <div class="highlight-box-title">Monthly Impact</div>
          <div class="highlight-box-val">${fmt$(cp.financial.totalMonthlyCost)}/mo</div>
          <div class="highlight-box-sub">Your new total monthly energy cost including solar payment and remaining utility.</div>
        </div>

        <div class="sec-hdr" style="margin-top:10px;">What You Get</div>
        <ul class="checklist">
          <li>${fmtKw(cp.panel.systemSizeKw)} solar system — ${cp.panel.count} × ${cp.panel.wattage}W panels</li>
          <li>${fmtPct(cp.offset.percentage)} of your electricity offset</li>
          <li>${fmtKwh(cp.production.annualKwh)} estimated annual production</li>
          <li>25-year performance warranty on panels</li>
          <li>Full permit package and utility interconnection</li>
          <li>Ongoing monitoring and support</li>
          ${cp.financial.itcAmount > 0 ? `<li>Federal ITC credit: ${fmt$(cp.financial.itcAmount)}</li>` : ''}
          ${cp.policy.srecAvailable ? '<li>SREC income eligibility in your state</li>' : ''}
        </ul>

        <div style="margin-top:12px;padding:12px;background:#0f172a;color:white;border-radius:6px;text-align:center;">
          <div style="font-size:10px;font-weight:900;margin-bottom:4px;">${branding.companyName}</div>
          ${branding.companyPhone ? `<div style="font-size:11px;color:#f59e0b;font-weight:700;">${branding.companyPhone}</div>` : ''}
          ${branding.companyAddress ? `<div style="font-size:8px;color:#94a3b8;margin-top:3px;">${branding.companyAddress}</div>` : ''}
          <div style="font-size:8px;color:#64748b;margin-top:6px;">This proposal is valid for 30 days. Contact us today to lock in your pricing.</div>
        </div>
      </div>
    </div>

    <div class="disclaimer">
      This proposal is prepared for ${clientName} and is based on information provided at the time of site assessment.
      System size, production estimates, and financial projections are estimates only and may vary based on actual site conditions,
      equipment availability, utility rate changes, and regulatory requirements. Proposal valid for 30 days from date of issue.
      All incentive and tax credit information is based on current laws and is subject to change.
      Consult a qualified tax professional for advice specific to your situation.
      ${branding.companyName} is a licensed solar installation contractor. License number available upon request.
    </div>
  </div>`;
}

// ── Branding type ─────────────────────────────────────────────────────────────

export interface ProposalBranding {
  companyName: string;
  companyAddress?: string | null;
  companyPhone?: string | null;
  companyWebsite?: string | null;
  brandPrimaryColor?: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function renderProposalHTML(
  cp: CanonicalProposal,
  proposal: Proposal,
  branding: ProposalBranding = { companyName: 'SolarPro' },
): string {
  const pages = [
    pageCover(cp, proposal, branding),
    pageSystem(cp, proposal),
    pageFinancial(cp),
    page25YrProjection(cp),
    pageIncentives(cp),
    pageEquipment(cp, proposal),
    pageNextSteps(cp, proposal, branding),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Solar Proposal — ${proposal.project?.name ?? proposal.title ?? 'Solar Proposal'}</title>
  <style>${CSS}</style>
</head>
<body>
${pages}
</body>
</html>`;
}