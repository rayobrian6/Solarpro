export function normalizeCandidateConfidence(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0;
  const clamped = Math.min(1, Math.max(0, confidence));
  return Math.round(clamped * 10000) / 10000;
}

export function preserveLowestConfidence(values: number[]): number {
  if (values.length === 0) return 0;
  return normalizeCandidateConfidence(Math.min(...values));
}
