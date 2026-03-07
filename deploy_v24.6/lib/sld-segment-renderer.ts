// ============================================================
// SLD SEGMENT RENDERER — BUILD v16
// Renders SLD from segment model only.
// Respects interconnection type.
// Places labels inline on segments.
// ============================================================

import {
  Segment,
  SegmentType,
  InterconnectionType,
} from './segment-model';

interface SLDRendererInput {
  segments: Segment[];
  topology: 'micro' | 'string' | 'optimizer';
  address: string;
  totalModules: number;
  acOutputKw: number;
  panelWatts: number;
  panelVoc: string;
  panelIsc: string;
  inverterModel: string;
  branchCount?: number;
  mainPanelAmps: number;
  mainPanelBrand: string;
  panelBusRating: number;
  mainBreakerAmps: number;
  interconnectionType: InterconnectionType;
  maxPVBreaker?: number; // From NEC 705.12(B) calculation
}

export function renderSLDFromSegments(input: SLDRendererInput): string {
  const W = 1200;
  const H = 800;
  const MAR = 20;
  const SCH_X = MAR + 10;
  const SCH_Y = MAR + 70;
  const SCH_W = W - MAR * 2 - 20;
  const SCH_H = H - MAR * 2 - 70;
  
  const BUS_Y = SCH_Y + SCH_H / 2;
  const TB_X = W / 2;
  
  const WHT = '#FFFFFF';
  const BLK = '#000000';
  const GRN = '#228B22';
  const RED = '#DC143C';
  const BLU = '#1E90FF';
  const GRAY = '#707070';
  
  const SW_BORDER = 2;
  const SW_THIN = 1;
  const SW_MED = 1.5;
  const SW_THICK = 2.5;
  
  const F = {
    title: 14,
    sub: 10,
    label: 11,
    data: 9,
    segment: 8,
    note: 7,
  };
  
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  const rect = (x: number, y: number, w: number, h: number, opts?: Record<string, any>) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}"${Object.entries(opts || {}).map(([k, v]) => ` ${k}="${v}"`).join('')} />`;
  
  const ln = (x1: number, y1: number, x2: number, y2: number, opts?: Record<string, any>) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${Object.entries(opts || {}).map(([k, v]) => ` ${k}="${v}"`).join('')} />`;
  
  const txt = (x: number, y: number, content: string, opts?: Record<string, any>) =>
    `<text x="${x}" y="${y}"${Object.entries(opts || {}).map(([k, v]) => ` ${k}="${v}"`).join('')}>${content}</text>`;
  
  const arrow = (x1: number, y1: number, x2: number, y2: number, color: string) => {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 10;
    const headX = x2 - headLen * Math.cos(angle - Math.PI / 6);
    const headY = y2 - headLen * Math.sin(angle - Math.PI / 6);
    const headX2 = x2 - headLen * Math.cos(angle + Math.PI / 6);
    const headY2 = y2 - headLen * Math.sin(angle + Math.PI / 6);
    return `
      <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="2" marker-end="url(#arrowhead)" />
      <polygon points="${x2},${y2} ${headX},${headY} ${headX2},${headY2}" fill="${color}" />
    `;
  };
  
  const parts: string[] = [];
  
  // Arrow marker definition
  parts.push(`
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="${BLK}" />
      </marker>
    </defs>
  `);
  
  // SVG root
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:${WHT};font-family:Arial,Helvetica,sans-serif;">`);
  parts.push(rect(0, 0, W, H, { fill: WHT, stroke: WHT, sw: 0 }));
  parts.push(rect(MAR/2, MAR/2, W - MAR, H - MAR, { fill: WHT, stroke: BLK, sw: SW_BORDER }));
  
  // Title
  const titleCX = (SCH_W) / 2 + SCH_X;
  parts.push(txt(titleCX, SCH_Y - 35, 'SINGLE LINE DIAGRAM — PHOTOVOLTAIC SYSTEM', {
    size: F.title, bold: true, anchor: 'middle',
  }));
  parts.push(txt(titleCX, SCH_Y - 20,
    `${esc(input.address)}  |  ${esc(input.topology.replace('_', ' ').toUpperCase())}  |  ${input.totalModules} MODULES  |  ${input.acOutputKw} kW AC`,
    { size: F.sub, anchor: 'middle', fill: '#444' }
  ));
  
  // Schematic border
  parts.push(rect(SCH_X, SCH_Y, SCH_W, SCH_H, { fill: WHT, stroke: BLK, sw: SW_THIN }));
  
  // Component X positions based on segment flow
  const xPad = 80;
  const usableW = SCH_W - xPad * 2;
  
  // Determine node positions based on segments
  const nodePositions: Record<string, { x: number; y: number }> = {};
  const segmentDraws: Array<{ seg: Segment; x1: number; y1: number; x2: number; y2: number }> = [];
  
  // Build node graph from segments
  const nodes = new Set<string>();
  const edges = new Array<{ from: string; to: string; segment: Segment }>();
  
  for (const seg of input.segments) {
    nodes.add(seg.fromNode);
    nodes.add(seg.toNode);
    edges.push({ from: seg.fromNode, to: seg.toNode, segment: seg });
  }
  
  const nodeList = Array.from(nodes);
  const nodeXStep = usableW / (nodeList.length - 1);
  
  nodeList.forEach((node, i) => {
    nodePositions[node] = {
      x: SCH_X + xPad + i * nodeXStep,
      y: BUS_Y,
    };
  });
  
  // ============================================================
  // Draw interconnection method
  // ============================================================
  
  if (input.interconnectionType === InterconnectionType.LOAD_SIDE_TAP) {
    // Draw load-side tap symbol on MSP
    const mspNode = nodeList.find(n => n.includes('MAIN SERVICE'));
    if (mspNode && nodePositions[mspNode]) {
      const { x, y } = nodePositions[mspNode];
      // Tap symbol
      parts.push(rect(x - 30, y - 20, 60, 40, { fill: WHT, stroke: BLK, sw: SW_MED }));
      parts.push(txt(x, y - 5, 'LOAD SIDE', { size: F.note, anchor: 'middle', bold: true }));
      parts.push(txt(x, y + 10, 'TAP', { size: F.note, anchor: 'middle', bold: true }));
      parts.push(txt(x, y + 40, 'NEC 705.12(B)', { size: F.note, anchor: 'middle', fill: GRAY }));
    }
  } else if (input.interconnectionType === InterconnectionType.BACKFED_BREAKER) {
    // Draw backfed breaker symbol in MSP
    const mspNode = nodeList.find(n => n.includes('MAIN SERVICE'));
    if (mspNode && nodePositions[mspNode]) {
      const { x, y } = nodePositions[mspNode];
      const maxBreaker = input.maxPVBreaker || 40;
      // Breaker symbol
      parts.push(rect(x - 35, y - 25, 70, 50, { fill: '#FFEB3B', stroke: BLK, sw: SW_MED }));
      parts.push(txt(x, y - 8, 'BACKFED', { size: F.note, anchor: 'middle', bold: true }));
      parts.push(txt(x, y + 8, 'BREAKER', { size: F.note, anchor: 'middle', bold: true }));
      parts.push(txt(x, y + 35, `MAX ${maxBreaker}A`, { size: F.note, anchor: 'middle', fill: RED }));
      parts.push(txt(x, y + 55, 'NEC 705.12(B)', { size: F.note, anchor: 'middle', fill: GRAY }));
    }
  } else if (input.interconnectionType === InterconnectionType.SUPPLY_SIDE_TAP || input.interconnectionType === InterconnectionType.LINE_SIDE_TAP) {
    // Draw supply-side tap symbol
    const mspNode = nodeList.find(n => n.includes('MAIN SERVICE') || n.includes('UTILITY SERVICE'));
    if (mspNode && nodePositions[mspNode]) {
      const { x, y } = nodePositions[mspNode];
      // Supply-side tap symbol
      parts.push(rect(x - 30, y - 20, 60, 40, { fill: '#E1F5FE', stroke: BLU, sw: SW_MED }));
      parts.push(txt(x, y - 5, 'SUPPLY', { size: F.note, anchor: 'middle', bold: true }));
      parts.push(txt(x, y + 10, 'SIDE TAP', { size: F.note, anchor: 'middle', bold: true }));
      parts.push(txt(x, y + 40, 'NEC 705.11', { size: F.note, anchor: 'middle', fill: BLU }));
    }
  }
  
  // ============================================================
  // Draw segments with inline labels
  // ============================================================
  
  for (const { from, to, segment } of edges) {
    const fromPos = nodePositions[from];
    const toPos = nodePositions[to];
    
    if (!fromPos || !toPos) continue;
    
    const x1 = fromPos.x;
    const y1 = fromPos.y;
    const x2 = toPos.x;
    const y2 = toPos.y;
    
    // Determine color based on segment type
    let color = BLK;
    if (segment.type === SegmentType.UTILITY_SERVICE_ENTRANCE) color = GRAY;
    if (segment.type === SegmentType.LOAD_SIDE_TAP_SEGMENT || segment.type === SegmentType.BACKFED_BREAKER_SEGMENT) color = BLU;
    
    // Draw segment line
    parts.push(ln(x1, y1, x2, y2, { stroke: color, stroke_width: SW_THICK }));
    
    // Draw inline label at midpoint
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    
    // Background for label
    const labelLines = segment.conductorCallout.split(' IN ');
    const labelHeight = labelLines.length * 14 + 10;
    parts.push(rect(midX - 90, midY - labelHeight/2 - 5, 180, labelHeight, { fill: WHT, stroke: color, stroke_width: 1, rx: 3 }));
    
    // Label text
    labelLines.forEach((line, i) => {
      parts.push(txt(midX, midY - labelHeight/2 + 10 + i * 14, line, {
        size: F.segment,
        anchor: 'middle',
        fill: color,
      }));
    });
    
    // Store for node drawing
    segmentDraws.push({ seg: segment, x1, y1, x2, y2 });
  }
  
  // ============================================================
  // Draw nodes (draw after segments to cover line ends)
  // ============================================================
  
  const drawnNodes = new Set<string>();
  
  for (const node of nodeList) {
    const pos = nodePositions[node];
    if (!pos) continue;
    
    const { x, y } = pos;
    
    // Determine node type and appearance
    let nodeColor = WHT;
    let nodeStroke = BLK;
    let nodeStrokeWidth = SW_MED;
    let nodeLabel = node;
    
    if (node.includes('PV ARRAY')) {
      nodeLabel = `PV ARRAY\n${input.totalModules}×${input.panelWatts}W`;
    } else if (node.includes('ROOF JUNCTION')) {
      nodeLabel = 'ROOF J-BOX';
    } else if (node.includes('AC COMBINER')) {
      nodeLabel = 'AC COMBINER';
      nodeColor = '#FFF3E0';
    } else if (node.includes('AC DISCONNECT')) {
      nodeLabel = 'AC DISCONNECT';
      nodeColor = '#F3E5F5';
    } else if (node.includes('MAIN SERVICE')) {
      nodeLabel = `${input.mainPanelAmps}A MSP\n${input.mainPanelBrand}`;
      nodeColor = '#E0F7FA';
    } else if (node.includes('UTILITY METER')) {
      nodeLabel = 'UTILITY METER';
      nodeColor = '#FFFDE7';
    } else if (node.includes('UTILITY SERVICE')) {
      nodeLabel = 'UTILITY';
      nodeColor = '#FFEBEE';
    }
    
    // Don't draw node if it's the interconnection method (already drawn above)
    if (node.includes('MAIN SERVICE') && (input.interconnectionType === InterconnectionType.LOAD_SIDE_TAP || input.interconnectionType === InterconnectionType.BACKFED_BREAKER)) {
      continue;
    }
    
    // Node box
    const nodeW = 100;
    const nodeH = 50;
    parts.push(rect(x - nodeW/2, y - nodeH/2, nodeW, nodeH, { fill: nodeColor, stroke: nodeStroke, stroke_width: nodeStrokeWidth }));
    
    // Node label (multiline)
    const lines = nodeLabel.split('\n');
    lines.forEach((line, i) => {
      parts.push(txt(x, y - nodeH/2 + 15 + i * 14, line, {
        size: F.label,
        anchor: 'middle',
        fill: BLK,
      }));
    });
    
    drawnNodes.add(node);
  }
  
  // ============================================================
  // Legend
  // ============================================================
  
  const legendX = SCH_X + 20;
  const legendY = SCH_Y + SCH_H - 80;
  
  parts.push(rect(legendX, legendY, 200, 70, { fill: WHT, stroke: GRAY, stroke_width: 1, rx: 5 }));
  parts.push(txt(legendX + 10, legendY + 15, 'LEGEND', { size: F.label, bold: true }));
  parts.push(txt(legendX + 10, legendY + 35, '━ Segment conductor bundle', { size: F.note }));
  parts.push(txt(legendX + 10, legendY + 55, '▭ Equipment / Device', { size: F.note }));
  
  // ============================================================
  // Info box
  // ============================================================
  
  const infoX = SCH_X + SCH_W - 220;
  const infoY = SCH_Y + SCH_H - 80;
  
  parts.push(rect(infoX, infoY, 200, 70, { fill: '#F5F5F5', stroke: GRAY, stroke_width: 1, rx: 5 }));
  parts.push(txt(infoX + 10, infoY + 15, 'SYSTEM INFO', { size: F.label, bold: true }));
  parts.push(txt(infoX + 10, infoY + 35, `Interconnection: ${input.interconnectionType}`, { size: F.note }));
  
  if (input.interconnectionType === InterconnectionType.BACKFED_BREAKER) {
    const maxBreaker = input.maxPVBreaker || 40;
    parts.push(txt(infoX + 10, infoY + 55, `Max PV Breaker: ${maxBreaker}A (NEC 705.12(B))`, { size: F.note, fill: RED }));
  }
  
  parts.push('</svg>');
  
  return parts.join('\n');
}