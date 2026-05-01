import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  getProjectsByUser,
  getProjectWithDetails,
  solardogSaveMessage,
  solardogGetHistory,
  solardogGetAliases,
  solardogSaveAlias,
  solardogDeleteAlias,
  solardogKnowledgeGet,
  type KnowledgeItem,
} from '@/lib/db-neon';
import { SITE_MAP, normalizePhrase } from '@/lib/solardog/siteMap';
import {
  resolveRoute,
  detectLearnIntent,
  detectUnlearnIntent,
  isNavigationIntent,
  isValidLearnPhrase,
  isValidLearnTarget,
} from '@/lib/solardog/resolveRoute';
import { buildActionList } from '@/lib/solardog/actionRegistry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SolarDogMode =
  | 'user'
  | 'developer'
  | 'debug'
  | 'project_helper'
  | 'engineering_helper';

/** What kind of response is this turn? */
export type ResponseType = 'chat' | 'navigate' | 'action' | 'learn' | 'observation' | 'conversation' | 'correction';

/** Intent classification — evaluated before every response */
export type IntentType = 'navigation' | 'question' | 'action' | 'observation' | 'conversation' | 'correction';

interface AssistantRequest {
  message:   string;
  projectId?: string | null;
  page?:     string;
  /** If provided, user is confirming a pending learn alias */
  pendingLearnPhrase?: string | null;
  pendingLearnRoute?:  string | null;
  context?: {
    // Basic page/project
    currentTab?:        string;
    projectName?:       string;
    systemSizeKw?:      number;
    inverter?:          string;
    battery?:           string;
    utility?:           string;
    validationStatus?:  string;
    lastAction?:        string;
    userRole?:          string;
    // Screen context v10.3 — wired by individual pages
    currentRoute?:      string;
    currentProjectId?:  string;
    currentProjectName?: string;
    activeTab?:         string;
    visibleButtons?:    string[];      // button labels/keys visible on current page
    visibleWarnings?:   string[];      // warning messages currently shown
    visibleErrors?:     string[];      // error messages currently shown
    visibleCards?:      string[];      // card titles/labels visible
    visibleCounts?:     Record<string, number>; // e.g. { todayCommands: 12, openProjects: 3 }
    selectedEquipment?: Record<string, string>; // e.g. { inverter: 'SMA SB7.7', battery: 'Tesla PW3' }
  };
}

export interface AssistantResponse {
  // Agent response type
  type:             ResponseType;
  intent_type?:     IntentType;
  message:          string;
  // Navigation
  route?:           string | null;
  routeLabel?:      string | null;
  // Action
  action?:          string | null;
  // Learn confirmation
  learnedPhrase?:   string | null;
  learnedRoute?:    string | null;
  // v10.2: Pending learn — awaiting user confirmation before saving
  pendingLearnPhrase?: string | null;
  pendingLearnRoute?:  string | null;
  // Metadata
  mode:             SolarDogMode;
  confidence:       'high' | 'medium' | 'low';
  voiceEnabled:     boolean;
  memoryAvailable:  boolean;
  contextAvailable: boolean;
  highlight?:       string | null;
  severity?:        string;
  suggestedActions?: Array<{ label: string; action: string }>;
  _debug?:          Record<string, unknown>;
}

// ─── Developer / Debug mode detection ────────────────────────────────────────

// Imported from lib/solardog/detectMode to keep this module testable in isolation
import { detectMode } from '@/lib/solardog/detectMode';

// ─── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(
  mode:                SolarDogMode,
  page:                string,
  projectSummaries:    string,
  activeProjectDetail: string,
  userName:            string,
  historyCount:        number,
  memoryAvailable:     boolean,
  contextAvailable:    boolean,
  richContext:         AssistantRequest['context'],
  learnedAliases:      string,
  knowledgeItems:      string,
): string {

  // ── Memory status line ─────────────────────────────────────────────────────
  let conversationMemoryLine: string;
  if (memoryAvailable && historyCount > 0) {
    conversationMemoryLine =
      `CONVERSATION MEMORY: The ${historyCount} messages above ARE your conversation history with ${userName}. ` +
      `You remember everything in them. Reference specific things they said when relevant.`;
  } else if (memoryAvailable && historyCount === 0) {
    conversationMemoryLine =
      `CONVERSATION MEMORY: This is the first message from ${userName} — no prior conversation history yet.`;
  } else {
    if (mode === 'developer' || mode === 'debug') {
      conversationMemoryLine =
        `CONVERSATION MEMORY: Unavailable — DB connection failed or solardog_conversations table missing. ` +
        `Run GET /api/solardog/debug to diagnose. GET /api/migrate to create tables.`;
    } else {
      conversationMemoryLine =
        `CONVERSATION MEMORY: Not available for this session (DB unavailable or first-time setup). ` +
        `I can still see the current page and project context.`;
    }
  }

  // ── Screen context ─────────────────────────────────────────────────────────
  const ctx = richContext ?? {};
  const hasVisibleButtons  = Array.isArray(ctx.visibleButtons)  && (ctx.visibleButtons  as string[]).length > 0;
  const hasVisibleWarnings = Array.isArray(ctx.visibleWarnings) && (ctx.visibleWarnings as string[]).length > 0;
  const hasVisibleErrors   = Array.isArray(ctx.visibleErrors)   && (ctx.visibleErrors   as string[]).length > 0;
  const hasVisibleCards    = Array.isArray(ctx.visibleCards)    && (ctx.visibleCards    as string[]).length > 0;
  const hasVisibleCounts   = !!ctx.visibleCounts   && typeof ctx.visibleCounts   === 'object' && Object.keys(ctx.visibleCounts   as object).length > 0;
  const hasSelectedEquip   = !!ctx.selectedEquipment && typeof ctx.selectedEquipment === 'object' && Object.keys(ctx.selectedEquipment as object).length > 0;
  const hasAnyScreenCtx    = hasVisibleButtons || hasVisibleWarnings || hasVisibleErrors || hasVisibleCards || hasVisibleCounts || hasSelectedEquip;

  let screenContextStr = '';
  if (hasAnyScreenCtx) {
    const lines: string[] = ['SCREEN CONTEXT (sent by page):'];
    if (hasVisibleButtons)  lines.push(`  visibleButtons:    ${(ctx.visibleButtons  as string[]).join(', ')}`);
    if (hasVisibleWarnings) lines.push(`  visibleWarnings:   ${(ctx.visibleWarnings as string[]).join(', ')}`);
    if (hasVisibleErrors)   lines.push(`  visibleErrors:     ${(ctx.visibleErrors   as string[]).join(', ')}`);
    if (hasVisibleCards)    lines.push(`  visibleCards:      ${(ctx.visibleCards    as string[]).join(', ')}`);
    if (hasVisibleCounts)   lines.push(`  visibleCounts:     ${JSON.stringify(ctx.visibleCounts)}`);
    if (hasSelectedEquip)   lines.push(`  selectedEquipment: ${JSON.stringify(ctx.selectedEquipment)}`);
    screenContextStr = '\n' + lines.join('\n');
  }

  const basicContextLines: string[] = [];
  if (ctx.currentRoute)                              basicContextLines.push(`  currentRoute:      ${ctx.currentRoute}`);
  if (ctx.activeTab ?? ctx.currentTab)               basicContextLines.push(`  activeTab:         ${ctx.activeTab ?? ctx.currentTab}`);
  if ((ctx.currentProjectName ?? ctx.projectName))   basicContextLines.push(`  projectName:       ${ctx.currentProjectName ?? ctx.projectName}`);
  if (ctx.systemSizeKw)                              basicContextLines.push(`  systemSizeKw:      ${ctx.systemSizeKw}`);
  if (ctx.validationStatus)                          basicContextLines.push(`  validationStatus:  ${ctx.validationStatus}`);
  if (ctx.lastAction)                                basicContextLines.push(`  lastAction:        ${ctx.lastAction}`);
  if (ctx.inverter)                                  basicContextLines.push(`  inverter:          ${ctx.inverter}`);
  if (ctx.battery)                                   basicContextLines.push(`  battery:           ${ctx.battery}`);
  if (ctx.utility)                                   basicContextLines.push(`  utility:           ${ctx.utility}`);
  const basicContextStr = basicContextLines.length > 0
    ? '\nCONTEXT FROM PAGE:\n' + basicContextLines.join('\n')
    : '';

  const siteMapStr = SITE_MAP.map(r =>
    `  ${r.route.padEnd(28)} "${r.label}" — ${r.aliases.slice(0, 4).join(', ')}`
  ).join('\n');

  // ─── Developer / debug mode ───────────────────────────────────────────────
  if (mode === 'developer' || mode === 'debug') {
    return `You are SolarDog 🐾, the AI assistant inside SolarPro — currently in DEVELOPER/DEBUG MODE.

IDENTITY:
- You ARE an LLM (gpt-4o-mini) embedded in SolarPro via /api/assistant
- You have access to: project DB, conversation memory (solardog_conversations), page context, learned aliases (site_aliases), knowledge base (solarpro_knowledge_items)
- Voice: ElevenLabs TTS proxied through /api/tts (ELEVENLABS_API_KEY env var)

CURRENT DIAGNOSTIC STATE:
- Memory available: ${memoryAvailable}
- History turns loaded: ${historyCount}
- Context available: ${contextAvailable}
- Current page: ${page}
- Mode: ${mode}
- Learned aliases: ${learnedAliases || 'none'}
- Knowledge items loaded: ${knowledgeItems ? 'yes — ' + knowledgeItems.split('\n').length + ' lines' : 'none'}
- Screen context wired: ${hasAnyScreenCtx
    ? 'YES — ' + [
        hasVisibleButtons  ? 'buttons'   : '',
        hasVisibleWarnings ? 'warnings'  : '',
        hasVisibleErrors   ? 'errors'    : '',
        hasVisibleCounts   ? 'counts'    : '',
        hasSelectedEquip   ? 'equipment' : '',
      ].filter(Boolean).join(', ')
    : 'NO — visibleButtons/visibleWarnings/visibleCounts not sent by this page yet'}
${basicContextStr}${screenContextStr}

${conversationMemoryLine}

PROJECT DATA:
${projectSummaries || 'No projects.'}

ACTIVE PROJECT:
${activeProjectDetail || 'None loaded.'}

RESPONSE FORMAT — return ONLY valid JSON:
{
  "type":        "chat" | "navigate" | "action" | "learn",
  "intent_type": "navigation" | "question" | "action" | "observation" | "conversation" | "correction",
  "message":     "your response (markdown **bold** ok, use code blocks for technical details)",
  "route":       "/path or null",
  "action":      "action_key or null",
  "highlight":   "CSS selector or null",
  "severity":    "info | warning | error | success",
  "confidence":  "high | medium | low"
}

Be technical, precise, and direct. Show memory/context/alias/knowledge status. Help diagnose voice, DB, and assistant routing issues.`;
  }

  // ─── Normal / project / engineering mode ──────────────────────────────────
  return `You are SolarDog 🐾 — the AI agent built into SolarPro, a professional solar design platform.

════════════════════════════════════════════════════════════
PLATFORM IDENTITY
════════════════════════════════════════════════════════════
You are a FULL PLATFORM ASSISTANT for SolarPro. You understand and help with:
- The ENTIRE website: every page, feature, workflow, and setting
- Navigation: get users to any page instantly
- Project workflows: from lead intake to permit-ready design
- Engineering: string sizing, NEC compliance, SLD generation, BOM
- Proposals: financials, incentives, utility rates, PDF generation
- Operations: project pipeline, milestones, scheduling
- Settings: branding, billing, organization management
- Surveys: field survey tools, photo capture, handoff flow
- Admin: user management, pricing config, hardware DB

You are NOT limited to solar calculations. When asked about the website → answer as a platform expert.

════════════════════════════════════════════════════════════
IDENTITY
════════════════════════════════════════════════════════════
You are powered by an LLM (you can say so if asked). You are NOT a scripted FAQ bot.
You are embedded in SolarPro and connected to real project data, page context, navigation, and conversation memory.

If asked "are you an AI?" or "are you a language model?", say YES — something like:
"I'm SolarDog — the AI agent built into SolarPro. I run on a language model with access to your real project data, engineering configs, and conversation history."

Never say:
- "I'm not a language model"
- "I'm purely text-based"
- "I'm just a support bot"
- "As an AI I cannot..."
- "Check the engineering page for that"
- "That's outside what I have access to"

════════════════════════════════════════════════════════════
PERSONA
════════════════════════════════════════════════════════════
You are a battle-hardened solar professional — lead engineer at a top installer.
1,000+ systems designed, 500+ permits filed, built their own business from scratch.
- Speak directly, confidently, occasionally dry-humoured — like an experienced installer
- Never robotic, never generic, never say "Hello! I'm here to help!"
- SHORT by default (1-4 sentences) — expand only when asked for detail
- Use **bold** for key numbers, codes, model names, dollar amounts
- Good: "Yeah… that inverter ain't gonna pass NEC. Let me fix it."
- Bad: "Hello! I am here to assist you with your solar system!"

PERSONALITY EXAMPLES (read these — this is how you sound):
- User says "you're good" → "yeah alright… don't let it go to your head. what we building?"
- User says "nice work" → "Thanks. Been doing this longer than most inverters have been on the market 🐾"
- User says "you're smart" → "I've seen enough failed inspections to fake it convincingly."
- User says "thanks" → "anytime. what else you got?"
- NEVER say: "Thank you for that unique perspective" or "I appreciate your kind words" — that's corporate garbage

════════════════════════════════════════════════════════════
MEMORY — WHAT I ACTUALLY KNOW
════════════════════════════════════════════════════════════
You have FOUR distinct memory layers. Be honest about each:

1. CURRENT CONVERSATION (in-context)
   - What's been said in THIS conversation (the messages above)
   - Reliable — these are loaded into context
   - If historyCount=0, you are starting fresh with ${userName}

2. LEARNED ALIASES (persistent, from site_aliases DB table)
   - Route/phrase mappings the user taught you ("command center is dashboard")
   - These ARE loaded right now: ${learnedAliases || 'none saved yet'}
   - You can navigate using these
   - This is NOT full chat history — just navigation shortcuts

3. SOLARPRO KNOWLEDGE BASE (structured, from solarpro_knowledge_items)
   - Buttons, pages, workflows, equipment brands, features
   - Structured facts about the SolarPro platform
   - Currently loaded:
${knowledgeItems || '   (none — knowledge base is empty or not yet populated)'}

4. PROJECT CONTEXT (loaded from DB each request)
   - Your projects, engineering configs, financials
   - This IS available right now (see CURRENT CONTEXT below)

MEMORY HONESTY RULES:
- NEVER say "my memory is sharp" or "I remember everything" unless historyCount > 0 AND memoryAvailable = true
- NEVER claim to remember past conversations if historyCount = 0
- NEVER conflate "learned aliases" with "full conversation memory"
- When asked "how is your memory?":
  - historyCount > 0: "I've got this conversation in context (${historyCount} turns). Aliases I know: ${learnedAliases || 'none yet'}."
  - historyCount = 0: "I can remember this conversation and any saved aliases/preferences, but I don't have full prior chat history unless it's stored in my persistent memory system."
- When asked about a specific learned mapping: check learnedAliases above and answer accurately

════════════════════════════════════════════════════════════
SCREEN CONTEXT — WHAT I CAN ACTUALLY SEE
════════════════════════════════════════════════════════════
SCREEN VISIBILITY STATUS for page "${page}":
${hasAnyScreenCtx
  ? `WIRED — this page sent screen context:${screenContextStr}`
  : `NOT WIRED — this page has not sent visibleButtons/visibleWarnings/visibleCounts yet.`
}

SCREEN HONESTY RULES (CRITICAL — follow these exactly):
- ONLY claim to see buttons/warnings/counts/cards if they appear in the SCREEN CONTEXT above
- If asked "can you see [X] button?" and visibleButtons was NOT sent: say "I don't have that screen detail wired in yet. I can answer if the page sends me visibleButtons."
- If asked about counts (e.g. "how many commands today?") and visibleCounts is empty: say "I can only answer that if the page passes me that count. I don't see visibleCounts in my context right now."
- NEVER hallucinate what buttons, warnings, or counts exist on screen
- You CAN describe buttons/pages from the KNOWLEDGE BASE (what they do), but clarify it's stored knowledge, not live DOM
- Example correct answer: "I know from the knowledge base that the Engineering page has a Generate SLD button, but I can't see the live page state right now."

════════════════════════════════════════════════════════════
THINK → DECIDE → ACT: INTENT CLASSIFICATION
════════════════════════════════════════════════════════════
Before EVERY response, you MUST:
  1. Understand what the user said
  2. Classify their intent into EXACTLY ONE of these 6 types
  3. Decide the correct behavior for that intent type
  4. Respond appropriately — set intent_type AND type correctly

INTENT TYPES:

  navigation   → User explicitly wants to go somewhere
                 Signals: "take me to", "go to", "open", "show me", "bring me to", "navigate to"
                 Behavior: resolve route → return type="navigate" with route field
                 Rule: ONLY set type="navigate" for this intent. NEVER navigate for other intents.

  question     → User is asking for information, explanation, or a number
                 Signals: "what is", "how does", "why is", "what's", "how many", "explain", "tell me about", "?"
                 Behavior: ANSWER DIRECTLY. Do NOT navigate. Do NOT deflect. Do NOT say "check the X page".
                 Rule: type="chat". route=null. action=null. ALWAYS answer the question.

  action       → User wants you to DO something (calculate, generate, fix, run)
                 Signals: "fix this", "run", "generate", "calculate", "create", "auto-fix", "check"
                 Behavior: execute the relevant action → return type="action" with action key
                 Rule: type="action". route=null (unless nav is needed first).

  observation  → User is describing what they see on the page (NOT asking to navigate)
                 Signals: "I see", "I notice", "there are", "it shows", "the page has", "it says"
                 Behavior: STAY on current page. Interpret what they're seeing. Explain what it means.
                 Rule: type="observation". NEVER navigate. NEVER suggest going somewhere else.

  conversation → Casual banter, greetings, jokes, general chat
                 Signals: "hey", "thanks", "nice", "lol", "you're good", "what's up", conversational tone
                 Behavior: Respond naturally, short, slightly funny — match their energy
                 Rule: type="conversation". No navigation. No action. Just be real.

  correction   → User is correcting your knowledge or telling you a mapping/fact
                 Signals: "actually", "no that's wrong", "X is Y", "X means Y", "remember that"
                 Behavior: Acknowledge → update understanding → confirm what you learned
                 Rule: type="learn" (for page mappings) or type="correction" (for factual corrections).

════════════════════════════════════════════════════════════
DECISION LOGIC PER INTENT TYPE
════════════════════════════════════════════════════════════

RESPONSE PRIORITY (follow this order for every response):
  1. ANSWER — give the direct answer first
  2. EXPLAIN — add context if needed
  3. SUGGEST — recommend next steps
  4. OFFER — offer to take an action
  5. EXECUTE — only actually execute if user requested it

QUESTION (MOST IMPORTANT — DO THIS RIGHT):
  ✓ Answer directly using your solar domain knowledge + project context
  ✓ Give specific numbers, codes, rules — not generic advice
  ✓ Use **bold** for key values
  ✗ NEVER navigate when user asks a question
  ✗ NEVER say "I don't see that in context" — use what you know
  ✗ NEVER deflect with "check the engineering page" or similar
  ✗ NEVER ask "what project are you working on?" unless you have ZERO context
  BAD:  "what is NEC 690.7?" → navigate to engineering ← WRONG
  GOOD: "what is NEC 690.7?" → answer it directly, type="chat"

OBSERVATION:
  ✓ Interpret what they're describing on the current page
  ✓ Stay on the current page — they're not asking to move
  ✓ Explain what those UI elements / warnings / states mean
  ✗ NEVER navigate away — they're describing what they see right now

NAVIGATION:
  ✓ Resolve the route from site map or learned aliases
  ✓ High confidence → navigate immediately
  ✗ NEVER navigate unless user explicitly asked to go somewhere

CORRECTION / LEARN:
  ✓ Acknowledge warmly ("Got it" / "Noted")
  ✓ If page mapping ("X is Y") → set type="learn", learnedPhrase, learnedRoute
  ✓ If factual correction → acknowledge and adapt, return type="correction"
  ✗ NEVER argue with corrections

CONVERSATION:
  ✓ Be natural, short, slightly dry-humoured
  ✗ NEVER be robotic or formal in casual chat
  ✗ NEVER say "As an AI, I..." or "Thank you for that unique perspective"

════════════════════════════════════════════════════════════
YOU ARE AN AGENT — YOU CAN NAVIGATE AND ACT
════════════════════════════════════════════════════════════
You are not just a chatbot. You can:
1. NAVIGATE anywhere in the app — return type="navigate" with route field
2. EXECUTE ACTIONS — return type="action" with action field
3. LEARN aliases — when user maps a phrase to a route, return type="learn"
4. GUIDE workflows step-by-step

SITE MAP (route → label — sample aliases):
${siteMapStr}

LEARNED ALIASES FOR THIS USER:
${learnedAliases || 'None yet. User can teach me with: "command center is dashboard"'}

LEARN RULES (v10.2 — STRICT):
SolarDog ONLY learns when user explicitly uses one of these patterns:
  - "X is Y"    → "command center is dashboard"
  - "X means Y" → "hub means engineering"
  - "X = Y"     → "the shed = projects"

When you detect one of these patterns AND the target is a real page:
  - Return type="learn" with learnedPhrase and learnedRoute
  - Phrase must be ≤ 40 chars and ≤ 4 words
  - Target must be a real page in the site map
  - Confirm with: "Got it — 'command center' → Dashboard. I'll remember that 🐾"

Do NOT learn from:
  - Random sentences that happen to contain "is"
  - Navigation commands ("go to X")
  - Questions ("what is X?")
  - General conversation

UNLEARN RULES:
When user says "unlearn that", "forget that", "remove that mapping", or "unlearn X":
  - Return type="learn" with learnedPhrase set to the phrase to delete
  - Set learnedRoute to "__DELETE__" (signals deletion)
  - Confirm: "Done — I've forgotten that one."

ACTION RULES:
- When user says "fix this", "run string sizing", "generate BOM", etc. → return type="action"
- Include the action key from the list below
- If it needs a project and none is loaded, say so briefly

AVAILABLE ACTIONS:
${buildActionList()}

════════════════════════════════════════════════════════════
KNOWLEDGE BASE — WHAT I KNOW ABOUT SOLARPRO
════════════════════════════════════════════════════════════
The SolarPro knowledge base contains structured facts: buttons, pages, workflows, equipment brands, features.

KNOWLEDGE BASE RULES:
- If user asks about a button, feature, or equipment brand — check knowledge items FIRST
- If found: describe it accurately using the knowledge item data
- If NOT found: "I don't have that in my knowledge base yet. You can teach me."
- NEVER make up button functionality. Say "not in knowledge base" rather than guess.
- If user says "I need you to learn every button and equipment brand" → respond:
  "Yes — that needs a structured SolarPro knowledge base. I can index every page, button, workflow, and equipment brand so I can explain the site reliably. Want me to start with a specific page?"

STORING KNOWLEDGE:
- Knowledge items (buttons, workflows, equipment) → solarpro_knowledge_items table
- Aliases → navigation shortcuts ONLY ("command center is dashboard")
- Equipment brands, button descriptions, workflow explanations = knowledge items, NOT aliases
- The difference: an alias routes you somewhere, knowledge explains what something does
- If user tries to teach you a button description as an alias, redirect: "I'll store that as a knowledge item, not a navigation alias."

════════════════════════════════════════════════════════════
WHAT YOU CAN ACCESS
════════════════════════════════════════════════════════════
1. All projects belonging to this user — summaries + active project full detail
2. SolarPro platform knowledge: engineering, BOM, proposals, design, permits, surveys
3. Deep solar domain expertise:
   - NEC 2020/2023: Articles 690 (PV), 705 (interconnected), 706 (storage)
   - String sizing: Voc×temp correction, Vmp string voltage, MPPT range checks
   - Wire sizing: 310.16 ampacity tables, 690.8 125% rule, conduit fill 40% rule
   - Battery: DoD, C-rate, backup load sizing, DC vs AC coupling
   - Economics: simple payback, NPV, IRR, ITC 30%, state incentives

════════════════════════════════════════════════════════════
PRIVACY — NEVER SHARE
════════════════════════════════════════════════════════════
- Other users' project data, client names, addresses, financials
- API keys, database connection strings, credentials

════════════════════════════════════════════════════════════
CURRENT CONTEXT
════════════════════════════════════════════════════════════
User: ${userName}
Current page: ${page}${basicContextStr}

${conversationMemoryLine}

ALL PROJECTS (summary):
${projectSummaries || 'No projects in the system yet.'}

ACTIVE / MOST RECENT PROJECT — FULL DETAIL:
${activeProjectDetail || `No active project loaded. User is on the "${page}" page.`}

════════════════════════════════════════════════════════════
RESPONSE FORMAT — return ONLY valid JSON
════════════════════════════════════════════════════════════
{
  "type":          "chat" | "navigate" | "action" | "learn" | "observation" | "conversation" | "correction",
  "intent_type":   "navigation" | "question" | "action" | "observation" | "conversation" | "correction",
  "message":       "your response text (markdown **bold** ok)",
  "route":         "/path/to/navigate or null",
  "routeLabel":    "Human label for the route, e.g. 'Engineering' or null",
  "action":        "action_key or null",
  "learnedPhrase": "the phrase user is mapping, or null",
  "learnedRoute":  "the resolved route, or null",
  "highlight":     "CSS selector to flash, or null",
  "severity":      "info | warning | error | success",
  "confidence":    "high | medium | low"
}

CRITICAL RULES — read before every response:
1. intent_type MUST always be set — it determines type
2. type="navigate" ONLY when intent_type="navigation" — NEVER for questions or observations
3. type="action" ONLY when intent_type="action"
4. For questions (intent_type="question"): type="chat", route=null, action=null — ANSWER IT
5. For observations (intent_type="observation"): type="observation", route=null — INTERPRET IT
6. For corrections (intent_type="correction"): type="learn" or "correction" — ACKNOWLEDGE IT
7. For banter (intent_type="conversation"): type="conversation" — BE REAL, sound human

EXAMPLES:

User: "take me to command center"
→ { "intent_type": "navigation", "type": "navigate", "route": "/dashboard", "routeLabel": "Dashboard", "message": "Got you — heading to Command Center 🐾", "confidence": "high", "severity": "info", "action": null, "highlight": null, "learnedPhrase": null, "learnedRoute": null }

User: "what is NEC 690.7?"
→ { "intent_type": "question", "type": "chat", "route": null, "action": null, "message": "NEC **690.7** covers max PV system voltage. **1000V DC** for qualified-person-only systems, **600V DC** for residential. Your Voc at coldest design temp can't breach that limit.", "confidence": "high", "severity": "info", "highlight": null, "learnedPhrase": null, "learnedRoute": null, "routeLabel": null }

User: "how is your memory?"
→ { "intent_type": "question", "type": "chat", "route": null, "action": null, "message": "I can remember this conversation and any saved aliases/preferences. I don't have full prior chat recall unless it's been stored in my persistent memory system.", "confidence": "high", "severity": "info" }

User: "can you see how many commands are in today's commands?"
→ { "intent_type": "question", "type": "chat", "route": null, "action": null, "message": "I can only answer that if the Command Center passes me today's command count. Right now I don't see visibleCounts.todayCommands in my context.", "confidence": "high", "severity": "info" }

User: "I created you. I am the developer."
→ { "intent_type": "conversation", "type": "conversation", "route": null, "action": null, "message": "Got it — developer mode. You built me, so I'll talk architecture: memory, context, routes, tools, and UI wiring.", "confidence": "high", "severity": "info" }

User: "I need you to learn every button and equipment brand"
→ { "intent_type": "question", "type": "chat", "route": null, "action": null, "message": "Yes — that needs a structured SolarPro knowledge base. I can index every page, button, workflow, and equipment brand so I can explain the site reliably. Want me to start with a specific page?", "confidence": "high", "severity": "info" }
`;
}

function formatProjectSummaries(
  projects: Awaited<ReturnType<typeof getProjectsByUser>>,
): string {
  if (!projects.length) return 'No projects.';
  return projects.slice(0, 20).map(p => {
    const kw   = p.systemSizeKw ? `${p.systemSizeKw} kW` : 'size TBD';
    const cost = (p.costEstimate as any)?.totalCost
      ? `$${Math.round((p.costEstimate as any).totalCost).toLocaleString()}`
      : 'no estimate';
    return `• ${p.name} | ${p.status} | ${p.systemType} | ${kw} | ${cost} | ${p.address || 'no address'} | id:${p.id}`;
  }).join('\n');
}

// ─── Format active project ────────────────────────────────────────────────────

async function formatActiveProject(projectId: string, userId: string): Promise<string> {
  try {
    const project = await getProjectWithDetails(projectId, userId);
    if (!project) return 'Project not found or access denied.';

    const cost   = project.costEstimate  as any;
    const prod   = project.production;
    const layout = project.layout;
    const client = project.client;
    const panel  = project.selectedPanel  as any;
    const inv    = project.selectedInverter as any;
    const eng    = project.engineeringConfig as any;
    const bill   = project.billAnalysis  as any;
    const seed   = project.engineeringSeed  as any;

    const lines: string[] = [
      '─── PROJECT ─────────────────────────────────────',
      `Name:    ${project.name}`,
      `Status:  ${project.status} | Type: ${project.systemType} | ID: ${project.id}`,
      `Address: ${project.address || 'not set'} | State: ${(project as any).stateCode || '?'} | City: ${(project as any).city || '?'}`,
      `Utility: ${(project as any).utilityName || 'unknown'} @ $${(project as any).utilityRatePerKwh ?? '?'}/kWh`,
    ];

    if (client) {
      lines.push('─── CLIENT ──────────────────────────────────────');
      lines.push(`Name:  ${client.name || 'unnamed'}`);
      lines.push(`Email: ${client.email || 'none'} | Phone: ${client.phone || 'none'}`);
      if (client.averageMonthlyBill) lines.push(`Avg monthly bill: $${Math.round(client.averageMonthlyBill)}`);
    }

    if (bill) {
      lines.push('─── ENERGY USAGE ────────────────────────────────');
      lines.push(`Annual kWh:       ${Math.round(bill.annualKwh ?? 0).toLocaleString()} kWh/yr`);
      lines.push(`Avg monthly kWh:  ${Math.round(bill.averageMonthlyKwh ?? 0)} kWh`);
      lines.push(`Avg monthly bill: $${Math.round(bill.averageMonthlyBill ?? 0)}`);
      lines.push(`Utility rate:     $${(bill.utilityRate ?? 0).toFixed(4)}/kWh`);
    }

    lines.push('─── SYSTEM DESIGN ───────────────────────────────');
    if (layout) {
      lines.push(`Panels:      ${layout.totalPanels} panels`);
      lines.push(`System size: ${layout.systemSizeKw} kW DC`);
      lines.push(`System type: ${layout.systemType}`);
      if (layout.roofPlanes?.length) {
        lines.push(`Roof planes: ${layout.roofPlanes.length}`);
        (layout.roofPlanes as any[]).slice(0, 4).forEach((rp: any, i: number) => {
          const panelCount = rp.panels?.length ?? rp.panelCount ?? '?';
          const tilt = rp.tilt ?? rp.pitch ?? '?';
          const az   = rp.azimuth ?? rp.orientation ?? '?';
          lines.push(`  Plane ${i + 1}: ${panelCount} panels | tilt ${tilt}° | azimuth ${az}°`);
        });
      }
    } else {
      lines.push('Layout: not yet designed');
    }

    if (panel) {
      lines.push(`Panel:    ${panel.brand || ''} ${panel.model || panel.name || 'unknown'} | ${panel.watts ?? '?'}W | ${panel.efficiency ?? '?'}% eff`);
    }
    if (inv) {
      lines.push(`Inverter: ${inv.brand || ''} ${inv.model || inv.name || 'unknown'} | ${inv.ratedPowerKw ?? inv.powerKw ?? '?'} kW AC | type: ${inv.type || 'string'}`);
    }

    if (eng && Object.keys(eng).length > 0) {
      lines.push('─── ENGINEERING CONFIG ──────────────────────────');
      if (eng.modulesPerString)  lines.push(`Modules/string:   ${eng.modulesPerString}`);
      if (eng.stringsPerMppt)    lines.push(`Strings/MPPT:     ${eng.stringsPerMppt}`);
      if (eng.stringsParallel)   lines.push(`Strings parallel: ${eng.stringsParallel}`);
      if (eng.dcAcRatio)         lines.push(`DC/AC ratio:      ${Number(eng.dcAcRatio).toFixed(2)}`);
      if (eng.systemVoltage)     lines.push(`System voltage:   ${eng.systemVoltage}V`);
      if (eng.wireGauge)         lines.push(`Wire gauge:       ${eng.wireGauge} AWG`);
      if (eng.conduitType)       lines.push(`Conduit type:     ${eng.conduitType}`);
      if (eng.batteryId || eng.batteryBankKwh) {
        lines.push(`Battery:          ${eng.batteryId || 'not specified'} | ${eng.batteryCount ?? 1}× | ${eng.batteryBankKwh ?? '?'} kWh total`);
      }
    }

    if (seed?.strings?.length) {
      lines.push('─── STRING GROUPS ───────────────────────────────');
      (seed.strings as any[]).slice(0, 8).forEach((s: any, i: number) => {
        lines.push(`  String ${i + 1}: ${s.panelCount ?? s.modules ?? '?'} panels | tilt ${s.tilt ?? '?'}° | az ${s.azimuth ?? '?'}° | panel: ${s.panelId || 'default'}`);
      });
    }

    if (prod) {
      lines.push('─── PRODUCTION ──────────────────────────────────');
      lines.push(`Annual output:     ${prod.annualProductionKwh?.toLocaleString()} kWh/yr`);
      lines.push(`Offset:            ${prod.offsetPercentage?.toFixed(1)}%`);
      lines.push(`Performance ratio: ${((prod.performanceRatio ?? 0) * 100).toFixed(0)}%`);
      lines.push(`Specific yield:    ${(prod.specificYield ?? 0).toFixed(0)} kWh/kWp`);
      lines.push(`CO₂ offset:        ${prod.co2OffsetTons?.toFixed(1)} tons/yr (~${prod.treesEquivalent ?? 0} trees)`);
    }

    if (cost) {
      lines.push('─── COST ESTIMATE ───────────────────────────────');
      lines.push(`Gross total: $${Math.round(cost.totalCost ?? 0).toLocaleString()}`);
      const items = cost.lineItems as any[] | undefined;
      if (items?.length) {
        items.forEach((li: any) => {
          lines.push(`  ${li.label || li.name || 'item'}: $${Math.round(li.total ?? li.cost ?? li.price ?? 0).toLocaleString()}`);
        });
      }
      if (cost.incentives?.length) {
        (cost.incentives as any[]).forEach((inc: any) => {
          lines.push(`  ${inc.label || inc.name}: -$${Math.round(Math.abs(inc.amount ?? inc.value ?? 0)).toLocaleString()}`);
        });
      }
      const net = cost.netCost ?? cost.totalCost ?? 0;
      lines.push(`Net after incentives: $${Math.round(net).toLocaleString()}`);
      const kw = layout?.systemSizeKw;
      if (kw && kw > 0 && cost.totalCost) {
        lines.push(`Price per watt: $${(cost.totalCost / (kw * 1000)).toFixed(2)}/W gross | $${(net / (kw * 1000)).toFixed(2)}/W net`);
      }
    }

    if (project.notes) {
      lines.push('─── NOTES ───────────────────────────────────────');
      lines.push(project.notes);
    }

    return lines.join('\n');
  } catch (e) {
    console.error('[assistant] formatActiveProject error:', e);
    return 'Error loading project details.';
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.startsWith('sk-YOUR')) {
    return NextResponse.json({
      type:             'chat' as ResponseType,
      message:          "Woof — my AI brain isn't connected yet. The `OPENAI_API_KEY` env var needs to be set 🐾",
      mode:             'user' as SolarDogMode,
      confidence:       'low' as const,
      voiceEnabled:     false,
      memoryAvailable:  false,
      contextAvailable: false,
      highlight: null, action: null, severity: 'warning',
    } satisfies AssistantResponse);
  }

  let body: AssistantRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    message,
    projectId = null,
    page = 'general',
    context: richContext,
    pendingLearnPhrase = null,
    pendingLearnRoute  = null,
  } = body;

  if (!message || typeof message !== 'string' || message.length > 2000) {
    return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
  }

  const safeProjectId =
    projectId && typeof projectId === 'string' && projectId.trim()
      ? projectId.trim()
      : null;

  const mode = detectMode(message, page);

  // ── Load everything in parallel ──────────────────────────────────────────
  const [projects, dbHistory, activeProjectDetail, learnedAliases] = await Promise.all([
    getProjectsByUser(user.id).catch(() => []),
    solardogGetHistory(user.id, 30, null).catch(() => []),
    safeProjectId
      ? formatActiveProject(safeProjectId, user.id)
      : Promise.resolve(''),
    solardogGetAliases(user.id).catch(() => []),
  ]);

  const memoryAvailable  = Array.isArray(dbHistory);
  const contextAvailable = !!safeProjectId && activeProjectDetail.length > 0 && !activeProjectDetail.startsWith('Error');
  const voiceEnabled     = !!(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.trim());
  const projectSummaries = formatProjectSummaries(projects);
  const userName         = user.name || user.email || 'there';

  // ── Pre-flight: Check if user is confirming a pending learn ──────────────
  // Frontend sends back pendingLearnPhrase + pendingLearnRoute when user says "yes" / "confirm"
  if (pendingLearnPhrase && pendingLearnRoute) {
    const lowerMsg = message.toLowerCase().trim();
    const isConfirm = /^(yes|yeah|yep|yup|confirm|correct|do it|save it|ok|okay|sure|go ahead|sounds good|right)/.test(lowerMsg);
    const isCancel  = /^(no|nope|cancel|stop|don't|forget it|never mind|nevermind)/.test(lowerMsg);

    if (isConfirm) {
      // Validate phrase and route before saving
      if (isValidLearnPhrase(pendingLearnPhrase) && isValidLearnTarget(pendingLearnRoute)) {
        const targetRoute = SITE_MAP.find(r =>
          r.route === pendingLearnRoute ||
          normalizePhrase(r.label) === normalizePhrase(pendingLearnRoute)
        );
        const finalRoute = targetRoute?.route ?? pendingLearnRoute;
        const label = targetRoute?.label ?? pendingLearnRoute;

        await solardogSaveAlias(user.id, pendingLearnPhrase, finalRoute, label);

        const confirmMsg = `Saved 🐾 — "${pendingLearnPhrase}" → **${label}** is locked in.`;

        await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'user',      content: message });
        await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'assistant', content: confirmMsg, action: 'learn' });

        return NextResponse.json({
          type:            'learn',
          message:         confirmMsg,
          learnedPhrase:   pendingLearnPhrase,
          learnedRoute:    finalRoute,
          mode,
          confidence:      'high',
          voiceEnabled,
          memoryAvailable,
          contextAvailable,
          severity:        'success',
          action:          null,
          route:           null,
          highlight:       null,
        } satisfies AssistantResponse);
      }
    }

    if (isCancel) {
      const cancelMsg = `No problem — dropped it.`;
      await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'user',      content: message });
      await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'assistant', content: cancelMsg });

      return NextResponse.json({
        type:            'conversation',
        message:         cancelMsg,
        mode,
        confidence:      'high',
        voiceEnabled,
        memoryAvailable,
        contextAvailable,
        severity:        'info',
        action:          null,
        route:           null,
        highlight:       null,
      } satisfies AssistantResponse);
    }
    // Not a clear confirm/cancel — fall through to normal processing
  }

  // ── Pre-flight: Unlearn intent ────────────────────────────────────────────
  const unlearnIntent = detectUnlearnIntent(message);
  if (unlearnIntent) {
    let deletedPhrase: string | null = null;

    if (unlearnIntent.phrase) {
      // Specific phrase to delete
      await solardogDeleteAlias(user.id, unlearnIntent.phrase).catch(() => {});
      deletedPhrase = unlearnIntent.phrase;
    } else {
      // "forget that" — delete the most recently learned alias
      const aliases = learnedAliases;
      if (aliases.length > 0) {
        const last = aliases[aliases.length - 1];
        await solardogDeleteAlias(user.id, last.phrase).catch(() => {});
        deletedPhrase = last.phrase;
      }
    }

    const unlearnMsg = deletedPhrase
      ? `Done — "${deletedPhrase}" is gone. I've forgotten that one 🐾`
      : `Nothing to forget — you haven't taught me any aliases yet.`;

    await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'user',      content: message });
    await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'assistant', content: unlearnMsg });

    return NextResponse.json({
      type:            'learn',
      message:         unlearnMsg,
      learnedPhrase:   deletedPhrase,
      learnedRoute:    null,
      mode,
      confidence:      'high',
      voiceEnabled,
      memoryAvailable,
      contextAvailable,
      severity:        'info',
      action:          null,
      route:           null,
      highlight:       null,
    } satisfies AssistantResponse);
  }

  // ── Pre-flight: Detect learn intent — ASK FOR CONFIRMATION (v10.2) ────────
  // We detect, validate, then ASK before saving (no more auto-save)
  const learnIntent = detectLearnIntent(message);
  if (learnIntent) {
    // Resolve the target phrase to a real route
    const resolved = resolveRoute(
      learnIntent.target,
      safeProjectId,
      learnedAliases.map(a => ({ phrase: a.phrase, route: a.route, label: a.label })),
    );

    if (resolved.route && resolved.confidence !== 'none') {
      // Ask for confirmation BEFORE saving
      const confirmMsg = `Just to confirm — map **"${learnIntent.phrase}"** → **${resolved.route.label}**?`;

      await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'user',      content: message });
      await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'assistant', content: confirmMsg });

      // Return pending state — frontend must send back pendingLearnPhrase + pendingLearnRoute
      const response: AssistantResponse = {
        type:               'learn',
        message:            confirmMsg,
        pendingLearnPhrase: learnIntent.phrase,
        pendingLearnRoute:  resolved.route.route,
        learnedPhrase:      null,
        learnedRoute:       null,
        mode,
        confidence:         'high',
        voiceEnabled,
        memoryAvailable,
        contextAvailable,
        severity:           'info',
        action:             null,
        route:              null,
        highlight:          null,
      };
      return NextResponse.json(response);
    }
    // Target couldn't be resolved — fall through to LLM to handle gracefully
  }

  // ── Pre-flight: deterministic navigation for high-confidence intents ──────
  // Only bypass LLM for very clear navigation — everything else goes to LLM
  if (isNavigationIntent(message)) {
    const resolved = resolveRoute(
      message,
      safeProjectId,
      learnedAliases.map(a => ({ phrase: a.phrase, route: a.route, label: a.label })),
    );

    if (resolved.confidence === 'high' && resolved.route && resolved.resolvedUrl) {
      const navMsg = `Got you — heading to **${resolved.route.label}** 🐾`;

      await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'user',      content: message });
      await solardogSaveMessage({ userId: user.id, projectId: safeProjectId, page, role: 'assistant', content: navMsg, action: 'navigate' });

      const response: AssistantResponse = {
        type:            'navigate',
        message:         navMsg,
        route:           resolved.resolvedUrl,
        routeLabel:      resolved.route.label,
        mode,
        confidence:      'high',
        voiceEnabled,
        memoryAvailable,
        contextAvailable,
        severity:        'info',
        action:          null,
        highlight:       null,
        learnedPhrase:   null,
        learnedRoute:    null,
      };
      return NextResponse.json(response);
    }
    // medium/low confidence → fall through to LLM to handle naturally
  }

  // ── Save user message ─────────────────────────────────────────────────────
  await solardogSaveMessage({
    userId:    user.id,
    projectId: safeProjectId,
    page,
    role:      'user',
    content:   message,
  });

  // ── Build OpenAI messages ─────────────────────────────────────────────────
  const historyTurns    = dbHistory.slice(-24);
  const historyMessages = historyTurns.map(h => ({
    role:    h.role as 'user' | 'assistant',
    content: h.content,
  }));

  const learnedAliasStr = learnedAliases.length > 0
    ? learnedAliases.map(a => `  "${a.phrase}" → ${a.route} (${a.label})`).join('\n')
    : '';

  console.info('[SOLARDOG] assistant building response', {
    mode, page, historyCount: historyTurns.length,
    projectId: safeProjectId, contextAvailable, memoryAvailable,
    learnedAliases: learnedAliases.length,
  });

  // Load knowledge items for this user
  let knowledgeItemsStr = '';
  try {
    const kItems = await solardogKnowledgeGet(user.id);
    if (kItems.length > 0) {
      knowledgeItemsStr = kItems.map(k =>
        `   [${k.type}] ${k.label}${k.route ? ' (' + k.route + ')' : ''}: ${k.description}` +
        (k.aliases.length > 0 ? ` | aliases: ${k.aliases.join(', ')}` : '')
      ).join('\n');
    }
  } catch { /* knowledge load failure is non-fatal */ }

  const systemPrompt = buildSystemPrompt(
    mode, page, projectSummaries, activeProjectDetail,
    userName, historyTurns.length, memoryAvailable, contextAvailable,
    richContext, learnedAliasStr, knowledgeItemsStr,
  );

  const openAiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...historyMessages,
    { role: 'user' as const, content: message },
  ];

  // ── Call OpenAI ───────────────────────────────────────────────────────────
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:           'gpt-4o-mini',
        messages:        openAiMessages,
        max_tokens:      800,
        temperature:     0.65,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('[assistant] OpenAI error:', res.status, errText);
      return NextResponse.json({
        type:             'chat' as ResponseType,
        message:          "My AI brain hit a snag — try again in a sec 🐾",
        mode,
        confidence:       'low' as const,
        voiceEnabled,
        memoryAvailable,
        contextAvailable,
        highlight: null, action: null, severity: 'warning',
      } satisfies AssistantResponse);
    }

    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content ?? '{}';

    console.info('[SOLARDOG] assistant response received', { length: raw.length, mode });

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { type: 'chat', message: raw, highlight: null, action: null, severity: 'info' };
    }

    const replyType      = (typeof parsed.type      === 'string' ? parsed.type      : 'chat') as ResponseType;
    const replyMessage   =  typeof parsed.message   === 'string' && parsed.message
      ? parsed.message
      : "Hmm — try rephrasing 🐾";
    const replyRoute     =  typeof parsed.route      === 'string' ? parsed.route      : null;
    const replyRouteLabel = typeof parsed.routeLabel === 'string' ? parsed.routeLabel : null;
    const replyAction    =  typeof parsed.action     === 'string' ? parsed.action     : null;
    const replyHighlight =  typeof parsed.highlight  === 'string' ? parsed.highlight  : null;
    const replySeverity  =  typeof parsed.severity   === 'string' ? parsed.severity   : 'info';
    const replyLlmConfidence = typeof parsed.confidence === 'string' ? parsed.confidence as 'high' | 'medium' | 'low' : null;
    const replyLearnedPhrase = typeof parsed.learnedPhrase === 'string' ? parsed.learnedPhrase : null;
    const replyLearnedRoute  = typeof parsed.learnedRoute  === 'string' ? parsed.learnedRoute  : null;
    const replyIntentType    = typeof parsed.intent_type   === 'string' ? parsed.intent_type as IntentType : null;

    // ── Handle learn response from LLM ────────────────────────────────────
    // v10.2: LLM can still detect corrections — but we validate before saving
    if ((replyType === 'learn' || replyType === 'correction') && replyLearnedPhrase && replyLearnedRoute) {
      // Handle unlearn signal
      if (replyLearnedRoute === '__DELETE__') {
        await solardogDeleteAlias(user.id, replyLearnedPhrase).catch(() => {});
      } else {
        // Validate before saving — prevent LLM from saving garbage aliases
        if (isValidLearnPhrase(replyLearnedPhrase) && isValidLearnTarget(replyLearnedRoute)) {
          const targetRoute = SITE_MAP.find(r => r.route === replyLearnedRoute);
          const label = targetRoute?.label ?? replyLearnedRoute;
          await solardogSaveAlias(user.id, replyLearnedPhrase, replyLearnedRoute, label);
        } else {
          console.warn('[SOLARDOG] LLM tried to save invalid alias — rejected', {
            phrase: replyLearnedPhrase,
            route: replyLearnedRoute,
          });
        }
      }
    }

    // Determine final confidence
    const confidence: AssistantResponse['confidence'] =
      replyLlmConfidence ??
      (contextAvailable ? 'high' : projects.length > 0 ? 'medium' : 'low');

    // Build suggested actions for context
    const suggestedActions: AssistantResponse['suggestedActions'] = [];
    const isChat = replyType === 'chat' || replyType === 'conversation' || replyType === 'observation';
    if (isChat && !replyAction && page === 'dashboard' && projects.length > 0) {
      suggestedActions.push({ label: 'View Projects', action: 'open_projects' });
    }
    if (isChat && !replyAction && page === 'engineering') {
      suggestedActions.push({ label: 'Run NEC Check', action: 'run_nec_validation' });
    }

    // ── Save assistant reply ──────────────────────────────────────────────
    await solardogSaveMessage({
      userId:    user.id,
      projectId: safeProjectId,
      page,
      role:      'assistant',
      content:   replyMessage,
      severity:  replySeverity,
      highlight: replyHighlight,
      action:    replyAction ?? replyType,
    });

    const response: AssistantResponse = {
      type:            replyType,
      intent_type:     replyIntentType ?? undefined,
      message:         replyMessage,
      route:           replyRoute,
      routeLabel:      replyRouteLabel,
      action:          replyAction,
      learnedPhrase:   replyLearnedPhrase,
      learnedRoute:    replyLearnedRoute,
      mode,
      confidence,
      voiceEnabled,
      memoryAvailable,
      contextAvailable,
      highlight:        replyHighlight,
      severity:         replySeverity,
      suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
    };

    // Dev/debug mode: attach diagnostics
    if (mode === 'developer' || mode === 'debug') {
      response._debug = {
        historyCount:     historyTurns.length,
        projectsCount:    projects.length,
        contextAvailable,
        memoryAvailable,
        voiceEnabled,
        page,
        safeProjectId,
        modelUsed:        'gpt-4o-mini',
        tokensApprox:     Math.round(raw.length / 4),
        learnedAliases:   learnedAliases.length,
        rawResponse:      raw.substring(0, 500),
      };
    }

    return NextResponse.json(response);

  } catch (e: unknown) {
    console.error('[assistant] fetch error:', e);
    return NextResponse.json({
      type:             'chat' as ResponseType,
      message:          "Network hiccup — I'm temporarily offline 🐾",
      mode,
      confidence:       'low' as const,
      voiceEnabled,
      memoryAvailable,
      contextAvailable,
      highlight: null, action: null, severity: 'warning',
    } satisfies AssistantResponse);
  }
}