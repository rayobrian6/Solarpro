'use client';
// ============================================================
// components/permit/CoverSheet.tsx
// PV-0 Permit Cover Sheet — Engineering Authority Edition
// Accepts PermitCoverData (lib/permit/types.ts).
// display:table layout for wkhtmltopdf compatibility.
// ALL DATA BINDINGS PRESERVED. ZERO LOGIC CHANGES.
// ============================================================

import React from 'react';
import type { PermitCoverData } from '@/lib/permit/types';
import PermitSheetLayout from './PermitSheetLayout';

interface CoverSheetProps {
  data: PermitCoverData;
  standalone?: boolean;
}

// ── Compass Rose ─────────────────────────────────────────────────────────────
function CompassRose({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <circle cx="24" cy="24" r="22" fill="none" stroke="#000" strokeWidth="1.5" />
      <polygon points="24,3 21,20 24,17 27,20" fill="#000" />
      <polygon points="24,45 21,28 24,31 27,28" fill="#fff" stroke="#000" strokeWidth="0.8" />
      <line x1="2" y1="24" x2="7" y2="24" stroke="#000" strokeWidth="1.5" />
      <line x1="41" y1="24" x2="46" y2="24" stroke="#000" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="1.6" fill="#000" />
      <text x="24" y="12" textAnchor="middle" fontSize="7" fontWeight="bold" fontFamily="Arial" fill="#000">N</text>
      <text x="24" y="47" textAnchor="middle" fontSize="6" fontFamily="Arial" fill="#555">S</text>
      <text x="5"  y="27" textAnchor="middle" fontSize="6" fontFamily="Arial" fill="#555">W</text>
      <text x="43" y="27" textAnchor="middle" fontSize="6" fontFamily="Arial" fill="#555">E</text>
    </svg>
  );
}

// ── Site Pin ──────────────────────────────────────────────────────────────────
function SitePin() {
  return (
    <svg width="26" height="34" viewBox="0 0 36 44" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block' }}>
      <circle cx="18" cy="18" r="16" fill="#b00" stroke="#fff" strokeWidth="2" />
      <circle cx="18" cy="18" r="5" fill="#fff" />
      <polygon points="10,30 26,30 18,44" fill="#b00" />
    </svg>
  );
}

// ── Cover Sheet Inner ─────────────────────────────────────────────────────────
function CoverSheetInner({ data }: { data: PermitCoverData }) {
  const {
    projectName, clientName, address, city, state, zip,
    apn, ahj, utility, necVersion, ibcVersion, ifcVersion,
    systemSizeKWDC, systemSizeKWAC, moduleCount,
    moduleModel, moduleManufacturer, moduleWatts,
    inverterModel, inverterManufacturer, inverterType,
    mountingSystem,
    batteryCount, batteryModel, batteryManufacturer,
    interconnectionMethod, backfeedAmps, mainPanelAmps, mainBreakerDeRatePass,
    roofType, roofPitch, roofFraming, stories, roofLayers, roofLoadPsf,
    windSpeedMph, windExposure, exposureCategory, groundSnowPsf,
    satelliteImageBase64, satelliteImageUrl,
    engineerCompany, engineerAddress,
    preparedDate, designer, revision,
    sheets, constructionNotes,
  } = data;

  const inverterLabel =
    inverterType === 'microinverter' ? 'MICROINVERTER' :
    inverterType === 'optimizer'     ? 'POWER OPTIMIZER + STRING INVERTER' :
                                       'STRING INVERTER';

  const sysTypeLabel =
    mountingSystem?.toUpperCase().includes('GROUND') ? 'GROUND MOUNT' :
    mountingSystem?.toUpperCase().includes('FENCE')  ? 'SOL FENCE / GROUND MOUNT' :
                                                       'ROOF MOUNT';

  const aerialSrc   = satelliteImageBase64 ?? satelliteImageUrl ?? '';
  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
  const busLimit    = Math.round(mainPanelAmps * 1.2);

  return (
    <div className="E-root">

      {/* ══ OUTER BORDER ══════════════════════════════════════════════════ */}
      <div className="E-sheet">

        {/* ── TITLE BANNER ─────────────────────────────────────────────── */}
        <div className="E-banner">
          <div className="E-banner-t1">PHOTOVOLTAIC {sysTypeLabel} SYSTEM</div>
          <div className="E-banner-t2">
            {moduleCount}&nbsp;MODULES&nbsp;—&nbsp;
            {systemSizeKWDC.toFixed(3)}&nbsp;kW DC&nbsp;/&nbsp;
            {systemSizeKWAC.toFixed(3)}&nbsp;kW AC
          </div>
        </div>

        {/* ── PROJECT ID BAR ────────────────────────────────────────────── */}
        <div className="E-idbar">
          <span className="E-idbar-proj">{projectName || clientName}</span>
          <span className="E-idbar-addr">{fullAddress}</span>
          <span className="E-idbar-note">FIELD VERIFY ALL DIMENSIONS · NOT TO SCALE UNLESS OTHERWISE NOTED</span>
        </div>

        {/* ── SYSTEM SPECIFICATION BLOCK ───────────────────────────────── */}
        <div className="E-specblock">
          <div className="E-blk-hdr">▌ PHOTOVOLTAIC SYSTEM SPECIFICATION</div>
          <div className="E-specgrid">
            <div className="E-specrow">
              <span className="E-sk">SYSTEM TYPE:</span><span className="E-sv E-sv-bold">{sysTypeLabel}</span>
              <span className="E-sk">SYSTEM SIZE DC:</span><span className="E-sv E-sv-bold">{systemSizeKWDC.toFixed(3)} kW DC</span>
              <span className="E-sk">SYSTEM SIZE AC:</span><span className="E-sv E-sv-bold">{systemSizeKWAC.toFixed(3)} kW AC</span>
            </div>
            <div className="E-specrow">
              <span className="E-sk">MODULE COUNT:</span><span className="E-sv E-sv-bold">{moduleCount} MODULES @ {moduleWatts}W EA.</span>
              <span className="E-sk">INVERTER TYPE:</span><span className="E-sv E-sv-bold">{inverterLabel}</span>
              <span className="E-sk">INTERCONNECTION:</span><span className="E-sv E-sv-bold">{interconnectionMethod}</span>
            </div>
          </div>
        </div>

        {/* ── BODY: LEFT + RIGHT ────────────────────────────────────────── */}
        <div className="E-body">

          {/* ── LEFT COLUMN ── */}
          <div className="E-col-l">

            {/* EQUIPMENT SCHEDULE */}
            <div className="E-sec">EQUIPMENT SCHEDULE — SYSTEM SUMMARY</div>
            <table className="E-eq">
              <tbody>
                <tr>
                  <td className="E-tag">(N)</td>
                  <td className="E-qty">{moduleCount}</td>
                  <td className="E-desc">–&nbsp;{moduleManufacturer ? moduleManufacturer + ': ' : ''}{moduleModel} ({moduleWatts}W) PV MODULE</td>
                </tr>
                <tr>
                  <td className="E-tag">(N)</td>
                  <td className="E-qty">{moduleCount}</td>
                  <td className="E-desc">–&nbsp;{inverterManufacturer ? inverterManufacturer + ': ' : ''}{inverterModel} {inverterLabel}</td>
                </tr>
                {batteryCount !== undefined && batteryCount > 0 ? (
                  <tr>
                    <td className="E-tag">(N)</td>
                    <td className="E-qty">{batteryCount}</td>
                    <td className="E-desc">–&nbsp;{batteryManufacturer ? batteryManufacturer + ' ' : ''}{batteryModel ?? '—'} BATTERY STORAGE SYSTEM</td>
                  </tr>
                ) : null}
                <tr>
                  <td className="E-tag">(E)</td>
                  <td className="E-qty">1</td>
                  <td className="E-desc">–&nbsp;{mainPanelAmps}A MAIN SERVICE PANEL (EXISTING)</td>
                </tr>
                <tr>
                  <td className="E-tag">(N)</td>
                  <td className="E-qty">1</td>
                  <td className="E-desc">–&nbsp;{mountingSystem}</td>
                </tr>
                <tr>
                  <td className="E-tag">(N)</td>
                  <td className="E-qty">1</td>
                  <td className="E-desc">–&nbsp;{backfeedAmps}A PV BACKFEED BREAKER</td>
                </tr>
                <tr>
                  <td className="E-tag">(N)</td>
                  <td className="E-qty">1</td>
                  <td className="E-desc">–&nbsp;{mainPanelAmps}A MSP W/ {busLimit}A MAX BUS (120% RULE)</td>
                </tr>
              </tbody>
            </table>

            {/* ELECTRICAL SUMMARY */}
            <div className="E-sec" style={{ marginTop: '4px' }}>ELECTRICAL SUMMARY</div>
            <table className="E-kv">
              <tbody>
                <tr><td className="E-k">INTERCONNECTION METHOD</td><td className="E-v">{interconnectionMethod}</td></tr>
                <tr><td className="E-k">BACKFEED BREAKER SIZE</td><td className="E-v">{backfeedAmps}A</td></tr>
                <tr><td className="E-k">MAIN PANEL BUS RATING</td><td className="E-v">{mainPanelAmps}A</td></tr>
                <tr><td className="E-k">120% MAX BUS (NEC 705.12)</td><td className="E-v">{busLimit}A</td></tr>
                <tr>
                  <td className="E-k">120% RULE STATUS</td>
                  <td className={mainBreakerDeRatePass ? 'E-pass' : 'E-fail'}>
                    {mainBreakerDeRatePass ? '✓ PASS' : '✗ FAIL — DERATE / BUS UPGRADE REQUIRED'}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* DESIGN CRITERIA */}
            <div className="E-sec" style={{ marginTop: '4px' }}>DESIGN CRITERIA</div>
            <table className="E-kv">
              <tbody>
                <tr><td className="E-k">ROOF TYPE</td><td className="E-v">{roofType}</td></tr>
                <tr><td className="E-k">NO. OF LAYERS</td><td className="E-v">{String(roofLayers).padStart(2, '0')}</td></tr>
                <tr><td className="E-k">ROOF FRAMING</td><td className="E-v">{roofFraming}</td></tr>
                <tr><td className="E-k">ROOF PITCH</td><td className="E-v">{roofPitch}</td></tr>
                <tr><td className="E-k">STORIES</td><td className="E-v">{stories}</td></tr>
                <tr><td className="E-k">ROOF DL</td><td className="E-v">{roofLoadPsf} PSF</td></tr>
                <tr><td className="E-k">BASIC WIND SPEED (ASCE 7-22)</td><td className="E-v">{windSpeedMph} MPH</td></tr>
                <tr><td className="E-k">WIND EXPOSURE CAT.</td><td className="E-v">EXP. {windExposure} / {exposureCategory}</td></tr>
                <tr><td className="E-k">GROUND SNOW LOAD (Pg)</td><td className="E-v">{groundSnowPsf} PSF</td></tr>
              </tbody>
            </table>

            {/* GOVERNING CODES */}
            <div className="E-sec" style={{ marginTop: '4px' }}>GOVERNING CODES</div>
            <table className="E-codes">
              <tbody>
                <tr><td>{ibcVersion} INTERNATIONAL BUILDING CODE (IBC)</td></tr>
                <tr><td>{ibcVersion} INTERNATIONAL RESIDENTIAL CODE (IRC)</td></tr>
                <tr><td>{ifcVersion} INTERNATIONAL FIRE CODE (IFC)</td></tr>
                <tr><td>{necVersion} NATIONAL ELECTRICAL CODE (NEC)</td></tr>
                <tr><td>ASCE 7-22 MINIMUM DESIGN LOADS FOR BUILDINGS AND OTHER STRUCTURES</td></tr>
                <tr><td>AHJ: {ahj}</td></tr>
                <tr><td>SERVING UTILITY: {utility}</td></tr>
              </tbody>
            </table>

            {/* SHEET INDEX */}
            {sheets && sheets.length > 0 ? (
              <>
                <div className="E-sec" style={{ marginTop: '4px' }}>SHEET INDEX</div>
                <table className="E-idx">
                  <thead>
                    <tr>
                      <th className="E-idx-h E-idx-c1">SHT.</th>
                      <th className="E-idx-h E-idx-c2">TITLE</th>
                      <th className="E-idx-h">DESCRIPTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sheets.map((s, i) => (
                      <tr key={i} className={s.id === 'PV-0' ? 'E-idx-cur' : ''}>
                        <td className="E-idx-id">{s.id}</td>
                        <td className="E-idx-ti">{s.title}</td>
                        <td className="E-idx-de">{s.description ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            {/* PROJECT INFO */}
            <div className="E-sec" style={{ marginTop: '4px' }}>PROJECT INFORMATION</div>
            <table className="E-kv">
              <tbody>
                <tr><td className="E-k">CLIENT</td><td className="E-v">{clientName}</td></tr>
                <tr><td className="E-k">PROJECT ADDRESS</td><td className="E-v">{fullAddress}</td></tr>
                {apn && <tr><td className="E-k">APN</td><td className="E-v">{apn}</td></tr>}
                <tr><td className="E-k">AHJ</td><td className="E-v">{ahj}</td></tr>
                <tr><td className="E-k">UTILITY</td><td className="E-v">{utility}</td></tr>
                <tr><td className="E-k">DESIGNED BY</td><td className="E-v">{designer}</td></tr>
                <tr><td className="E-k">ENGINEER OF RECORD</td><td className="E-v">{engineerCompany}</td></tr>
                <tr><td className="E-k">DATE ISSUED</td><td className="E-v">{preparedDate}</td></tr>
                <tr><td className="E-k">REVISION</td><td className="E-v">{revision}</td></tr>
              </tbody>
            </table>

            <div className="E-authority-line">
              CONTRACTOR RESPONSIBLE FOR VERIFICATION OF ALL SITE CONDITIONS PRIOR TO INSTALLATION.
            </div>

          </div>{/* end left */}

          {/* ── RIGHT COLUMN ── */}
          <div className="E-col-r">

            {/* CONSTRUCTION NOTES */}
            {constructionNotes && constructionNotes.length > 0 ? (
              <>
                <div className="E-sec">GENERAL CONSTRUCTION NOTES</div>
                <div className="E-notes">
                  {constructionNotes.map((note, i) => (
                    <div key={i} className="E-note">
                      <span className="E-note-n">{i + 1}.</span>
                      <span className="E-note-t">{note}</span>
                    </div>
                  ))}
                  <div className="E-note E-note-authority">
                    <span className="E-note-n">—</span>
                    <span className="E-note-t">FIELD VERIFY ALL DIMENSIONS AND CONDITIONS PRIOR TO INSTALLATION. CONTRACTOR RESPONSIBLE FOR ALL SITE CONDITIONS. DRAWINGS NOT NECESSARILY TO SCALE. ALL SUBSTITUTIONS REQUIRE ENGINEER APPROVAL AND AHJ RE-SUBMISSION.</span>
                  </div>
                </div>
              </>
            ) : null}

          </div>{/* end right */}

        </div>{/* end body */}

        {/* ── SITE / VICINITY MAP ───────────────────────────────────────── */}
        <div className="E-map">
          <div className="E-map-hdr">
            <span className="E-map-n">▌ 2</span>
            <span className="E-map-lbl">SITE & VICINITY MAP — AERIAL VIEW</span>
            <span className="E-map-nts">SCALE: NTS · NOT TO SCALE</span>
            <span className="E-map-rose"><CompassRose size={32} /></span>
          </div>
          <div className="E-map-body">
            {aerialSrc ? (
              <div className="E-map-imgwrap">
                <img src={aerialSrc} alt="Aerial site view" className="E-map-img" />
                <div className="E-map-pin">
                  <SitePin />
                  <div className="E-map-pinlbl">▲ PROJECT SITE</div>
                </div>
                <div className="E-map-addrbar">{fullAddress}</div>
              </div>
            ) : (
              <div className="E-map-noimg">
                SATELLITE / AERIAL IMAGE UNAVAILABLE — {fullAddress}<br />
                CONTRACTOR TO PROVIDE SITE PHOTOGRAPHS FOR AHJ SUBMITTAL
              </div>
            )}
          </div>
        </div>

        {/* ── DOCUMENT FOOTER ──────────────────────────────────────────── */}
        <div className="E-footer">
          <span className="E-footer-co">{engineerCompany}</span>
          <span className="E-footer-sep"> · </span>
          <span className="E-footer-adr">{engineerAddress}</span>
          <span className="E-footer-stamp">ISSUED FOR PERMIT · REV {revision}</span>
          <span className="E-footer-pv">PV-0</span>
        </div>

      </div>{/* end sheet */}

      {/* ── STYLES ────────────────────────────────────────────────────────── */}
      <style>{`
        /* ROOT */
        .E-root {
          font-family: Arial, Helvetica, sans-serif;
          font-size: 8px;
          color: #000;
          background: #fff;
          width: 100%;
          box-sizing: border-box;
          line-height: 1.3;
        }

        /* OUTER SHEET BORDER — THICK */
        .E-sheet {
          border: 3px solid #000;
          width: 100%;
          box-sizing: border-box;
        }

        /* TITLE BANNER */
        .E-banner {
          background: #000;
          color: #fff;
          text-align: center;
          padding: 6px 8px 5px;
          border-bottom: 2px solid #000;
        }
        .E-banner-t1 {
          font-size: 16px;
          font-weight: 900;
          letter-spacing: 5px;
          text-transform: uppercase;
          line-height: 1;
        }
        .E-banner-t2 {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 2px;
          color: #ddd;
          margin-top: 3px;
          text-transform: uppercase;
        }

        /* PROJECT ID BAR */
        .E-idbar {
          background: #e4e4e4;
          border-bottom: 1.5px solid #000;
          padding: 2px 5px;
          display: table;
          width: 100%;
          box-sizing: border-box;
        }
        .E-idbar-proj {
          display: table-cell;
          font-size: 8.5px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: #000;
          vertical-align: middle;
          width: 30%;
        }
        .E-idbar-addr {
          display: table-cell;
          font-size: 7.5px;
          color: #222;
          vertical-align: middle;
          font-weight: 600;
          width: 36%;
        }
        .E-idbar-note {
          display: table-cell;
          font-size: 6px;
          color: #555;
          vertical-align: middle;
          text-align: right;
          font-weight: 700;
          letter-spacing: 0.3px;
          font-style: italic;
          width: 34%;
        }

        /* SYSTEM SPECIFICATION BLOCK */
        .E-specblock {
          border-bottom: 1.5px solid #000;
          background: #f8f8f8;
        }
        .E-blk-hdr {
          background: #1a1a1a;
          color: #fff;
          font-size: 7px;
          font-weight: 900;
          letter-spacing: 2px;
          text-transform: uppercase;
          padding: 2px 5px;
          border-bottom: 1px solid #000;
        }
        .E-specgrid {
          padding: 2px 5px 3px;
        }
        .E-specrow {
          display: table;
          width: 100%;
          border-bottom: 1px solid #ddd;
          padding: 1px 0;
        }
        .E-specrow:last-child { border-bottom: none; }
        .E-sk {
          display: table-cell;
          font-size: 7px;
          font-weight: 900;
          color: #000;
          width: 110px;
          white-space: nowrap;
          vertical-align: middle;
          border-right: 1px solid #ccc;
          padding-right: 4px;
        }
        .E-sv {
          display: table-cell;
          font-size: 8px;
          color: #000;
          font-weight: 600;
          padding: 0 12px 0 5px;
          vertical-align: middle;
        }
        .E-sv-bold { font-weight: 900; }

        /* BODY COLUMNS */
        .E-body {
          width: 100%;
          font-size: 0;
          border-bottom: 1.5px solid #000;
        }
        .E-col-l {
          display: inline-block;
          vertical-align: top;
          width: 44%;
          font-size: 8px;
          padding: 4px 4px 4px 5px;
          box-sizing: border-box;
          border-right: 1.5px solid #000;
        }
        .E-col-r {
          display: inline-block;
          vertical-align: top;
          width: 56%;
          font-size: 8px;
          padding: 4px 5px 4px 4px;
          box-sizing: border-box;
        }

        /* SECTION HEADERS — MECHANICAL */
        .E-sec {
          background: #000;
          color: #fff;
          font-size: 6px;
          font-weight: 900;
          letter-spacing: 2px;
          text-transform: uppercase;
          padding: 1.5px 4px;
          margin-bottom: 1px;
          display: block;
        }

        /* EQUIPMENT SCHEDULE — (N)/(E) */
        .E-eq {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1px;
          font-size: 7px;
        }
        .E-eq td {
          padding: 0.5px 2px;
          vertical-align: top;
          border-bottom: 1px solid #ddd;
          line-height: 1.3;
          color: #000;
        }
        .E-eq tr:last-child td { border-bottom: 1px solid #999; }
        .E-tag {
          width: 22px;
          font-weight: 900;
          font-family: 'Courier New', Courier, monospace;
          font-size: 7px;
          color: #000;
          white-space: nowrap;
        }
        .E-qty {
          width: 20px;
          font-weight: 700;
          text-align: right;
          padding-right: 3px;
          white-space: nowrap;
          font-size: 7px;
        }
        .E-desc {
          font-size: 7px;
          color: #000;
          font-weight: 600;
        }

        /* KEY-VALUE TABLE */
        .E-kv {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1px;
          font-size: 7px;
          border: 1px solid #999;
        }
        .E-kv td {
          padding: 0.5px 3px;
          vertical-align: top;
          border-bottom: 1px solid #ddd;
          line-height: 1.3;
        }
        .E-kv tr:last-child td { border-bottom: none; }
        .E-k {
          width: 120px;
          font-weight: 700;
          color: #222;
          white-space: nowrap;
          font-size: 6.5px;
          border-right: 1px solid #ccc;
          background: #f4f4f4;
          padding-right: 4px;
        }
        .E-v {
          color: #000;
          font-weight: 600;
          font-size: 7px;
          padding-left: 4px;
        }
        .E-pass { font-weight: 900; color: #000; font-size: 7px; padding-left: 4px; }
        .E-fail { font-weight: 900; color: #800; font-size: 7px; padding-left: 4px; }

        /* CODES LIST */
        .E-codes {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1px;
          font-size: 7px;
          border: 1px solid #999;
        }
        .E-codes td {
          padding: 0.5px 3px;
          border-bottom: 1px solid #ddd;
          font-weight: 600;
          color: #000;
          line-height: 1.3;
        }
        .E-codes tr:last-child td { border-bottom: none; }

        /* SHEET INDEX */
        .E-idx {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 1px;
          font-size: 6.5px;
          border: 1px solid #000;
        }
        .E-idx-h {
          background: #1a1a1a;
          color: #fff;
          font-size: 6px;
          font-weight: 700;
          padding: 1px 3px;
          text-align: left;
          letter-spacing: 0.5px;
          border: 1px solid #000;
        }
        .E-idx-c1 { width: 32px; }
        .E-idx-c2 { width: 24%; }
        .E-idx td {
          padding: 0.5px 3px;
          border: 1px solid #bbb;
          vertical-align: top;
          line-height: 1.3;
        }
        .E-idx-id {
          font-weight: 900;
          font-family: 'Courier New', Courier, monospace;
          font-size: 7px;
          color: #000;
          white-space: nowrap;
        }
        .E-idx-ti { font-weight: 600; color: #000; font-size: 6.5px; }
        .E-idx-de { color: #333; font-size: 6px; }
        .E-idx-cur td { background: #fffff0; font-weight: 700; }

        /* AUTHORITY LINE */
        .E-authority-line {
          font-size: 6px;
          font-weight: 700;
          color: #333;
          font-style: italic;
          border-top: 1px solid #ccc;
          margin-top: 3px;
          padding-top: 2px;
          letter-spacing: 0.2px;
          text-transform: uppercase;
        }

        /* CONSTRUCTION NOTES */
        .E-notes {
          border: 1px solid #000;
          background: #fff;
          font-size: 7px;
        }
        .E-note {
          display: table;
          width: 100%;
          border-bottom: 1px solid #ddd;
        }
        .E-note:last-child { border-bottom: none; }
        .E-note-n {
          display: table-cell;
          width: 13px;
          font-weight: 900;
          font-family: 'Courier New', Courier, monospace;
          font-size: 6.5px;
          vertical-align: top;
          padding: 1px 2px 1px 3px;
          white-space: nowrap;
          color: #000;
          border-right: 1px solid #ddd;
          background: #f4f4f4;
        }
        .E-note-t {
          display: table-cell;
          vertical-align: top;
          font-size: 6.5px;
          line-height: 1.35;
          color: #000;
          text-align: justify;
          padding: 1px 3px;
        }
        .E-note-authority .E-note-n { background: #1a1a1a; color: #fff; }
        .E-note-authority .E-note-t { font-weight: 700; background: #fafafa; font-style: italic; }

        /* SITE / VICINITY MAP */
        .E-map {
          border-top: 2px solid #000;
        }
        .E-map-hdr {
          background: #e4e4e4;
          border-bottom: 1.5px solid #000;
          padding: 2px 5px;
          display: table;
          width: 100%;
          box-sizing: border-box;
        }
        .E-map-n {
          display: table-cell;
          width: 20px;
          font-size: 9px;
          font-weight: 900;
          color: #000;
          vertical-align: middle;
        }
        .E-map-lbl {
          display: table-cell;
          font-size: 8px;
          font-weight: 900;
          letter-spacing: 1.5px;
          color: #000;
          text-transform: uppercase;
          vertical-align: middle;
        }
        .E-map-nts {
          display: table-cell;
          font-size: 6.5px;
          color: #444;
          vertical-align: middle;
          padding-left: 8px;
          font-weight: 700;
          font-style: italic;
        }
        .E-map-rose {
          display: table-cell;
          width: 42px;
          text-align: right;
          vertical-align: middle;
        }
        .E-map-body {
          width: 100%;
          background: #ccc;
          overflow: hidden;
        }
        .E-map-imgwrap {
          position: relative;
          width: 100%;
          height: 220px;
          overflow: hidden;
        }
        .E-map-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .E-map-pin {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          text-align: center;
        }
        .E-map-pinlbl {
          background: rgba(0,0,0,0.85);
          color: #fff;
          font-size: 6px;
          font-weight: 900;
          padding: 1px 5px;
          letter-spacing: 1px;
          white-space: nowrap;
          margin-top: 1px;
          border: 1px solid #fff;
          text-transform: uppercase;
        }
        .E-map-addrbar {
          position: absolute;
          top: 4px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(255,255,255,0.94);
          color: #000;
          font-size: 6.5px;
          font-weight: 900;
          padding: 1px 7px;
          letter-spacing: 0.5px;
          white-space: nowrap;
          border: 1px solid #000;
        }
        .E-map-noimg {
          width: 100%;
          height: 100px;
          display: table;
          text-align: center;
          background: #ccc;
        }
        .E-map-noimg span {
          display: table-cell;
          vertical-align: middle;
          font-size: 7.5px;
          color: #444;
          font-style: italic;
          letter-spacing: 0.5px;
          text-align: center;
        }

        /* DOCUMENT FOOTER */
        .E-footer {
          background: #000;
          color: #aaa;
          padding: 2px 6px;
          font-size: 6.5px;
          position: relative;
        }
        .E-footer-co    { font-weight: 700; color: #fff; }
        .E-footer-sep   { color: #555; }
        .E-footer-adr   { color: #888; }
        .E-footer-stamp {
          position: absolute;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          font-size: 6px;
          font-weight: 700;
          color: #aaa;
          letter-spacing: 1px;
          text-transform: uppercase;
        }
        .E-footer-pv {
          position: absolute;
          right: 7px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 12px;
          font-weight: 900;
          color: #fff;
          letter-spacing: 2px;
          font-family: 'Courier New', Courier, monospace;
        }
      `}</style>
    </div>
  );
}

// ── Exported wrapper ─────────────────────────────────────────────────────────
export default function CoverSheet({ data, standalone = false }: CoverSheetProps) {
  if (standalone) {
    return <CoverSheetInner data={data} />;
  }

  const sheetMeta = {
    sheetNumber:     'PV-0',
    sheetTitle:      'COVER SHEET',
    projectName:     data.projectName || data.clientName,
    clientName:      data.clientName,
    address:         [data.address, data.city, data.state].filter(Boolean).join(', '),
    preparedDate:    data.preparedDate,
    revision:        data.revision,
    designer:        data.designer,
    engineerCompany: data.engineerCompany,
    engineerAddress: data.engineerAddress,
    totalSheets:     data.sheets?.length ?? 11,
  };

  return (
    <PermitSheetLayout meta={sheetMeta}>
      <CoverSheetInner data={data} />
    </PermitSheetLayout>
  );
}