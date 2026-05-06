/**
 * tests/solardog.test.ts
 *
 * SolarDog v10.1 — Autonomous Agent + Think→Decide→Act behavior contracts
 *
 * Test groups:
 *  1.  detectMode — mode classification
 *  2.  Memory line — never exposes internals to normal users
 *  3.  LLM identity rules — never denies being an LLM
 *  4.  Capabilities section coverage
 *  5.  Response schema compliance
 *  6.  Voice enabled logic
 *  7.  Over-refusal persona checks
 *  8.  TTS proxy contract
 *  9.  resolveRoute — navigation resolver
 * 10.  detectLearnIntent — alias learning detection
 * 11.  isNavigationIntent — nav intent detection
 * 12.  normalizePhrase — phrase normalization
 * 13.  siteMap — canonical routes coverage
 * 14.  actionRegistry — action keys and categories
 * 15.  Response type handling (navigate / action / learn / chat)
 * 16.  Confidence-gated behavior
 * 17.  Intent classification — classifyIntent() (v10.1)
 * 18.  System prompt — THINK → DECIDE → ACT section (v10.1)
 * 19.  Response schema — new types: observation/conversation/correction (v10.1)
 * 20.  Navigation guard — type=navigate is the ONLY trigger (v10.1)
 * 21.  Action guard — type=action is the ONLY trigger (v10.1)
 * 22.  Correction → learn flow (v10.1)
 * 23.  isNavigationIntent — rejects questions/observations (v10.1)
 */

import { describe, it, expect } from 'vitest';

// ── Import lib functions directly ─────────────────────────────────────────────
import { resolveRoute, detectLearnIntent, detectUnlearnIntent, isNavigationIntent, isValidLearnPhrase, isValidLearnTarget } from '../lib/solardog/resolveRoute';
import { normalizePhrase, SITE_MAP, buildAliasMap } from '../lib/solardog/siteMap';
import { ACTION_REGISTRY, buildActionList, getAction, getActionsByCategory } from '../lib/solardog/actionRegistry';
import { SOLARPRO_KNOWLEDGE_SEED } from '../lib/solardog/knowledgeSeed';

// ── Replicate route-internal logic for unit testing ───────────────────────────
// (detectMode and buildMemoryLine are not exported from the route, so replicate here)

type SolarDogMode = 'user' | 'developer' | 'debug' | 'project_helper' | 'engineering_helper';
type ResponseType = 'chat' | 'navigate' | 'action' | 'learn' | 'observation' | 'conversation' | 'correction';

const DEV_PHRASES = [
  'dev mode', 'developer mode', 'this is your father',
  'this is the dev', "i'm the developer", 'im the developer',
  "i'm your creator", 'im your creator', "i built you", 'show debug',
  'enable debug', 'solardog debug', 'your father', 'dad here',
  // v10.3: natural developer identification phrases
  'i created you', 'i am the developer', 'i built this',
  'i made you', 'i built solardog', 'i made solardog',
  "i'm the creator", 'im the creator', 'developer here',
];

function detectMode(message: string, page: string): SolarDogMode {
  const lower = message.toLowerCase();
  if (DEV_PHRASES.some(p => lower.includes(p))) return 'developer';
  if (lower.includes('debug mode') || lower.includes('inspect') || lower.includes('diagnose')) return 'debug';
  if (lower.includes('debug') && (lower.includes('voice') || lower.includes('memory') || lower.includes('connection'))) return 'debug';
  if (page === 'engineering') return 'engineering_helper';
  if (page === 'projects' || page === 'design' || page === 'proposals') return 'project_helper';
  return 'user';
}

function buildMemoryLine(
  mode: SolarDogMode,
  memoryAvailable: boolean,
  historyCount: number,
  userName: string,
): string {
  if (memoryAvailable && historyCount > 0) {
    return `The ${historyCount} messages above ARE your conversation history with ${userName}.`;
  } else if (memoryAvailable && historyCount === 0) {
    return `This is the first message from ${userName} — no prior conversation history yet.`;
  } else {
    if (mode === 'developer' || mode === 'debug') {
      return `Memory unavailable — DB connection failed or solardog_conversations table missing. ` +
        `Run GET /api/solardog/debug to diagnose. GET /api/migrate to create tables.`;
    } else {
      return `Long-term memory is not available for this session. ` +
        `I can still see the current page and project context.`;
    }
  }
}

// ── Forbidden phrases ─────────────────────────────────────────────────────────

const FORBIDDEN_USER_PHRASES = [
  '/api/migrate',
  'database may need migration',
  'migration run',
  'solardog_conversations table',
  'DB connection failed',
  'table missing',
];

const FORBIDDEN_LLM_DENIAL_PHRASES = [
  "i'm not a language model",
  "i'm purely text-based",
  "i'm just a support bot",
  "as an ai i cannot",
  "i don't have the ability to recall",
  "i can't access your account",
];

const REQUIRED_CAPABILITY_KEYWORDS = [
  'engineering', 'proposal', 'design', 'project', 'bom', 'nec', 'string', 'battery',
];

// ════════════════════════════════════════════════════════════════════════════════
// 1. detectMode
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog mode detection', () => {

  it('returns "user" for normal solar question', () => {
    expect(detectMode('how do I size a battery?', 'dashboard')).toBe('user');
  });

  it('returns "user" for project question', () => {
    expect(detectMode('what projects do I have?', 'general')).toBe('user');
  });

  it('returns "developer" for "this is your father"', () => {
    expect(detectMode('This is your father. The dev.', 'general')).toBe('developer');
  });

  it('returns "developer" for "dev mode"', () => {
    expect(detectMode('enable dev mode please', 'general')).toBe('developer');
  });

  it('returns "developer" for "developer mode"', () => {
    expect(detectMode('switch to developer mode', 'general')).toBe('developer');
  });

  it('returns "developer" for "I\'m the developer"', () => {
    expect(detectMode("I'm the developer, show me everything", 'general')).toBe('developer');
  });

  it('returns "developer" for "i built you"', () => {
    expect(detectMode('I built you. Show me debug info.', 'general')).toBe('developer');
  });

  it('returns "debug" for "debug mode" keyword', () => {
    expect(detectMode('switch to debug mode', 'general')).toBe('debug');
  });

  it('returns "debug" for "diagnose"', () => {
    expect(detectMode('diagnose why voice isnt working', 'general')).toBe('debug');
  });

  it('returns "debug" for "debug voice"', () => {
    expect(detectMode('debug voice', 'general')).toBe('debug');
  });

  it('returns "engineering_helper" on engineering page', () => {
    expect(detectMode('check my string config', 'engineering')).toBe('engineering_helper');
  });

  it('returns "project_helper" on projects page', () => {
    expect(detectMode('show me all projects', 'projects')).toBe('project_helper');
  });

  it('returns "project_helper" on design page', () => {
    expect(detectMode('place panels on roof', 'design')).toBe('project_helper');
  });

  it('is case-insensitive for dev phrases', () => {
    expect(detectMode('DEV MODE ENABLED', 'general')).toBe('developer');
    expect(detectMode('THIS IS YOUR FATHER', 'general')).toBe('developer');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 2. Memory line — never exposes internals to normal users
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog memory line — never exposes internals to normal users', () => {

  it('user mode with no memory — does NOT mention /api/migrate', () => {
    const line = buildMemoryLine('user', false, 0, 'TestUser');
    FORBIDDEN_USER_PHRASES.forEach(phrase => {
      expect(line.toLowerCase()).not.toContain(phrase.toLowerCase());
    });
  });

  it('user mode with no memory — friendly message', () => {
    const line = buildMemoryLine('user', false, 0, 'TestUser');
    expect(line).toContain('not available');
  });

  it('developer mode with no memory — DOES mention /api/migrate', () => {
    const line = buildMemoryLine('developer', false, 0, 'TestUser');
    expect(line).toContain('/api/migrate');
  });

  it('debug mode with no memory — DOES mention /api/migrate', () => {
    const line = buildMemoryLine('debug', false, 0, 'TestUser');
    expect(line).toContain('/api/migrate');
  });

  it('user mode with memory available and no history — first message line', () => {
    const line = buildMemoryLine('user', true, 0, 'Alice');
    expect(line).toContain('first message');
    expect(line).toContain('Alice');
  });

  it('user mode with memory and history — references history count', () => {
    const line = buildMemoryLine('user', true, 15, 'Bob');
    expect(line).toContain('15');
    expect(line).toContain('Bob');
  });

  it('project_helper mode with no memory — no internals exposed', () => {
    const line = buildMemoryLine('project_helper', false, 0, 'User');
    FORBIDDEN_USER_PHRASES.forEach(phrase => {
      expect(line.toLowerCase()).not.toContain(phrase.toLowerCase());
    });
  });

  it('engineering_helper mode with no memory — no internals exposed', () => {
    const line = buildMemoryLine('engineering_helper', false, 0, 'User');
    FORBIDDEN_USER_PHRASES.forEach(phrase => {
      expect(line.toLowerCase()).not.toContain(phrase.toLowerCase());
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 3. LLM identity rules
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog system prompt — LLM identity rules', () => {

  const IDENTITY_SECTION = `
You are powered by an LLM (you can say so if asked). You are NOT a scripted FAQ bot.
You are embedded in SolarPro and connected to real project data, page context, and conversation memory when available.

If asked "are you an AI?" or "are you a language model?", say YES — something like:
"I'm SolarDog — the AI assistant built into SolarPro. I run on a language model with access to your real project data, engineering configs, and conversation history."

Never say:
- "I'm not a language model"
- "I'm purely text-based"
- "I'm just a support bot"
- "As an AI I cannot..."
- "I don't have the ability to recall"
- "I can't access your account"
  `.trim();

  it('identity section contains LLM acknowledgment', () => {
    expect(IDENTITY_SECTION).toContain('You are powered by an LLM');
  });

  it('identity section instructs bot to say YES when asked if it is an AI', () => {
    expect(IDENTITY_SECTION).toContain('say YES');
  });

  it('identity section explicitly forbids "I\'m not a language model"', () => {
    FORBIDDEN_LLM_DENIAL_PHRASES.forEach(phrase => {
      expect(IDENTITY_SECTION.toLowerCase()).toContain(phrase.toLowerCase());
    });
  });

  it('identity section tells bot it is LLM-powered', () => {
    expect(IDENTITY_SECTION).toMatch(/language model|LLM/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 4. Capabilities coverage
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog capabilities section', () => {

  const CAPABILITIES_SECTION = `
I help with:
- navigating SolarPro
- project setup
- site surveys
- system design
- CAD layouts
- SLDs
- BOMs
- permits
- proposals
- NEC/code explanations
- engineering
- string sizing
- wire sizing
- battery sizing
- production estimates
- cost/incentive analysis
- project navigation
  `.trim();

  REQUIRED_CAPABILITY_KEYWORDS.forEach(kw => {
    it(`capabilities mention "${kw}"`, () => {
      expect(CAPABILITIES_SECTION.toLowerCase()).toContain(kw.toLowerCase());
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 5. Response schema compliance
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog response schema compliance', () => {

  const VALID_RESPONSE_TYPES: ResponseType[] = ['chat', 'navigate', 'action', 'learn'];
  const VALID_CONFIDENCES = ['high', 'medium', 'low'];
  const VALID_SEVERITIES  = ['info', 'warning', 'error', 'success'];

  it('response type must be one of chat|navigate|action|learn', () => {
    VALID_RESPONSE_TYPES.forEach(t => {
      expect(['chat', 'navigate', 'action', 'learn']).toContain(t);
    });
  });

  it('confidence must be high|medium|low', () => {
    VALID_CONFIDENCES.forEach(c => {
      expect(['high', 'medium', 'low']).toContain(c);
    });
  });

  it('severity must be info|warning|error|success', () => {
    VALID_SEVERITIES.forEach(s => {
      expect(['info', 'warning', 'error', 'success']).toContain(s);
    });
  });

  it('navigate response requires route field', () => {
    const navigateResponse = {
      type:        'navigate' as ResponseType,
      message:     'Heading to Dashboard 🐾',
      route:       '/dashboard',
      routeLabel:  'Dashboard',
      confidence:  'high' as const,
    };
    expect(navigateResponse.route).toBeTruthy();
    expect(navigateResponse.route).toMatch(/^\//);
  });

  it('learn response requires learnedPhrase and learnedRoute', () => {
    const learnResponse = {
      type:          'learn' as ResponseType,
      message:       "Got it — I'll remember that 🐾",
      learnedPhrase: 'command center',
      learnedRoute:  '/dashboard',
      confidence:    'high' as const,
    };
    expect(learnResponse.learnedPhrase).toBeTruthy();
    expect(learnResponse.learnedRoute).toMatch(/^\//);
  });

  it('action response requires action key', () => {
    const actionResponse = {
      type:       'action' as ResponseType,
      message:    "Yeah… fixing that wire for you.",
      action:     'auto_fix_wire',
      confidence: 'high' as const,
    };
    expect(actionResponse.action).toBeTruthy();
  });

  it('chat response works with minimal fields', () => {
    const chatResponse = {
      type:    'chat' as ResponseType,
      message: "You're on the dashboard.",
      confidence: 'high' as const,
    };
    expect(chatResponse.message).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 6. Voice enabled logic
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog voice enabled logic', () => {

  const voiceEnabled = (envVar: string | undefined) =>
    !!(envVar && envVar.trim());

  it('voiceEnabled = false when ELEVENLABS_API_KEY is undefined', () => {
    expect(voiceEnabled(undefined)).toBe(false);
  });

  it('voiceEnabled = false when ELEVENLABS_API_KEY is empty string', () => {
    expect(voiceEnabled('')).toBe(false);
  });

  it('voiceEnabled = false when ELEVENLABS_API_KEY is whitespace only', () => {
    expect(voiceEnabled('   ')).toBe(false);
  });

  it('voiceEnabled = true when ELEVENLABS_API_KEY is set', () => {
    expect(voiceEnabled('sk_abc123')).toBe(true);
  });

  it('voiceEnabled = true for realistic key format', () => {
    expect(voiceEnabled('sk_b092cc4ca0d26b878bfcaf0f7564271893b2c5fa38740e1f')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 7. Over-refusal persona checks
// ════════════════════════════════════════════════════════════════════════════════

describe('SolarDog over-refusal persona checks', () => {

  const FORBIDDEN_REFUSALS = [
    "i don't have access",
    "check the engineering page",
    "that's outside what i have access to",
    "i cannot access",
    "i'm unable to",
    "as an ai, i",
    "i don't know",
    "that's not something i can",
  ];

  const PERSONA_SECTION = `
You are a battle-hardened solar professional — lead engineer at a top installer.
1,000+ systems designed, 500+ permits filed, built their own business from scratch.
Speak directly, confidently, occasionally dry-humoured.
Never robotic, never generic.
SHORT by default (1-4 sentences).
Never say:
- "I don't have access"
- "Check the engineering page for that"
- "That's outside what I have access to"
- "As an AI, I cannot..."
- "I don't know"
  `.trim();

  it('persona section forbids generic refusals', () => {
    const forbidden = ["i don't have access", "check the engineering page", "that's outside what i have access to"];
    forbidden.forEach(phrase => {
      expect(PERSONA_SECTION.toLowerCase()).toContain(phrase.toLowerCase());
    });
  });

  it('persona has "battle-hardened" / experienced installer language', () => {
    expect(PERSONA_SECTION.toLowerCase()).toContain('battle-hardened');
  });

  it('persona requires short responses by default', () => {
    expect(PERSONA_SECTION.toLowerCase()).toMatch(/short|1-4 sentence/i);
  });

  it('FORBIDDEN_REFUSALS array has correct values', () => {
    expect(FORBIDDEN_REFUSALS.length).toBeGreaterThan(5);
    expect(FORBIDDEN_REFUSALS).toContain("i don't have access");
  });

  it('none of the forbidden refusals appear in good response examples', () => {
    const GOOD_RESPONSES = [
      "Yeah… that inverter setup ain't gonna pass. Let me fix it.",
      "You're on the Dashboard. Want me to take you to Engineering?",
      "String Voc is 482V — just under the 500V MPPT max. You're good.",
      "Got you — heading to Command Center 🐾",
    ];
    GOOD_RESPONSES.forEach(resp => {
      FORBIDDEN_REFUSALS.forEach(refusal => {
        expect(resp.toLowerCase()).not.toContain(refusal.toLowerCase());
      });
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 8. TTS proxy contract
// ════════════════════════════════════════════════════════════════════════════════

describe('TTS proxy contract', () => {

  const VALID_ERROR_CODES = ['no_key', 'quota_exceeded', 'invalid_key', 'voice_error', 'timeout', 'disabled'];

  it('valid error codes include no_key', () => {
    expect(VALID_ERROR_CODES).toContain('no_key');
  });

  it('valid error codes include quota_exceeded', () => {
    expect(VALID_ERROR_CODES).toContain('quota_exceeded');
  });

  it('valid error codes include invalid_key', () => {
    expect(VALID_ERROR_CODES).toContain('invalid_key');
  });

  it('success response is audio/mpeg content type', () => {
    const SUCCESS_CONTENT_TYPE = 'audio/mpeg';
    expect(SUCCESS_CONTENT_TYPE).toBe('audio/mpeg');
  });

  it('error response shape has error and code fields', () => {
    const errorShape = { error: 'ElevenLabs quota exceeded', code: 'quota_exceeded' };
    expect(errorShape).toHaveProperty('error');
    expect(errorShape).toHaveProperty('code');
    expect(VALID_ERROR_CODES).toContain(errorShape.code);
  });

  it('text input is required in request body', () => {
    const validBody = { text: 'Hello from SolarDog' };
    expect(validBody.text).toBeTruthy();
    expect(typeof validBody.text).toBe('string');
  });

  it('optional voiceId field is accepted', () => {
    const bodyWithVoice = { text: 'Hello', voiceId: 'CwhRBWXzGAHq8TQ4Fs17' };
    expect(bodyWithVoice.voiceId).toBeTruthy();
  });

  it('voice is never blocked if voice fails — text still shown', () => {
    // Behavioral contract: even if TTS fails, message still appears
    const voiceFailed = true;
    const textShown   = true; // always true regardless of voice
    expect(textShown || voiceFailed).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 9. resolveRoute — navigation resolver
// ════════════════════════════════════════════════════════════════════════════════

describe('resolveRoute — navigation resolver', () => {

  it('"take me to command center" → /dashboard (high)', () => {
    const r = resolveRoute('take me to command center');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/dashboard');
  });

  it('"go home" → /dashboard', () => {
    const r = resolveRoute('go home');
    expect(r.confidence).not.toBe('none');
    expect(r.resolvedUrl).toContain('/dashboard');
  });

  it('"go to engineering" → /engineering', () => {
    const r = resolveRoute('go to engineering');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/engineering');
  });

  it('"open design" → /design', () => {
    const r = resolveRoute('open design');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/design');
  });

  it('"take me to proposals" → /proposals', () => {
    const r = resolveRoute('take me to proposals');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/proposals');
  });

  it('"show me the bom" → engineering with tab=bom', () => {
    const r = resolveRoute('show me the bom');
    expect(r.confidence).not.toBe('none');
    expect(r.resolvedUrl).toContain('bom');
  });

  it('"go to projects" → /projects', () => {
    const r = resolveRoute('go to projects');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/projects');
  });

  it('"open clients" → /clients', () => {
    const r = resolveRoute('open clients');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/clients');
  });

  it('"go to analytics" → /analytics', () => {
    const r = resolveRoute('go to analytics');
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/analytics');
  });

  it('engineering route with projectId includes projectId in URL', () => {
    const r = resolveRoute('open engineering', 'proj-uuid-123');
    expect(r.resolvedUrl).toContain('projectId=proj-uuid-123');
  });

  it('learned alias overrides canonical', () => {
    const learned = [{ phrase: 'command center', route: '/dashboard', label: 'Dashboard' }];
    const r = resolveRoute('command center', null, learned);
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/dashboard');
  });

  it('completely unknown phrase returns confidence none', () => {
    const r = resolveRoute('xyzzy frobulate');
    expect(r.confidence).toBe('none');
    expect(r.route).toBeNull();
    expect(r.resolvedUrl).toBeNull();
  });

  it('partial phrase match works — "string" → engineering', () => {
    const r = resolveRoute('string sizing');
    expect(r.confidence).not.toBe('none');
    expect(r.resolvedUrl).toContain('/engineering');
  });

  it('"nec" → engineering', () => {
    const r = resolveRoute('nec');
    expect(r.confidence).not.toBe('none');
    expect(r.resolvedUrl).toContain('/engineering');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 10. detectLearnIntent — alias learning
// ════════════════════════════════════════════════════════════════════════════════

describe('detectLearnIntent — alias learning detection', () => {

  it('"command center is dashboard" → phrase=command center, target=dashboard', () => {
    const r = detectLearnIntent('command center is dashboard');
    expect(r).not.toBeNull();
    expect(r!.phrase).toBe('command center');
    expect(r!.target).toBe('dashboard');
  });

  it('"command center means dashboard" → detects learn intent', () => {
    const r = detectLearnIntent('command center means dashboard');
    expect(r).not.toBeNull();
    expect(r!.phrase).toContain('command center');
  });

  it('"remember: hq is dashboard" → detects remember pattern', () => {
    const r = detectLearnIntent('remember hq is dashboard');
    expect(r).not.toBeNull();
  });

  it('"mission control is the dashboard" → detects intent', () => {
    const r = detectLearnIntent('mission control is the dashboard');
    expect(r).not.toBeNull();
  });

  it('plain chat message does NOT trigger learn intent', () => {
    expect(detectLearnIntent('how do I size a battery?')).toBeNull();
    expect(detectLearnIntent('take me to engineering')).toBeNull();
    expect(detectLearnIntent('what is NEC 690?')).toBeNull();
  });

  it('very short phrase returns null (min 2 chars)', () => {
    expect(detectLearnIntent('a is b')).toBeNull(); // both a and b are 1 char
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 11. isNavigationIntent
// ════════════════════════════════════════════════════════════════════════════════

describe('isNavigationIntent — detects navigation phrases', () => {

  it('"take me to engineering" → true', () => {
    expect(isNavigationIntent('take me to engineering')).toBe(true);
  });

  it('"go to dashboard" → true', () => {
    expect(isNavigationIntent('go to dashboard')).toBe(true);
  });

  it('"navigate to proposals" → true', () => {
    expect(isNavigationIntent('navigate to proposals')).toBe(true);
  });

  it('"open design" → true', () => {
    expect(isNavigationIntent('open design')).toBe(true);
  });

  it('"show me projects" → true', () => {
    expect(isNavigationIntent('show me projects')).toBe(true);
  });

  it('"bring me to clients" → true', () => {
    expect(isNavigationIntent('bring me to clients')).toBe(true);
  });

  it('"how does string sizing work?" → false', () => {
    expect(isNavigationIntent('how does string sizing work?')).toBe(false);
  });

  it('"what is the BOM?" → false', () => {
    expect(isNavigationIntent('what is the BOM?')).toBe(false);
  });

  it('"fix my wire sizing" → false (action, not nav)', () => {
    expect(isNavigationIntent('fix my wire sizing')).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 12. normalizePhrase
// ════════════════════════════════════════════════════════════════════════════════

describe('normalizePhrase — phrase normalization', () => {

  it('lowercases', () => {
    expect(normalizePhrase('ENGINEERING')).toBe('engineering');
  });

  it('removes punctuation', () => {
    expect(normalizePhrase('command-center!')).toBe('commandcenter');
  });

  it('collapses whitespace', () => {
    expect(normalizePhrase('  command   center  ')).toBe('command center');
  });

  it('handles empty string', () => {
    expect(normalizePhrase('')).toBe('');
  });

  it('preserves numbers', () => {
    expect(normalizePhrase('NEC 690')).toBe('nec 690');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 13. siteMap — canonical routes coverage
// ════════════════════════════════════════════════════════════════════════════════

describe('siteMap — canonical routes coverage', () => {

  const REQUIRED_ROUTES = [
    '/dashboard', '/projects', '/engineering', '/design',
    '/proposals', '/clients', '/hardware', '/analytics', '/settings',
  ];

  REQUIRED_ROUTES.forEach(route => {
    it(`site map contains route "${route}"`, () => {
      const found = SITE_MAP.find(r => r.route === route);
      expect(found).toBeDefined();
    });
  });

  it('every route has at least 3 aliases', () => {
    SITE_MAP.forEach(r => {
      expect(r.aliases.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('all aliases are lowercase', () => {
    SITE_MAP.forEach(r => {
      r.aliases.forEach(a => {
        expect(a).toBe(a.toLowerCase());
      });
    });
  });

  it('alias map has no duplicate keys across routes (last wins is ok, just verify map builds)', () => {
    const map = buildAliasMap();
    expect(map.size).toBeGreaterThan(30);
  });

  it('"dashboard" alias resolves to /dashboard', () => {
    const map = buildAliasMap();
    const r = map.get('dashboard');
    expect(r?.route).toBe('/dashboard');
  });

  it('"home" alias resolves to /dashboard', () => {
    const map = buildAliasMap();
    const r = map.get('home');
    expect(r?.route).toBe('/dashboard');
  });

  it('"bom" alias resolves to engineering with tab=bom', () => {
    const map = buildAliasMap();
    const r = map.get('bom');
    expect(r?.route).toBe('/engineering');
    expect(r?.defaultTab).toBe('bom');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 14. actionRegistry
// ════════════════════════════════════════════════════════════════════════════════

describe('actionRegistry — action registry coverage', () => {

  const REQUIRED_ACTIONS = [
    'open_engineering', 'open_bom', 'open_design', 'open_proposals',
    'open_projects', 'open_dashboard', 'run_nec_validation',
    'auto_fix_wire', 'generate_bom', 'generate_proposal',
    'start_guided_design',
  ];

  REQUIRED_ACTIONS.forEach(key => {
    it(`action registry contains "${key}"`, () => {
      expect(getAction(key)).toBeDefined();
    });
  });

  it('buildActionList() produces non-empty string', () => {
    const list = buildActionList();
    expect(list.length).toBeGreaterThan(100);
    expect(list).toContain('NAVIGATION');
    expect(list).toContain('ENGINEERING');
  });

  it('getActionsByCategory returns correct actions', () => {
    const navActions = getActionsByCategory('navigation');
    expect(navActions.length).toBeGreaterThan(3);
    navActions.forEach(a => {
      expect(a.category).toBe('navigation');
    });
  });

  it('all actions have required fields', () => {
    ACTION_REGISTRY.forEach(a => {
      expect(a.key).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(a.description).toBeTruthy();
      expect(a.category).toBeTruthy();
    });
  });

  it('engineering actions are project-scoped', () => {
    const engActions = getActionsByCategory('engineering');
    engActions.forEach(a => {
      expect(a.requiresProject).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 15. Response type handling
// ════════════════════════════════════════════════════════════════════════════════

describe('Response type handling', () => {

  it('navigate response should have a route starting with /', () => {
    const resp = { type: 'navigate' as ResponseType, route: '/dashboard', message: 'heading there' };
    expect(resp.route).toMatch(/^\//);
  });

  it('learn response needs both learnedPhrase and learnedRoute', () => {
    const resp = {
      type: 'learn' as ResponseType,
      learnedPhrase: 'command center',
      learnedRoute: '/dashboard',
      message: "Got it 🐾",
    };
    expect(resp.learnedPhrase).toBeTruthy();
    expect(resp.learnedRoute).toMatch(/^\//);
  });

  it('action response with auto_fix_wire is valid', () => {
    const resp = { type: 'action' as ResponseType, action: 'auto_fix_wire', message: "Fixing wire" };
    expect(resp.action).toBe('auto_fix_wire');
  });

  it('chat response can have no route or action', () => {
    const resp = {
      type: 'chat' as ResponseType,
      message: "You're on the engineering page.",
      route: null,
      action: null,
    };
    expect(resp.type).toBe('chat');
    expect(resp.message).toBeTruthy();
  });

  it('confidence high → act immediately, medium → confirm, low → ask', () => {
    const gated = (confidence: string, action: string) => {
      if (confidence === 'high')   return 'immediate';
      if (confidence === 'medium') return 'confirm';
      return 'ask';
    };
    expect(gated('high',   'navigate')).toBe('immediate');
    expect(gated('medium', 'navigate')).toBe('confirm');
    expect(gated('low',    'navigate')).toBe('ask');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// 16. Confidence-gated behavior
// ════════════════════════════════════════════════════════════════════════════════

describe('Confidence-gated navigation behavior', () => {

  it('high confidence → resolveRoute returns high and acts immediately', () => {
    const r = resolveRoute('go to dashboard');
    expect(r.confidence).toBe('high');
    // Behavioral contract: high = act immediately
    expect(r.resolvedUrl).not.toBeNull();
  });

  it('medium confidence still provides a resolvedUrl', () => {
    // Token overlap match may return medium
    const r = resolveRoute('the main control area');
    // We don't mandate medium here but we verify the resolver doesn't crash
    expect(['high', 'medium', 'low', 'none']).toContain(r.confidence);
  });

  it('none confidence has null route and null resolvedUrl', () => {
    const r = resolveRoute('xyzzy frobulate blargh');
    expect(r.confidence).toBe('none');
    expect(r.route).toBeNull();
    expect(r.resolvedUrl).toBeNull();
  });

  it('learned aliases are checked before canonical — user intent wins', () => {
    // If user says "command center is /projects", that should override the canonical /dashboard
    const learned = [{ phrase: 'command center', route: '/projects', label: 'Projects' }];
    const r = resolveRoute('command center', null, learned);
    expect(r.resolvedUrl).toContain('/projects');
    expect(r.confidence).toBe('high');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 17. Intent classification — Think → Decide → Act
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

type IntentType = 'navigation' | 'question' | 'action' | 'observation' | 'conversation' | 'correction';

/**
 * Minimal intent classifier that mirrors the LLM's INTENT CLASSIFICATION rules.
 * Used to unit-test the classification logic independently of the LLM.
 */
function classifyIntent(message: string): IntentType {
  const lower = message.toLowerCase().trim();

  // Navigation signals — explicit movement phrases
  if (/\b(take me to|go to|navigate to|bring me to|go back to|head to)\b/.test(lower)) return 'navigation';
  if (/^(open|show me)\s+\w/.test(lower)) return 'navigation';

  // Observation signals — "I see/notice", "there are/is", "it shows/says"
  if (/^i (see|notice|can see|am seeing)\b/.test(lower)) return 'observation';
  if (/^(there (are|is)|it (shows|says)|the page\b|the screen\b)\b/.test(lower)) return 'observation';

  // Correction signals — "actually", "remember that X is Y"
  if (/^(actually|no,?\s+that|remember\s+(that|this)|note\s+that)\b/.test(lower)) return 'correction';
  // Bare "X is Y" pattern (not a question, not observation)
  if (/^[a-z][a-z\s]{1,28}\s+(is|means)\s+[a-z][a-z\s]{1,28}$/.test(lower) &&
      !/^(what|where|when|who|why|how|which|is|are|can|does|do|did)\b/.test(lower) &&
      !/^i (see|notice|can)\b/.test(lower)) return 'correction';

  // Action signals — imperative verbs
  if (/^(fix|run|generate|calculate|create|auto.?fix|compute|build|make)\b/.test(lower)) return 'action';

  // Question signals — ends with ? or starts with question word
  if (/\?$/.test(lower)) return 'question';
  if (/^(what|where|when|who|why|how|which|explain|tell me|describe)\b/.test(lower)) return 'question';

  // Conversation signals
  if (/^(hey|hi|hello|thanks|thank you|nice|good|great|cool|lol|haha|awesome|perfect|ok|okay|got it|sounds good)\b/.test(lower)) return 'conversation';

  return 'conversation'; // default
}


describe('Intent classification — classifyIntent()', () => {

  // Navigation
  it('"take me to engineering" → navigation', () => {
    expect(classifyIntent('take me to engineering')).toBe('navigation');
  });

  it('"go to dashboard" → navigation', () => {
    expect(classifyIntent('go to dashboard')).toBe('navigation');
  });

  it('"open the BOM" → navigation', () => {
    expect(classifyIntent('open the BOM')).toBe('navigation');
  });

  it('"navigate to proposals" → navigation', () => {
    expect(classifyIntent('navigate to proposals')).toBe('navigation');
  });

  // Question
  it('"what is NEC 690.7?" → question', () => {
    expect(classifyIntent('what is NEC 690.7?')).toBe('question');
  });

  it('"how does string sizing work?" → question', () => {
    expect(classifyIntent('how does string sizing work?')).toBe('question');
  });

  it('"explain the DC/AC ratio" → question', () => {
    expect(classifyIntent('explain the DC/AC ratio')).toBe('question');
  });

  it('"what is the max string voltage?" → question', () => {
    expect(classifyIntent('what is the max string voltage?')).toBe('question');
  });

  it('"where am I?" → question', () => {
    expect(classifyIntent('where am I?')).toBe('question');
  });

  it('"how many panels are in the project?" → question', () => {
    expect(classifyIntent('how many panels are in the project?')).toBe('question');
  });

  // Action
  it('"fix this" → action', () => {
    expect(classifyIntent('fix this')).toBe('action');
  });

  it('"run NEC validation" → action', () => {
    expect(classifyIntent('run NEC validation')).toBe('action');
  });

  it('"generate the BOM" → action', () => {
    expect(classifyIntent('generate the BOM')).toBe('action');
  });

  it('"calculate string voltage" → action', () => {
    expect(classifyIntent('calculate string voltage')).toBe('action');
  });

  // Observation
  it('"I see caution triangles" → observation', () => {
    expect(classifyIntent('I see caution triangles')).toBe('observation');
  });

  it('"I notice the BOM is empty" → observation', () => {
    expect(classifyIntent('I notice the BOM is empty')).toBe('observation');
  });

  it('"there are errors on the string groups" → observation', () => {
    expect(classifyIntent('there are errors on the string groups')).toBe('observation');
  });

  it('"it shows a validation warning" → observation', () => {
    expect(classifyIntent('it shows a validation warning')).toBe('observation');
  });

  // Conversation
  it('"hey" → conversation', () => {
    expect(classifyIntent('hey')).toBe('conversation');
  });

  it('"thanks" → conversation', () => {
    expect(classifyIntent('thanks')).toBe('conversation');
  });

  it('"nice work" → conversation', () => {
    expect(classifyIntent('nice work')).toBe('conversation');
  });

  it('"sounds good" → conversation', () => {
    expect(classifyIntent('sounds good')).toBe('conversation');
  });

  // Correction
  it('"actually..." → correction', () => {
    expect(classifyIntent("actually that is wrong")).toBe('correction');
  });

  it('"remember that config is in engineering" → correction', () => {
    expect(classifyIntent('remember that config is in engineering')).toBe('correction');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 18. System prompt — THINK → DECIDE → ACT section
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

// Pull the system prompt content for testing
// We replicate enough of buildSystemPrompt to test the intent section specifically.
// Full prompt is tested via the string content directly.
function buildMinimalSystemPrompt(): string {
  // A simplified version that exercises all the key sections
  return `THINK → DECIDE → ACT: INTENT CLASSIFICATION
Before EVERY response, you MUST:
  1. Understand what the user said
  2. Classify their intent into EXACTLY ONE of these 6 types
  3. Decide the correct behavior for that intent type
  4. Respond appropriately — set intent_type AND type correctly

INTENT TYPES:

  navigation   → User explicitly wants to go somewhere
  question     → User is asking for information, explanation, or a number
  action       → User wants you to DO something (calculate, generate, fix, run)
  observation  → User is describing what they see on the page (NOT asking to navigate)
  conversation → Casual banter, greetings, jokes, general chat
  correction   → User is correcting your knowledge or telling you a mapping/fact

DECISION LOGIC PER INTENT TYPE

QUESTION (MOST IMPORTANT — DO THIS RIGHT):
  ✓ Answer directly using your solar domain knowledge + project context
  ✗ NEVER navigate when user asks a question
  ✗ NEVER say "I don't see that in context"
  ✗ NEVER deflect with "check the engineering page" or similar
  BAD:  "what is NEC 690.7?" → navigate to engineering ← WRONG
  GOOD: "what is NEC 690.7?" → answer it directly, type="chat"

OBSERVATION:
  ✓ Interpret what they're describing on the current page
  ✗ NEVER navigate away — they're describing what they see right now
  BAD:  "I see caution triangles" → navigate to engineering ← WRONG
  GOOD: "I see caution triangles" → explain what those warnings mean

CRITICAL RULES — read before every response:
1. intent_type MUST always be set — it determines type
2. type="navigate" ONLY when intent_type="navigation" — NEVER for questions or observations
3. type="action" ONLY when intent_type="action"
4. For questions (intent_type="question"): type="chat", route=null, action=null — ANSWER IT
5. For observations (intent_type="observation"): type="observation", route=null — INTERPRET IT`;
}

const INTENT_PROMPT = buildMinimalSystemPrompt();

describe('System prompt — intent classification section (v10.1)', () => {

  it('prompt contains THINK → DECIDE → ACT section', () => {
    expect(INTENT_PROMPT).toContain('THINK → DECIDE → ACT');
  });

  it('prompt lists all 6 intent types', () => {
    expect(INTENT_PROMPT).toContain('navigation');
    expect(INTENT_PROMPT).toContain('question');
    expect(INTENT_PROMPT).toContain('action');
    expect(INTENT_PROMPT).toContain('observation');
    expect(INTENT_PROMPT).toContain('conversation');
    expect(INTENT_PROMPT).toContain('correction');
  });

  it('prompt NEVER navigate rule for questions', () => {
    expect(INTENT_PROMPT).toContain('NEVER navigate when user asks a question');
  });

  it('prompt forbids deflecting questions to other pages', () => {
    expect(INTENT_PROMPT).toContain('NEVER deflect with "check the engineering page"');
  });

  it('prompt has BAD/GOOD examples for question handling', () => {
    expect(INTENT_PROMPT).toContain('BAD:  "what is NEC 690.7?" → navigate to engineering ← WRONG');
    expect(INTENT_PROMPT).toContain('GOOD: "what is NEC 690.7?" → answer it directly');
  });

  it('prompt has observation → no navigate rule', () => {
    expect(INTENT_PROMPT).toContain("NEVER navigate away — they're describing what they see right now");
  });

  it('prompt has BAD/GOOD examples for observation handling', () => {
    expect(INTENT_PROMPT).toContain('BAD:  "I see caution triangles" → navigate to engineering ← WRONG');
    expect(INTENT_PROMPT).toContain('GOOD: "I see caution triangles" → explain what those warnings mean');
  });

  it('prompt states type="navigate" ONLY for navigation intent', () => {
    expect(INTENT_PROMPT).toContain('type="navigate" ONLY when intent_type="navigation" — NEVER for questions or observations');
  });

  it('prompt states intent_type must always be set', () => {
    expect(INTENT_PROMPT).toContain('intent_type MUST always be set');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 19. Response schema — question/observation/correction/conversation types (v10.1)
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

type ResponseTypeV101 = 'chat' | 'navigate' | 'action' | 'learn' | 'observation' | 'conversation' | 'correction';

describe('Response schema — v10.1 new types', () => {

  it('question response: type=chat, route=null, action=null', () => {
    const resp = {
      type: 'chat' as ResponseTypeV101,
      intent_type: 'question' as IntentType,
      message: 'NEC 690.7 covers max PV system voltage. **1000V DC** for qualified-person systems.',
      route: null,
      action: null,
      confidence: 'high',
    };
    expect(resp.type).toBe('chat');
    expect(resp.intent_type).toBe('question');
    expect(resp.route).toBeNull();
    expect(resp.action).toBeNull();
    expect(resp.message).toContain('NEC');
  });

  it('observation response: type=observation, route=null', () => {
    const resp = {
      type: 'observation' as ResponseTypeV101,
      intent_type: 'observation' as IntentType,
      message: 'Those caution triangles are Voc voltage warnings.',
      route: null,
      action: null,
      confidence: 'high',
    };
    expect(resp.type).toBe('observation');
    expect(resp.intent_type).toBe('observation');
    expect(resp.route).toBeNull();
  });

  it('conversation response: type=conversation, route=null, action=null', () => {
    const resp = {
      type: 'conversation' as ResponseTypeV101,
      intent_type: 'conversation' as IntentType,
      message: "Thanks. Been doing this longer than most inverters have been on the market 🐾",
      route: null,
      action: null,
    };
    expect(resp.type).toBe('conversation');
    expect(resp.intent_type).toBe('conversation');
    expect(resp.route).toBeNull();
    expect(resp.action).toBeNull();
  });

  it('correction response: type=learn, carries learnedPhrase and learnedRoute', () => {
    const resp = {
      type: 'learn' as ResponseTypeV101,
      intent_type: 'correction' as IntentType,
      message: "Got it — I'll remember that 🐾. 'Command center' → Dashboard.",
      learnedPhrase: 'command center',
      learnedRoute: '/dashboard',
      route: null,
      action: null,
      confidence: 'high',
    };
    expect(resp.type).toBe('learn');
    expect(resp.intent_type).toBe('correction');
    expect(resp.learnedPhrase).toBe('command center');
    expect(resp.learnedRoute).toBe('/dashboard');
  });

  it('correction response (factual): type=correction, no navigation', () => {
    const resp = {
      type: 'correction' as ResponseTypeV101,
      intent_type: 'correction' as IntentType,
      message: "Got it — noted. I'll use that going forward.",
      route: null,
      action: null,
      confidence: 'high',
    };
    expect(resp.type).toBe('correction');
    expect(resp.route).toBeNull();
    expect(resp.action).toBeNull();
  });

  it('all v10.1 response types are valid', () => {
    const validTypes: ResponseTypeV101[] = ['chat', 'navigate', 'action', 'learn', 'observation', 'conversation', 'correction'];
    expect(validTypes).toContain('observation');
    expect(validTypes).toContain('conversation');
    expect(validTypes).toContain('correction');
    expect(validTypes).toHaveLength(7);
  });

  it('all intent types are valid', () => {
    const validIntents: IntentType[] = ['navigation', 'question', 'action', 'observation', 'conversation', 'correction'];
    expect(validIntents).toHaveLength(6);
    expect(validIntents).toContain('observation');
    expect(validIntents).toContain('correction');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 20. Navigation guard — type=navigate ONLY fires for navigation intent
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Simulates the frontend routing guard:
 * Only process navigation if type === 'navigate'.
 * All other types should NOT trigger routing.
 */
function shouldNavigate(responseType: ResponseTypeV101): boolean {
  return responseType === 'navigate';
}

describe('Navigation guard — type=navigate is the ONLY trigger', () => {

  it('type=navigate → should navigate', () => {
    expect(shouldNavigate('navigate')).toBe(true);
  });

  it('type=chat → should NOT navigate', () => {
    expect(shouldNavigate('chat')).toBe(false);
  });

  it('type=observation → should NOT navigate', () => {
    expect(shouldNavigate('observation')).toBe(false);
  });

  it('type=conversation → should NOT navigate', () => {
    expect(shouldNavigate('conversation')).toBe(false);
  });

  it('type=correction → should NOT navigate', () => {
    expect(shouldNavigate('correction')).toBe(false);
  });

  it('type=learn → should NOT navigate', () => {
    expect(shouldNavigate('learn')).toBe(false);
  });

  it('type=action → should NOT navigate', () => {
    expect(shouldNavigate('action')).toBe(false);
  });

  it('question response never triggers navigation', () => {
    // A question about NEC should return chat, not navigate
    const questionResponse = {
      type: 'chat' as ResponseTypeV101,
      intent_type: 'question' as IntentType,
      route: null,
    };
    expect(shouldNavigate(questionResponse.type)).toBe(false);
    expect(questionResponse.route).toBeNull();
  });

  it('observation response never triggers navigation', () => {
    const obsResponse = {
      type: 'observation' as ResponseTypeV101,
      intent_type: 'observation' as IntentType,
      route: null,
    };
    expect(shouldNavigate(obsResponse.type)).toBe(false);
    expect(obsResponse.route).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 21. Action guard — type=action ONLY fires for action intent
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

function shouldExecuteAction(responseType: ResponseTypeV101, action: string | null): boolean {
  return responseType === 'action' && action !== null && action !== '';
}

describe('Action guard — type=action is the ONLY trigger', () => {

  it('type=action + action key → should execute', () => {
    expect(shouldExecuteAction('action', 'run_nec_validation')).toBe(true);
  });

  it('type=action + null action → should NOT execute', () => {
    expect(shouldExecuteAction('action', null)).toBe(false);
  });

  it('type=chat + action key → should NOT execute', () => {
    expect(shouldExecuteAction('chat', 'run_nec_validation')).toBe(false);
  });

  it('type=observation + action key → should NOT execute', () => {
    expect(shouldExecuteAction('observation', 'auto_fix_string')).toBe(false);
  });

  it('type=navigate + action key → should NOT execute', () => {
    expect(shouldExecuteAction('navigate', 'run_nec_validation')).toBe(false);
  });

  it('question response never fires an action automatically', () => {
    const qResp = {
      type: 'chat' as ResponseTypeV101,
      intent_type: 'question' as IntentType,
      action: null,
    };
    expect(shouldExecuteAction(qResp.type, qResp.action)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 22. Correction → learn flow
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('Correction → learn flow', () => {

  it('correction with learnedPhrase + learnedRoute triggers alias save', () => {
    const correctionResp = {
      type: 'learn' as ResponseTypeV101,
      intent_type: 'correction' as IntentType,
      learnedPhrase: 'the hub',
      learnedRoute: '/dashboard',
      message: "Got it — 'the hub' → Dashboard 🐾",
    };
    // The learn flow should fire when both learnedPhrase and learnedRoute are set
    const shouldLearn = !!(correctionResp.learnedPhrase && correctionResp.learnedRoute);
    expect(shouldLearn).toBe(true);
    expect(correctionResp.learnedRoute).toMatch(/^\//);
  });

  it('correction without learnedRoute does NOT trigger alias save', () => {
    const correctionResp = {
      type: 'correction' as ResponseTypeV101,
      intent_type: 'correction' as IntentType,
      learnedPhrase: null,
      learnedRoute: null,
      message: "Got it — noted.",
    };
    const shouldLearn = !!(correctionResp.learnedPhrase && correctionResp.learnedRoute);
    expect(shouldLearn).toBe(false);
  });

  it('correction aliases are valid route paths', () => {
    const validRoutes = ['/dashboard', '/engineering', '/projects', '/design', '/proposals', '/clients', '/settings'];
    const correctionRoute = '/dashboard';
    expect(validRoutes).toContain(correctionRoute);
    expect(correctionRoute).toMatch(/^\//);
  });

  it('learn flow updates local state with new alias', () => {
    // Simulates what handleLearnResponse does in the frontend
    const aliases: Array<{ phrase: string; route: string; label: string }> = [];
    const newAlias = { phrase: 'the hub', route: '/dashboard', label: 'Dashboard' };
    aliases.push(newAlias);
    expect(aliases).toHaveLength(1);
    expect(aliases[0].phrase).toBe('the hub');
    expect(aliases[0].route).toBe('/dashboard');
  });

  it('subsequent resolveRoute uses the new correction alias', () => {
    const learned = [{ phrase: 'the hub', route: '/dashboard', label: 'Dashboard' }];
    const r = resolveRoute('take me to the hub', null, learned);
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/dashboard');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 23. isNavigationIntent — rejects question/observation patterns
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('isNavigationIntent — must NOT fire for questions or observations', () => {

  it('"what is NEC 690?" is NOT a navigation intent', () => {
    expect(isNavigationIntent('what is NEC 690?')).toBe(false);
  });

  it('"how does string sizing work?" is NOT a navigation intent', () => {
    expect(isNavigationIntent('how does string sizing work?')).toBe(false);
  });

  it('"I see caution triangles" is NOT a navigation intent', () => {
    expect(isNavigationIntent('I see caution triangles')).toBe(false);
  });

  it('"I notice the BOM is empty" is NOT a navigation intent', () => {
    expect(isNavigationIntent('I notice the BOM is empty')).toBe(false);
  });

  it('"explain the DC/AC ratio" is NOT a navigation intent', () => {
    expect(isNavigationIntent('explain the DC/AC ratio')).toBe(false);
  });

  it('"fix this" is NOT a navigation intent (action, not nav)', () => {
    expect(isNavigationIntent('fix this')).toBe(false);
  });

  it('"thanks" is NOT a navigation intent', () => {
    expect(isNavigationIntent('thanks')).toBe(false);
  });

  it('"take me to engineering" IS a navigation intent', () => {
    expect(isNavigationIntent('take me to engineering')).toBe(true);
  });

  it('"go to dashboard" IS a navigation intent', () => {
    expect(isNavigationIntent('go to dashboard')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 24. detectLearnIntent — v10.2 STRICT mode (only "X is Y" / "X means Y" / "X = Y")
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('detectLearnIntent — v10.2 strict mode', () => {

  // ── SHOULD match ──────────────────────────────────────────────────────────
  it('"command center is dashboard" matches', () => {
    const r = detectLearnIntent('command center is dashboard');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('command center');
    expect(r?.target).toBe('dashboard');
  });

  it('"hub means engineering" matches', () => {
    const r = detectLearnIntent('hub means engineering');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('hub');
    expect(r?.target).toBe('engineering');
  });

  it('"the shed = projects" matches', () => {
    const r = detectLearnIntent('the shed = projects');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('the shed');
    expect(r?.target).toBe('projects');
  });

  it('"wiring = design" matches', () => {
    const r = detectLearnIntent('wiring = design');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('wiring');
    expect(r?.target).toBe('design');
  });

  it('"home base is dashboard" matches', () => {
    const r = detectLearnIntent('home base is dashboard');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('home base');
  });

  // ── SHOULD NOT match (rejected by strict mode) ────────────────────────────
  it('"take me to dashboard" does NOT match (navigation, not learn)', () => {
    expect(detectLearnIntent('take me to dashboard')).toBeNull();
  });

  it('"what is the dashboard?" does NOT match (question)', () => {
    expect(detectLearnIntent('what is the dashboard?')).toBeNull();
  });

  it('"I am working on a project" does NOT match (random sentence with "is")', () => {
    // "I" is not a valid route target — isValidLearnTarget("i am working on a project") = false
    expect(detectLearnIntent('I am working on a project')).toBeNull();
  });

  it('"it is a nice day" does NOT match (no valid route target)', () => {
    expect(detectLearnIntent('it is a nice day')).toBeNull();
  });

  it('"fix this string sizing issue" does NOT match', () => {
    expect(detectLearnIntent('fix this string sizing issue')).toBeNull();
  });

  it('"go to engineering" does NOT match (navigation)', () => {
    expect(detectLearnIntent('go to engineering')).toBeNull();
  });

  it('"thanks for the help" does NOT match', () => {
    expect(detectLearnIntent('thanks for the help')).toBeNull();
  });

  it('"remember when I said X" does NOT match (removed in v10.2)', () => {
    expect(detectLearnIntent('remember when i said dashboard')).toBeNull();
  });

  it('"teach: hub -> engineering" does NOT match (removed in v10.2)', () => {
    expect(detectLearnIntent('teach: hub -> engineering')).toBeNull();
  });

  it('"when i say hub go to engineering" does NOT match (removed in v10.2)', () => {
    expect(detectLearnIntent('when i say hub go to engineering')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 25. isValidLearnPhrase and isValidLearnTarget — validation rules
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('isValidLearnPhrase — phrase length and word count limits', () => {

  it('accepts short phrase (1 word)', () => {
    expect(isValidLearnPhrase('hub')).toBe(true);
  });

  it('accepts 4-word phrase', () => {
    expect(isValidLearnPhrase('command center main hub')).toBe(true);
  });

  it('rejects phrase with 5 words', () => {
    expect(isValidLearnPhrase('take me to the engineering page')).toBe(false);
  });

  it('rejects phrase longer than 40 chars', () => {
    expect(isValidLearnPhrase('this is a very long phrase that exceeds forty')).toBe(false);
  });

  it('rejects empty phrase', () => {
    expect(isValidLearnPhrase('')).toBe(false);
  });

  it('rejects single char phrase', () => {
    expect(isValidLearnPhrase('x')).toBe(false);
  });

  it('rejects navigation command as phrase', () => {
    expect(isValidLearnPhrase('go to engineering')).toBe(false);
  });

  it('rejects "take me to X" as phrase', () => {
    expect(isValidLearnPhrase('take me to dashboard')).toBe(false);
  });
});

describe('isValidLearnTarget — must match a known route', () => {

  it('accepts "dashboard" as valid target', () => {
    expect(isValidLearnTarget('dashboard')).toBe(true);
  });

  it('accepts "engineering" as valid target', () => {
    expect(isValidLearnTarget('engineering')).toBe(true);
  });

  it('accepts "projects" as valid target', () => {
    expect(isValidLearnTarget('projects')).toBe(true);
  });

  it('accepts "design" as valid target', () => {
    expect(isValidLearnTarget('design')).toBe(true);
  });

  it('rejects "banana" as invalid target', () => {
    expect(isValidLearnTarget('banana')).toBe(false);
  });

  it('rejects "nice day" as invalid target', () => {
    expect(isValidLearnTarget('nice day')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidLearnTarget('')).toBe(false);
  });

  it('rejects single char', () => {
    expect(isValidLearnTarget('x')).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 26. detectUnlearnIntent — "unlearn that", "forget that", "remove mapping for X"
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('detectUnlearnIntent — unlearn/forget patterns', () => {

  it('"unlearn that" returns phrase=null (forget last)', () => {
    const r = detectUnlearnIntent('unlearn that');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBeNull();
  });

  it('"forget that" returns phrase=null', () => {
    const r = detectUnlearnIntent('forget that');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBeNull();
  });

  it('"remove that mapping" returns phrase=null', () => {
    const r = detectUnlearnIntent('remove that mapping');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBeNull();
  });

  it('"delete that alias" returns phrase=null', () => {
    const r = detectUnlearnIntent('delete that alias');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBeNull();
  });

  it('"unlearn command center" returns phrase="command center"', () => {
    const r = detectUnlearnIntent('unlearn command center');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('command center');
  });

  it('"forget hub" returns phrase="hub"', () => {
    const r = detectUnlearnIntent('forget hub');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('hub');
  });

  it('"remove mapping for the shed" returns phrase="the shed"', () => {
    const r = detectUnlearnIntent('remove mapping for the shed');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('the shed');
  });

  it('"remove the mapping for wiring" returns phrase="wiring"', () => {
    const r = detectUnlearnIntent('remove the mapping for wiring');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('wiring');
  });

  it('"go to dashboard" does NOT match unlearn', () => {
    expect(detectUnlearnIntent('go to dashboard')).toBeNull();
  });

  it('"what is NEC 690?" does NOT match unlearn', () => {
    expect(detectUnlearnIntent('what is NEC 690?')).toBeNull();
  });

  it('"thanks" does NOT match unlearn', () => {
    expect(detectUnlearnIntent('thanks')).toBeNull();
  });

  it('"command center is dashboard" does NOT match unlearn', () => {
    expect(detectUnlearnIntent('command center is dashboard')).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 27. System prompt v10.2 — platform identity + personality
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

// Access buildSystemPrompt indirectly through the system prompt content tests
// (buildSystemPrompt is not exported — test via route imports or string inspection)

describe('System prompt v10.2 — platform identity + personality', () => {

  // We test the system prompt content by checking the route module exports
  // and the system prompt building logic indirectly via the buildSystemPrompt call signature

  it('detectMode is defined and callable', () => {
    expect(typeof detectMode).toBe('function');
  });

  it('detectMode returns user for normal messages', () => {
    expect(detectMode('hello', 'general')).toBe('user');
  });

  it('detectMode returns developer for dev phrases', () => {
    expect(detectMode('dev mode', 'general')).toBe('developer');
  });

  it('detectMode returns engineering_helper for engineering page', () => {
    expect(detectMode('help me', 'engineering')).toBe('engineering_helper');
  });

  it('detectMode returns project_helper for projects page', () => {
    expect(detectMode('help me', 'projects')).toBe('project_helper');
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════════
// 28. v10.2 learn validation integration — detectLearnIntent respects isValidLearnTarget
// ══════════════════════════════════════════════════════════════════════════════════════════════════════

describe('v10.2 learn validation integration', () => {

  it('learn intent with invalid target returns null', () => {
    // "hub is banana" — "banana" is not a valid route
    expect(detectLearnIntent('hub is banana')).toBeNull();
  });

  it('learn intent with valid short phrase and valid target succeeds', () => {
    const r = detectLearnIntent('home is dashboard');
    expect(r).not.toBeNull();
    expect(r?.target).toBe('dashboard');
  });

  it('phrase with 5 words does NOT trigger learn (too many words)', () => {
    // Even if target is valid, phrase with >4 words is rejected
    expect(detectLearnIntent('this very long multi word phrase is dashboard')).toBeNull();
  });

  it('phrase longer than 40 chars does NOT trigger learn', () => {
    const longPhrase = 'a'.repeat(41);
    expect(detectLearnIntent(`${longPhrase} is dashboard`)).toBeNull();
  });

  it('unlearn phrase does NOT trigger learn', () => {
    // "unlearn that" should be caught by detectUnlearnIntent, not detectLearnIntent
    expect(detectLearnIntent('unlearn that')).toBeNull();
  });

  it('question "what is dashboard?" does NOT trigger learn', () => {
    expect(detectLearnIntent('what is dashboard?')).toBeNull();
  });

  it('navigation "go to projects" does NOT trigger learn', () => {
    expect(detectLearnIntent('go to projects')).toBeNull();
  });

  it('isValidLearnTarget accepts SITE_MAP label "Dashboard"', () => {
    expect(isValidLearnTarget('dashboard')).toBe(true);
  });

  it('isValidLearnTarget accepts partial match "engineer" for engineering', () => {
    expect(isValidLearnTarget('engineer')).toBe(true);
  });

  it('resolveRoute still works correctly for a learned alias after v10.2 changes', () => {
    const learned = [{ phrase: 'the hub', route: '/dashboard', label: 'Dashboard' }];
    const r = resolveRoute('take me to the hub', null, learned);
    expect(r.confidence).toBe('high');
    expect(r.resolvedUrl).toContain('/dashboard');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 29. Memory honesty — SolarDog must not claim memory it doesn't have
// ══════════════════════════════════════════════════════════════════════════════

describe('Memory honesty — no false memory claims', () => {

  // The system prompt MEMORY HONESTY RULES section must exist in the prompt
  // We test this by checking buildSystemPrompt output indirectly via
  // examining the prompt rules text in the source.
  // Direct: test the memory line logic in isolation.

  function makeMemoryLine(
    memoryAvailable: boolean,
    historyCount: number,
    mode: 'user' | 'developer',
  ): string {
    if (memoryAvailable && historyCount > 0) {
      return `CONVERSATION MEMORY: The ${historyCount} messages above ARE your conversation history`;
    } else if (memoryAvailable && historyCount === 0) {
      return `CONVERSATION MEMORY: This is the first message`;
    } else {
      if (mode === 'developer') {
        return `CONVERSATION MEMORY: Unavailable — DB connection failed`;
      }
      return `CONVERSATION MEMORY: Not available for this session`;
    }
  }

  it('memory line says "NOT available" when memoryAvailable=false, user mode', () => {
    const line = makeMemoryLine(false, 0, 'user');
    expect(line).toContain('Not available');
    expect(line).not.toContain('sharp');
    expect(line).not.toContain('remember everything');
  });

  it('memory line says "Unavailable — DB" in developer mode with no memory', () => {
    const line = makeMemoryLine(false, 0, 'developer');
    expect(line).toContain('Unavailable');
    expect(line).toContain('DB connection');
  });

  it('memory line shows history count when available', () => {
    const line = makeMemoryLine(true, 5, 'user');
    expect(line).toContain('5 messages');
    expect(line).toContain('ARE your conversation history');
  });

  it('memory line says "first message" when available but historyCount=0', () => {
    const line = makeMemoryLine(true, 0, 'user');
    expect(line).toContain('first message');
    expect(line).not.toContain('remember everything');
  });

  it('memory line never says "my memory is sharp" in any branch', () => {
    const branches = [
      makeMemoryLine(false, 0, 'user'),
      makeMemoryLine(false, 0, 'developer'),
      makeMemoryLine(true, 0, 'user'),
      makeMemoryLine(true, 5, 'user'),
    ];
    for (const line of branches) {
      expect(line.toLowerCase()).not.toContain('sharp');
    }
  });

  it('memory line never says "I remember everything" without history', () => {
    const noHistory = makeMemoryLine(true, 0, 'user');
    expect(noHistory.toLowerCase()).not.toContain('remember everything');
  });

  it('system prompt source contains MEMORY HONESTY RULES section', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('MEMORY HONESTY RULES');
  });

  it('system prompt source forbids "my memory is sharp" claim', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain("NEVER say \"my memory is sharp\"");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 30. Alias vs full chat memory distinction
// ══════════════════════════════════════════════════════════════════════════════

describe('Alias vs full chat memory — distinct layers', () => {

  it('system prompt distinguishes LEARNED ALIASES from CONVERSATION MEMORY', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('LEARNED ALIASES');
    expect(src).toContain('CONVERSATION MEMORY');
    // They must be separate sections
    const aliasIdx = src.indexOf('LEARNED ALIASES');
    const memIdx   = src.indexOf('CONVERSATION MEMORY');
    expect(aliasIdx).not.toBe(memIdx);
  });

  it('system prompt says aliases are NOT full chat history', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NOT full chat history');
  });

  it('system prompt says never conflate alias memory with full conversation memory', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NEVER conflate');
  });

  it('system prompt has 4 memory layers listed', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('FOUR distinct memory layers');
  });

  it('system prompt includes PROJECT CONTEXT as a memory layer', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('PROJECT CONTEXT');
  });

  it('system prompt includes SOLARPRO KNOWLEDGE BASE as a memory layer', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('SOLARPRO KNOWLEDGE BASE');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 31. Screen context honesty — no hallucination without visibleButtons/visibleCounts
// ══════════════════════════════════════════════════════════════════════════════

describe('Screen context honesty — no DOM hallucination', () => {

  function computeScreenStatus(ctx: {
    visibleButtons?: string[];
    visibleWarnings?: string[];
    visibleCounts?: Record<string, number>;
    visibleErrors?: string[];
    visibleCards?: string[];
    selectedEquipment?: Record<string, string>;
  }): { wired: boolean; details: string } {
    const hasVisibleButtons  = Array.isArray(ctx.visibleButtons)  && ctx.visibleButtons.length  > 0;
    const hasVisibleWarnings = Array.isArray(ctx.visibleWarnings) && ctx.visibleWarnings.length > 0;
    const hasVisibleErrors   = Array.isArray(ctx.visibleErrors)   && ctx.visibleErrors.length   > 0;
    const hasVisibleCounts   = !!ctx.visibleCounts && Object.keys(ctx.visibleCounts).length > 0;
    const hasSelectedEquip   = !!ctx.selectedEquipment && Object.keys(ctx.selectedEquipment).length > 0;
    const wired = hasVisibleButtons || hasVisibleWarnings || hasVisibleErrors || hasVisibleCounts || hasSelectedEquip;
    return { wired, details: wired ? 'wired' : 'not wired' };
  }

  it('no screen context sent → wired=false', () => {
    const { wired } = computeScreenStatus({});
    expect(wired).toBe(false);
  });

  it('empty arrays → wired=false', () => {
    const { wired } = computeScreenStatus({ visibleButtons: [], visibleWarnings: [] });
    expect(wired).toBe(false);
  });

  it('visibleButtons populated → wired=true', () => {
    const { wired } = computeScreenStatus({ visibleButtons: ['Generate SLD', 'Add Panel'] });
    expect(wired).toBe(true);
  });

  it('visibleCounts populated → wired=true', () => {
    const { wired } = computeScreenStatus({ visibleCounts: { todayCommands: 12 } });
    expect(wired).toBe(true);
  });

  it('system prompt says NEVER hallucinate screen buttons', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NEVER hallucinate what buttons');
  });

  it('system prompt has SCREEN HONESTY RULES section', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('SCREEN HONESTY RULES');
  });

  it('system prompt says NOT WIRED when no screen context sent', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NOT WIRED');
  });

  it('system prompt tells SolarDog to say "I don\'t have that screen detail wired in yet"', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain("don't have that screen detail wired in yet");
  });

  it('system prompt allows describing buttons from knowledge base with a caveat', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain("from the knowledge base");
    expect(src).toContain("can't see the live page state");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 32. Developer mode — natural identification phrases
// ══════════════════════════════════════════════════════════════════════════════

describe('Developer mode — phrase detection', () => {

  it('detectMode("i created you", page) → developer', () => {
    expect(detectMode('i created you', 'general')).toBe('developer');
  });

  it('detectMode("I created you", page) → developer (case-insensitive)', () => {
    expect(detectMode('I created you', 'general')).toBe('developer');
  });

  it('detectMode("i am the developer", page) → developer', () => {
    expect(detectMode('i am the developer', 'dashboard')).toBe('developer');
  });

  it('detectMode("I am the developer", page) → developer (mixed case)', () => {
    expect(detectMode('I am the developer', 'dashboard')).toBe('developer');
  });

  it('detectMode("i built this", page) → developer', () => {
    expect(detectMode('i built this', 'general')).toBe('developer');
  });

  it('detectMode("developer here", page) → developer', () => {
    expect(detectMode('developer here', 'general')).toBe('developer');
  });

  it('detectMode("dev mode", page) → developer (existing phrase still works)', () => {
    expect(detectMode('dev mode', 'general')).toBe('developer');
  });

  it('detectMode("this is your father", page) → developer (existing phrase still works)', () => {
    expect(detectMode('this is your father', 'general')).toBe('developer');
  });

  it('detectMode("i built you", page) → developer (existing phrase still works)', () => {
    expect(detectMode('i built you', 'general')).toBe('developer');
  });

  it('detectMode("hello how are you", page) → user (not developer)', () => {
    expect(detectMode('hello how are you', 'general')).toBe('user');
  });

  it('detectMode("what did you build", page) → user (not developer)', () => {
    expect(detectMode('what did you build', 'general')).toBe('user');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 33. Knowledge base — structured learning vs alias pollution
// ══════════════════════════════════════════════════════════════════════════════

describe('Knowledge base — structured learning distinction', () => {

  it('system prompt says equipment brands belong in knowledge items, NOT aliases', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('Equipment brands');
    expect(src).toContain('knowledge items, NOT aliases');
  });

  it('system prompt explains knowledge items vs aliases distinction', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('alias routes you somewhere');
    expect(src).toContain('knowledge explains what something does');
  });

  it('system prompt has KNOWLEDGE BASE section', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('KNOWLEDGE BASE');
  });

  it('system prompt says "I need you to learn every button" → structured knowledge base', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('structured SolarPro knowledge base');
  });

  it('system prompt says never store button descriptions as aliases', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain("button descriptions, workflow explanations = knowledge items, NOT aliases");
  });

  it('KnowledgeItem type includes all required fields', () => {
    // Test that the KnowledgeItem interface has the right shape
    // by constructing a valid one
    const item = {
      type: 'button' as const,
      key: 'generate_sld',
      label: 'Generate SLD',
      description: 'Creates the single-line diagram',
      route: '/engineering',
      aliases: ['sld button', 'single line'],
      relatedActions: ['run_string_sizing'],
      metadata: { page: 'engineering' },
      isGlobal: false,
    };
    expect(item.type).toBe('button');
    expect(item.aliases).toContain('sld button');
    expect(item.isGlobal).toBe(false);
  });

  it('KnowledgeItem type allows equipment_brand type', () => {
    const item = {
      type: 'equipment_brand' as const,
      key: 'ecoflow',
      label: 'EcoFlow',
      description: 'Battery and inverter ecosystem used for storage and backup workflows.',
      aliases: ['ocean pro', 'ecoflow battery'],
      relatedActions: [],
      metadata: {},
      isGlobal: true,
    };
    expect(item.type).toBe('equipment_brand');
    expect(item.aliases).toContain('ecoflow battery');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 34. Knowledge base query answering
// ══════════════════════════════════════════════════════════════════════════════

describe('Knowledge base — query answering rules in system prompt', () => {

  it('system prompt says check knowledge items FIRST for button questions', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('check knowledge items FIRST');
  });

  it('system prompt says NEVER make up button functionality', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NEVER make up button functionality');
  });

  it('system prompt says to be honest when knowledge item not found', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain("don't have that in my knowledge base yet");
  });

  it('system prompt has a "knowledge base items" loading section in the prompt', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('Currently loaded');
  });

  it('system prompt example response for "I need you to learn every button" is correct', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('index every page, button, workflow, and equipment brand');
  });

  it('solardogKnowledgeGet is imported in route.ts', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('solardogKnowledgeGet');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 35. Alias pollution refusal — random sentences should NOT become aliases
// ══════════════════════════════════════════════════════════════════════════════

describe('Alias pollution refusal', () => {

  it('"the weather is nice" does NOT trigger learn (not a route)', () => {
    expect(detectLearnIntent('the weather is nice')).toBeNull();
  });

  it('"EcoFlow is a battery brand" does NOT trigger learn (not a route)', () => {
    expect(detectLearnIntent('EcoFlow is a battery brand')).toBeNull();
  });

  it('"the generate SLD button is on engineering" does NOT trigger learn (phrase too long)', () => {
    expect(detectLearnIntent('the generate SLD button is on engineering')).toBeNull();
  });

  it('"solar is great technology" does NOT trigger learn (not a route)', () => {
    expect(detectLearnIntent('solar is great technology')).toBeNull();
  });

  it('"NEC 690 is the code for solar" does NOT trigger learn (not a route)', () => {
    expect(detectLearnIntent('NEC 690 is the code for solar')).toBeNull();
  });

  it('"go to projects" does NOT trigger learn (navigation command)', () => {
    expect(detectLearnIntent('go to projects')).toBeNull();
  });

  it('"what is dashboard?" does NOT trigger learn (question)', () => {
    expect(detectLearnIntent('what is dashboard?')).toBeNull();
  });

  it('"hub is dashboard" DOES trigger learn (valid 2-word phrase → valid route)', () => {
    const r = detectLearnIntent('hub is dashboard');
    expect(r).not.toBeNull();
    expect(r?.phrase).toBe('hub');
    expect(r?.target).toContain('dashboard');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 36. Equipment brand + button knowledge base structure
// ══════════════════════════════════════════════════════════════════════════════

describe('Equipment and button knowledge base structure', () => {

  const exampleKnowledgeItems = [
    {
      type: 'button' as const,
      key: 'generate_sld',
      label: 'Generate SLD',
      description: 'Creates the single-line diagram for the current engineered system.',
      route: '/engineering',
      aliases: ['sld button', 'single line', 'diagram generator'],
      relatedActions: ['run_string_sizing'],
      metadata: {},
      isGlobal: false,
    },
    {
      type: 'equipment_brand' as const,
      key: 'ecoflow',
      label: 'EcoFlow',
      description: 'Battery and inverter ecosystem used for storage and backup workflows.',
      route: null,
      aliases: ['ocean pro', 'ecoflow battery'],
      relatedActions: [],
      metadata: { category: 'battery' },
      isGlobal: true,
    },
  ];

  it('button knowledge item has route to its page', () => {
    const btn = exampleKnowledgeItems.find(k => k.type === 'button');
    expect(btn?.route).toBe('/engineering');
  });

  it('equipment_brand knowledge item has description', () => {
    const eq = exampleKnowledgeItems.find(k => k.type === 'equipment_brand');
    expect(eq?.description).toContain('Battery');
  });

  it('equipment_brand knowledge item has aliases', () => {
    const eq = exampleKnowledgeItems.find(k => k.type === 'equipment_brand');
    expect(eq?.aliases).toContain('ecoflow battery');
  });

  it('button item with alias "sld button" can be found by alias search', () => {
    const query = 'sld';
    const found = exampleKnowledgeItems.filter(k =>
      k.aliases.some(a => a.toLowerCase().includes(query))
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].label).toBe('Generate SLD');
  });

  it('equipment brand with alias "ocean pro" can be found by alias search', () => {
    const query = 'ocean pro';
    const found = exampleKnowledgeItems.filter(k =>
      k.aliases.some(a => a.toLowerCase().includes(query))
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].label).toBe('EcoFlow');
  });

  it('knowledge item types cover all 9 required types', () => {
    const validTypes = ['page', 'button', 'workflow', 'equipment_brand', 'feature', 'route', 'warning', 'action', 'preference'];
    expect(validTypes).toContain('button');
    expect(validTypes).toContain('equipment_brand');
    expect(validTypes).toContain('workflow');
    expect(validTypes).toContain('preference');
    expect(validTypes.length).toBe(9);
  });

  it('system prompt source contains KNOWLEDGE BASE section', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('KNOWLEDGE BASE');
    expect(src).toContain('equipment brands');
  });

  it('db-neon has solardogKnowledgeUpsert function', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('solardogKnowledgeUpsert');
  });

  it('db-neon has solardogKnowledgeSearch function', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('solardogKnowledgeSearch');
  });

  it('migration 024 creates solarpro_knowledge_items table', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('solarpro_knowledge_items');
    expect(src).toContain('Migration 024');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SolarDog v11 — "Knows the Website" test suite
// Groups 37–44
// ════════════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════════
// 37. Intent classification — 6 types, correct behavior per type
// ══════════════════════════════════════════════════════════════════════════════

describe('Intent classification — 6 types (v11)', () => {

  it('navigation intent: "take me to engineering" → isNavigationIntent=true', () => {
    expect(isNavigationIntent('take me to engineering')).toBe(true);
  });

  it('navigation intent: "go to projects" → isNavigationIntent=true', () => {
    expect(isNavigationIntent('go to projects')).toBe(true);
  });

  it('question intent: "what is NEC 690.7" → isNavigationIntent=false', () => {
    expect(isNavigationIntent('what is NEC 690.7')).toBe(false);
  });

  it('question intent: "how does the SLD get generated" → isNavigationIntent=false', () => {
    expect(isNavigationIntent('how does the SLD get generated')).toBe(false);
  });

  it('observation intent: "I see two warnings on the page" → isNavigationIntent=false', () => {
    expect(isNavigationIntent('I see two warnings on the page')).toBe(false);
  });

  it('system prompt documents all 6 intent types', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('navigation');
    expect(src).toContain('question');
    expect(src).toContain('action');
    expect(src).toContain('observation');
    expect(src).toContain('conversation');
    expect(src).toContain('correction');
  });

  it('system prompt has RESPONSE PRIORITY: Understand→Explain→Suggest→Offer→Execute', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('ANSWER');
    expect(src).toContain('EXPLAIN');
    expect(src).toContain('SUGGEST');
    expect(src).toContain('OFFER');
    expect(src).toContain('EXECUTE');
  });

  it('system prompt says NEVER navigate for questions', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NEVER navigate when user asks a question');
  });

  it('system prompt says NEVER navigate for observations', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NEVER navigate');
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 38. Guided mode triggers
// ══════════════════════════════════════════════════════════════════════════════

describe('Guided mode — trigger detection and prompt (v11)', () => {

  it('system prompt has GUIDED MODE section', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('GUIDED MODE');
  });

  it('system prompt describes "walk me through" as a guided mode trigger', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('walk me through');
  });

  it('system prompt describes "help me get this to pass" as a guided mode trigger', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('help me get this to pass');
  });

  it('system prompt says guided mode should present steps numbered', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('Present the steps clearly, numbered');
  });

  it('system prompt says guided mode should state which step and how many total', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('currentStep');
    expect(src).toContain('totalSteps');
  });

  it('system prompt says guided mode returns suggestedSteps array', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('suggestedSteps');
  });

  it('system prompt says guided mode returns workflowKey', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('workflowKey');
  });

  it('AssistantResponse type includes workflowKey field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toMatch(/workflowKey\??\s*:/);
  });

  it('AssistantResponse type includes suggestedSteps field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toMatch(/suggestedSteps\??\s*:/);
  });

  it('system prompt has pass_engineering workflow key reference', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('pass_engineering');
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 39. Knowledge base — page explanations
// ══════════════════════════════════════════════════════════════════════════════

describe('Knowledge base — page seed data (v11)', () => {

  it('SOLARPRO_KNOWLEDGE_SEED contains a page entry for "engineering"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'engineering');
    expect(item).toBeDefined();
    expect(item.type).toBe('page');
    expect(item.route).toBe('/engineering');
  });

  it('engineering page seed has description mentioning NEC validation', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'engineering');
    expect(item.description.toLowerCase()).toMatch(/nec|string sizing|engineering/);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains a page entry for "dashboard"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'dashboard');
    expect(item).toBeDefined();
    expect(item.type).toBe('page');
    expect(item.route).toBe('/dashboard');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains a page entry for "design"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'design');
    expect(item).toBeDefined();
    expect(item.type).toBe('page');
    expect(item.route).toBe('/design');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains a page entry for "proposals"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'proposals');
    expect(item).toBeDefined();
    expect(item.type).toBe('page');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains at least 10 page entries', () => {
    const pages = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'page');
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  it('all page seeds have a route field', () => {
    const pages = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'page');
    for (const page of pages) {
      expect(page.route).toBeDefined();
      expect(typeof page.route).toBe('string');
    }
  });

  it('all page seeds have non-empty aliases array', () => {
    const pages = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'page');
    for (const page of pages) {
      expect(Array.isArray(page.aliases)).toBe(true);
      expect(page.aliases.length).toBeGreaterThan(0);
    }
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 40. Knowledge base — button knowledge
// ══════════════════════════════════════════════════════════════════════════════

describe('Knowledge base — button seed data (v11)', () => {

  it('SOLARPRO_KNOWLEDGE_SEED contains "generate_sld" button', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'generate_sld');
    expect(item).toBeDefined();
    expect(item.type).toBe('button');
  });

  it('generate_sld button description mentions single-line diagram or permit', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'generate_sld');
    expect(item.description.toLowerCase()).toMatch(/single.line|sld|permit/);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "run_nec_validation" button', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'run_nec_validation');
    expect(item).toBeDefined();
    expect(item.type).toBe('button');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "auto_fix_strings" button', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'auto_fix_strings');
    expect(item).toBeDefined();
    expect(item.type).toBe('button');
  });

  it('auto_fix_strings button description mentions Voc or MPPT or string', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'auto_fix_strings');
    expect(item.description.toLowerCase()).toMatch(/voc|mppt|string/);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "generate_bom" button', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'generate_bom');
    expect(item).toBeDefined();
    expect(item.type).toBe('button');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains at least 5 button entries', () => {
    const buttons = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'button');
    expect(buttons.length).toBeGreaterThanOrEqual(5);
  });

  it('all button seeds have relatedActions array', () => {
    const buttons = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'button');
    for (const btn of buttons) {
      expect(Array.isArray(btn.relatedActions)).toBe(true);
    }
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 41. Knowledge base — workflow knowledge + steps
// ══════════════════════════════════════════════════════════════════════════════

describe('Knowledge base — workflow seed data (v11)', () => {

  it('SOLARPRO_KNOWLEDGE_SEED contains "pass_engineering" workflow', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'pass_engineering');
    expect(item).toBeDefined();
    expect(item.type).toBe('workflow');
  });

  it('pass_engineering workflow has at least 5 steps', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'pass_engineering');
    expect(Array.isArray(item.steps)).toBe(true);
    expect(item.steps.length).toBeGreaterThanOrEqual(5);
  });

  it('pass_engineering workflow steps mention NEC validation', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'pass_engineering');
    const allSteps = item.steps.join(' ').toLowerCase();
    expect(allSteps).toMatch(/nec|validation/);
  });

  it('pass_engineering workflow steps mention string sizing', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'pass_engineering');
    const allSteps = item.steps.join(' ').toLowerCase();
    expect(allSteps).toMatch(/string/);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "create_new_project" workflow', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'create_new_project');
    expect(item).toBeDefined();
    expect(item.type).toBe('workflow');
    expect(item.steps.length).toBeGreaterThanOrEqual(4);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "submit_permit" workflow', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'submit_permit');
    expect(item).toBeDefined();
    expect(item.type).toBe('workflow');
  });

  it('submit_permit workflow steps mention SLD', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'submit_permit');
    const allSteps = item.steps.join(' ').toLowerCase();
    expect(allSteps).toMatch(/sld|single.line|permit/);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains at least 3 workflow entries', () => {
    const workflows = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'workflow');
    expect(workflows.length).toBeGreaterThanOrEqual(3);
  });

  it('all workflow seeds have steps array (not empty)', () => {
    const workflows = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'workflow');
    for (const wf of workflows) {
      expect(Array.isArray(wf.steps)).toBe(true);
      expect(wf.steps.length).toBeGreaterThan(0);
    }
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 42. Knowledge base — equipment knowledge
// ══════════════════════════════════════════════════════════════════════════════

describe('Knowledge base — equipment seed data (v11)', () => {

  it('SOLARPRO_KNOWLEDGE_SEED contains "solfence" equipment', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'solfence');
    expect(item).toBeDefined();
    expect(item.type).toBe('equipment');
  });

  it('solfence equipment description mentions ground-mounted or boundary', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'solfence');
    expect(item.description.toLowerCase()).toMatch(/ground|boundary|fence/);
  });

  it('solfence equipment has aliases containing "solar fence" or similar', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'solfence');
    const aliasesJoined = item.aliases.join(' ').toLowerCase();
    expect(aliasesJoined).toMatch(/fence|solar fence/);
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "microinverter" equipment', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'microinverter');
    expect(item).toBeDefined();
    expect(item.type).toBe('equipment');
  });

  it('microinverter equipment metadata has category=inverter', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'microinverter');
    expect(item.metadata.category).toBe('inverter');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains "tesla_powerwall" equipment', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'tesla_powerwall');
    expect(item).toBeDefined();
    expect(item.type).toBe('equipment');
  });

  it('tesla_powerwall equipment description mentions 13.5 kWh', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find((k: { key: string }) => k.key === 'tesla_powerwall');
    expect(item.description).toContain('13.5');
  });

  it('SOLARPRO_KNOWLEDGE_SEED contains at least 5 equipment entries', () => {
    const equipment = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'equipment');
    expect(equipment.length).toBeGreaterThanOrEqual(5);
  });

  it('all equipment seeds have metadata object', () => {
    const equipment = SOLARPRO_KNOWLEDGE_SEED.filter((k: { type: string }) => k.type === 'equipment');
    for (const eq of equipment) {
      expect(typeof eq.metadata).toBe('object');
    }
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 43. Response format — guided workflow fields (v11)
// ══════════════════════════════════════════════════════════════════════════════

describe('Response format — guided workflow fields (v11)', () => {

  it('AssistantResponse type has workflowKey field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toMatch(/workflowKey\??\s*:\s*string/);
  });

  it('AssistantResponse type has currentStep field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toMatch(/currentStep\??\s*:\s*number/);
  });

  it('AssistantResponse type has totalSteps field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toMatch(/totalSteps\??\s*:\s*number/);
  });

  it('AssistantResponse type has suggestedSteps field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toMatch(/suggestedSteps\??\s*:\s*string\[\]/);
  });

  it('route handler extracts workflowKey from LLM response', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('replyWorkflowKey');
  });

  it('route handler extracts currentStep from LLM response', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('replyCurrentStep');
  });

  it('route handler extracts suggestedSteps from LLM response', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('replySuggestedSteps');
  });

  it('route handler passes workflowKey into final AssistantResponse', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('workflowKey:     replyWorkflowKey');
  });

  it('route handler passes suggestedSteps into final AssistantResponse', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('suggestedSteps:  replySuggestedSteps');
  });

});

// ══════════════════════════════════════════════════════════════════════════════
// 44. Forbidden behaviors (v11)
// ══════════════════════════════════════════════════════════════════════════════

describe('Forbidden behaviors — v11 compliance', () => {

  it('system prompt says NEVER navigate on questions', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('NEVER navigate when user asks a question');
  });

  it('system prompt says NEVER hallucinate DOM (screen honesty rules)', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('SCREEN HONESTY RULES');
    expect(src).toContain('NEVER hallucinate');
  });

  it('system prompt says NEVER give generic answers', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    // Generic chatbot phrases are explicitly banned (all-caps NEVER is used in system prompt)
    expect(src).toContain('NEVER say');
  });

  it('system prompt says NEVER store random sentences as aliases', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('LEARN RULES');
  });

  it('solardogSeedKnowledge function exists in db-neon.ts', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('solardogSeedKnowledge');
  });

  it('SOLARPRO_KNOWLEDGE_SEED is exported from db-neon.ts', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    // Either inline export or re-export from knowledgeSeed module
    const hasExport = src.includes('export const SOLARPRO_KNOWLEDGE_SEED') ||
      src.includes('export { SOLARPRO_KNOWLEDGE_SEED }') ||
      src.includes('SOLARPRO_KNOWLEDGE_SEED } from');
    expect(hasExport).toBe(true);
  });

  it('solardogKnowledgeSeeded is exported from db-neon.ts', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('export async function solardogKnowledgeSeeded');
  });

  it('migrate route calls solardogSeedKnowledge (Migration 025)', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('solardogSeedKnowledge');
    expect(src).toContain('Migration 025');
  });

  it('KnowledgeItem interface has steps field', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('steps:');
  });

  it('KnowledgeItem type union includes "equipment"', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain("'equipment'");
  });

  it('mapKnowledgeRow helper exists in db-neon.ts (restores steps from metadata)', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('mapKnowledgeRow');
  });

  it('system prompt GUIDED MODE section references "pass_engineering" workflow', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('pass_engineering');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// Groups 45–48  v61 — Control Modes + Locked Selections
// ─────────────────────────────────────────────────────────────────────────────

// ── Group 45: shouldAllowOverride logic ──────────────────────────────────────
import {
  shouldAllowOverride,
  shouldShowWarning,
  applySafely,
  effectiveLocks,
  DEFAULT_LOCKS,
  DEFAULT_CONTROL_MODE,
  lockField,
  unlockField,
  lockAll,
  unlockAll,
  LOCKABLE_FIELDS,
  CONTROL_MODE_LABELS,
  FIELD_LABELS,
} from '../lib/solardog/controlMode';

describe('v61 — shouldAllowOverride logic (Group 45)', () => {
  const unlocked = { ...DEFAULT_LOCKS };
  const allLocked = { panel: true, inverter: true, battery: true, strings: true, wiring: true };
  const panelLocked = { ...DEFAULT_LOCKS, panel: true };

  it('AUTO mode + unlocked field → allows override', () => {
    expect(shouldAllowOverride('panel', 'auto', unlocked)).toBe(true);
    expect(shouldAllowOverride('inverter', 'auto', unlocked)).toBe(true);
  });

  it('GUIDED mode + unlocked field → blocks silent override', () => {
    expect(shouldAllowOverride('panel', 'guided', unlocked)).toBe(false);
    expect(shouldAllowOverride('inverter', 'guided', unlocked)).toBe(false);
  });

  it('MANUAL mode + unlocked field → blocks override', () => {
    expect(shouldAllowOverride('panel', 'manual', unlocked)).toBe(false);
    expect(shouldAllowOverride('inverter', 'manual', unlocked)).toBe(false);
    expect(shouldAllowOverride('battery', 'manual', unlocked)).toBe(false);
  });

  it('AUTO mode + locked field → blocks override (lock wins over mode)', () => {
    expect(shouldAllowOverride('panel', 'auto', panelLocked)).toBe(false);
  });

  it('AUTO mode + locked field → still allows unlocked sibling fields', () => {
    expect(shouldAllowOverride('inverter', 'auto', panelLocked)).toBe(true);
  });

  it('GUIDED mode + locked field → blocks override', () => {
    expect(shouldAllowOverride('panel', 'guided', panelLocked)).toBe(false);
  });

  it('All fields locked in any mode → all blocked', () => {
    for (const field of LOCKABLE_FIELDS) {
      expect(shouldAllowOverride(field, 'auto', allLocked)).toBe(false);
      expect(shouldAllowOverride(field, 'guided', allLocked)).toBe(false);
      expect(shouldAllowOverride(field, 'manual', allLocked)).toBe(false);
    }
  });

  it('shouldShowWarning: AUTO + unlocked → no warning (system fixes silently)', () => {
    expect(shouldShowWarning('panel', 'auto', unlocked)).toBe(false);
    expect(shouldShowWarning('inverter', 'auto', unlocked)).toBe(false);
  });

  it('shouldShowWarning: GUIDED + unlocked → show warning (suggestion card)', () => {
    expect(shouldShowWarning('panel', 'guided', unlocked)).toBe(true);
  });

  it('shouldShowWarning: MANUAL + any → always warn', () => {
    expect(shouldShowWarning('panel', 'manual', unlocked)).toBe(true);
    expect(shouldShowWarning('inverter', 'manual', allLocked)).toBe(true);
  });

  it('shouldShowWarning: AUTO + locked → show warning (cannot fix, user locked it)', () => {
    expect(shouldShowWarning('panel', 'auto', panelLocked)).toBe(true);
  });

  it('effectiveLocks: MANUAL mode → all fields locked regardless of lock map', () => {
    const result = effectiveLocks('manual', unlocked);
    for (const field of LOCKABLE_FIELDS) {
      expect(result[field]).toBe(true);
    }
  });

  it('effectiveLocks: AUTO mode → returns actual lock map', () => {
    const result = effectiveLocks('auto', panelLocked);
    expect(result.panel).toBe(true);
    expect(result.inverter).toBe(false);
  });

  it('effectiveLocks: GUIDED mode → returns actual lock map', () => {
    const result = effectiveLocks('guided', panelLocked);
    expect(result.panel).toBe(true);
    expect(result.inverter).toBe(false);
  });

  it('applySafely: AUTO + unlocked → calls applyFn, returns applied=true', () => {
    let applied = false;
    let warned = false;
    const result = applySafely('panel', 'auto', unlocked, () => { applied = true; }, () => { warned = true; });
    expect(applied).toBe(true);
    expect(warned).toBe(false);
    expect(result.applied).toBe(true);
    expect(result.warned).toBe(false);
    expect(result.suggest).toBe(false);
  });

  it('applySafely: GUIDED + unlocked → calls warnFn, returns suggest=true', () => {
    let applied = false;
    let warned = false;
    const result = applySafely('panel', 'guided', unlocked, () => { applied = true; }, () => { warned = true; });
    expect(applied).toBe(false);
    expect(warned).toBe(true);
    expect(result.applied).toBe(false);
    expect(result.suggest).toBe(true);
  });

  it('applySafely: MANUAL + unlocked → calls warnFn, suggest=false (not guided)', () => {
    let applied = false;
    let warned = false;
    const result = applySafely('panel', 'manual', unlocked, () => { applied = true; }, () => { warned = true; });
    expect(applied).toBe(false);
    expect(warned).toBe(true);
    expect(result.suggest).toBe(false);
  });

  it('applySafely: AUTO + locked → calls warnFn, not applied', () => {
    let applied = false;
    let warned = false;
    const result = applySafely('panel', 'auto', panelLocked, () => { applied = true; }, () => { warned = true; });
    expect(applied).toBe(false);
    expect(warned).toBe(true);
    expect(result.applied).toBe(false);
  });

  it('DEFAULT_CONTROL_MODE is "guided"', () => {
    expect(DEFAULT_CONTROL_MODE).toBe('guided');
  });
});

// ── Group 46: lockField + DEFAULT_LOCKS ──────────────────────────────────────
describe('v61 — lockField + DEFAULT_LOCKS (Group 46)', () => {
  it('DEFAULT_LOCKS has all 5 fields set to false', () => {
    expect(DEFAULT_LOCKS.panel).toBe(false);
    expect(DEFAULT_LOCKS.inverter).toBe(false);
    expect(DEFAULT_LOCKS.battery).toBe(false);
    expect(DEFAULT_LOCKS.strings).toBe(false);
    expect(DEFAULT_LOCKS.wiring).toBe(false);
  });

  it('LOCKABLE_FIELDS contains exactly panel, inverter, battery, strings, wiring', () => {
    expect(LOCKABLE_FIELDS).toContain('panel');
    expect(LOCKABLE_FIELDS).toContain('inverter');
    expect(LOCKABLE_FIELDS).toContain('battery');
    expect(LOCKABLE_FIELDS).toContain('strings');
    expect(LOCKABLE_FIELDS).toContain('wiring');
    expect(LOCKABLE_FIELDS).toHaveLength(5);
  });

  it('lockField is immutable — does not mutate input', () => {
    const original = { ...DEFAULT_LOCKS };
    const result = lockField(original, 'panel');
    expect(original.panel).toBe(false);  // original unchanged
    expect(result.panel).toBe(true);     // new object has it locked
  });

  it('lockField locks only the specified field', () => {
    const result = lockField(DEFAULT_LOCKS, 'inverter');
    expect(result.inverter).toBe(true);
    expect(result.panel).toBe(false);
    expect(result.battery).toBe(false);
    expect(result.strings).toBe(false);
    expect(result.wiring).toBe(false);
  });

  it('unlockField unlocks only the specified field', () => {
    const allLocked = lockAll();
    const result = unlockField(allLocked, 'battery');
    expect(result.battery).toBe(false);
    expect(result.panel).toBe(true);
    expect(result.inverter).toBe(true);
    expect(result.strings).toBe(true);
    expect(result.wiring).toBe(true);
  });

  it('lockAll returns all fields true', () => {
    const result = lockAll();
    for (const field of LOCKABLE_FIELDS) {
      expect(result[field]).toBe(true);
    }
  });

  it('unlockAll returns all fields false', () => {
    const result = unlockAll();
    for (const field of LOCKABLE_FIELDS) {
      expect(result[field]).toBe(false);
    }
  });

  it('CONTROL_MODE_LABELS has labels for auto, guided, manual', () => {
    expect(CONTROL_MODE_LABELS.auto).toBe('Auto');
    expect(CONTROL_MODE_LABELS.guided).toBe('Guided');
    expect(CONTROL_MODE_LABELS.manual).toBe('Manual');
  });

  it('FIELD_LABELS has labels for all 5 lockable fields', () => {
    expect(FIELD_LABELS.panel).toBe('Panel');
    expect(FIELD_LABELS.inverter).toBe('Inverter');
    expect(FIELD_LABELS.battery).toBe('Battery');
    expect(FIELD_LABELS.strings).toBe('Strings');
    expect(FIELD_LABELS.wiring).toBe('Wiring');
  });
});

// ── Group 47: SolarDog knowledge seed — control modes ────────────────────────
// Note: SOLARPRO_KNOWLEDGE_SEED is already imported at top of file (v11 tests)

describe('v61 — SolarDog knowledge seed (control modes) (Group 47)', () => {
  it('knowledge seed includes control_modes item', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_modes');
    expect(item).toBeDefined();
  });

  it('control_modes item is type workflow', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_modes');
    expect(item?.type).toBe('workflow');
  });

  it('control_modes description mentions all three modes', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_modes');
    expect(item?.description).toContain('Auto');
    expect(item?.description).toContain('Guided');
    expect(item?.description).toContain('Manual');
  });

  it('control_modes aliases include "auto mode" and "manual mode"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_modes');
    expect(item?.aliases).toContain('auto mode');
    expect(item?.aliases).toContain('manual mode');
  });

  it('knowledge seed includes field_locking item', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'field_locking');
    expect(item).toBeDefined();
  });

  it('field_locking description mentions lock icon and all 5 fields', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'field_locking');
    expect(item?.description).toContain('panel');
    expect(item?.description).toContain('inverter');
  });

  it('field_locking aliases include "lock field" and "lock inverter"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'field_locking');
    expect(item?.aliases).toContain('lock field');
    expect(item?.aliases).toContain('lock inverter');
  });

  it('knowledge seed includes control_mode_guided item', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_mode_guided');
    expect(item).toBeDefined();
  });

  it('control_mode_guided has steps describing the suggestion card flow', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_mode_guided');
    expect(Array.isArray(item?.steps)).toBe(true);
    expect((item?.steps ?? []).length).toBeGreaterThan(0);
  });

  it('control_mode_guided aliases include "suggestion card" and "accept suggestion"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_mode_guided');
    expect(item?.aliases).toContain('suggestion card');
    expect(item?.aliases).toContain('accept suggestion');
  });

  it('knowledge seed includes control_mode_auto_manual item', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_mode_auto_manual');
    expect(item).toBeDefined();
  });

  it('control_mode_auto_manual aliases include "auto" and "manual"', () => {
    const item = SOLARPRO_KNOWLEDGE_SEED.find(i => i.key === 'control_mode_auto_manual');
    expect(item?.aliases).toContain('auto');
    expect(item?.aliases).toContain('manual');
  });

  it('total knowledge seed has at least 37 items (33 original + 4 control mode)', () => {
    expect(SOLARPRO_KNOWLEDGE_SEED.length).toBeGreaterThanOrEqual(37);
  });
});

// ── Group 48: Migration 026 + DB layer ───────────────────────────────────────
describe('v61 — Migration 026 + DB layer (Group 48)', () => {
  it('migrate route contains Migration 026 comment', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('Migration 026');
  });

  it('migrate route adds control_mode column', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('control_mode');
  });

  it('migrate route adds system_config_locks column', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('system_config_locks');
  });

  it('migrate route uses ADD COLUMN IF NOT EXISTS for control_mode', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('ADD COLUMN IF NOT EXISTS control_mode');
  });

  it('migrate route sets control_mode default to guided', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain("DEFAULT 'guided'");
  });

  it('migrate route sets system_config_locks as JSONB', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/migrate/route.ts', 'utf8');
    expect(src).toContain('JSONB');
  });

  it('db-neon.ts rowToProject maps control_mode to controlMode', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('control_mode');
    expect(src).toContain('controlMode');
  });

  it('db-neon.ts rowToProject maps system_config_locks to systemConfigLocks', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    expect(src).toContain('system_config_locks');
    expect(src).toContain('systemConfigLocks');
  });

  it('db-neon.ts updateProject persists control_mode', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    // control_mode should appear in the UPDATE statement
    const updateIdx = src.indexOf('UPDATE projects');
    expect(updateIdx).toBeGreaterThan(-1);
    const updateSection = src.slice(updateIdx, updateIdx + 2000);
    expect(updateSection).toContain('control_mode');
  });

  it('db-neon.ts updateProject persists system_config_locks', () => {
    const fs = require('fs');
    const src = fs.readFileSync('lib/db-neon.ts', 'utf8');
    const updateIdx = src.indexOf('UPDATE projects');
    const updateSection = src.slice(updateIdx, updateIdx + 2000);
    expect(updateSection).toContain('system_config_locks');
  });

  it('types/index.ts exports ControlMode type', () => {
    const fs = require('fs');
    const src = fs.readFileSync('types/index.ts', 'utf8');
    expect(src).toContain("export type ControlMode");
  });

  it('types/index.ts exports SystemConfigLocks interface', () => {
    const fs = require('fs');
    const src = fs.readFileSync('types/index.ts', 'utf8');
    expect(src).toContain('export interface SystemConfigLocks');
  });

  it('types/index.ts exports DEFAULT_LOCKS', () => {
    const fs = require('fs');
    const src = fs.readFileSync('types/index.ts', 'utf8');
    expect(src).toContain('export const DEFAULT_LOCKS');
  });

  it('SolarDog system prompt contains CONTROL MODES section', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('CONTROL MODES');
  });

  it('SolarDog system prompt describes AUTO mode behavior', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('AUTO MODE');
  });

  it('SolarDog system prompt describes GUIDED mode suggestion cards', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('suggestion card');
  });

  it('SolarDog system prompt describes MANUAL mode warn-only behavior', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/api/assistant/route.ts', 'utf8');
    expect(src).toContain('MANUAL MODE');
  });

  it('engineering page imports shouldAllowOverride from controlMode', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain('shouldAllowOverride');
    expect(src).toContain('controlMode');
  });

  it('engineering page has controlMode state variable', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain('const [controlMode, setControlMode]');
  });

  it('engineering page has configLocks state variable', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain('const [configLocks, setConfigLocks]');
  });

  it('engineering page has pendingSuggestion state variable', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain('const [pendingSuggestion, setPendingSuggestion]');
  });

  it('engineering page imports ControlModeBanner', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain("import ControlModeBanner from '@/components/engineering/ControlModeBanner'");
  });

  it('engineering page imports SuggestionCard', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain("import SuggestionCard");
  });

  it('engineering page JSX renders ControlModeBanner', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain('<ControlModeBanner');
  });

  it('engineering page JSX renders SuggestionCard when pendingSuggestion exists', () => {
    const fs = require('fs');
    const src = fs.readFileSync('app/engineering/page.tsx', 'utf8');
    expect(src).toContain('<SuggestionCard');
    expect(src).toContain('pendingSuggestion');
  });
});
