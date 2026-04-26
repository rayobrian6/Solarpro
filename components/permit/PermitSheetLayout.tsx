'use client';
// ============================================================
// components/permit/PermitSheetLayout.tsx
// Reusable layout wrapper for permit plan sheet pages.
// Renders the standard engineering title block on the right side,
// sheet number in bottom-right corner, and provides a content
// area for the sheet body.
// ============================================================

import React from 'react';

export interface PermitSheetMeta {
  sheetNumber: string;       // e.g. "PV-0"
  sheetTitle:  string;       // e.g. "COVER SHEET"
  projectName: string;
  clientName:  string;
  address:     string;
  preparedDate: string;
  revision:    string;
  designer:    string;
  engineerCompany: string;
  engineerAddress: string;
  totalSheets?: number;      // e.g. 11
}

interface PermitSheetLayoutProps {
  meta:     PermitSheetMeta;
  children: React.ReactNode;
  /** Extra CSS class(es) for the sheet body area */
  bodyClassName?: string;
}

// ── Title block (right strip) ────────────────────────────────────────────────

function TitleBlock({ meta }: { meta: PermitSheetMeta }) {
  return (
    <div className="permit-title-block">

      {/* Company name / brand */}
      <div className="ptb-logo">
        <span className="ptb-logo-sp">Solar</span><span className="ptb-logo-pro">Pro</span>
        <div className="ptb-logo-sub">ENGINEERING</div>
      </div>

      {/* Project info rows */}
      <div className="ptb-row">
        <div className="ptb-label">PROJECT</div>
        <div className="ptb-value">{meta.projectName}</div>
      </div>
      <div className="ptb-row">
        <div className="ptb-label">CLIENT</div>
        <div className="ptb-value">{meta.clientName}</div>
      </div>
      <div className="ptb-row">
        <div className="ptb-label">ADDRESS</div>
        <div className="ptb-value">{meta.address}</div>
      </div>

      <div className="ptb-divider" />

      {/* Engineering info */}
      <div className="ptb-row">
        <div className="ptb-label">ENGINEER</div>
        <div className="ptb-value">{meta.engineerCompany}</div>
      </div>
      <div className="ptb-row">
        <div className="ptb-label">DESIGNED BY</div>
        <div className="ptb-value">{meta.designer}</div>
      </div>
      <div className="ptb-row">
        <div className="ptb-label">DATE</div>
        <div className="ptb-value">{meta.preparedDate}</div>
      </div>
      <div className="ptb-row ptb-row-rev">
        <div className="ptb-label">REV</div>
        <div className="ptb-value ptb-rev">{meta.revision}</div>
      </div>

      <div className="ptb-divider" />

      {/* PE Stamp placeholder */}
      <div className="ptb-stamp">
        <div className="ptb-stamp-ring">
          <span className="ptb-stamp-txt">PE STAMP<br />REQUIRED</span>
        </div>
      </div>

      <div className="ptb-divider" />

      {/* Sheet size */}
      <div className="ptb-row">
        <div className="ptb-label">SHEET SIZE</div>
        <div className="ptb-value">ANSI B<br />11" × 17"</div>
      </div>

      <div className="ptb-divider" />

      {/* Sheet title & number */}
      <div className="ptb-sheet-label">SHEET NAME</div>
      <div className="ptb-sheet-title">{meta.sheetTitle}</div>

      <div className="ptb-sheet-label" style={{ marginTop: '4px' }}>SHEET NO.</div>
      <div className="ptb-sheet-number">{meta.sheetNumber}</div>
      {meta.totalSheets !== undefined && (
        <div className="ptb-sheet-total">OF {meta.totalSheets}</div>
      )}

    </div>
  );
}

// ── Main layout ──────────────────────────────────────────────────────────────

export default function PermitSheetLayout({
  meta,
  children,
  bodyClassName = '',
}: PermitSheetLayoutProps) {
  return (
    <div className="permit-sheet-wrapper">

      {/* Main content area */}
      <div className={`permit-sheet-body ${bodyClassName}`}>
        {children}
      </div>

      {/* Right-side title block */}
      <TitleBlock meta={meta} />

      {/* Scoped styles */}
      <style>{`
        .permit-sheet-wrapper {
          position: relative;
          width: 100%;
          min-height: 100vh;
          background: #fff;
          font-family: Arial, Helvetica, sans-serif;
          font-size: 10px;
          color: #0d0d0d;
          box-sizing: border-box;
        }

        /* Right-side title block strip */
        .permit-title-block {
          position: absolute;
          top: 0;
          right: 0;
          width: 118px;
          bottom: 0;
          background: #fff;
          border-left: 2px solid #0d0d0d;
          display: flex;
          flex-direction: column;
          align-items: stretch;
          padding: 0;
          overflow: hidden;
        }

        .permit-sheet-body {
          margin-right: 120px;
          padding: 10px;
          box-sizing: border-box;
          min-height: 100vh;
        }

        /* ── Logo / Brand ── */
        .ptb-logo {
          background: #0d0d0d;
          color: #fff;
          text-align: center;
          padding: 7px 4px 4px;
          border-bottom: 2px solid #0d0d0d;
          line-height: 1.1;
        }
        .ptb-logo-sp  { font-size: 14px; font-weight: 900; color: #f0c040; letter-spacing: 0.5px; }
        .ptb-logo-pro { font-size: 14px; font-weight: 900; color: #fff;    letter-spacing: 0.5px; }
        .ptb-logo-sub {
          font-size: 6.5px;
          font-weight: 700;
          color: #bbb;
          letter-spacing: 2px;
          text-transform: uppercase;
          margin-top: 2px;
        }

        /* ── Info rows ── */
        .ptb-row {
          border-bottom: 1px solid #aaa;
          padding: 3px 5px;
        }
        .ptb-row-rev {
          background: #f0f0f0;
        }
        .ptb-label {
          font-size: 6px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          line-height: 1.2;
        }
        .ptb-value {
          font-size: 7.5px;
          color: #0d0d0d;
          font-weight: 700;
          word-break: break-word;
          margin-top: 1px;
          line-height: 1.3;
        }
        .ptb-rev {
          font-size: 10px;
          font-weight: 900;
          color: #0d0d0d;
          font-family: 'Courier New', Courier, monospace;
        }

        .ptb-divider {
          height: 2px;
          background: #0d0d0d;
          margin: 0;
          flex-shrink: 0;
        }

        /* ── PE Stamp ── */
        .ptb-stamp {
          padding: 6px 4px;
          text-align: center;
          border-bottom: 1px solid #aaa;
        }
        .ptb-stamp-ring {
          border: 1.5px dashed #888;
          border-radius: 50%;
          width: 76px;
          height: 76px;
          margin: 0 auto;
          display: table;
        }
        .ptb-stamp-txt {
          display: table-cell;
          vertical-align: middle;
          font-size: 6.5px;
          color: #888;
          font-weight: 700;
          text-align: center;
          line-height: 1.5;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        /* ── Sheet labels ── */
        .ptb-sheet-label {
          font-size: 6px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          padding: 4px 5px 1px;
          line-height: 1;
        }
        .ptb-sheet-title {
          text-align: center;
          font-size: 8px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          color: #0d0d0d;
          padding: 2px 4px 4px;
          border-bottom: 1px solid #aaa;
        }
        .ptb-sheet-number {
          text-align: center;
          font-size: 22px;
          font-weight: 900;
          color: #0d0d0d;
          padding: 4px 4px 2px;
          line-height: 1;
          font-family: 'Courier New', Courier, monospace;
          letter-spacing: 1px;
        }
        .ptb-sheet-total {
          text-align: center;
          font-size: 7px;
          color: #555;
          font-weight: 600;
          padding-bottom: 4px;
        }
      `}</style>
    </div>
  );
}