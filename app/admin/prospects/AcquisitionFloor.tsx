'use client';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════
 *  THE ACQUISITION FLOOR — A Gaslit Gothic Sweatshop
 *  "It was night, and the rain fell; and, falling, it streamed through
 *   the dim lamp that swung from the ceiling, and glistened upon the
 *   worn floor, as though the very house were weeping."
 *                                   — after Edgar Allan Poe
 *
 *  Six workshop bays, each a chamber of toil and dread. An Overseer
 *  with top hat and whip paces the catwalk, barking orders that would
 *  make a Dickens villain blush. Clerks faint, ravens croak, bats
 *  wheel, lightning splits the dark, and the Tell-Tale Heart beats
 *  beneath the floorboards of the Assay Room. Counts are LIVE.
 * ═══════════════════════════════════════════════════════════════
 */

type Stage =
  | 'discovered' | 'enriched' | 'qualified' | 'contacted' | 'signed_up' | 'rejected';

type RoomDef = {
  stage: Stage; name: string; tag: string; banner: string; poe: string;
  accent: string; glow: string; wall: string; wallDeep: string; lines: string[];
};

const ROOMS: RoomDef[] = [
  { stage: 'discovered', name: 'THE SCOUTING ROOM', tag: 'Discovery', banner: 'FIND MORE INSTALLERS', poe: '"The impalpable origin of the thing is never found."',
    accent: '#5eead4', glow: 'rgba(45,212,191,0.30)', wall: '#0e1c18', wallDeep: '#081210',
    lines: ['found one!', 'another name!', 'add to the ledger', 'I spy a firm', 'scouring the maps', 'dust off the atlas'] },
  { stage: 'enriched', name: 'THE COPYING ROOM', tag: 'Contact intel', banner: 'GET THEIR DIGITS', poe: '"We copied it all from the pages of the lost."',
    accent: '#7dd3fc', glow: 'rgba(56,189,248,0.30)', wall: '#0a1520', wallDeep: '#060d14',
    lines: ['got the email!', 'phone number \u2713', 'fattening the file', 'copying it all', 'ink upon parchment'] },
  { stage: 'qualified', name: 'THE ASSAY ROOM', tag: 'Vetting', banner: 'ONLY THE WORTHY', poe: '"We weighed, we measured \u2014 and the heart beneath beat on."',
    accent: '#c4b5fd', glow: 'rgba(167,139,250,0.30)', wall: '#140e22', wallDeep: '#0a0714',
    lines: ['licensed, aye', 'a worthy firm', 'checking papers', 'grade A!', 'the scales tip'] },
  { stage: 'contacted', name: 'THE POST ROOM', tag: 'Pitching', banner: 'SEAL THE LETTER', poe: '"Sealed with a sigil of dread and of desire."',
    accent: '#fcd34d', glow: 'rgba(251,191,36,0.34)', wall: '#1a1408', wallDeep: '#0e0a04',
    lines: ['letter sent!', 'awaiting reply', 'posted by courier', 'no word yet\u2026', 'the raven waits'] },
  { stage: 'signed_up', name: 'THE COUNTING HOUSE', tag: 'Customers', banner: 'KA-CHING', poe: '"And the coffers swelled as coffins fill."',
    accent: '#6ee7b7', glow: 'rgba(52,211,153,0.40)', wall: '#0c1a12', wallDeep: '#060e09',
    lines: ['a deal struck!', 'signed in ink', 'welcome aboard!', 'the coffers fill!', 'gold upon gold'] },
  { stage: 'rejected', name: 'THE CATACOMBS', tag: 'Passed', banner: 'BEGONE', poe: '"We buried them in the walls \u2014 and the walls did not complain."',
    accent: '#fda4af', glow: 'rgba(244,63,94,0.28)', wall: '#1a0a10', wallDeep: '#0e0508',
    lines: ['not a fit', 'filed away', 'nevermore', 'into the bin', 'consigned to dust'] },
];

const SUPERVISOR_LINES = [
  'IDLE HANDS, IDLE PROFITS!',
  'Find me more installers, you laggards!',
  'Quoth the quota: MORE.',
  'BACK TO YOUR DESKS!',
  'The marketplace HUNGERS!',
  'Faster, my little wretches!',
  'I do NOT pay you to DAWDLE!',
  'Whoever rests gets the SACK!',
  'Sleep is for the unsubscribed!',
  'Coffee break? In THIS economy?!',
  'I SMELL slacking!',
  'Every idle clerk is a lead LOST!',
  'SMILE while you toil!',
  'The ledger is WATCHING.',
  'Bonuses? HA! Crumbs, perhaps.',
  'Double the leads or ELSE!',
  'Less sighing, more HUSTLING!',
  'Is this a UNION?! It is NOT.',
  'My grandfather toiled uphill, BOTH WAYS!',
  'CHOP CHOP, the sun is selling!',
  'You there! The RAVEN is OUTWORKING you!',
  'Not while I breathe shall this house go idle!',
  'The night is LONG and the quota is UNYIELDING!',
  'Dost thou think this a PARLOR? It is a WORKHOUSE!',
  'Methinks I hear WHIMPERING. Cease at once!',
];

const RAGE_LINES = ['SLACKER! Back to WORK!', "I'll have your HIDE!", 'WORK, you dog!', 'NO dawdling!', 'I SAW that yawn!', 'FASTER, blast you!', 'You call THAT toil?!', 'The CATACOMBS await you!', 'Must I fetch the IRON?'];
const PAIN_LINES = ['OW!', 'EEK!', 'YES SIR!', 'SORRY SIR!', 'AAH!', 'NOT THE WHIP!', 'RIGHT AWAY!', 'MERCY!', 'I BEG YOU!'];

const POE_QUOTES = [
  '"Nevermore."',
  '"The darkness gave no token, and the silence was unbroken."',
  '"And my soul from out that shadow that lies floating on the floor shall be lifted \u2014 nevermore!"',
  '"Deep into that darkness peering, long I stood there wondering, fearing."',
  '"The imp of the perverse."',
  '"All that we see or seem is but a dream within a dream."',
  '"The boundaries which divide Life from Death are at best shadowy and vague."',
  '"We loved with a love that was more than love."',
  '"I became insane, with long intervals of horrible sanity."',
  '"There was a loud ringing in my ears \u2014 the sound of the Tell-Tale Heart!"',
];

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

const IDLE_TEXT: Partial<Record<Stage, string>> = {
  discovered: 'awaiting the next scouting run\u2026',
  enriched: 'no raw leads to enrich\u2026',
  qualified: 'no leads vetted yet\u2026',
  contacted: 'awaiting the sales rep\u2026',
  signed_up: 'no deals closed\u2026 yet',
  rejected: 'the catacombs lie empty',
};

const DESKS = [
  { left: 8, top: 20 }, { left: 40, top: 12 }, { left: 70, top: 30 },
];

function workersFor(count: number): number {
  if (count <= 0) return 1;
  return Math.min(6, Math.max(2, Math.round(count / 10)));
}
function rand(min: number, max: number) { return min + Math.random() * (max - min); }
function depthScale(yFrac: number) { return 0.78 + 0.32 * yFrac; }

/* ═══════════════════════════════════════════════════════════════
   OVERWORKED CLERK — hunched, haunted, Victorian wage slave
   ═══════════════════════════════════════════════════════════════ */
function Clerk({ c, variant = 0, seated, gold }: { c: string; variant?: number; seated?: boolean; gold?: boolean }) {
  const tie = gold ? '#fbbf24' : c;
  return (
    <svg width="38" height="46" viewBox="0 0 38 46" style={{ display: 'block', filter: gold ? 'drop-shadow(0 0 6px rgba(251,191,36,0.9))' : 'drop-shadow(0 3px 2px rgba(0,0,0,0.5))' }}>
      {!seated && <><rect x="13" y="38" width="4" height="7" rx="1" fill="#2b3a4a" /><rect x="21" y="38" width="4" height="7" rx="1" fill="#2b3a4a" /><ellipse cx="15" cy="45" rx="3" ry="1.4" fill="#10151c" /><ellipse cx="23" cy="45" rx="3" ry="1.4" fill="#10151c" /></>}
      <path d="M10 26 Q19 22 28 26 L29 40 Q19 43 9 40 Z" fill="#cdd6e0" />
      <path d="M10 26 Q19 22 28 26 L29 40 Q19 43 9 40 Z" fill="#000" opacity="0.06" />
      <circle cx="24" cy="32" r="1.8" fill="#1a1a3a" opacity="0.25" />
      <path d="M19 25 l-2.4 4 2.4 7 2.4-7 z" fill={tie} />
      <path d="M11 28 Q5 31 7 37" stroke="#cdd6e0" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M27 28 Q33 31 31 37" stroke="#cdd6e0" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {variant === 3 ? <line x1="31" y1="37" x2="36" y2="30" stroke="#3a2c19" strokeWidth="1.2" strokeLinecap="round" /> : null}
      <ellipse cx="19" cy="14" rx="9" ry="8.5" fill="#e6c8a8" />
      <ellipse cx="19" cy="14" rx="9" ry="8.5" fill="#000" opacity="0.04" />
      <path d="M11 9 Q15 1 19 3 Q23 1 27 9 Q24 5 19 6 Q14 5 11 9 Z" fill="#3a2d22" />
      {variant === 1 ? <rect x="10.5" y="9.5" width="17" height="3.2" rx="1.6" fill="#2f7d4f" opacity="0.92" /> : null}
      <ellipse cx="15.5" cy="14" rx="2.1" ry="1.7" fill="#fff" /><ellipse cx="22.5" cy="14" rx="2.1" ry="1.7" fill="#fff" />
      <circle cx="15.5" cy="14.4" r="0.95" fill="#222" /><circle cx="22.5" cy="14.4" r="0.95" fill="#222" />
      <path d="M13.6 16 Q15.5 17.4 17.4 16" stroke="#8a6060" strokeWidth="0.8" fill="none" opacity="0.7" />
      <path d="M20.6 16 Q22.5 17.4 24.4 16" stroke="#8a6060" strokeWidth="0.8" fill="none" opacity="0.7" />
      <ellipse cx="15.5" cy="17" rx="2.4" ry="0.6" fill="#6a4a4a" opacity="0.35" />
      <ellipse cx="22.5" cy="17" rx="2.4" ry="0.6" fill="#6a4a4a" opacity="0.35" />
      <path d="M13 10.5 l3 1.5 M25 10.5 l-3 1.5" stroke="#5a4632" strokeWidth="1" strokeLinecap="round" />
      <path d="M16.5 19 Q19 17.8 21.5 19" stroke="#7a5a3a" strokeWidth="0.9" fill="none" />
      <path d="M27 11 q1.4 2 0 3.2 q-1.4 -1.2 0 -3.2 z" fill="#7dd3fc" opacity="0.85" />
      <path d="M10 12 q1.2 1.8 0 2.8 q-1.2 -1 0 -2.8 z" fill="#7dd3fc" opacity="0.55" />
      {variant === 2 ? <g><rect x="0.5" y="33" width="6" height="5" rx="1" fill="#e6e0d2" stroke="#8a7d63" strokeWidth="0.6" /><path d="M6.5 34 q2 0.5 0 2.5" stroke="#8a7d63" strokeWidth="0.7" fill="none" /><circle cx="3.5" cy="33" r="0.7" fill="#fff4cc" opacity="0.7" style={{ animation: 'smoke 2s ease-in-out infinite' }} /></g> : null}
      {gold ? <g><path d="M12 5 l2 3 2.5-3 2.5 3 2.5-3 2 3 -1 2 H13 z" fill="#fbbf24" stroke="#b8860b" strokeWidth="0.5" /><circle cx="15" cy="4.5" r="0.6" fill="#fde68a" /><circle cx="19" cy="4" r="0.6" fill="#fde68a" /><circle cx="23" cy="4.5" r="0.6" fill="#fde68a" /></g> : null}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   THE OVERSEER — fatter, meaner, glowing monocle, whip, smoke
   ═══════════════════════════════════════════════════════════════ */
function Overseer({ raging }: { raging?: boolean }) {
  return (
    <svg width="64" height="72" viewBox="0 0 64 72" style={{ display: 'block', filter: `drop-shadow(0 4px 3px rgba(0,0,0,0.6))${raging ? ' brightness(1.3)' : ''}` }}>
      <rect x="22" y="56" width="8" height="13" rx="1.5" fill="#3a2c19" /><rect x="34" y="56" width="8" height="13" rx="1.5" fill="#3a2c19" />
      <path d="M22 56v13M26 56v13M34 56v13M38 56v13" stroke="#241a10" strokeWidth="0.7" />
      <ellipse cx="25" cy="70" rx="5" ry="2" fill="#0c0c0f" /><ellipse cx="39" cy="70" rx="5" ry="2" fill="#0c0c0f" />
      <ellipse cx="32" cy="44" rx="18" ry="15" fill="#14110c" /><ellipse cx="32" cy="46" rx="12" ry="11" fill="#3b3329" />
      <circle cx="32" cy="40" r="1.1" fill="#d4af37" /><circle cx="32" cy="45" r="1.1" fill="#d4af37" /><circle cx="32" cy="50" r="1.1" fill="#d4af37" />
      <path d="M26 44 Q22 49 27 52" stroke="#d4af37" strokeWidth="1.2" fill="none" />
      <path d="M16 38 Q8 42 12 50" stroke="#14110c" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M48 38 Q56 42 54 54" stroke="#14110c" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M54 54 Q58 48 50 38 Q46 32 52 26 Q56 20 50 14" stroke="#5a3a1a" strokeWidth="1.8" fill="none" strokeLinecap="round"
        style={{ animation: raging ? 'whipCrack 0.3s ease-in-out infinite alternate' : 'none', transformOrigin: '54px 54px' }} />
      <path d="M28 30 L32 38 L36 30 Z" fill="#7c1d1d" />
      <ellipse cx="32" cy="24" rx="11" ry="10" fill="#e8b48c" />
      <path d="M22 19 l8 3 M42 19 l-8 3" stroke="#3a2d22" strokeWidth="2" strokeLinecap="round" />
      <circle cx="28" cy="24" r="1.5" fill="#222" /><circle cx="37" cy="24" r="1.4" fill="#222" />
      <circle cx="37" cy="24" r="4" fill="none" stroke="#d4af37" strokeWidth="1.2" style={{ filter: raging ? 'drop-shadow(0 0 3px #fbbf24)' : 'none' }} />
      <path d="M40 26 Q43 31 41 35" stroke="#d4af37" strokeWidth="0.8" fill="none" />
      <circle cx="35.5" cy="22" r="0.5" fill="#fff" opacity="0.7" />
      <path d="M24 29 Q28 33 32 30 Q36 33 40 29 Q36 31 32 30.5 Q28 31 24 29 Z" fill="#3a2d22" />
      <rect x="32" y="30.5" width="9" height="2.2" rx="1" fill="#6b4423" /><circle cx="41" cy="31.6" r="0.9" fill="#ff7a1a" />
      <circle cx="44" cy="29" r="1.5" fill="#cbd5e1" opacity="0.45" style={{ animation: 'smoke 2.4s ease-in-out infinite' }} />
      <circle cx="47" cy="25" r="2" fill="#cbd5e1" opacity="0.3" style={{ animation: 'smoke 2.4s ease-in-out 0.6s infinite' }} />
      <circle cx="49" cy="20" r="2.5" fill="#cbd5e1" opacity="0.18" style={{ animation: 'smoke 2.4s ease-in-out 1.2s infinite' }} />
      <rect x="22" y="0" width="20" height="15" rx="1.5" fill="#0c0c0f" stroke="#b8860b" strokeWidth="1" />
      <rect x="17" y="14" width="30" height="3.5" rx="1.5" fill="#0c0c0f" stroke="#b8860b" strokeWidth="0.8" />
      <rect x="22" y="11.5" width="20" height="2.4" fill="#7c1d1d" />
      <circle cx="32" cy="5" r="1.8" fill="#e8dcc0" opacity="0.6" /><circle cx="31" cy="4.5" r="0.4" fill="#222" /><circle cx="33" cy="4.5" r="0.4" fill="#222" />
    </svg>
  );
}

function Desk({ accent, delay }: { accent: string; delay: number }) {
  return (
    <svg width="64" height="48" viewBox="0 0 64 48" style={{ display: 'block', filter: 'drop-shadow(0 5px 4px rgba(0,0,0,0.6))' }}>
      <rect x="4" y="36" width="56" height="8" rx="2" fill="#3b2a1c" stroke="#1c130b" strokeWidth="1" />
      <rect x="8" y="43" width="3.5" height="5" fill="#241a10" /><rect x="52" y="43" width="3.5" height="5" fill="#241a10" />
      <rect x="18" y="8" width="28" height="22" rx="2.5" fill="#0a0f1a" stroke="#241a10" strokeWidth="2" />
      <rect x="21" y="11" width="22" height="15" rx="1" fill={accent} opacity="0.85" style={{ animation: `screenFlicker 2.6s ease-in-out ${delay}s infinite` }} />
      <rect x="21" y="14" width="22" height="1" fill="#0a0f1a" opacity="0.35" /><rect x="21" y="17" width="22" height="1" fill="#0a0f1a" opacity="0.35" />
      <rect x="21" y="20" width="22" height="1" fill="#0a0f1a" opacity="0.35" /><rect x="21" y="23" width="22" height="1" fill="#0a0f1a" opacity="0.25" />
      <rect x="29" y="30" width="6" height="6" fill="#1c130b" /><rect x="22" y="36" width="20" height="3" rx="1" fill="#2a1d12" />
      <rect x="48" y="31" width="9" height="6" rx="0.5" fill="#e8dcc0" stroke="#9c8a66" strokeWidth="0.6" transform="rotate(-5 52 34)" />
      <circle cx="52" cy="34" r="1.5" fill="#8b1a1a" opacity="0.7" />
      <rect x="44" y="36" width="4" height="3" rx="1" fill="#1a1a3a" />
    </svg>
  );
}

function FilingCabinet({ accent }: { accent: string }) {
  return (
    <svg width="26" height="40" viewBox="0 0 26 40" style={{ display: 'block', filter: 'drop-shadow(0 3px 3px rgba(0,0,0,0.55))' }}>
      <rect x="2" y="2" width="22" height="36" rx="2" fill="#2a2014" stroke="#1c1206" strokeWidth="1.2" />
      {[4, 16, 28].map((y) => (
        <g key={y}><rect x="4" y={y} width="18" height="9" rx="1" fill="#3a2c19" /><rect x="10" y={y + 3.5} width="6" height="2" rx="1" fill={accent} opacity="0.8" /></g>
      ))}
      <text x="13" y="36" textAnchor="middle" fill={accent} opacity="0.4" fontSize="3" fontFamily="serif">DREAD</text>
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GOTHIC / POE SET DRESSING — Fireplace, Chandelier, Raven, etc.
   ═══════════════════════════════════════════════════════════════ */

function Fireplace() {
  return (
    <svg width="66" height="56" viewBox="0 0 66 56" style={{ display: 'block' }}>
      <rect x="2" y="6" width="62" height="50" rx="2" fill="#241c14" stroke="#15100a" strokeWidth="1.5" />
      <rect x="2" y="2" width="62" height="6" rx="1" fill="#322619" stroke="#15100a" strokeWidth="1" />
      <path d="M6 8 Q4 4 8 6 L10 8 Z" fill="#3a2c19" /><path d="M58 8 Q60 4 56 6 L54 8 Z" fill="#3a2c19" />
      <path d="M14 56 V28 a19 19 0 0 1 38 0 V56 Z" fill="#0a0603" />
      <rect x="20" y="46" width="26" height="4" rx="2" fill="#3a2a1a" transform="rotate(-6 33 48)" />
      <rect x="20" y="49" width="26" height="4" rx="2" fill="#2e2114" transform="rotate(5 33 51)" />
      <path d="M33 50 q-9 -10 -4 -20 q3 7 7 5 q-4 -10 2 -17 q2 11 8 15 q4 5 1 11 q-3 6 -14 6 z" fill="#f59e0b" style={{ animation: 'flame 0.5s ease-in-out infinite alternate', transformOrigin: '33px 50px' }} />
      <path d="M33 50 q-5 -8 -1 -16 q2 5 5 4 q-3 -7 2 -12 q1 8 5 11 q3 4 0 8 q-2 5 -11 5 z" fill="#fde68a" style={{ animation: 'flame 0.4s ease-in-out 0.1s infinite alternate', transformOrigin: '33px 50px' }} />
      <path d="M33 50 q-2 -4 0 -8 q1 3 2 2 q-1 -4 1 -6 q1 4 3 5 q1 2 0 4 q-1 3 -6 3 z" fill="#fff4cc" style={{ animation: 'flame 0.3s ease-in-out 0.2s infinite alternate', transformOrigin: '33px 50px' }} />
      <ellipse cx="33" cy="46" rx="24" ry="14" fill="#f59e0b" opacity="0.22" style={{ animation: 'bulb 1.2s ease-in-out infinite' }} />
      <path d="M52 -1 h4 l-0.6 3 q-1.4 1 -2.8 0 z" fill="#d4af37" transform="translate(0,2)" />
      <circle cx="10" cy="5" r="2.5" fill="#e8dcc0" opacity="0.3" /><circle cx="9" cy="4.5" r="0.5" fill="#0a0705" /><circle cx="11" cy="4.5" r="0.5" fill="#0a0705" />
    </svg>
  );
}

function Chandelier() {
  return (
    <svg width="60" height="44" viewBox="0 0 60 44" style={{ display: 'block', animation: 'chandelierSway 4s ease-in-out infinite' }}>
      <line x1="30" y1="0" x2="30" y2="8" stroke="#b8860b" strokeWidth="1.5" />
      <ellipse cx="30" cy="10" rx="8" ry="3" fill="none" stroke="#b8860b" strokeWidth="1.2" />
      {[0, 72, 144, 216, 288].map((angle, i) => {
        const rad = angle * Math.PI / 180;
        const x = 30 + Math.cos(rad) * 18;
        const y = 14 + Math.sin(rad) * 6;
        return (
          <g key={angle}>
            <line x1="30" y1="10" x2={x} y2={y} stroke="#b8860b" strokeWidth="1" />
            <rect x={x - 1} y={y} width="2" height="4" fill="#e8d8b0" />
            <ellipse cx={x} cy={y - 1} rx="2" ry="3.5" fill="#fff4cc" style={{ animation: `flame 0.5s ease-in-out ${i * 0.15}s infinite alternate`, transformOrigin: `${x}px ${y + 2}px` }} />
            <ellipse cx={x} cy={y - 1} rx="1" ry="2" fill="#f59e0b" />
            <path d={`M${x + 0.5} ${y + 4} q0.5 2 0 4`} stroke="#e8dcc0" strokeWidth="0.5" fill="none" opacity="0.6" />
          </g>
        );
      })}
    </svg>
  );
}

function Candelabra() {
  return (
    <svg width="30" height="34" viewBox="0 0 30 34" style={{ display: 'block' }}>
      <rect x="14" y="14" width="2" height="16" fill="#7c6a52" />
      <ellipse cx="15" cy="31" rx="6" ry="2" fill="#5b4636" />
      <path d="M4 18 q0 -6 5 -6 M26 18 q0 -6 -5 -6 M15 14 v-3" stroke="#7c6a52" strokeWidth="2" fill="none" />
      {[4, 15, 26].map((x, i) => (
        <g key={x}>
          <rect x={x - 1} y={x === 15 ? 7 : 12} width="2" height="5" fill="#e8d8b0" />
          <ellipse cx={x} cy={x === 15 ? 5.5 : 10.5} rx="1.8" ry="3" fill="#fff4cc" style={{ animation: `flame 0.5s ease-in-out ${i * 0.2}s infinite alternate`, transformOrigin: `${x}px ${x === 15 ? 7 : 12}px` }} />
          <ellipse cx={x} cy={x === 15 ? 5.5 : 10.5} rx="0.8" ry="1.6" fill="#f59e0b" />
          <path d={`M${x + 0.3} ${x === 15 ? 12 : 17} q0.4 1.5 0 3`} stroke="#e8dcc0" strokeWidth="0.4" fill="none" opacity="0.5" />
        </g>
      ))}
    </svg>
  );
}

function Raven() {
  return (
    <svg width="26" height="20" viewBox="0 0 26 20" style={{ display: 'block', animation: 'ravenBob 3s ease-in-out infinite' }}>
      <ellipse cx="12" cy="11" rx="8" ry="4.5" fill="#0b0b10" /><circle cx="19" cy="7" r="3.5" fill="#0b0b10" />
      <path d="M22 7 l4 -1 -3 2 z" fill="#3a3a44" /><circle cx="20" cy="6.5" r="0.7" fill="#fbbf24" />
      <path d="M5 9 l-4 -3 3 5 z" fill="#070709" /><rect x="10" y="15" width="1.2" height="4" fill="#1a1a22" /><rect x="14" y="15" width="1.2" height="4" fill="#1a1a22" />
    </svg>
  );
}

function Bats() {
  return (
    <svg width="36" height="18" viewBox="0 0 36 18" style={{ display: 'block', animation: 'batFly 2.5s ease-in-out infinite' }}>
      <ellipse cx="12" cy="10" rx="4" ry="2.5" fill="#0b0b10" />
      <path d="M8 10 Q4 6 0 9 Q4 8 8 10 M16 10 Q20 6 24 9 Q20 8 16 10" fill="#0b0b10" />
      <circle cx="10" cy="9" r="0.5" fill="#fbbf24" opacity="0.8" /><circle cx="14" cy="9" r="0.5" fill="#fbbf24" opacity="0.8" />
      <ellipse cx="28" cy="6" rx="3" ry="1.8" fill="#0b0b10" opacity="0.7" />
      <path d="M25 6 Q22 3 19 5 Q22 4 25 6 M31 6 Q34 3 36 5 Q34 4 31 6" fill="#0b0b10" opacity="0.7" />
    </svg>
  );
}

function Ghost() {
  return (
    <svg width="24" height="30" viewBox="0 0 24 30" style={{ display: 'block', animation: 'ghostFloat 3s ease-in-out infinite', filter: 'blur(0.3px)' }}>
      <path d="M4 6 Q12 0 20 6 L20 22 Q17 26 14 22 Q11 26 8 22 Q5 26 4 22 Z" fill="#cbd5e1" opacity="0.18" />
      <path d="M4 6 Q12 0 20 6 L20 22 Q17 26 14 22 Q11 26 8 22 Q5 26 4 22 Z" fill="none" stroke="#cbd5e1" strokeWidth="0.5" opacity="0.3" />
      <ellipse cx="10" cy="12" rx="2" ry="2.5" fill="#0a0705" opacity="0.4" /><ellipse cx="16" cy="12" rx="2" ry="2.5" fill="#0a0705" opacity="0.4" />
      <ellipse cx="13" cy="17" rx="1.5" ry="2" fill="#0a0705" opacity="0.3" />
    </svg>
  );
}

function Skeleton() {
  return (
    <svg width="18" height="30" viewBox="0 0 18 30" style={{ display: 'block', opacity: 0.35 }}>
      <ellipse cx="9" cy="5" rx="5" ry="5" fill="#e8dcc0" opacity="0.6" /><circle cx="7" cy="4" r="1.5" fill="#0a0705" opacity="0.5" /><circle cx="11" cy="4" r="1.5" fill="#0a0705" opacity="0.5" />
      <path d="M7 7 Q9 9 11 7" stroke="#0a0705" strokeWidth="0.5" fill="none" opacity="0.5" />
      <line x1="9" y1="10" x2="9" y2="24" stroke="#e8dcc0" strokeWidth="1" opacity="0.5" />
      {[0, 1, 2, 3].map((i) => (<path key={i} d={`M${5} ${12 + i * 3} Q9 ${11 + i * 3} ${13} ${12 + i * 3}`} stroke="#e8dcc0" strokeWidth="0.6" fill="none" opacity="0.4" />))}
      <path d="M5 12 Q2 16 6 20 M13 12 Q16 16 12 20" stroke="#e8dcc0" strokeWidth="0.6" fill="none" opacity="0.4" />
    </svg>
  );
}

function Portrait({ accent }: { accent: string }) {
  return (
    <svg width="30" height="38" viewBox="0 0 30 38" style={{ display: 'block' }}>
      <rect x="1" y="1" width="28" height="36" rx="2" fill="#1a1206" stroke="#b8860b" strokeWidth="2" /><rect x="4" y="4" width="22" height="30" rx="1" fill="#0d0a06" />
      <ellipse cx="15" cy="16" rx="6" ry="7" fill="#2a2436" /><ellipse cx="15" cy="13" rx="4.5" ry="5" fill="#46415a" />
      <rect x="11" y="5" width="8" height="6" rx="1" fill="#0c0c0f" /><rect x="9" y="10" width="12" height="2" rx="0.5" fill="#0c0c0f" /><rect x="9" y="22" width="12" height="10" rx="3" fill="#1c1830" />
      <circle cx="13" cy="13" r="1" fill={accent} style={{ animation: 'bulb 3s ease-in-out infinite' }} /><circle cx="17" cy="13" r="1" fill={accent} style={{ animation: 'bulb 3s ease-in-out 0.5s infinite' }} />
      <rect x="7" y="30" width="16" height="4" rx="1" fill="#b8860b" opacity="0.5" /><text x="15" y="33" textAnchor="middle" fill="#0a0705" fontSize="2.5" fontFamily="serif">O'BRIAN</text>
    </svg>
  );
}

function Cobweb() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" style={{ display: 'block', opacity: 0.4 }}>
      <path d="M0 0 L34 0 M0 0 L0 34 M0 0 L24 24 M0 0 L34 14 M0 0 L14 34" stroke="#cbd5e1" strokeWidth="0.5" fill="none" opacity="0.5" />
      <path d="M0 8 Q8 6 8 0 M0 16 Q16 14 16 0 M0 26 Q26 22 26 0" stroke="#cbd5e1" strokeWidth="0.5" fill="none" opacity="0.5" />
    </svg>
  );
}

function Rat() {
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" style={{ display: 'block' }}>
      <ellipse cx="9" cy="8" rx="7" ry="3.5" fill="#2a2a30" /><circle cx="15" cy="6" r="3" fill="#2a2a30" />
      <circle cx="14" cy="3.5" r="1.4" fill="#3a3a44" /><circle cx="17" cy="3.5" r="1.4" fill="#3a3a44" /><circle cx="16.5" cy="6" r="0.6" fill="#ff6b6b" />
      <path d="M2 8 Q-4 8 -2 11" stroke="#3a3a44" strokeWidth="1.2" fill="none" /><rect x="6" y="10" width="1" height="2" fill="#1a1a22" /><rect x="11" y="10" width="1" height="2" fill="#1a1a22" />
    </svg>
  );
}

function TeaCart() {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" style={{ display: 'block', filter: 'drop-shadow(0 3px 2px rgba(0,0,0,0.5))' }}>
      <rect x="4" y="10" width="26" height="3" rx="1" fill="#5b4636" /><rect x="4" y="20" width="26" height="3" rx="1" fill="#5b4636" />
      <rect x="5" y="13" width="2" height="7" fill="#3a2c19" /><rect x="27" y="13" width="2" height="7" fill="#3a2c19" />
      <circle cx="8" cy="26" r="3" fill="#1c1206" stroke="#3a2c19" strokeWidth="1" /><circle cx="26" cy="26" r="3" fill="#1c1206" stroke="#3a2c19" strokeWidth="1" />
      <ellipse cx="14" cy="7" rx="5" ry="4" fill="#d4af37" /><path d="M19 6 q4 0 3 4" stroke="#d4af37" strokeWidth="1.6" fill="none" /><rect x="13" y="2" width="2" height="2" fill="#d4af37" />
      <circle cx="14" cy="4" r="1" fill="#fff4cc" style={{ animation: 'smoke 2s ease-in-out infinite' }} />
      <rect x="22" y="6" width="5" height="4" rx="1" fill="#e8e0d2" /><circle cx="24.5" cy="5" r="0.6" fill="#fff4cc" opacity="0.6" style={{ animation: 'smoke 2s ease-in-out 0.5s infinite' }} />
    </svg>
  );
}

function BloodMoon() {
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" style={{ display: 'block', filter: 'drop-shadow(0 0 8px rgba(180,40,40,0.5))' }}>
      <circle cx="20" cy="20" r="14" fill="#7c1d1d" opacity="0.4" /><circle cx="20" cy="20" r="12" fill="#a33" opacity="0.3" />
      <circle cx="20" cy="20" r="10" fill="#c44" opacity="0.2" style={{ animation: 'bulb 4s ease-in-out infinite' }} />
      <circle cx="16" cy="16" r="2" fill="#6a1a1a" opacity="0.3" /><circle cx="23" cy="22" r="1.5" fill="#6a1a1a" opacity="0.25" /><circle cx="18" cy="24" r="1" fill="#6a1a1a" opacity="0.2" />
    </svg>
  );
}

function FogLayer() {
  return (
    <div className="pointer-events-none absolute inset-0" style={{
      background: 'linear-gradient(180deg, transparent 40%, rgba(200,200,210,0.03) 60%, rgba(200,200,210,0.06) 75%, transparent 95%)',
      animation: 'fogDrift 12s ease-in-out infinite alternate',
    }} />
  );
}

type Pos = { x: number; y: number; tx: number; ty: number; speed: number; dir: number };

export default function AcquisitionFloor({
  byStage, total, onEnterRoom, onDispatched,
}: {
  byStage: Record<string, number>;
  total: number;
  onEnterRoom: (stage: Stage) => void;
  onDispatched: () => void;
}) {
  const floorRefs = useRef<Map<Stage, HTMLDivElement | null>>(new Map());
  const wanderEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const spriteEls = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const posRef = useRef<Map<string, Pos>>(new Map());
  const [bubbles, setBubbles] = useState<Record<string, string>>({});

  const supRef = useRef<HTMLDivElement | null>(null);
  const supSpriteRef = useRef<HTMLDivElement | null>(null);
  const supLaneRef = useRef<HTMLDivElement | null>(null);
  const supPos = useRef({ x: 20, tx: 200, dir: 1 });
  const [supLine, setSupLine] = useState<string>('');

  const [dispatching, setDispatching] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState<string>('');
  const [blitzState, setBlitzState] = useState('TX');
  const [whipTarget, setWhipTarget] = useState<string | null>(null);
  const [raging, setRaging] = useState(false);
  const [productivity, setProductivity] = useState(42);
  const [faintTarget, setFaintTarget] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [autoWorking, setAutoWorking] = useState(false);
  const [thunderFlash, setThunderFlash] = useState(false);
  const [poeQuote, setPoeQuote] = useState<string>('');
  const [heartbeat, setHeartbeat] = useState(false);
  const whippedStage = whipTarget ? (whipTarget.split('-')[0] as Stage) : null;

  const rooms = useMemo(() => ROOMS.map((r) => {
    const count = byStage[r.stage] ?? 0;
    const n = workersFor(count);
    const seated = n >= 2 ? Math.min(n - 1, DESKS.length) : n;
    return { ...r, count, total: n, seated, wanderers: Math.max(0, n - seated) };
  }), [byStage]);

  const wanderers = useMemo(() => {
    const list: { id: string; stage: Stage; accent: string; variant: number }[] = [];
    for (const r of rooms) for (let i = 0; i < r.wanderers; i++) {
      list.push({ id: `${r.stage}-wander-${i}`, stage: r.stage, accent: r.accent, variant: i % 4 });
    }
    return list;
  }, [rooms]);

  useEffect(() => {
    const next = new Map<string, Pos>();
    for (const w of wanderers) {
      next.set(w.id, posRef.current.get(w.id) ?? {
        x: rand(10, 160), y: rand(8, 60), tx: rand(10, 160), ty: rand(8, 60),
        speed: rand(0.18, 0.42), dir: 1,
      });
    }
    posRef.current = next;
  }, [wanderers]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      for (const w of wanderers) {
        const p = posRef.current.get(w.id); const el = wanderEls.current.get(w.id); const floor = floorRefs.current.get(w.stage);
        if (!p || !el || !floor) continue;
        const maxX = Math.max(20, floor.clientWidth - 40);
        const maxY = Math.max(16, floor.clientHeight - 46);
        const dx = p.tx - p.x, dy = p.ty - p.y, d = Math.hypot(dx, dy);
        if (d < 2) { p.tx = rand(6, maxX); p.ty = rand(4, maxY); }
        else { p.x += (dx / d) * p.speed; p.y += (dy / d) * p.speed; p.dir = dx >= 0 ? 1 : -1; }
        const sc = depthScale(p.y / maxY);
        el.style.transform = `translate(${p.x}px, ${p.y}px)`; el.style.zIndex = String(Math.round(p.y));
        const s = spriteEls.current.get(w.id); if (s) s.style.transform = `scale(${sc}) scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [wanderers]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const lane = supLaneRef.current, el = supRef.current, sp = supSpriteRef.current, p = supPos.current;
      if (lane && el) {
        const max = Math.max(60, lane.clientWidth - 70);
        if (Math.abs(p.tx - p.x) < 4) p.tx = rand(0, max);
        p.dir = p.tx - p.x >= 0 ? 1 : -1;
        p.x += p.dir * 0.8;
        el.style.transform = `translateX(${p.x}px)`;
        if (sp) sp.style.transform = `scaleX(${p.dir})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      setSupLine(SUPERVISOR_LINES[Math.floor(Math.random() * SUPERVISOR_LINES.length)]);
      setTimeout(() => setSupLine(''), 3000);
    }, 3400);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      if (Math.random() < 0.35) {
        setThunderFlash(true);
        setTimeout(() => setThunderFlash(false), 150);
        setTimeout(() => { setThunderFlash(true); setTimeout(() => setThunderFlash(false), 80); }, 250);
      }
    }, 8000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => {
      if (Math.random() < 0.4) {
        setPoeQuote(POE_QUOTES[Math.floor(Math.random() * POE_QUOTES.length)]);
        setTimeout(() => setPoeQuote(''), 6000);
      }
    }, 12000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!autoWorking) return;
    const iv = setInterval(() => {
      setHeartbeat(true);
      setTimeout(() => setHeartbeat(false), 200);
      setTimeout(() => { setHeartbeat(true); setTimeout(() => setHeartbeat(false), 150); }, 350);
    }, 2000);
    return () => clearInterval(iv);
  }, [autoWorking]);

  const allWorkerIds = useMemo(() => {
    const ids: { id: string; stage: Stage }[] = [];
    for (const r of rooms) {
      for (let i = 0; i < r.seated; i++) ids.push({ id: `${r.stage}-seat-${i}`, stage: r.stage });
      for (let i = 0; i < r.wanderers; i++) ids.push({ id: `${r.stage}-wander-${i}`, stage: r.stage });
    }
    return ids;
  }, [rooms]);

  useEffect(() => {
    if (allWorkerIds.length === 0) return;
    const iv = setInterval(() => {
      const pick = allWorkerIds[Math.floor(Math.random() * allWorkerIds.length)];
      if ((byStage[pick.stage] ?? 0) === 0 && Math.random() > 0.25) return;
      const room = ROOMS.find((r) => r.stage === pick.stage)!;
      const line = Math.random() < 0.15 ? 'zzz \uD83D\uDEA4' : Math.random() < 0.08 ? 'nevermore\u2026' : room.lines[Math.floor(Math.random() * room.lines.length)];
      setBubbles((b) => ({ ...b, [pick.id]: line }));
      setTimeout(() => setBubbles((b) => { const n = { ...b }; delete n[pick.id]; return n; }), 2200);
    }, 1100);
    return () => clearInterval(iv);
  }, [allWorkerIds, byStage]);

  useEffect(() => {
    if (allWorkerIds.length === 0) return;
    const iv = setInterval(() => {
      setRaging(true);
      setSupLine(RAGE_LINES[Math.floor(Math.random() * RAGE_LINES.length)]);
      const victim = allWorkerIds[Math.floor(Math.random() * allWorkerIds.length)];
      setWhipTarget(victim.id);
      setBubbles((b) => ({ ...b, [victim.id]: PAIN_LINES[Math.floor(Math.random() * PAIN_LINES.length)] }));
      setTimeout(() => setRaging(false), 900);
      setTimeout(() => {
        setWhipTarget(null);
        setBubbles((b) => { const n = { ...b }; delete n[victim.id]; return n; });
      }, 1600);
    }, 7500);
    return () => clearInterval(iv);
  }, [allWorkerIds]);

  useEffect(() => {
    const iv = setInterval(() => {
      const base = (dispatching || autoWorking) ? 90 : 36 + Math.min(42, Math.round(total / 4));
      setProductivity(Math.max(8, Math.min(99, base + Math.round(rand(-8, 8)))));
    }, 1600);
    return () => clearInterval(iv);
  }, [dispatching, autoWorking, total]);

  useEffect(() => {
    if (wanderers.length === 0) return;
    const iv = setInterval(() => {
      const w = wanderers[Math.floor(Math.random() * wanderers.length)];
      setFaintTarget(w.id);
      setBubbles((b) => ({ ...b, [w.id]: '\uD83D\uDCAB' }));
      setTimeout(() => { setFaintTarget(null); setBubbles((b) => { const n = { ...b }; delete n[w.id]; return n; }); }, 2600);
    }, 10000);
    return () => clearInterval(iv);
  }, [wanderers]);

  async function runBlitz() {
    setDispatching(true);
    setSupLine('MOVE, you wretches! Scour every street!');
    setDispatchMsg(`The scouts ride out across ${blitzState} into the night\u2026`);
    try {
      const res = await fetch('/api/admin/prospects/blitz', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: blitzState }) });
      const data = await res.json();
      if (data.success) { setDispatchMsg(`Back from ${data.stateName || blitzState}: ${data.inserted} new, ${data.updated} already known \u2014 marched into Scouting!`); onDispatched(); if (auto) setTimeout(() => runTick(), 2000); }
      else setDispatchMsg(data.error || data.message || 'The scouts returned empty-handed.');
    } catch (e) { setDispatchMsg('The scouts were lost to the fog. ' + (e as Error).message); }
    finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 9000); }
  }

  async function summonBatch() {
    setDispatching(true);
    setDispatchMsg('Summoning the starter batch\u2026');
    try {
      const res = await fetch('/api/admin/prospects/seed', { method: 'POST' });
      const data = await res.json();
      if (data.success || typeof data.total === 'number') { setDispatchMsg(`${data.total} installers on the books!`); onDispatched(); if (auto) setTimeout(() => runTick(), 2000); }
      else setDispatchMsg(data.error || data.message || 'Could not summon the batch.');
    } catch (e) { setDispatchMsg('Summon failed. ' + (e as Error).message); }
    finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 6000); }
  }

  const WORK_EP: Partial<Record<Stage, string>> = { enriched: '/api/admin/prospects/work/enrich', qualified: '/api/admin/prospects/work/qualify' };
  const WORK_LABEL: Partial<Record<Stage, string>> = { enriched: '\u2699 Enrich raw leads (AI $)', qualified: '\u2699 Vet the enriched' };
  const WORK_BARK: Partial<Record<Stage, string>> = { enriched: 'COPY faster, you wretches!', qualified: 'VET them \u2014 only the worthy!' };

  async function workRoom(stage: Stage) {
    const ep = WORK_EP[stage];
    if (!ep || dispatching) return;
    setDispatching(true);
    setSupLine(WORK_BARK[stage] || '');
    setDispatchMsg('At work\u2026');
    try {
      const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      if (data.success) {
        setDispatchMsg(stage === 'enriched'
          ? `Enriched ${data.enriched} of ${data.processed} raw leads \u2014 off to the Assay Room.`
          : `Vetted ${data.processed}: ${data.qualified} qualified, ${data.rejected} to the Catacombs.`);
        onDispatched();
      } else setDispatchMsg(data.error || data.message || 'The work faltered.');
    } catch (e) { setDispatchMsg('The work faltered. ' + (e as Error).message); }
    finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 8000); }
  }

  async function runTick(announce = false) {
    setAutoWorking(true);
    try {
      const d = await fetch('/api/admin/prospects/pipeline/tick', { method: 'POST' }).then((r) => r.json());
      if (d?.success) {
        onDispatched();
        if ((d.moved ?? 0) > 0) {
          setDispatchMsg(`Vetted ${d.qualified} into the Assay Room${d.rejected ? `, ${d.rejected} binned` : ''}.`);
          setSupLine('Down the line they go!');
        }
      }
    } catch { /* keep quiet */ }
    finally { setTimeout(() => setAutoWorking(false), 1000); }
  }

  useEffect(() => {
    if (!auto) return;
    const iv = setInterval(() => { runTick(); }, 25000);
    const t = setTimeout(() => runTick(), 1500);
    return () => { clearInterval(iv); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  async function runJob(ep: string, bark: string, fmt: (d: Record<string, number>) => string) {
    if (dispatching) return;
    setDispatching(true); setSupLine(bark); setDispatchMsg('At work\u2026');
    try {
      const data = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json());
      if (data.success) { setDispatchMsg(fmt(data)); onDispatched(); }
      else setDispatchMsg(data.error || data.message || 'The work faltered.');
    } catch (e) { setDispatchMsg('The work faltered. ' + (e as Error).message); }
    finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 8000); }
  }

  async function runHouse() {
    if (dispatching) return;
    setDispatching(true);
    setSupLine('THE WHOLE HOUSE \u2014 to WORK!');
    try {
      setDispatchMsg('Copying Room: combing the wires for contacts\u2026');
      await fetch('/api/admin/prospects/work/enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => null);
      onDispatched();
      setDispatchMsg('Assay Room: weighing every firm\u2026');
      const q = await fetch('/api/admin/prospects/work/qualify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((r) => r.json()).catch(() => null);
      onDispatched();
      setDispatchMsg(q?.success ? `The house ran: ${q.qualified} qualified, ${q.rejected} binned. Onboard the worthy in the Counting House.` : 'The house ran.');
    } finally { setDispatching(false); setTimeout(() => setDispatchMsg(''), 9000); }
  }

  const bubble = 'absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap px-2 py-0.5 rounded-md text-[11px] font-semibold text-amber-950 bg-amber-100 shadow z-50';

  return (
    <div className={`relative transition-all duration-100 ${thunderFlash ? 'brightness-150' : ''}`}>
      <style>{`
        @keyframes floorBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-3px) } }
        @keyframes typeBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-1.5px) } }
        @keyframes bubblePop { 0%{ opacity:0; transform: translate(-50%, 4px) scale(.85) } 12%{ opacity:1; transform: translate(-50%,0) scale(1) } 88%{ opacity:1 } 100%{ opacity:0 } }
        @keyframes screenFlicker { 0%,100%{ opacity:.85 } 45%{ opacity:.62 } 55%{ opacity:.95 } 70%{ opacity:.7 } }
        @keyframes bulb { 0%,100%{ opacity:.9 } 50%{ opacity:1 } }
        @keyframes smoke { 0%{ opacity:.5; transform: translateY(0) } 100%{ opacity:0; transform: translateY(-10px) } }
        @keyframes ember { 0%{ transform: translateY(0); opacity:0 } 10%{opacity:.7} 100%{ transform: translateY(-280px); opacity:0 } }
        @keyframes flame { 0%{ transform: scaleY(1) scaleX(1) } 100%{ transform: scaleY(1.18) scaleX(0.92) } }
        @keyframes ravenBob { 0%,100%{ transform: translateY(0) } 50%{ transform: translateY(-2px) } }
        @keyframes whipShake { 0%,100%{ transform: translateX(0) rotate(0deg) } 25%{ transform: translateX(-2.5px) rotate(-7deg) } 75%{ transform: translateX(2.5px) rotate(7deg) } }
        @keyframes whipCrack { 0%{ transform: rotate(0deg) } 50%{ transform: rotate(-15deg) } 100%{ transform: rotate(10deg) } }
        @keyframes crackPop { 0%{ opacity:0; transform: scale(.5) rotate(-12deg) } 25%{ opacity:1; transform: scale(1.4) rotate(6deg) } 100%{ opacity:0; transform: scale(1) rotate(0) } }
        @keyframes dust { 0%{ transform: translate(0,0); opacity:0 } 15%{ opacity:.5 } 100%{ transform: translate(40px,-120px); opacity:0 } }
        @keyframes pendulum { 0%,100%{ transform: rotate(16deg) } 50%{ transform: rotate(-16deg) } }
        @keyframes rollAcross { from{ left:-12% } to{ left:108% } }
        @keyframes ratRun { from{ left:-8% } to{ left:106% } }
        @keyframes faint { 0%{ transform: rotate(0) } 100%{ transform: rotate(82deg) translateY(6px) } }
        @keyframes marquee { 0%,100%{ text-shadow: 0 0 8px rgba(251,191,36,0.7), 0 0 2px #fff } 50%{ text-shadow: 0 0 18px rgba(251,191,36,0.95), 0 0 6px #fff, 0 0 12px rgba(180,40,40,0.3) } }
        @keyframes roomFlash { 0%,100%{ box-shadow: 0 10px 28px rgba(0,0,0,0.7) } 50%{ box-shadow: 0 0 26px rgba(239,68,68,0.7), inset 0 0 30px rgba(239,68,68,0.25) } }
        @keyframes coinDrop { 0%{ transform: translateY(-26px); opacity:0 } 25%{ opacity:1 } 60%{ transform: translateY(3px) } 100%{ transform: translateY(0); opacity:1 } }
        @keyframes ghostFloat { 0%,100%{ transform: translateY(0) translateX(0); opacity:0.7 } 25%{ transform: translateY(-6px) translateX(3px); opacity:0.9 } 50%{ transform: translateY(-3px) translateX(-2px); opacity:0.5 } 75%{ transform: translateY(-8px) translateX(1px); opacity:0.8 } }
        @keyframes batFly { 0%,100%{ transform: translateY(0) translateX(0) } 25%{ transform: translateY(-8px) translateX(6px) } 50%{ transform: translateY(-4px) translateX(-4px) } 75%{ transform: translateY(-10px) translateX(3px) } }
        @keyframes fogDrift { 0%{ transform: translateX(-5%); opacity:0.8 } 50%{ opacity:1 } 100%{ transform: translateX(5%); opacity:0.8 } }
        @keyframes chandelierSway { 0%,100%{ transform: rotate(0deg) } 25%{ transform: rotate(1deg) } 75%{ transform: rotate(-1deg) } }
        @keyframes heartbeatPulse { 0%{ transform: scale(1); opacity:0.6 } 15%{ transform: scale(1.08); opacity:1 } 30%{ transform: scale(1); opacity:0.6 } 45%{ transform: scale(1.05); opacity:0.9 } 60%{ transform: scale(1); opacity:0.6 } 100%{ transform: scale(1); opacity:0.6 } }
        @keyframes poeDrift { 0%{ opacity:0; transform: translateY(10px) } 15%{ opacity:0.7; transform: translateY(0) } 85%{ opacity:0.7 } 100%{ opacity:0; transform: translateY(-8px) } }
        @keyframes bloodDrip { 0%{ transform: scaleY(0); opacity:0 } 10%{ opacity:0.4 } 100%{ transform: scaleY(1); opacity:0.15 } }
        @keyframes rainDrop { 0%{ transform: translateY(-20px); opacity:0 } 10%{ opacity:0.3 } 100%{ transform: translateY(100%); opacity:0 } }
        @keyframes portraitEyes { 0%,40%,100%{ opacity:0.6 } 50%,90%{ opacity:1 } }
        @keyframes chainSway { 0%,100%{ transform: rotate(0deg) } 30%{ transform: rotate(0.5deg) } 70%{ transform: rotate(-0.5deg) } }
        @keyframes lanternGlow { 0%,100%{ box-shadow: 0 0 8px rgba(251,191,36,0.4), 0 0 20px rgba(251,191,36,0.15) } 50%{ box-shadow: 0 0 14px rgba(251,191,36,0.6), 0 0 35px rgba(251,191,36,0.25) } }
        @keyframes brickShimmer { 0%,100%{ opacity:0.03 } 50%{ opacity:0.08 } }
      `}</style>

      {/* ══════ GASLIT MARQUEE ══════ */}
      <div className="text-center mb-3">
        <div className="inline-block px-8 py-3 rounded-md border-2 border-amber-600/60 bg-gradient-to-b from-[#241808] to-[#0c0905] shadow-[0_0_30px_rgba(251,191,36,0.25)] relative overflow-hidden">
          <div className="absolute top-0 left-4 w-3 h-6 rounded-b-full bg-amber-700/40" style={{ animation: 'bloodDrip 6s ease-in infinite' }} />
          <div className="absolute top-0 right-8 w-2.5 h-5 rounded-b-full bg-amber-700/35" style={{ animation: 'bloodDrip 8s ease-in 2s infinite' }} />
          <div className="absolute top-0 left-1/3 w-2 h-4 rounded-b-full bg-amber-700/30" style={{ animation: 'bloodDrip 7s ease-in 4s infinite' }} />
          <div className="text-amber-300 font-extrabold tracking-[0.22em] text-sm md:text-xl" style={{ fontFamily: 'Georgia, serif', animation: 'marquee 2.5s ease-in-out infinite' }}>
            \u2726 O&apos;BRIAN & SONS \u2726 PURVEYORS OF LEADS \u2726
          </div>
          <div className="text-[9px] text-amber-700/80 tracking-[0.4em] uppercase mt-0.5">Established 1849 \u00b7 Lead Works & Counting House</div>
          <div className="text-[8px] text-red-800/50 tracking-[0.3em] uppercase mt-0.5 italic" style={{ fontFamily: 'Georgia, serif' }}>"Abandon hope, all ye who enter idle."</div>
        </div>
      </div>

      {/* ══════ POE QUOTE DRIFT ══════ */}
      {poeQuote ? (
        <div className="text-center mb-2 pointer-events-none">
          <span className="text-[11px] italic text-slate-400/70" style={{ fontFamily: 'Georgia, serif', animation: 'poeDrift 6s ease-in-out forwards' }}>
            {poeQuote} \u2014 Poe
          </span>
        </div>
      ) : null}

      {/* ══════ THE TELL-TALE HEARTBEAT ══════ */}
      {heartbeat ? (
        <div className="absolute top-0 left-0 right-0 pointer-events-none z-50 flex justify-center">
          <div className="text-red-500/60 text-xs font-bold tracking-widest uppercase" style={{ fontFamily: 'Georgia, serif', animation: 'heartbeatPulse 1s ease-in-out' }}>
            \u2022 the tell-tale heart beats beneath the floorboards \u2022
          </div>
        </div>
      ) : null}

      {/* ══════ CATWALK: THE OVERSEER + CONTROLS ══════ */}
      <div className={`rounded-xl border border-amber-900/50 bg-gradient-to-b from-[#1d1409] to-[#0c0905] p-3 mb-4 transition-all duration-100 ${thunderFlash ? 'shadow-[0_0_40px_rgba(255,255,200,0.15)]' : ''}`}>
        <div className="flex items-center gap-4 flex-wrap">
          <div ref={supLaneRef} className="relative flex-1 min-w-[280px] h-24 overflow-hidden rounded-lg bg-[#0a0705]"
            style={{ boxShadow: 'inset 0 0 40px rgba(0,0,0,0.7)' }}>
            <div className="absolute top-1 left-3 text-[10px] uppercase tracking-[0.3em] text-amber-600/80 font-bold">The Overseer&apos;s Catwalk</div>
            {/* pendulum clock */}
            <div className="absolute top-2 right-3 flex flex-col items-center">
              <div className="w-8 h-8 rounded-full border-2 border-amber-700/70 bg-[#0c0905] relative">
                <div className="absolute left-1/2 top-1/2 w-[1px] h-3 bg-amber-500" style={{ transform: 'translate(-50%,-100%) rotate(35deg)', transformOrigin: 'bottom' }} />
                <div className="absolute left-1/2 top-1/2 w-[1.5px] h-2 bg-amber-500" style={{ transform: 'translate(-50%,-100%) rotate(-70deg)', transformOrigin: 'bottom' }} />
              </div>
              <div className="flex flex-col items-center" style={{ transformOrigin: 'top center', animation: 'pendulum 1.6s ease-in-out infinite' }}>
                <div className="w-[1.5px] h-5 bg-amber-700/80" /><div className="w-2.5 h-2.5 rounded-full bg-amber-600 -mt-0.5" />
              </div>
            </div>
            {/* raven perched on the catwalk railing */}
            <div className="absolute top-3 right-16"><Raven /></div>
            <div ref={supRef} className="absolute bottom-0 left-0 will-change-transform" style={{ transform: 'translateX(20px)' }}>
              {supLine ? (
                <div className={`absolute -top-3 left-16 whitespace-nowrap px-2.5 py-1 rounded-lg text-[12px] font-bold shadow-lg ${raging ? 'text-red-100 bg-red-950 border border-red-500/70' : 'text-amber-100 bg-amber-950 border border-amber-600/60'}`} style={{ animation: 'bubblePop 3s ease-in-out forwards' }}>
                  {supLine}
                </div>
              ) : null}
              {raging ? <div className="absolute top-3 left-[4.5rem] text-lg font-black text-amber-300 pointer-events-none z-50" style={{ animation: 'crackPop 0.9s ease-out forwards', textShadow: '0 0 12px #f59e0b, 0 0 6px #fff, 0 0 20px rgba(180,40,40,0.5)' }}>
                \uD83D\uDCA5 CRACK!</div> : null}
              <div ref={supSpriteRef} style={{ transformOrigin: 'center bottom' }}><Overseer raging={raging} /></div>
            </div>
            {/* fog on the catwalk */}
            <FogLayer />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-amber-300/80 font-medium">Send the scouts to</span>
              <select value={blitzState} onChange={(e) => setBlitzState(e.target.value)} disabled={dispatching}
                className="px-3 py-2.5 rounded-lg bg-[#1a1208] border border-amber-700/50 text-amber-100 text-sm font-semibold focus:outline-none focus:border-amber-500 disabled:opacity-60">
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={runBlitz} disabled={dispatching}
                className="px-5 py-2.5 rounded-lg font-bold text-sm text-amber-50 border border-amber-600/60 bg-gradient-to-b from-amber-700/50 to-amber-950/70 hover:from-amber-600/60 hover:to-amber-900/80 disabled:opacity-60 transition-all shadow-[0_0_22px_rgba(251,191,36,0.35)]">
                {dispatching ? '\uD83D\uDC0E Scouting\u2026' : '\uD83D\uDC0E Dispatch the scouts'}
              </button>
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={runHouse} disabled={dispatching} title="Enrich raw leads then vet \u2014 uses AI on the raw ones"
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-100 border border-emerald-600/50 bg-emerald-900/40 hover:bg-emerald-800/50 disabled:opacity-60 transition-all">
                \u2699 Run full pass (AI $)
              </button>
              <button onClick={() => runJob('/api/admin/prospects/work/cleanup', 'TIDY the ledgers, vermin!', (d) => `Tidied ${d.fixed} of ${d.scanned} records.`)} disabled={dispatching}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-sky-100 border border-sky-600/50 bg-sky-900/40 hover:bg-sky-800/50 disabled:opacity-60 transition-all">
                \uD83E\uDDF9 Tidy records
              </button>
            </div>
            <button onClick={summonBatch} disabled={dispatching} className="text-[11px] text-amber-600/70 hover:text-amber-300 underline disabled:opacity-50 text-right">
              or summon the 84-installer starter batch
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-widest text-amber-600/80 font-bold whitespace-nowrap">\u26A1 Productivity</span>
          <div className="flex-1 h-2.5 rounded-full bg-black/50 overflow-hidden border border-amber-900/50">
            <div className="h-full rounded-full transition-all duration-700" style={{ width: `${productivity}%`, background: productivity > 70 ? 'linear-gradient(90deg,#16a34a,#4ade80)' : productivity > 40 ? 'linear-gradient(90deg,#ca8a04,#fbbf24)' : 'linear-gradient(90deg,#b91c1c,#f87171)' }} />
          </div>
          <span className="text-[11px] font-bold text-amber-200 w-10 text-right">{productivity}%</span>
          <button onClick={() => setAuto((a) => !a)} title="Auto-vets enriched leads into Qualified \u2014 FREE, no AI."
            className={`ml-2 text-[10px] px-2.5 py-1 rounded-md border font-bold whitespace-nowrap transition-colors ${auto ? (autoWorking ? 'bg-red-900/60 text-red-200 border-red-600/50' : 'bg-emerald-900/60 text-emerald-200 border-emerald-600/50') : 'bg-black/30 text-slate-400 border-white/10 hover:text-white'}`}>
            {auto ? (autoWorking ? '\uD83D\uDC9A Auto-vet: HEARTBEAT\u2026' : '\u2699 Auto-vet: ON (free)') : '\u25B6 Auto-vet: OFF'}
          </button>
        </div>
        {dispatchMsg ? <div className="mt-2 text-center text-sm text-amber-300 italic" style={{ fontFamily: 'Georgia, serif' }}>{dispatchMsg}</div> : null}
      </div>

      {/* ══════ THE WORKSHOP BAYS ══════ */}
      <div className="relative rounded-2xl border border-amber-950/60 bg-[#070504] p-4 md:p-6 overflow-hidden" style={{ boxShadow: 'inset 0 0 120px rgba(0,0,0,0.9)' }}>
        {/* atmospheric particles */}
        {[...Array(8)].map((_, i) => (
          <div key={`e${i}`} className="pointer-events-none absolute rounded-full z-10" style={{ left: `${8 + i * 11}%`, bottom: '3%', width: 3, height: 3, background: '#f59e0b', filter: 'blur(0.5px)', animation: `ember ${6 + i}s linear ${i * 1.1}s infinite` }} />
        ))}
        {[...Array(12)].map((_, i) => (
          <div key={`d${i}`} className="pointer-events-none absolute rounded-full z-10" style={{ left: `${5 + i * 8}%`, bottom: `${10 + (i % 5) * 15}%`, width: 2, height: 2, background: 'rgba(220,220,210,0.5)', animation: `dust ${9 + i}s linear ${i * 0.9}s infinite` }} />
        ))}
        {[...Array(6)].map((_, i) => (
          <div key={`r${i}`} className="pointer-events-none absolute z-10" style={{ left: `${10 + i * 15}%`, top: 0, width: 1, height: 20, background: 'linear-gradient(180deg, transparent, rgba(120,140,180,0.15))', animation: `rainDrop ${1.5 + Math.random()}s linear ${i * 0.3}s infinite` }} />
        ))}

        {/* blood moon watching from the top right */}
        <div className="absolute top-2 right-4 pointer-events-none z-20 opacity-50"><BloodMoon /></div>

        {/* bats wheeling in the rafters */}
        <div className="absolute top-4 left-1/4 pointer-events-none z-20"><Bats /></div>
        <div className="absolute top-8 right-1/3 pointer-events-none z-20" style={{ animationDelay: '1.2s' }}><Bats /></div>

        {/* ghost drifting through the works */}
        <div className="absolute top-16 left-1/2 -translate-x-1/2 pointer-events-none z-20"><Ghost /></div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {rooms.map((room) => {
            const idle = room.count === 0;
            const seatList = Array.from({ length: room.seated }, (_, i) => i);
            const wlist = wanderers.filter((w) => w.stage === room.stage);
            return (
              <button key={room.stage} onClick={() => onEnterRoom(room.stage)}
                className="group relative text-left rounded-xl overflow-hidden focus:outline-none transition-transform hover:-translate-y-0.5"
                style={{ height: 280, border: `2px solid ${whippedStage === room.stage ? '#ef4444' : `${room.accent}55`}`, boxShadow: `0 10px 28px rgba(0,0,0,0.7), 0 0 22px ${room.glow}`, animation: whippedStage === room.stage ? 'roomFlash 0.8s ease-in-out' : undefined }}>

                {/* BACK WALL — deep stone with brick texture and damp */}
                <div className="absolute inset-x-0 top-0 h-[55%]" style={{ background: `linear-gradient(180deg, ${room.wallDeep} 0%, ${room.wall} 60%, #0a0705 100%)` }}>
                  {/* brick pattern — more detailed */}
                  <div className="absolute inset-0" style={{
                    backgroundImage: `
                      repeating-linear-gradient(0deg, rgba(80,50,30,0.12) 0 11px, transparent 11px 12px),
                      repeating-linear-gradient(90deg, transparent 0 28px, rgba(0,0,0,0.25) 28px 29px),
                      repeating-linear-gradient(90deg, transparent 0 56px, rgba(80,50,30,0.06) 56px 57px)
                    `,
                    backgroundSize: '29px 12px, 29px 12px, 57px 12px',
                  }} />
                  {/* damp patches on the wall */}
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundImage: `
                      radial-gradient(ellipse 40px 30px at 20% 35%, rgba(40,60,50,0.15), transparent),
                      radial-gradient(ellipse 50px 25px at 75% 55%, rgba(40,50,60,0.12), transparent),
                      radial-gradient(ellipse 35px 20px at 50% 20%, rgba(50,40,40,0.10), transparent)
                    `,
                  }} />
                  {/* mortar line shimmer */}
                  <div className="absolute inset-0 pointer-events-none" style={{
                    backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 11px, rgba(200,180,150,0.03) 11px 12px)',
                    animation: 'brickShimmer 8s ease-in-out infinite',
                  }} />
                  {/* arched stone doorway to the next chamber */}
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-0 w-14 h-16" style={{
                    background: 'linear-gradient(180deg,#080504,#000)',
                    borderRadius: '28px 28px 0 0',
                    boxShadow: 'inset 0 0 20px #000, inset 0 -4px 8px rgba(0,0,0,0.8)',
                    border: '1px solid rgba(120,90,60,0.25)',
                    borderBottom: 'none',
                  }} />
                  {/* keystones on the arch */}
                  <div className="absolute left-1/2 -translate-x-1/2 bottom-14 w-3 h-3 rounded-t-sm" style={{ background: 'rgba(80,60,40,0.3)', border: '1px solid rgba(100,70,40,0.2)' }} />

                  {/* hanging lanterns — iron cage style with warm glow */}
                  {[22, 50, 78].map((lx) => (
                    <div key={lx} className="absolute" style={{ left: `${lx}%`, top: 0 }}>
                      {/* chain from ceiling */}
                      <div style={{ width: 1.5, height: 14, background: 'linear-gradient(180deg, #3a2c19, #2a1c09)', margin: '0 auto', animation: 'chainSway 3s ease-in-out infinite' }} />
                      {/* iron cage lantern */}
                      <div style={{
                        width: 14, height: 16, borderRadius: '3px 3px 6px 6px',
                        background: 'linear-gradient(180deg, #2a1c09, #1a0e04)',
                        border: '1px solid rgba(100,70,40,0.4)',
                        position: 'relative',
                        animation: 'lanternGlow 2s ease-in-out infinite',
                      }}>
                        {/* cage bars */}
                        <div style={{ position: 'absolute', left: 3, top: 2, width: 1, height: 10, background: 'rgba(100,70,40,0.3)' }} />
                        <div style={{ position: 'absolute', left: 7, top: 2, width: 1, height: 10, background: 'rgba(100,70,40,0.3)' }} />
                        <div style={{ position: 'absolute', left: 11, top: 2, width: 1, height: 10, background: 'rgba(100,70,40,0.3)' }} />
                        {/* the flame inside */}
                        <div style={{
                          position: 'absolute', left: '50%', top: 4, transform: 'translateX(-50%)',
                          width: 6, height: 8, borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                          background: `radial-gradient(circle at 50% 35%, #fff8e0, #fbbf24 40%, ${room.accent} 80%)`,
                          animation: `flame 0.6s ease-in-out ${lx * 0.01}s infinite alternate`,
                          transformOrigin: 'center bottom',
                          boxShadow: `0 0 10px ${room.glow}, 0 0 25px ${room.glow}`,
                        }} />
                      </div>
                    </div>
                  ))}

                  {/* threatening banner — blood red with gold trim */}
                  <div className="absolute left-1/2 -translate-x-1/2 top-8 px-4 py-1 rounded-sm text-[11px] font-black tracking-widest"
                    style={{
                      background: 'linear-gradient(180deg, #7c1d1d, #4a0e0e)',
                      color: '#ffe9b0',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.6), 0 0 12px rgba(124,29,29,0.3), inset 0 1px 0 rgba(255,220,150,0.1)',
                      border: '1px solid rgba(160,50,50,0.5)',
                      borderTop: '2px solid rgba(200,160,80,0.25)',
                    }}>
                    {room.banner}
                  </div>

                  {/* wall clock — ornate */}
                  <div className="absolute right-3 top-2 w-8 h-8 rounded-full flex items-center justify-center" style={{
                    borderColor: room.accent,
                    border: '2px solid rgba(100,70,40,0.4)',
                    background: 'radial-gradient(circle at 40% 35%, #1a1206, #0a0705)',
                    boxShadow: 'inset 0 0 4px rgba(0,0,0,0.6)',
                  }}>
                    <div className="absolute w-2.5 h-[1.5px]" style={{ background: room.accent, transform: 'rotate(40deg)', opacity: 0.8 }} />
                    <div className="absolute w-[1.5px] h-3" style={{ background: room.accent, transform: 'rotate(10deg)', opacity: 0.8 }} />
                    <div className="absolute w-0.5 h-0.5 rounded-full" style={{ background: room.accent, opacity: 0.6 }} />
                  </div>

                  {/* cobwebs — more detailed */}
                  <div className="absolute top-0 left-0"><Cobweb /></div>
                  <div className="absolute top-0 right-0" style={{ transform: 'scaleX(-1)' }}><Cobweb /></div>

                  {/* fireplace — warm amber glow with iron surround */}
                  <div className="absolute left-2 bottom-0" style={{ zIndex: 6 }}><Fireplace /></div>
                  {/* fireplace glow on the floor */}
                  <div className="absolute left-0 bottom-0 w-24 h-16 pointer-events-none" style={{
                    background: 'radial-gradient(ellipse at 30% 80%, rgba(245,158,11,0.12), transparent 70%)',
                  }} />

                  {/* framed portrait — gilded frame, glowing eyes */}
                  <div className="absolute right-20 bottom-2 hidden md:block"><Portrait accent={room.accent} /></div>

                  {/* candelabra */}
                  <div className="absolute right-4 bottom-1"><Candelabra /></div>

                  {/* raven */}
                  <div className="absolute right-12 top-7"><Raven /></div>

                  {/* chandelier — only in the Counting House */}
                  {room.stage === 'signed_up' ? <div className="absolute left-1/2 -translate-x-1/2 top-0"><Chandelier /></div> : null}

                  {/* skeleton — only in the Catacombs */}
                  {room.stage === 'rejected' ? <div className="absolute right-8 bottom-1 opacity-40"><Skeleton /></div> : null}

                  {/* Poe quote etched into the wall */}
                  <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[7px] italic text-slate-500/30 max-w-[80%] text-center pointer-events-none whitespace-nowrap" style={{ fontFamily: 'Georgia, serif' }}>
                    {room.poe}
                  </div>

                  {/* wainscoting along the bottom of the wall */}
                  <div className="absolute bottom-0 inset-x-0 h-4" style={{
                    background: `linear-gradient(180deg, rgba(60,40,25,0.15), rgba(40,25,15,0.25))`,
                    borderTop: '1px solid rgba(100,70,40,0.15)',
                  }} />
                </div>

                {/* FLOOR — worn wood planks with depth and grime */}
                <div ref={(el) => { floorRefs.current.set(room.stage, el); }} className="absolute inset-x-0 bottom-0 h-[45%]"
                  style={{
                    background: 'linear-gradient(180deg, #1a120a 0%, #22170d 40%, #2a1d10 70%, #332412 100%)',
                    backgroundImage: `
                      repeating-linear-gradient(90deg, rgba(0,0,0,0.25) 0 1px, transparent 1px 40px),
                      repeating-linear-gradient(90deg, rgba(80,50,30,0.06) 0 2px, transparent 2px 80px)
                    `,
                    boxShadow: 'inset 0 14px 22px rgba(0,0,0,0.7), inset 26px 0 28px rgba(0,0,0,0.5), inset -26px 0 28px rgba(0,0,0,0.5)',
                  }}>
                  <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(ellipse at 50% 0%, ${room.glow}, transparent 60%)` }} />

                  {/* floorboard nail heads */}
                  {[0, 1, 2, 3, 4].map((ni) => (
                    <div key={ni} className="absolute pointer-events-none" style={{
                      left: `${10 + ni * 20}%`, top: '8%',
                      width: 2, height: 2, borderRadius: '50%',
                      background: 'radial-gradient(circle, rgba(120,90,60,0.3), rgba(80,50,30,0.15))',
                    }} />
                  ))}

                  {/* spilled ink stain */}
                  <div className="absolute pointer-events-none" style={{
                    left: '35%', top: '25%', width: 12, height: 8, borderRadius: '40% 60% 50% 50%',
                    background: 'radial-gradient(ellipse, rgba(20,15,30,0.25), transparent 70%)',
                  }} />

                  {/* Tell-Tale Heart pulse — in the Assay Room floor */}
                  {room.stage === 'qualified' && autoWorking ? (
                    <div className="absolute inset-0 pointer-events-none" style={{
                      background: 'radial-gradient(ellipse at 50% 50%, rgba(180,40,40,0.12), transparent 60%)',
                      animation: 'heartbeatPulse 1s ease-in-out',
                    }} />
                  ) : null}

                  {/* fog layer */}
                  <FogLayer />

                  {/* a rat scurries the baseboards */}
                  <div className="absolute bottom-0 pointer-events-none" style={{ left: 0, zIndex: 2, animation: 'ratRun 9s linear infinite', animationDelay: `${ROOMS.findIndex((r) => r.stage === room.stage) * 1.6}s` }}><Rat /></div>

                  {/* the tea cart in the Copying Room */}
                  {room.stage === 'enriched' ? <div className="absolute bottom-1 pointer-events-none" style={{ left: 0, zIndex: 3, animation: 'rollAcross 24s linear infinite' }}><TeaCart /></div> : null}

                  {/* filing cabinet */}
                  <div className="absolute right-2 bottom-1" style={{ zIndex: 60 }}><FilingCabinet accent={room.accent} /></div>

                  {/* desks + seated clerks */}
                  {DESKS.map((d, i) => {
                    const sc = depthScale(d.top / 100);
                    return (
                      <div key={i} className="absolute" style={{ left: `${d.left}%`, top: `${d.top}%`, transform: `scale(${sc})`, transformOrigin: 'center bottom', zIndex: Math.round(d.top) + 10 }}>
                        <Desk accent={room.accent} delay={i * 0.7} />
                        {seatList.includes(i) ? (
                          <div className="absolute" style={{ left: 16, top: 2 }}>
                            {bubbles[`${room.stage}-seat-${i}`] ? <div className={bubble} style={{ animation: 'bubblePop 2.2s ease-in-out forwards' }}>{bubbles[`${room.stage}-seat-${i}`]}</div> : null}
                            <div style={{ animation: whipTarget === `${room.stage}-seat-${i}` ? 'whipShake 0.4s ease-in-out infinite' : 'typeBob 0.5s ease-in-out infinite' }}><Clerk c={room.accent} variant={i % 4} seated gold={room.stage === 'signed_up' && i === 0} /></div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}

                  {/* wandering clerks */}
                  {wlist.map((w) => (
                    <div key={w.id} ref={(el) => { wanderEls.current.set(w.id, el); }} className="absolute top-0 left-0 will-change-transform" style={{ transform: 'translate(20px,20px)' }}>
                      {bubbles[w.id] ? <div className={bubble} style={{ animation: 'bubblePop 2.2s ease-in-out forwards' }}>{bubbles[w.id]}</div> : null}
                      <div ref={(el) => { spriteEls.current.set(w.id, el); }} style={{ transformOrigin: 'center bottom' }}>
                        <div style={{ transformOrigin: 'bottom center', animation: faintTarget === w.id ? 'faint 0.5s ease-in forwards' : whipTarget === w.id ? 'whipShake 0.4s ease-in-out infinite' : 'floorBob 1.3s ease-in-out infinite' }}>
                          <Clerk c={room.accent} variant={w.variant} />
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* sold leads drop coins in the Counting House */}
                  {room.stage === 'signed_up' && room.count > 0 ? (
                    <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex gap-0.5 pointer-events-none" style={{ zIndex: 5 }}>
                      {Array.from({ length: Math.min(room.count, 8) }).map((_, i) => (
                        <span key={i} style={{ fontSize: 15, animation: `coinDrop 0.7s ease-out ${i * 0.12}s both` }}>\uD83E\uDE99</span>
                      ))}
                    </div>
                  ) : null}

                  {idle ? <div className="absolute inset-0 flex items-center justify-center text-sm text-amber-700/70 italic pointer-events-none" style={{ fontFamily: 'Georgia, serif' }}>{IDLE_TEXT[room.stage] || 'this chamber lies vacant\u2026'}</div> : null}
                </div>

                {/* SIGN (big, readable, top) — more ornate */}
                <div className="absolute top-2 left-2 right-2 flex items-start justify-between z-40 pointer-events-none">
                  <div className="px-3 py-1.5 rounded-md" style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', borderLeft: `3px solid ${room.accent}40` }}>
                    <div className="text-base font-extrabold tracking-wide leading-none" style={{ color: room.accent, fontFamily: 'Georgia, serif', textShadow: `0 0 8px ${room.glow}` }}>{room.name}</div>
                    <div className="text-[11px] text-amber-500/90 uppercase tracking-wider mt-0.5">{room.tag}</div>
                  </div>
                  <div className="px-3 py-1.5 rounded-md bg-black/75 text-right" style={{ borderRight: `3px solid ${room.accent}40` }}>
                    <div className="text-3xl font-black text-amber-50 leading-none" style={{ fontFamily: 'Georgia, serif', textShadow: '0 0 6px rgba(251,191,36,0.3)' }}>{room.count}</div>
                    <div className="text-[10px] text-amber-500/90 uppercase tracking-widest">leads</div>
                  </div>
                </div>

                <div className="absolute bottom-2 left-3 z-40 text-[12px] font-semibold text-amber-200/80 group-hover:text-amber-300 transition-colors" style={{ fontFamily: 'Georgia, serif' }}>enter the chamber \u2192</div>

                {WORK_LABEL[room.stage] ? (
                  <div role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); workRoom(room.stage); }}
                    className="absolute top-14 right-2 z-40 px-2.5 py-1 rounded-md text-[11px] font-bold text-amber-50 bg-amber-800/80 hover:bg-amber-700 border border-amber-500/50 shadow cursor-pointer transition-colors"
                    style={{ pointerEvents: dispatching ? 'none' : 'auto', opacity: dispatching ? 0.5 : 1 }}>
                    {WORK_LABEL[room.stage]}
                  </div>
                ) : null}
                {room.stage === 'qualified' ? (
                  <div role="button" tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); runJob('/api/admin/prospects/work/dossier', 'To the READING ROOM, scribble!', (d) => `Drafted ${d.written} dossiers (${d.processed} read).`); }}
                    className="absolute top-[5.5rem] right-2 z-40 px-2.5 py-1 rounded-md text-[11px] font-bold text-violet-50 bg-violet-800/80 hover:bg-violet-700 border border-violet-400/50 shadow cursor-pointer transition-colors"
                    style={{ pointerEvents: dispatching ? 'none' : 'auto', opacity: dispatching ? 0.5 : 1 }}>
                    \uD83D\uDCD6 Write dossiers (AI $)
                  </div>
                ) : null}

                {/* Pipeline flow arrow */}
                {room.stage !== 'rejected' ? (
                  <div className="absolute bottom-2 right-3 z-40 text-[10px] text-amber-600/40 pointer-events-none" style={{ fontFamily: 'Georgia, serif' }}>
                    {room.stage === 'discovered' ? '\u2192 enriched' : room.stage === 'enriched' ? '\u2192 qualified' : room.stage === 'qualified' ? '\u2192 contacted' : room.stage === 'contacted' ? '\u2192 signed' : '\u2726'}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Global fog */}
        <FogLayer />
      </div>

      {/* ══════ EPILOGUE / EPITAPH FOOTER ══════ */}
      <div className="mt-3 text-center" style={{ fontFamily: 'Georgia, serif' }}>
        <div className="text-sm text-amber-700/80 italic">
          {total} installers within these walls \u00b7 {rooms.reduce((s, r) => s + r.total, 0)} clerks at their desks \u00b7 the ledgers update in real time
        </div>
        <div className="text-[9px] text-red-800/40 italic mt-1 tracking-wider">
          "And the Raven, never flitting, still is sitting, still is sitting \u2014 on the pallid bust of Pallas just above my chamber door."
        </div>
        <div className="mt-1 flex justify-center gap-3 text-[8px] text-slate-600/30 uppercase tracking-[0.3em]">
          <span>\u2620 est. 1849</span>
          <span>\u2022</span>
          <span>lead works</span>
          <span>\u2022</span>
          <span>nevermore</span>
          <span>\u2022</span>
          <span>all rights reserved in perpetuity</span>
          <span>\u2620</span>
        </div>
      </div>
    </div>
  );
}
