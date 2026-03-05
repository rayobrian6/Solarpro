// ============================================================
// PROPOSAL PDF GENERATOR
// Uses jsPDF + html2canvas for high-quality PDF output
// ============================================================
import type { Proposal } from '@/types';

export async function generateProposalPDF(proposal: Proposal): Promise<void> {
  try {
    const { default: jsPDF } = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');

    const element = document.getElementById('proposal-document');
    if (!element) {
      console.error('Proposal document element not found');
      return;
    }

    // Show loading state
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;color:white;font-size:16px;font-family:Inter,sans-serif;';
    loadingDiv.innerHTML = '<div style="text-align:center"><div style="font-size:24px;margin-bottom:8px">⚡</div><div>Generating PDF...</div></div>';
    document.body.appendChild(loadingDiv);

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: element.scrollWidth,
        height: element.scrollHeight,
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      // First page
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      // Additional pages if needed
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      // Save the PDF
      const clientName = proposal.project?.client?.name?.replace(/[^a-z0-9]/gi, '_') || 'Client';
      const date = new Date().toISOString().split('T')[0];
      pdf.save(`SolarProposal_${clientName}_${date}.pdf`);

    } finally {
      document.body.removeChild(loadingDiv);
    }
  } catch (error) {
    console.error('PDF generation error:', error);
    alert('PDF generation failed. Please try printing the page instead.');
  }
}

// ── Text-based PDF (fallback) ─────────────────────────────────
export async function generateTextPDF(proposal: Proposal): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate;
  const layout = proj?.layout;

  let y = 20;
  const lineH = 7;
  const margin = 20;
  const pageW = 210;

  // Helper functions
  const addText = (text: string, x: number, size = 10, bold = false, color = [30, 30, 30]) => {
    pdf.setFontSize(size);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setTextColor(color[0], color[1], color[2]);
    pdf.text(text, x, y);
  };

  const addLine = () => {
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margin, y, pageW - margin, y);
    y += 4;
  };

  const newPage = () => {
    pdf.addPage();
    y = 20;
  };

  // Header
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, 210, 50, 'F');
  pdf.setFontSize(24);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text('SOLAR ENERGY PROPOSAL', margin, 25);
  pdf.setFontSize(12);
  pdf.setTextColor(251, 191, 36);
  pdf.text('SolarPro Design Platform', margin, 35);
  pdf.setFontSize(10);
  pdf.setTextColor(148, 163, 184);
  pdf.text(`Prepared: ${new Date(proposal.preparedDate).toLocaleDateString()}`, margin, 43);

  y = 65;

  // Client Info
  addText('CLIENT INFORMATION', margin, 14, true, [15, 23, 42]);
  y += lineH;
  addLine();
  addText(`Name: ${client?.name || '—'}`, margin, 10);
  y += lineH;
  addText(`Address: ${client?.address}, ${client?.city}, ${client?.state} ${client?.zip}`, margin, 10);
  y += lineH;
  addText(`Email: ${client?.email || '—'}`, margin, 10);
  y += lineH;
  addText(`Utility Provider: ${client?.utilityProvider || '—'}`, margin, 10);
  y += lineH * 2;

  // System Overview
  addText('SYSTEM OVERVIEW', margin, 14, true, [15, 23, 42]);
  y += lineH;
  addLine();
  const sysType = { roof: 'Roof Mount', ground: 'Ground Mount', fence: 'Sol Fence' }[proj?.systemType || 'roof'];
  addText(`System Type: ${sysType}`, margin, 10);
  y += lineH;
  if (layout) {
    addText(`System Size: ${layout.systemSizeKw.toFixed(1)} kW`, margin, 10);
    y += lineH;
    addText(`Panel Count: ${layout.totalPanels} panels`, margin, 10);
    y += lineH;
  }
  if (production) {
    addText(`Annual Production: ${production.annualProductionKwh.toLocaleString()} kWh`, margin, 10);
    y += lineH;
    addText(`Energy Offset: ${production.offsetPercentage}%`, margin, 10);
    y += lineH;
    addText(`CO2 Offset: ${production.co2OffsetTons} tons/year`, margin, 10);
    y += lineH;
  }
  y += lineH;

  // Financial
  if (cost) {
    addText('FINANCIAL ANALYSIS', margin, 14, true, [15, 23, 42]);
    y += lineH;
    addLine();
    addText(`Gross System Cost: $${cost.grossCost.toLocaleString()}`, margin, 10);
    y += lineH;
    if (cost.taxCredit > 0) addText(`Estimated Incentives/ITC: -$${cost.taxCredit.toLocaleString()}`, margin, 10, false, [16, 185, 129]);
    y += lineH;
    addText(`Net System Cost: $${cost.netCost.toLocaleString()}`, margin, 12, true, [245, 158, 11]);
    y += lineH * 1.5;
    addText(`Annual Savings: $${cost.annualSavings.toLocaleString()}/year`, margin, 10, false, [16, 185, 129]);
    y += lineH;
    addText(`Payback Period: ${cost.paybackYears} years`, margin, 10);
    y += lineH;
    addText(`25-Year Savings: $${cost.lifetimeSavings.toLocaleString()}`, margin, 10, false, [16, 185, 129]);
    y += lineH;
    addText(`Total ROI: ${cost.roi}%`, margin, 10, false, [16, 185, 129]);
    y += lineH * 2;
  }

  // Footer
  if (y > 240) newPage();
  y = 270;
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 265, 210, 30, 'F');
  pdf.setFontSize(8);
  pdf.setTextColor(148, 163, 184);
  pdf.text(`Valid until: ${new Date(proposal.validUntil).toLocaleDateString()}`, margin, 275);
  pdf.text('Production estimates based on NREL PVWatts data. Actual results may vary.', margin, 282);

  const clientName = client?.name?.replace(/[^a-z0-9]/gi, '_') || 'Client';
  const date = new Date().toISOString().split('T')[0];
  pdf.save(`SolarProposal_${clientName}_${date}.pdf`);
}