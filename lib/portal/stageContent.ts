/**
 * lib/portal/stageContent.ts
 *
 * 🚨 ONE AUTHORITY FOR CUSTOMER-FACING STAGE PROSE. THERE WERE THREE, AND THEY
 *    CONTRADICTED EACH OTHER ON THE SAME PROJECT, MINUTES APART.
 *
 * Before this file, the words a homeowner reads about "what stage am I at"
 * existed in three hardcoded tables:
 *
 *   1. app/portal/dashboard/page.tsx        — the portal the homeowner reads.
 *   2. app/api/admin/projects/[id]/route.ts — the stage-advance EMAIL, sent by
 *      the same admin click that moves the stage. Its `installation` entry read
 *      "Your solar system is being installed! Our crew is on-site." while the
 *      portal page it links to said the installation was still being planned and
 *      a date would follow. One admin action, two minutes apart, two
 *      irreconcilable claims — and the email is the one that arrives with a
 *      link, so the homeowner clicks through to be contradicted.
 *   3. app/admin/projects/[id]/portal-preview/page.tsx — the screen a rep opens
 *      while ON THE PHONE with that homeowner, under a banner reading "This is
 *      exactly what <name> sees in their portal." Different words, a different
 *      step name, and none of the things the customer can actually act on.
 *
 * Copy that a customer reads is not a per-file detail; it is a claim the company
 * makes. Three copies of a claim is three claims. So the prose lives here and
 * every surface reads it.
 *
 * WHAT BELONGS HERE: the words. Headline, body, what happens next, what (if
 * anything) the homeowner has to do, the roadmap label and the step number.
 *
 * WHAT DOES NOT: presentation. The portal renders an emoji inside its timeline
 * node, the admin preview renders a lucide icon, and neither is prose — the
 * emoji lives here only because it is part of the portal's published roadmap and
 * the preview may show it too. Layout, colour and icon components stay with the
 * component that draws them.
 *
 * ⚠ EDITING THIS FILE CHANGES WHAT CUSTOMERS ARE TOLD, IN THE PORTAL AND IN
 *   THEIR INBOX, AT THE SAME TIME. That is the point. A stage's copy must be
 *   true at the MOMENT THE STAGE IS ENTERED — see the rule in
 *   tests/stageEntryIsNotAnOutcome.test.ts: entering a stage is not evidence of
 *   its outcome. "We're handling permits and lining up your crew" is true on
 *   entry to `installation`; "our crew is on-site" is not, and that is exactly
 *   the sentence this consolidation deleted.
 */

/** The seven customer-visible phases, in order. */
export const HOMEOWNER_STAGES = [
  'lead_submitted',
  'under_review',
  'site_survey',
  'design',
  'proposal',
  'installation',
  'completed',
] as const;

export type HomeownerStage = (typeof HOMEOWNER_STAGES)[number];

/** Render order of the roadmap. Same list; named for the readers that draw it. */
export const ROADMAP_STEPS: readonly HomeownerStage[] = HOMEOWNER_STAGES;

/** How many steps the customer is told there are ("Step 3 of 7"). */
export const TOTAL_STAGE_STEPS = HOMEOWNER_STAGES.length;

export type StageContent = {
  /** Short label used on the roadmap and as the email's subject-line label. */
  roadmapLabel: string;
  /** 1-based position in the roadmap. */
  stepNum: number;
  /** The one-line claim at the top of the stage card. */
  headline: string;
  /** The paragraph under it. */
  body: string;
  /** What happens next, from the homeowner's point of view. May be ''. */
  next: string;
  /** What the homeowner should do — or an explicit "nothing right now". */
  action: string;
  /** Whether `action` asks something of the homeowner. */
  actionIsRequired: boolean;
  /** Roadmap glyph for the current step. Presentation, kept with the copy. */
  emoji: string;
};

export const STAGE_CONTENT: Record<HomeownerStage, StageContent> = {
  lead_submitted: {
    roadmapLabel: 'Request Received', stepNum: 1,
    headline: 'We received your request.',
    body: "We've created your project and our team is getting familiar with your home and energy needs. You'll hear from us soon.",
    next: "We'll review your project and reach out shortly.",
    action: 'Nothing to do right now — sit tight!',
    actionIsRequired: false, emoji: '📋',
  },
  under_review: {
    roadmapLabel: 'Under Review', stepNum: 2,
    headline: "We're reviewing your project.",
    body: "Our team is analyzing your home, roof, and energy profile to determine the right solar system for you. This typically takes 1–2 business days.",
    next: "We'll schedule a visit to your home.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '🔍',
  },
  site_survey: {
    roadmapLabel: 'Home Visit', stepNum: 3,
    headline: "We're visiting your home.",
    body: "A technician will visit your property to take measurements and confirm the details needed to build you an accurate solar design.",
    next: "After the visit, we'll begin designing your system.",
    action: "We'll reach out to confirm your appointment time. Please be available.",
    actionIsRequired: true, emoji: '🏠',
  },
  design: {
    roadmapLabel: 'Designing Your System', stepNum: 4,
    headline: "We're designing your solar system.",
    body: "Our team is building a custom solar plan for your home — optimizing panel placement, system size, and projected energy output.",
    next: "We'll deliver your complete proposal.",
    action: 'Nothing to do right now.',
    actionIsRequired: false, emoji: '⚡',
  },
  proposal: {
    roadmapLabel: 'Proposal Ready', stepNum: 5,
    headline: 'Your proposal is ready.',
    body: "We've put together your complete solar plan — system size, estimated annual savings, financing options, and available incentives.",
    next: "Once you approve, we move straight to installation.",
    action: "Review your proposal and sign when you're ready.",
    actionIsRequired: true, emoji: '📄',
  },
  installation: {
    roadmapLabel: 'Installation', stepNum: 6,
    headline: 'Your installation is being planned.',
    body: "We're handling permits and lining up your installation crew. Everything is in motion — you'll receive a confirmed date soon.",
    next: "We'll reach out to confirm your installation date.",
    action: "Watch for our call or email with scheduling details.",
    actionIsRequired: true, emoji: '🔧',
  },
  completed: {
    roadmapLabel: 'System Live', stepNum: 7,
    headline: 'Your solar system is live! 🎉',
    body: "Your panels are installed, inspected, and generating clean energy right now. Welcome to energy independence.",
    next: '',
    action: "You're all set. Enjoy the savings.",
    actionIsRequired: false, emoji: '🌟',
  },
};

/** `"Step 3 of 7"` — derived, so the count can never drift from the list. */
export function stageStepLabel(stage: HomeownerStage): string {
  return `Step ${STAGE_CONTENT[stage].stepNum} of ${TOTAL_STAGE_STEPS}`;
}

/** Position in the roadmap, or -1 for a null/unknown stage. */
export function getStageIndex(stage: HomeownerStage | null | undefined): number {
  if (!stage) return -1;
  return ROADMAP_STEPS.indexOf(stage);
}

/**
 * The copy the stage-advance email sends, taken from the same table the portal
 * renders. Returns null for a stage that has no content, so a caller cannot
 * email an empty template.
 */
export function stageEmailContent(
  stage: string,
): { label: string; body: string; next: string } | null {
  const content = (STAGE_CONTENT as Record<string, StageContent | undefined>)[stage];
  if (!content) return null;
  return { label: content.roadmapLabel, body: content.body, next: content.next };
}
