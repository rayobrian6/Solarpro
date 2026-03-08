'use client';
/**
 * SolarAIBot — Built-in AI Support Chat Widget
 * 
 * Completely free — no API keys, no external services.
 * Uses a rule-based + keyword matching engine with a comprehensive
 * solar-specific knowledge base covering:
 * - NEC wire sizing, conduit, OCPD
 * - Panel placement, tilt, azimuth
 * - Battery/generator/ATS wiring
 * - BOM, SLD, engineering workflow
 * - Pricing, proposals, permits
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: 'user' | 'bot';
  text: string;
  timestamp: Date;
  quickReplies?: string[];
}

interface KBEntry {
  patterns: string[];        // keywords/phrases to match (lowercase)
  response: string;          // bot response
  quickReplies?: string[];   // follow-up suggestions
  priority?: number;         // higher = checked first (default 0)
}

// ── Solar Knowledge Base ───────────────────────────────────────────────────
const KNOWLEDGE_BASE: KBEntry[] = [
  // Greetings
  {
    patterns: ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'howdy', 'sup', 'start'],
    response: `👋 Hi! I'm SolarBot, your SolarPro design assistant.\n\nI can help you with:\n• **Panel placement** (roof, ground, fence)\n• **Wire sizing & NEC codes**\n• **Battery & generator wiring**\n• **BOM & engineering reports**\n• **Proposals & pricing**\n\nWhat can I help you with today?`,
    quickReplies: ['How do I place panels?', 'Wire sizing help', 'BOM questions', 'Generator wiring'],
    priority: 10,
  },

  // Panel Placement — Roof
  {
    patterns: ['place panel', 'roof panel', 'how to place', 'add panel', 'put panel', 'roof mode', 'click roof'],
    response: `🏠 **Roof Panel Placement**\n\n1. Click **Roof** in the 3D toolbar\n2. Click directly on the roof surface — panels snap to the roof angle automatically\n3. Use **Auto ✨** to fill all roof segments at once\n4. Use **Row ➡** mode to place a full row: click start → click end\n\n**Tips:**\n• Set your **Tilt** and **Azimuth** in the right panel before placing\n• Portrait/Landscape toggle changes panel orientation\n• Press **Delete** to remove a selected panel`,
    quickReplies: ['Ground panel placement', 'Auto-fill roof', 'Change tilt angle', 'Row placement'],
  },

  // Panel Placement — Ground Array
  {
    patterns: ['ground array', 'g-array', 'ground mount array', 'multiple rows', 'row spacing', 'ground row'],
    response: `🌱 **Ground Array Mode (G-Array)**\n\nThe G-Array tool places multiple rows with automatic inter-row spacing:\n\n1. Click **G-Array** in the 3D toolbar\n2. Set your **tilt angle** from the dropdown\n3. **Click 1:** Row start point on the ground\n4. **Click 2:** Row end point (defines length + direction)\n5. **Click 3, 4, 5...:** Each click adds another row\n6. Press **Enter** or click **✓ Confirm** to finalize\n\n**Row spacing** is auto-calculated using the winter solstice formula to prevent inter-row shading.\n\nFor 25° tilt at 38° latitude → ~10.4 ft (3.18m) minimum row spacing.`,
    quickReplies: ['What is row spacing?', 'Ground single panel', 'Cancel ground array', 'Tilt angle guide'],
  },

  // Ground single panel
  {
    patterns: ['ground panel', 'ground mode', 'single ground', 'ground placement', 'place ground'],
    response: `🌍 **Ground Panel Placement**\n\n1. Click **Ground** in the 3D toolbar\n2. Select tilt angle from the dropdown (0°–90°)\n3. Click anywhere on the ground to place a single panel\n\nFor **multiple rows**, use **G-Array** mode instead — it auto-calculates row spacing.\n\n**Ground panel color:** Green (vs. blue for roof panels)`,
    quickReplies: ['Ground Array mode', 'Set tilt angle', 'Fence panels'],
  },

  // Row spacing
  {
    patterns: ['row spacing', 'inter-row', 'shading between rows', 'how far apart', 'panel spacing'],
    response: `📏 **Row Spacing Formula**\n\nSolarPro uses the **winter solstice formula** (worst-case shading):\n\n\`Row Spacing = (Panel Depth + Shadow Length) × 1.1\`\n\nWhere:\n• Shadow Length = Panel Height × sin(tilt) ÷ tan(sun elevation)\n• Sun elevation at winter solstice = 90° − latitude − 23.45°\n\n**Common values (25° tilt, portrait):**\n| Latitude | Min Row Spacing |\n|----------|----------------|\n| 25° (FL) | ~7.8 ft (2.4m) |\n| 33° (GA) | ~9.2 ft (2.8m) |\n| 38° (IL) | ~10.4 ft (3.2m) |\n| 45° (OR) | ~12.8 ft (3.9m) |\n\nThe G-Array tool calculates this automatically based on your site latitude.`,
    quickReplies: ['G-Array mode', 'Tilt angle guide', 'NEC setback rules'],
  },

  // Wire sizing
  {
    patterns: ['wire size', 'wire gauge', 'awg', 'conductor', 'wire sizing', '#10', '#8', '#6', '#4', 'thwn'],
    response: `⚡ **Wire Sizing (NEC 310.15)**\n\nSolarPro auto-sizes all conductors based on:\n• **Load current** (inverter output or string current)\n• **Temperature correction** (NEC 310.15(B)(2))\n• **Conduit fill** (NEC Chapter 9)\n• **Voltage drop** (< 3% recommended)\n\n**Common wire gauges:**\n| Gauge | Ampacity (75°C) | Typical Use |\n|-------|----------------|-------------|\n| #10 AWG | 30A | DC strings, micro output |\n| #8 AWG | 50A | Small inverter AC output |\n| #6 AWG | 65A | Medium inverter AC |\n| #4 AWG | 85A | Large inverter, battery |\n| #2 AWG | 115A | Main service, large battery |\n\nCheck the **Wire-in-Conduit Sizing** section in Engineering for your specific run calculations.`,
    quickReplies: ['Conduit sizing', 'Voltage drop', 'BOM wire quantities', 'EGC sizing'],
  },

  // Conduit
  {
    patterns: ['conduit', 'emt', 'pvc', 'conduit size', 'conduit fill', 'pipe size'],
    response: `🔧 **Conduit Sizing (NEC Chapter 9)**\n\nSolarPro auto-selects conduit based on conductor count and fill percentage:\n\n**Fill limits (NEC Table 1):**\n• 1 conductor: 53% fill\n• 2 conductors: 31% fill\n• 3+ conductors: 40% fill\n\n**Common sizes:**\n| Conduit | Max conductors (THWN-2) |\n|---------|------------------------|\n| ¾" EMT | 3× #10 AWG |\n| 1" EMT | 3× #8 AWG or 4× #10 |\n| 1¼" EMT | 3× #6 AWG |\n| 1½" EMT | 3× #4 AWG |\n\n**EMT** = indoor/outdoor metallic (most common)\n**PVC** = underground runs (Schedule 40 or 80)`,
    quickReplies: ['Wire sizing', 'Underground runs', 'BOM conduit quantities'],
  },

  // Battery wiring
  {
    patterns: ['battery', 'battery wiring', 'battery to bui', 'bui', 'backup interface', 'enphase battery', 'powerwall', 'iq battery'],
    response: `🔋 **Battery Wiring**\n\nSolarPro computes battery wiring automatically when you select a battery in Engineering:\n\n**Key runs computed:**\n• **Battery → BUI:** DC or AC coupling wire (sized to battery output)\n• **BUI → MSP:** AC output to main service panel\n• **ATS → MSP:** Transfer switch to panel (if generator present)\n\n**NEC 705.12(B) — Battery Backfeed Rule:**\n\`Solar + Battery ≤ (Busbar × 1.2) − Main Breaker\`\n\nIf this rule is violated, SolarPro shows a compliance warning with remediation options (supply-side tap, busbar upgrade, or derate).\n\n**Select your battery** in the Equipment section of Engineering to see computed wire sizes.`,
    quickReplies: ['Generator wiring', 'NEC 705.12 rule', 'ATS wiring', 'Compliance errors'],
  },

  // Generator wiring
  {
    patterns: ['generator', 'generator wiring', 'generator to ats', 'ats', 'transfer switch', 'standby generator', 'generator wire length'],
    response: `⚡ **Generator Wiring**\n\nWhen a generator is selected in Engineering, SolarPro shows:\n\n**Generator → ATS Wire Length input:**\n• Enter the distance from your generator to the ATS/transfer switch\n• Default: 50 ft\n• SolarPro auto-sizes the wire gauge, conduit, and OCPD\n\n**Computed run: GENERATOR_TO_ATS_RUN**\n• Wire gauge: sized to generator output current\n• Conduit: EMT or PVC based on run type\n• OCPD: sized per NEC 445.12\n\n**The ATS is assumed to be located near the MSP/meter** — only the generator-to-ATS distance is variable.\n\nThis wire run appears in both the **SLD** and **BOM** automatically.`,
    quickReplies: ['Battery wiring', 'ATS to MSP', 'Wire sizing', 'BOM questions'],
  },

  // BOM
  {
    patterns: ['bom', 'bill of materials', 'material list', 'wire quantities', 'bom wire', 'bom conduit', 'bom mismatch'],
    response: `📋 **Bill of Materials (BOM)**\n\nThe BOM is generated from your Engineering configuration:\n\n**Wire quantities** are derived from \`ComputedSystem.runs\` — the same source as the Wire-in-Conduit Sizing section. Each wire gauge gets one line item.\n\n**BOM includes:**\n• Solar panels (module count)\n• Inverters / microinverters\n• Racking system\n• Wire by gauge (#10, #8, #6, #4 AWG)\n• Conduit by type+size (EMT, PVC)\n• Disconnects, OCPD, junction boxes\n• Battery, generator, ATS (if configured)\n\n**To generate BOM:**\n1. Complete Engineering configuration\n2. Click **Generate BOM** button\n3. Export as PDF or CSV\n\nIf wire quantities don't match the summary cards, check that \`bomQuantities\` is being passed from ComputedSystem.`,
    quickReplies: ['Wire sizing', 'SLD questions', 'Export BOM', 'Engineering workflow'],
  },

  // SLD
  {
    patterns: ['sld', 'single line', 'single line diagram', 'electrical diagram', 'schematic'],
    response: `📐 **Single Line Diagram (SLD)**\n\nThe SLD is auto-generated from your Engineering configuration:\n\n**What's shown:**\n• PV array → inverter/microinverter\n• DC disconnect (if required)\n• AC disconnect\n• Main service panel with busbar\n• Battery + BUI (if configured)\n• Generator + ATS (if configured)\n• Utility connection\n\n**Wire callouts** show gauge, conduit size, and OCPD for each run.\n\n**To generate SLD:**\n1. Complete Engineering configuration\n2. Click **Generate SLD** button\n3. Export as PDF\n\n**Tip:** The SLD updates automatically when you change equipment or wire lengths.`,
    quickReplies: ['BOM questions', 'Generator on SLD', 'Export SLD', 'NEC compliance'],
  },

  // NEC compliance
  {
    patterns: ['nec', 'code', 'compliance', 'violation', 'nec 690', 'nec 705', 'rapid shutdown', 'permit'],
    response: `📜 **NEC Compliance**\n\nSolarPro checks these NEC rules automatically:\n\n• **NEC 690.12** — Rapid Shutdown (required for roof-mounted systems)\n• **NEC 705.12(B)** — Battery backfeed limit (120% rule)\n• **NEC 310.15** — Conductor ampacity with temperature correction\n• **NEC 690.9** — Overcurrent protection sizing\n• **NEC Chapter 9** — Conduit fill limits\n• **NEC 445.12** — Generator OCPD sizing\n\n**Compliance issues** appear as red warnings in the Engineering panel with:\n• The specific NEC section violated\n• The calculated values vs. allowed values\n• Remediation options\n\n**AHJ settings** (Authority Having Jurisdiction) can be configured in Engineering → Jurisdiction to match your local NEC version.`,
    quickReplies: ['120% rule explained', 'Rapid shutdown', 'Wire sizing', 'Permit requirements'],
  },

  // 120% rule
  {
    patterns: ['120%', '120 percent', 'backfeed', 'busbar', 'bus rating', 'nec 705.12'],
    response: `⚡ **NEC 705.12(B) — 120% Busbar Rule**\n\n**Formula:**\n\`Solar + Battery Backfeed ≤ (Busbar Rating × 1.2) − Main Breaker\`\n\n**Example:**\n• 200A busbar, 200A main breaker\n• Max backfeed = (200 × 1.2) − 200 = **40A**\n• 40A × 240V = 9.6 kW max solar+battery\n\n**If violated, options are:**\n1. **Supply-side tap** — connect solar before the main breaker (no busbar limit)\n2. **Derate main breaker** — install smaller main breaker\n3. **Upgrade busbar** — install larger panel\n4. **Reduce system size** — fewer panels/smaller inverter\n\nSolarPro shows which option applies and calculates the required values.`,
    quickReplies: ['Supply-side tap', 'Battery wiring', 'Busbar upgrade', 'NEC compliance'],
  },

  // Tilt angle
  {
    patterns: ['tilt', 'tilt angle', 'panel angle', 'optimal tilt', 'best tilt', 'degrees tilt'],
    response: `☀️ **Optimal Tilt Angle**\n\nFor maximum annual production, tilt ≈ your latitude:\n\n| Location | Latitude | Optimal Tilt |\n|----------|----------|-------------|\n| Miami, FL | 25° | 20–25° |\n| Atlanta, GA | 33° | 28–33° |\n| Chicago, IL | 41° | 35–40° |\n| Denver, CO | 39° | 33–38° |\n| Seattle, WA | 47° | 40–45° |\n\n**Roof mounts:** Usually fixed at roof pitch (15°–35°)\n**Ground mounts:** Adjustable — use latitude ± 5°\n**Flat roofs:** 10°–15° minimum for self-cleaning\n\nIn SolarPro, set tilt in the **Configuration** panel (right side) before placing panels.`,
    quickReplies: ['Azimuth guide', 'Ground mount tilt', 'Production estimate', 'Row spacing'],
  },

  // Azimuth
  {
    patterns: ['azimuth', 'direction', 'south facing', 'panel direction', 'compass', 'orientation'],
    response: `🧭 **Panel Azimuth (Direction)**\n\n**0° = North, 90° = East, 180° = South, 270° = West**\n\n**Optimal for Northern Hemisphere:** 180° (true south)\n\n**Production impact:**\n• 180° (South): 100% production\n• 160° or 200° (SSE/SSW): ~98%\n• 135° or 225° (SE/SW): ~90%\n• 90° or 270° (East/West): ~75–80%\n\n**East-West split arrays** (90°/270°) are popular for:\n• Flat commercial roofs\n• Self-consumption optimization\n• Avoiding shading conflicts\n\nSet azimuth in the **Configuration** panel before placing panels.`,
    quickReplies: ['Tilt angle guide', 'East-west arrays', 'Production estimate', 'Shade analysis'],
  },

  // Shade analysis
  {
    patterns: ['shade', 'shading', 'shadow', 'shade analysis', 'sun hours', 'shade mode'],
    response: `🌡️ **Shade Analysis**\n\nSolarPro includes a real-time shade engine:\n\n**To enable:**\n1. Click **🌡 Shade** toggle in the 3D toolbar\n2. Use the **time slider** to simulate sun position throughout the day\n3. Panel colors show shade factor: 🟢 Full sun → 🔴 Full shade\n\n**Shade simulation uses:**\n• NOAA sun position algorithm (accurate to ±0.01°)\n• Cesium shadow maps (GPU-accelerated)\n• June 21 (summer solstice) by default\n\n**Tips:**\n• Check shading at 9am, 12pm, and 3pm\n• Winter solstice (Dec 21) shows worst-case shading\n• Trees and chimneys cast the longest shadows in winter`,
    quickReplies: ['Row spacing', 'Tilt angle', 'Production estimate', 'Shade toggle'],
  },

  // Proposals
  {
    patterns: ['proposal', 'quote', 'pricing', 'customer proposal', 'sales proposal', 'proposal pdf'],
    response: `📄 **Proposals**\n\nSolarPro generates professional customer proposals:\n\n**Proposal includes:**\n• System overview (size, panels, inverter)\n• Production estimate (kWh/year)\n• Financial analysis (cost, savings, payback, IRR)\n• State incentives (ITC, state credits, rebates, SRECs)\n• Equipment specifications\n• Company branding\n\n**To generate:**\n1. Complete project setup (address, utility, consumption)\n2. Complete Engineering configuration\n3. Go to **Proposals** → **New Proposal**\n4. Review and export as PDF\n\n**Incentives** are auto-detected by state — covers all 50 states including ITC (30%), state tax credits, utility rebates, and SREC programs.`,
    quickReplies: ['ITC incentive', 'State incentives', 'Financial analysis', 'Export proposal'],
  },

  // ITC / incentives
  {
    patterns: ['itc', 'tax credit', 'incentive', 'rebate', 'srec', 'federal credit', '30%', 'state incentive'],
    response: `💰 **Solar Incentives**\n\n**Federal ITC (Investment Tax Credit):**\n• **30%** of total system cost (through 2032)\n• Applies to equipment + installation\n• Residential and commercial\n\n**Common State Incentives:**\n| State | Additional Incentive |\n|-------|--------------------|\n| CA | Self-Generation Incentive Program |\n| NY | 25% state tax credit (up to $5,000) |\n| MA | SMART program + net metering |\n| NJ | SREC-II program |\n| TX | Property tax exemption |\n| IL | Illinois Shines SREC program |\n\nSolarPro auto-detects incentives based on your project address. Check the **Proposals** section for your specific incentive breakdown.`,
    quickReplies: ['Proposal generation', 'Financial analysis', 'Net metering', 'SREC programs'],
  },

  // Export / PDF
  {
    patterns: ['export', 'pdf', 'download', 'print', 'save', 'report'],
    response: `📥 **Export Options**\n\nSolarPro can export:\n\n• **SLD PDF** — Single Line Diagram (Engineering → Generate SLD → Export PDF)\n• **BOM PDF/CSV** — Bill of Materials (Engineering → Generate BOM → Export)\n• **Proposal PDF** — Customer proposal (Proposals → Export PDF)\n• **Structural Report** — Racking calculations (Engineering → Structural tab)\n• **Permit Package** — SLD + BOM + structural (Engineering → Permit tab)\n\n**Tip:** All exports include your company branding if configured in Settings → Branding.`,
    quickReplies: ['Generate SLD', 'Generate BOM', 'Proposal PDF', 'Permit package'],
  },

  // Microinverter vs string
  {
    patterns: ['microinverter', 'micro inverter', 'string inverter', 'iq8', 'enphase', 'solaredge', 'inverter type', 'which inverter'],
    response: `🔌 **Microinverter vs String Inverter**\n\n**Microinverters (e.g., Enphase IQ8):**\n• ✅ Best for shaded or complex roofs\n• ✅ Panel-level monitoring\n• ✅ No single point of failure\n• ✅ Easy expansion\n• ❌ Higher cost per watt\n• ❌ More components to install\n\n**String Inverters (e.g., SolarEdge, SMA):**\n• ✅ Lower cost\n• ✅ Simpler installation\n• ✅ Better for unshaded arrays\n• ❌ One inverter failure = system down\n• ❌ Shading affects entire string\n\n**In SolarPro:** Select inverter type in Engineering → Equipment. Wire sizing, BOM, and SLD all update automatically based on your selection.`,
    quickReplies: ['Wire sizing', 'BOM questions', 'Enphase IQ8 setup', 'String sizing'],
  },

  // Racking / mounting
  {
    patterns: ['racking', 'mounting', 'ironridge', 'unirac', 'roof mount', 'ground mount racking', 'structural', 'wind load', 'snow load'],
    response: `🏗️ **Racking & Structural**\n\nSolarPro includes structural calculations for:\n\n**Roof Mount:**\n• IronRidge XR100/XR1000\n• Unirac SolarMount\n• Roof pitch and rafter spacing input\n• Wind/snow load per ASCE 7\n\n**Ground Mount:**\n• Standard ground mount (driven piers)\n• Ballasted (flat roof / ground)\n• Tilt-up adjustable\n\n**Structural tab in Engineering shows:**\n• Rafter/purlin sizing\n• Attachment point spacing\n• Wind uplift calculations\n• Snow load compliance\n\nSelect your racking system in Engineering → Equipment → Mounting System.`,
    quickReplies: ['Wind load', 'Snow load', 'Ground mount setup', 'Structural report'],
  },

  // Getting started
  {
    patterns: ['getting started', 'how to start', 'new project', 'first project', 'tutorial', 'walkthrough', 'how does this work'],
    response: `🚀 **Getting Started with SolarPro**\n\n**Step 1: Create a Project**\nProjects → New Project → Enter address + customer info\n\n**Step 2: Design the System**\nDesign tab → Draw roof zones → Auto-generate panel layout\n\n**Step 3: Engineering**\nEngineering tab → Select equipment → Review wire sizing + compliance\n\n**Step 4: Generate Documents**\nEngineering → Generate SLD + BOM\nProposals → Generate customer proposal\n\n**Step 5: Export**\nExport PDF permit package + customer proposal\n\n**3D View:** Click "3D View" button to see your design in Google Photorealistic 3D Tiles with real-time shade simulation.`,
    quickReplies: ['Panel placement', 'Engineering setup', 'Generate proposal', '3D design tips'],
  },

  // Error / problem
  {
    patterns: ['error', 'bug', 'not working', 'broken', 'issue', 'problem', 'wrong', 'incorrect', 'help'],
    response: `🔧 **Troubleshooting**\n\nCommon issues and fixes:\n\n**3D view not loading:**\n• Check your internet connection\n• Verify Google Maps API key is configured\n• Try refreshing the page\n\n**Panels floating above roof:**\n• Wait for 3D tiles to fully load before placing panels\n• The loading indicator must show "Ready"\n\n**Wire quantities don't match:**\n• Regenerate BOM after changing equipment\n• Check that all wire runs have lengths entered\n\n**Compliance errors:**\n• Read the specific NEC section cited\n• Use the suggested remediation options\n\n**Can't find a feature:**\nTry the search or ask me a specific question!`,
    quickReplies: ['3D loading issues', 'BOM mismatch', 'Compliance errors', 'Contact support'],
  },

  // Contact / human support
  {
    patterns: ['contact', 'human', 'agent', 'support team', 'email', 'phone', 'talk to someone', 'real person'],
    response: `👤 **Contact Support**\n\nFor issues beyond what I can help with:\n\n• **Email:** support@solarpro.app\n• **Documentation:** docs.solarpro.app\n• **GitHub Issues:** Report bugs on our repository\n\nI'm an AI assistant — I can answer most questions about using SolarPro, but for account issues, billing, or complex technical problems, please reach out to the support team directly.\n\nIs there anything else I can help you with?`,
    quickReplies: ['Getting started', 'Feature request', 'Report a bug'],
  },

  // Fallback
  {
    patterns: ['__fallback__'],
    response: `🤔 I'm not sure about that specific question. Here are some things I can help with:\n\n• **Panel placement** — roof, ground, fence, ground array\n• **Wire & conduit sizing** — NEC 310.15, Chapter 9\n• **Battery & generator wiring** — BUI, ATS, backfeed rules\n• **BOM & SLD** — generating and exporting documents\n• **Proposals** — incentives, financial analysis\n• **NEC compliance** — 120% rule, rapid shutdown, permits\n\nTry asking a more specific question, or choose one of the topics above.`,
    quickReplies: ['Panel placement', 'Wire sizing', 'BOM questions', 'Getting started'],
    priority: -10,
  },
];

// ── Bot Engine ─────────────────────────────────────────────────────────────
function findResponse(input: string): KBEntry {
  const lower = input.toLowerCase().trim();
  let best: KBEntry | null = null;
  let bestScore = -1;

  for (const entry of KNOWLEDGE_BASE) {
    if (entry.patterns[0] === '__fallback__') continue;
    let score = 0;
    for (const pattern of entry.patterns) {
      if (lower.includes(pattern)) {
        // Longer pattern = more specific = higher score
        score = Math.max(score, pattern.length + (entry.priority ?? 0));
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = entry;
    }
  }

  if (bestScore <= 0) {
    return KNOWLEDGE_BASE.find(e => e.patterns[0] === '__fallback__')!;
  }
  return best!;
}

// Format markdown-like text to JSX
function formatText(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const formatted = parts.map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j}>{part.slice(2, -2)}</strong>;
      }
      // Inline code: `text`
      const codeParts = part.split(/(`[^`]+`)/g);
      return codeParts.map((cp, k) => {
        if (cp.startsWith('`') && cp.endsWith('`')) {
          return <code key={k} style={{ background: 'rgba(255,255,255,0.1)', padding: '1px 5px', borderRadius: 3, fontFamily: 'monospace', fontSize: 11 }}>{cp.slice(1, -1)}</code>;
        }
        return cp;
      });
    });
    return <span key={i}>{formatted}{i < lines.length - 1 ? <br /> : null}</span>;
  });
}

// ── Component ──────────────────────────────────────────────────────────────
export default function SolarAIBot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Welcome message on first open
  useEffect(() => {
    if (open && messages.length === 0) {
      const welcome = KNOWLEDGE_BASE.find(e => e.patterns.includes('hello'))!;
      setMessages([{
        id: 'welcome',
        role: 'bot',
        text: welcome.response,
        timestamp: new Date(),
        quickReplies: welcome.quickReplies,
      }]);
    }
    if (open) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: text.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setTyping(true);

    // Simulate typing delay (400–900ms)
    const delay = 400 + Math.random() * 500;
    setTimeout(() => {
      const entry = findResponse(text);
      const botMsg: Message = {
        id: `b-${Date.now()}`,
        role: 'bot',
        text: entry.response,
        timestamp: new Date(),
        quickReplies: entry.quickReplies,
      };
      setMessages(prev => [...prev, botMsg]);
      setTyping(false);
      if (!open) setUnread(u => u + 1);
    }, delay);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  return (
    <>
      {/* Floating button */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
      }}>
        {/* Tooltip when closed */}
        {!open && (
          <div style={{
            background: 'rgba(15,23,42,0.95)', color: '#e2e8f0',
            padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500,
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
            whiteSpace: 'nowrap', animation: 'fadeIn 0.3s ease',
          }}>
            ⚡ Ask SolarBot anything
          </div>
        )}

        {/* Main button */}
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            width: 56, height: 56, borderRadius: '50%', border: 'none',
            background: open ? '#334155' : 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#fff', fontSize: 24, cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(245,158,11,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s ease', position: 'relative',
          }}
          title={open ? 'Close chat' : 'Open SolarBot'}
        >
          {open ? '✕' : '⚡'}
          {unread > 0 && !open && (
            <div style={{
              position: 'absolute', top: -4, right: -4,
              background: '#ef4444', color: '#fff',
              width: 20, height: 20, borderRadius: '50%',
              fontSize: 11, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>{unread}</div>
          )}
        </button>
      </div>

      {/* Chat window */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 92, right: 24, zIndex: 9998,
          width: 360, height: 520,
          background: '#0f172a',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 16,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideUp 0.25s ease',
        }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, #1e293b, #0f172a)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, flexShrink: 0,
            }}>⚡</div>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14 }}>SolarBot</div>
              <div style={{ color: '#10b981', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                Online · Solar design assistant
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, padding: 4 }}
            >✕</button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: 8, alignItems: 'flex-start',
              }}>
                {msg.role === 'bot' && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, marginTop: 2,
                  }}>⚡</div>
                )}
                <div style={{ maxWidth: '80%' }}>
                  <div style={{
                    background: msg.role === 'user'
                      ? 'linear-gradient(135deg, #f59e0b22, #d9770622)'
                      : 'rgba(255,255,255,0.05)',
                    border: msg.role === 'user'
                      ? '1px solid rgba(245,158,11,0.3)'
                      : '1px solid rgba(255,255,255,0.08)',
                    borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                    padding: '10px 12px',
                    color: '#e2e8f0',
                    fontSize: 13,
                    lineHeight: 1.55,
                  }}>
                    {formatText(msg.text)}
                  </div>
                  {/* Quick replies */}
                  {msg.role === 'bot' && msg.quickReplies && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
                      {msg.quickReplies.map(qr => (
                        <button
                          key={qr}
                          onClick={() => sendMessage(qr)}
                          style={{
                            padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                            cursor: 'pointer',
                            background: 'rgba(245,158,11,0.1)',
                            border: '1px solid rgba(245,158,11,0.3)',
                            color: '#fbbf24',
                            transition: 'all 0.15s',
                          }}
                        >{qr}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {typing && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
                }}>⚡</div>
                <div style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '12px 12px 12px 2px',
                  padding: '10px 14px',
                  display: 'flex', gap: 4, alignItems: 'center',
                }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#64748b',
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.08)',
            padding: '10px 12px',
            background: '#0f172a',
          }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8 }}>
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask about panels, wiring, NEC codes..."
                style={{
                  flex: 1, background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 10, padding: '9px 12px',
                  color: '#e2e8f0', fontSize: 13, outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={!input.trim() || typing}
                style={{
                  width: 38, height: 38, borderRadius: 10, border: 'none',
                  background: input.trim() && !typing
                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                    : 'rgba(255,255,255,0.06)',
                  color: input.trim() && !typing ? '#fff' : '#475569',
                  cursor: input.trim() && !typing ? 'pointer' : 'default',
                  fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0,
                }}
              >↑</button>
            </form>
            <div style={{ color: '#334155', fontSize: 10, textAlign: 'center', marginTop: 6 }}>
              AI assistant · Not a licensed engineer · For design guidance only
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(10px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>
    </>
  );
}