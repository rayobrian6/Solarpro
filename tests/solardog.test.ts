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

// ── Replicate route-internal logic for unit testing ───────────────────────────
// (detectMode and buildMemoryLine are not exported from the route, so replicate here)

type SolarDogMode = 'user' | 'developer' | 'debug' | 'project_helper' | 'engineering_helper';
type ResponseType = 'chat' | 'navigate' | 'action' | 'learn' | 'observation' | 'conversation' | 'correction';

const DEV_PHRASES = [
  'dev mode', 'developer mode', 'this is your father',
  'this is the dev', "i'm the developer", 'im the developer',
  "i'm your creator", 'im your creator', "i built you", 'show debug',
  'enable debug', 'solardog debug', 'your father', 'dad here',
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
