/**
 * lib/solardog/detectMode.ts
 *
 * SolarDog mode detection — extracted as a pure utility so it can be
 * imported in tests without pulling in Next.js server-only modules.
 *
 * v10.2
 */

export type SolarDogMode =
  | 'user'
  | 'developer'
  | 'debug'
  | 'project_helper'
  | 'engineering_helper';

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

export function detectMode(message: string, page: string): SolarDogMode {
  const lower = message.toLowerCase();
  if (DEV_PHRASES.some(p => lower.includes(p))) return 'developer';
  if (lower.includes('debug mode') || lower.includes('inspect') || lower.includes('diagnose')) return 'debug';
  if (lower.includes('debug') && (lower.includes('voice') || lower.includes('memory') || lower.includes('connection'))) return 'debug';
  if (page === 'engineering') return 'engineering_helper';
  if (page === 'projects' || page === 'design' || page === 'proposals') return 'project_helper';
  return 'user';
}