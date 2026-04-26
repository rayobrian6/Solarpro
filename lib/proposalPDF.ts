// ============================================================
// PROPOSAL PDF GENERATOR — EXACT PAGE FIT COMPOSITOR
// v47.340: Hard page containers, fixed height, no overflow, no splits.
//
// Architecture:
//   1. Discover all .proposal-sec blocks
//   2. Organize into PAGE GROUPS (related sections together)
//   3. Pack groups into pages (each group tries to fit on ONE page)
//   4. If group exceeds page → split at safe boundaries only
//   5. Empty page fix: pull next group up if <70% fill
//   6. Max 12 pages — compress if over
//   7. Stage each page offscreen → html2canvas → jsPDF
//
// Target: 10–12 pages, tight narrative flow, no broken sections
// ============================================================
import type { Proposal } from '@/types';
import { getSystemTypeLabel } from '@/lib/systemEquipmentResolver';

// ── Models ──────────────────────────────────────────────────
interface Block {
  id: string;
  element: HTMLElement;
  height: number;
  keepTogether: boolean; // HIGH priority — never split
}

interface PageGroup {
  name: string;
  blockIds: string[];     // ordered block IDs in this group
  blocks: Block[];        // resolved blocks
  totalHeight: number;
  keepTogether: boolean;  // entire group should stay on one page if possible
}

interface ComposedPage {
  blocks: Block[];
  totalHeight: number;
}

// ── Constants ───────────────────────────────────────────────
const PAGE_W_PX = 816;                       // 8.5in at 96dpi
const PAGE_H_PX = 1056;                      // 11in at 96dpi
const PAD_PX    = 38;                         // 0.4in margins
const USABLE_H  = PAGE_H_PX - PAD_PX * 2;   // ~980px usable
const PULL_UP_THRESHOLD = 0.90;              // pull next content if <90% fill
const MAX_PAGES = 14;                         // allow up to 14 pages for proper splitting
const PAGE_FILL_TARGET = 0.95;               // target 95% page fill before splitting

const LETTER_W_MM = 215.9;
const LETTER_H_MM = 279.4;

// ── Group Definitions ───────────────────────────────────────
// Each group is a set of related block IDs that should stay together.
// The compositor tries to fit each group on ONE page.
const GROUP_DEFS: { name: string; blockIds: string[]; keepTogether: boolean }[] = [
  // PAGE 1: Hero + Value Proposition
  { name: 'Hero & Value', blockIds: ['hero', 'what-this-means', 'long-term-outcome'], keepTogether: false },

  // PAGE 2: Savings Punch (standalone impact page)
  { name: 'Savings Punch', blockIds: ['savings-punch'], keepTogether: true },

  // PAGE 3: System Summary
  { name: 'System Summary', blockIds: ['system-summary'], keepTogether: false },

  // PAGE 4: Utility Profile
  { name: 'Utility Profile', blockIds: ['utility-profile'], keepTogether: false },

  // PAGE 5: Cost vs Value (charts — no split)
  { name: 'Cost vs Value', blockIds: ['cost-vs-value'], keepTogether: true },

  // PAGE 6: What Changes Today
  { name: 'What Changes', blockIds: ['what-changes-today'], keepTogether: false },

  // PAGE 7: Financial Timeline (chart — no split)
  { name: 'Financial Timeline', blockIds: ['financial-timeline'], keepTogether: true },

  // PAGE 8: Incentives
  { name: 'Incentives', blockIds: ['incentives-srec'], keepTogether: false },

  // PAGE 9: Equipment + Trust
  { name: 'Equipment & Trust', blockIds: ['equipment', 'trust-performance'], keepTogether: false },

  // PAGE 10: Why This System + Layout
  { name: 'Design & Layout', blockIds: ['why-this-system', 'layout-preview'], keepTogether: false },

  // PAGE 11: Sol Fence
  { name: 'Sol Fence', blockIds: ['sol-fence'], keepTogether: true },

  // PAGE 12: Financial Summary (keep together for impact)
  { name: 'Financial Summary', blockIds: ['financial-summary'], keepTogether: true },

  // PAGE 13: Social Proof
  { name: 'Social Proof', blockIds: ['next-steps', 'why-customers-choose'], keepTogether: false },

  // PAGE 14: Decision + CTA (keep together — closing)
  { name: 'Closing', blockIds: ['decision-summary', 'cta'], keepTogether: true },
];

// ── Main Export ──────────────────────────────────────────────
export async function generateProposalPDF(proposal: Proposal): Promise<void> {
  try {
    const { default: jsPDF } = await import('jspdf');
    const { default: html2canvas } = await import('html2canvas');

    const docEl = document.getElementById('proposal-document');
    if (!docEl) {
      console.error('[PDF] proposal-document not found');
      return;
    }

    // Loading overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:9999;color:white;font-size:16px;font-family:Inter,sans-serif;';
    overlay.innerHTML = '<div style="text-align:center"><div style="font-size:28px;margin-bottom:8px">⚡</div><div>Building proposal...</div><div style="font-size:12px;color:#94a3b8;margin-top:4px" id="pdf-progress">Measuring content...</div></div>';
    document.body.appendChild(overlay);
    const progressEl = document.getElementById('pdf-progress');
    const setProgress = (msg: string) => { if (progressEl) progressEl.textContent = msg; };

    try {
      // ── PHASE 1: Discover & Measure Blocks ──────────────
      const sectionEls = docEl.querySelectorAll('.proposal-sec');
      if (sectionEls.length === 0) {
        console.warn('[PDF] No .proposal-sec found');
        document.body.removeChild(overlay);
        return;
      }

      const blockMap = new Map<string, Block>();
      const allBlocks: Block[] = [];

      for (let i = 0; i < sectionEls.length; i++) {
        const el = sectionEls[i] as HTMLElement;
        if (el.offsetHeight === 0) continue;

        const id = el.getAttribute('data-block-id') || `sec-${i}`;
        const keepTogether = el.getAttribute('data-keep-together') === 'true'
          || el.querySelector('svg, canvas, .recharts-wrapper') !== null;

        const block: Block = { id, element: el, height: el.offsetHeight, keepTogether };
        blockMap.set(id, block);
        allBlocks.push(block);
      }

      console.log(`[PDF] ${allBlocks.length} blocks measured`);
      setProgress(`${allBlocks.length} sections found...`);

      // ── PHASE 1.5: Re-measure Blocks with Density CSS ──
      // Block heights measured from live DOM don't account for density compression.
      // Create a hidden staging area, apply density CSS, clone blocks, and re-measure.
      const measureStage = document.createElement('div');
      measureStage.style.cssText = `position:fixed;left:-9999px;top:0;width:${docEl.offsetWidth}px;background:white;z-index:-1;`;
      document.body.appendChild(measureStage);

      const measureStyle = document.createElement('style');
      measureStyle.textContent = `
        .proposal-sec { margin-bottom: 3px !important; }
        .proposal-sec-hero { margin-bottom: 0 !important; }
        .card { padding: 8px !important; }
        h2 { font-size: 0.88rem !important; margin-bottom: 4px !important; }
        h3 { font-size: 0.76rem !important; margin-bottom: 3px !important; }
        .text-5xl { font-size: 1.6rem !important; }
        .text-4xl, .text-3xl { font-size: 1.3rem !important; }
        .text-2xl { font-size: 1.05rem !important; }
        .text-xl { font-size: 0.92rem !important; }
        .text-lg { font-size: 0.82rem !important; }
        .text-base { font-size: 0.78rem !important; }
        .gap-6 { gap: 6px !important; }
        .gap-5, .gap-4, .gap-3 { gap: 5px !important; }
        .gap-2 { gap: 3px !important; }
        .p-6, .p-5 { padding: 8px !important; }
        .p-4 { padding: 7px !important; }
        .p-3 { padding: 5px !important; }
        .space-y-4 > * + * { margin-top: 6px !important; }
        .space-y-3 > * + * { margin-top: 5px !important; }
        .space-y-2 > * + * { margin-top: 3px !important; }
        .mb-6, .mb-5, .mb-4 { margin-bottom: 5px !important; }
        .mb-3 { margin-bottom: 3px !important; }
        .py-20 { padding-top: 14px !important; padding-bottom: 14px !important; }
        .py-10, .py-8 { padding-top: 10px !important; padding-bottom: 10px !important; }
        .py-6, .py-5 { padding-top: 8px !important; padding-bottom: 8px !important; }
        .py-3, .py-2 { padding-top: 5px !important; padding-bottom: 5px !important; }
        .px-8 { padding-left: 12px !important; padding-right: 12px !important; }
        .px-6, .px-5 { padding-left: 10px !important; padding-right: 10px !important; }
        .recharts-wrapper { max-height: 200px !important; overflow: hidden !important; }
        svg.recharts-surface { max-height: 200px !important; }
      `;
      measureStage.appendChild(measureStyle);

      // Clone each block into measure stage and capture compressed height
      for (const block of allBlocks) {
        const clone = block.element.cloneNode(true) as HTMLElement;
        clone.style.overflow = 'hidden';
        measureStage.appendChild(clone);
        // Wait for layout
        await new Promise(r => setTimeout(r, 0));
        const compressedH = clone.offsetHeight;
        console.log(`[PDF] Block ${block.id}: ${block.height}px → ${compressedH}px (density)`);
        block.height = compressedH;  // Update with compressed height
        measureStage.removeChild(clone);
      }

      document.body.removeChild(measureStage);
      setProgress('Blocks re-measured with density compression...');

      // ── PHASE 2: Resolve Groups ─────────────────────────
      const groups: PageGroup[] = [];
      const usedIds = new Set<string>();

      for (const def of GROUP_DEFS) {
        const blocks: Block[] = [];
        let totalH = 0;
        for (const bid of def.blockIds) {
          const b = blockMap.get(bid);
          if (b) {
            blocks.push(b);
            totalH += b.height;
            usedIds.add(bid);
          }
        }
        if (blocks.length > 0) {
          groups.push({
            name: def.name,
            blockIds: def.blockIds,
            blocks,
            totalHeight: totalH,
            keepTogether: def.keepTogether,
          });
        }
      }

      // Add any ungrouped blocks as individual groups
      for (const b of allBlocks) {
        if (!usedIds.has(b.id)) {
          groups.push({
            name: b.id,
            blockIds: [b.id],
            blocks: [b],
            totalHeight: b.height,
            keepTogether: b.keepTogether,
          });
        }
      }

      console.log(`[PDF] ${groups.length} groups resolved`);

      // ── PHASE 3: Pack Groups into Pages ─────────────────
      let pages = packGroupsIntoPages(groups);
      setProgress(`${pages.length} pages composed...`);

      // ── PHASE 4: Overflow Detection & Auto-Split ──────
      // Check each page: if totalHeight > USABLE_H, split at block boundaries
      const validated: ComposedPage[] = [];
      for (const page of pages) {
        if (page.totalHeight <= USABLE_H) {
          validated.push(page);
        } else {
          // Page overflows — split into sub-pages
          console.log(`[PDF] Page overflows (${page.totalHeight}px > ${USABLE_H}px), splitting...`);
          let subPage: ComposedPage = { blocks: [], totalHeight: 0 };
          for (const block of page.blocks) {
            if (subPage.totalHeight + block.height <= USABLE_H) {
              subPage.blocks.push(block);
              subPage.totalHeight += block.height;
            } else {
              if (subPage.blocks.length > 0) {
                validated.push(subPage);
              }
              subPage = { blocks: [block], totalHeight: block.height };
            }
          }
          if (subPage.blocks.length > 0) {
            validated.push(subPage);
          }
        }
      }
      pages = validated;

      // Compression if over MAX_PAGES (merge small adjacent pages)
      if (pages.length > MAX_PAGES) {
        console.log(`[PDF] ${pages.length} pages exceeds max ${MAX_PAGES}, compressing...`);
        pages = compressPages(pages);
        setProgress(`Compressed to ${pages.length} pages...`);
      }

      // Log final composition
      for (let i = 0; i < pages.length; i++) {
        const ids = pages[i].blocks.map(b => b.id).join(', ');
        const fill = Math.round((pages[i].totalHeight / USABLE_H) * 100);
        console.log(`[PDF] Page ${i + 1}: [${ids}] (${fill}% fill)`);
      }

      // ── PHASE 5: Render Each Page (Exact Page Fit) ─────
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
      const docWidth = docEl.offsetWidth;

      for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        if (pageIdx > 0) pdf.addPage();
        setProgress(`Rendering page ${pageIdx + 1} of ${pages.length}...`);

        const page = pages[pageIdx];

        // Create offscreen staging container with EXACT page dimensions
        const stage = document.createElement('div');
        stage.className = 'pdf-page';
        stage.style.cssText = `position:fixed;left:-9999px;top:0;width:${PAGE_W_PX}px;height:${PAGE_H_PX}px;padding:${PAD_PX}px;box-sizing:border-box;background:white;overflow:hidden;z-index:-1;display:flex;flex-direction:column;justify-content:flex-start;`;
        document.body.appendChild(stage);

        const content = document.createElement('div');
        content.className = 'page-content';
        content.style.cssText = `display:flex;flex-direction:column;gap:0;background:white;max-height:${USABLE_H}px;overflow:hidden;`;
        stage.appendChild(content);

        // v47.340: Inject density + exact-fit styles into staging container
        const densityStyle = document.createElement('style');
        densityStyle.textContent = `
          /* ── Page Container ── */
          .pdf-page {
            width: ${PAGE_W_PX}px;
            height: ${PAGE_H_PX}px;
            padding: ${PAD_PX}px;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: flex-start;
            overflow: hidden;
            page-break-after: always;
            break-after: page;
          }
          .page-content {
            display: flex;
            flex-direction: column;
            gap: 0;
            max-height: ${USABLE_H}px;
            overflow: hidden;
          }

          /* ── No-Split Protection ── */
          .no-split,
          [data-keep-together="true"],
          .recharts-wrapper,
          canvas {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          /* ── Section Density ── */
          .proposal-sec { margin-bottom: 3px !important; }
          .proposal-sec-hero { margin-bottom: 0 !important; }
          .proposal-sec-hero .relative.z-10 { padding: 8px 12px !important; }

          /* ── Card & Block Density ── */
          .card { padding: 8px !important; }
          .section { margin-bottom: 12px !important; }

          /* ── Typography Density ── */
          h1, h2 { margin-bottom: 6px !important; }
          h2 { font-size: 0.88rem !important; margin-bottom: 4px !important; }
          h3 { font-size: 0.76rem !important; margin-bottom: 3px !important; }
          .text-5xl { font-size: 1.6rem !important; }
          .text-4xl, .text-3xl { font-size: 1.3rem !important; }
          .text-2xl { font-size: 1.05rem !important; }
          .text-xl { font-size: 0.92rem !important; }
          .text-lg { font-size: 0.82rem !important; }
          .text-base { font-size: 0.78rem !important; }
          .text-sm { font-size: 0.72rem !important; }
          .text-xs { font-size: 0.65rem !important; }

          /* ── Spacing Density ── */
          .gap-6 { gap: 6px !important; }
          .gap-5, .gap-4, .gap-3 { gap: 5px !important; }
          .gap-2 { gap: 3px !important; }
          .p-6, .p-5 { padding: 8px !important; }
          .p-4 { padding: 7px !important; }
          .p-3 { padding: 5px !important; }
          .space-y-4 > * + * { margin-top: 6px !important; }
          .space-y-3 > * + * { margin-top: 5px !important; }
          .space-y-2 > * + * { margin-top: 3px !important; }
          .mb-6, .mb-5, .mb-4 { margin-bottom: 5px !important; }
          .mb-3 { margin-bottom: 3px !important; }
          .mb-2 { margin-bottom: 2px !important; }
          .mt-8, .mt-6 { margin-top: 6px !important; }
          .mt-4 { margin-top: 5px !important; }
          .mt-3, .mt-2 { margin-top: 3px !important; }
          .py-20 { padding-top: 14px !important; padding-bottom: 14px !important; }
          .py-10, .py-8 { padding-top: 10px !important; padding-bottom: 10px !important; }
          .py-6, .py-5 { padding-top: 8px !important; padding-bottom: 8px !important; }
          .py-3, .py-2 { padding-top: 5px !important; padding-bottom: 5px !important; }
          .px-8 { padding-left: 12px !important; padding-right: 12px !important; }
          .px-6, .px-5 { padding-left: 10px !important; padding-right: 10px !important; }

          /* ── Chart Constraints ── */
          .recharts-wrapper { max-height: 200px !important; overflow: hidden !important; }
          svg.recharts-surface { max-height: 200px !important; }

          /* ── Border Radius ── */
          .rounded-2xl { border-radius: 0.5rem !important; }
          .rounded-xl { border-radius: 0.375rem !important; }
          .rounded-lg { border-radius: 0.25rem !important; }
        `;
        stage.appendChild(densityStyle);

        // Clone blocks into staging page with no-split protection
        for (const block of page.blocks) {
          const clone = block.element.cloneNode(true) as HTMLElement;

          // Force white background except hero, savings-punch, and CTA (intentionally dark)
          const isDark = block.id === 'hero' || block.id === 'cta' || block.id === 'savings-punch';
          if (!isDark) {
            clone.style.background = 'white';
          }
          clone.style.overflow = 'hidden';
          clone.style.maxHeight = `${USABLE_H}px`;

          // Add no-split class to charts and critical blocks
          if (block.keepTogether) {
            clone.classList.add('no-split');
          }

          content.appendChild(clone);
        }

        // Render staged page at EXACT page dimensions
        const canvas = await html2canvas(stage, {
          scale: 2,
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: PAGE_W_PX,
          height: PAGE_H_PX,      // Fixed page height — no overflow
        });

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        // Map pixel dimensions directly to Letter mm
        pdf.addImage(imgData, 'JPEG', 0, 0, LETTER_W_MM, LETTER_H_MM);

        document.body.removeChild(stage);
      }

      // ── Save ────────────────────────────────────────────
      const clientName = proposal.project?.client?.name?.replace(/[^a-z0-9]/gi, '_') || 'Client';
      const date = new Date().toISOString().split('T')[0];
      pdf.save(`SolarProposal_${clientName}_${date}.pdf`);
      console.log(`[PDF] Complete: ${pages.length} pages`);

    } finally {
      document.body.removeChild(overlay);
    }
  } catch (error) {
    console.error('[PDF] Error:', error);
    alert('PDF generation failed. Please try printing the page instead.');
  }
}

// ── Group Packer ──────────────────────────────────────────────
// Each group tries to fit on ONE page. If it doesn't fit,
// split at block boundaries (not mid-block).
// After packing, pull next content up if current page <70% full.
function packGroupsIntoPages(groups: PageGroup[]): ComposedPage[] {
  const pages: ComposedPage[] = [];
  let current: ComposedPage = { blocks: [], totalHeight: 0 };

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    const remaining = USABLE_H - current.totalHeight;

    // Case 1: Entire group fits on current page
    if (group.totalHeight <= remaining) {
      current.blocks.push(...group.blocks);
      current.totalHeight += group.totalHeight;
      continue;
    }

    // Case 2: Group is keepTogether — must start fresh page
    if (group.keepTogether) {
      if (current.blocks.length > 0) {
        pages.push(current);
      }
      current = { blocks: [...group.blocks], totalHeight: group.totalHeight };

      // If group exceeds full page, it still gets its own page (will scale)
      if (group.totalHeight > USABLE_H) {
        pages.push(current);
        current = { blocks: [], totalHeight: 0 };
      }
      continue;
    }

    // Case 3: Group doesn't fit — split at block boundaries
    // First, fill remaining space on current page with blocks that fit
    for (const block of group.blocks) {
      const rem = USABLE_H - current.totalHeight;

      if (block.height <= rem) {
        current.blocks.push(block);
        current.totalHeight += block.height;
      } else {
        // Block doesn't fit — start new page
        if (current.blocks.length > 0) {
          pages.push(current);
        }
        current = { blocks: [block], totalHeight: block.height };
      }
    }
  }

  // Push final page
  if (current.blocks.length > 0) {
    pages.push(current);
  }

  // ── STEP 5: Pull-up rule ─────────────────────────────────
  // If a page is less than 70% full, pull blocks from the next page
  const optimized: ComposedPage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];

    // Try to pull from next page if underfilled
    while (i + 1 < pages.length) {
      const fillRatio = page.totalHeight / USABLE_H;
      if (fillRatio >= PULL_UP_THRESHOLD) break;

      const nextPage = pages[i + 1];
      if (nextPage.blocks.length === 0) { i++; continue; }

      const nextBlock = nextPage.blocks[0];
      const wouldFit = (page.totalHeight + nextBlock.height) <= USABLE_H;

      if (wouldFit) {
        // Pull first block from next page into current
        page.blocks.push(nextBlock);
        page.totalHeight += nextBlock.height;
        nextPage.blocks.shift();
        nextPage.totalHeight -= nextBlock.height;

        // If next page is now empty, skip it
        if (nextPage.blocks.length === 0) {
          i++;
        }
      } else {
        break;
      }
    }

    optimized.push(page);
  }

  // ── Visual Balance Rule ──────────────────────────────────
  // Each page must have at least 2 content blocks, or 1 major (>40% fill).
  // If a page has only 1 small block, merge it with the next page.
  const balanced: ComposedPage[] = [];
  for (let i = 0; i < optimized.length; i++) {
    const page = optimized[i];
    const isSmallSingle = page.blocks.length === 1 && (page.totalHeight / USABLE_H) < 0.50;

    if (isSmallSingle && balanced.length > 0) {
      // Try to merge with previous page
      const prev = balanced[balanced.length - 1];
      if (prev.totalHeight + page.totalHeight <= USABLE_H * 1.05) {
        prev.blocks.push(...page.blocks);
        prev.totalHeight += page.totalHeight;
        continue;
      }
    }

    if (isSmallSingle && i + 1 < optimized.length) {
      // Try to merge with next page
      const next = optimized[i + 1];
      page.blocks.push(...next.blocks);
      page.totalHeight += next.totalHeight;
      i++; // skip next
    }

    balanced.push(page);
  }

  return balanced;
}

// ── Compression ─────────────────────────────────────────────
// If pages exceed MAX_PAGES, try to merge small adjacent pages
function compressPages(pages: ComposedPage[]): ComposedPage[] {
  const merged: ComposedPage[] = [];

  for (const page of pages) {
    if (merged.length === 0) {
      merged.push(page);
      continue;
    }

    const prev = merged[merged.length - 1];
    const combined = prev.totalHeight + page.totalHeight;

    // Merge if combined height fits within usable height (tight packing for density)
    if (combined <= USABLE_H * 1.02 && merged.length >= MAX_PAGES) {
      prev.blocks.push(...page.blocks);
      prev.totalHeight = combined;
    } else {
      merged.push(page);
    }
  }

  return merged;
}

// ── Text-based PDF (fallback) ─────────────────────────────────
export async function generateTextPDF(proposal: Proposal): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });

  const proj = proposal.project;
  const client = proj?.client;
  const production = proj?.production;
  const cost = proj?.costEstimate;
  const layout = proj?.layout;

  let y = 20;
  const lineH = 7;
  const mx = 20;
  const pageW = 216;
  const pageH = 279;

  const addText = (text: string, x: number, size = 10, bold = false, color = [30, 30, 30]) => {
    pdf.setFontSize(size);
    pdf.setFont('helvetica', bold ? 'bold' : 'normal');
    pdf.setTextColor(color[0], color[1], color[2]);
    pdf.text(text, x, y);
  };
  const addLine = () => { pdf.setDrawColor(200, 200, 200); pdf.line(mx, y, pageW - mx, y); y += 4; };
  const newPage = () => { pdf.addPage(); y = 20; };
  const check = () => { if (y > pageH - 30) newPage(); };

  pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, pageW, 50, 'F');
  pdf.setFontSize(24); pdf.setFont('helvetica', 'bold'); pdf.setTextColor(255, 255, 255);
  pdf.text('SOLAR ENERGY PROPOSAL', mx, 25);
  pdf.setFontSize(12); pdf.setTextColor(251, 191, 36);
  pdf.text('SolarPro Design Platform', mx, 35);
  pdf.setFontSize(10); pdf.setTextColor(148, 163, 184);
  pdf.text(`Prepared: ${new Date(proposal.preparedDate).toLocaleDateString()}`, mx, 43);
  y = 65;

  addText('CLIENT INFORMATION', mx, 14, true, [15, 23, 42]); y += lineH; addLine();
  addText(`Name: ${client?.name || '\u2014'}`, mx); y += lineH;
  addText(`Address: ${client?.address ?? ''}, ${client?.city ?? ''}, ${client?.state ?? ''} ${client?.zip ?? ''}`, mx); y += lineH;
  addText(`Email: ${client?.email || '\u2014'}`, mx); y += lineH;
  addText(`Utility Provider: ${client?.utilityProvider || '\u2014'}`, mx); y += lineH * 2; check();

  addText('SYSTEM OVERVIEW', mx, 14, true, [15, 23, 42]); y += lineH; addLine();
  addText(`System Type: ${getSystemTypeLabel(proj?.systemType ?? '')}`, mx); y += lineH;
  if (layout) {
    addText(`System Size: ${layout.systemSizeKw.toFixed(1)} kW`, mx); y += lineH;
    addText(`Panel Count: ${layout.totalPanels} panels`, mx); y += lineH;
  }
  if (production) {
    addText(`Annual Production: ${production.annualProductionKwh.toLocaleString()} kWh`, mx); y += lineH;
    addText(`Energy Offset: ${production.offsetPercentage}%`, mx); y += lineH;
    addText(`CO2 Offset: ${production.co2OffsetTons} tons/year`, mx); y += lineH;
  }
  y += lineH; check();

  if (cost) {
    newPage();
    addText('FINANCIAL ANALYSIS', mx, 14, true, [15, 23, 42]); y += lineH; addLine();
    addText(`Gross System Cost: $${cost.grossCost.toLocaleString()}`, mx); y += lineH;
    if (cost.taxCredit > 0) addText(`Estimated Incentives/ITC: -$${cost.taxCredit.toLocaleString()}`, mx, 10, false, [16, 185, 129]);
    y += lineH;
    addText(`Net System Cost: $${cost.netCost.toLocaleString()}`, mx, 12, true, [245, 158, 11]); y += lineH * 1.5;
    addText(`Annual Savings: $${cost.annualSavings.toLocaleString()}/year`, mx, 10, false, [16, 185, 129]); y += lineH;
    addText(`Payback Period: ${cost.paybackYears} years`, mx); y += lineH;
    addText(`25-Year Savings: $${cost.lifetimeSavings.toLocaleString()}`, mx, 10, false, [16, 185, 129]); y += lineH;
    addText(`Total ROI: ${cost.roi}%`, mx, 10, false, [16, 185, 129]); y += lineH * 2;
  }

  if (y > pageH - 40) newPage();
  y = pageH - 15;
  pdf.setFillColor(15, 23, 42); pdf.rect(0, pageH - 25, pageW, 25, 'F');
  pdf.setFontSize(8); pdf.setTextColor(148, 163, 184);
  pdf.text(`Valid until: ${new Date(proposal.validUntil).toLocaleDateString()}`, mx, y);
  pdf.text('Production estimates based on NREL PVWatts data. Actual results may vary.', mx, y + 7);

  const fn = client?.name?.replace(/[^a-z0-9]/gi, '_') || 'Client';
  pdf.save(`SolarProposal_${fn}_${new Date().toISOString().split('T')[0]}.pdf`);
}