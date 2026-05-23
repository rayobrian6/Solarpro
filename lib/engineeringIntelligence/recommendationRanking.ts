import type { EngineeringRecommendation, EngineeringRecommendationPriority, EngineeringRecommendationSeverity } from './recommendationTypes';

const priorityRank: Record<EngineeringRecommendationPriority, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  informational: 1,
};

const severityRank: Record<EngineeringRecommendationSeverity, number> = {
  blocked: 5,
  review_required: 4,
  stale_risk: 3,
  quality_gap: 2,
  guidance: 1,
};

export function rankEngineeringRecommendations(recommendations: EngineeringRecommendation[]): EngineeringRecommendation[] {
  return [...recommendations].sort((a, b) => {
    const score = b.deterministicScore - a.deterministicScore;
    if (score !== 0) return score;
    const severity = severityRank[b.severity] - severityRank[a.severity];
    if (severity !== 0) return severity;
    const priority = priorityRank[b.priority] - priorityRank[a.priority];
    if (priority !== 0) return priority;
    const category = a.category.localeCompare(b.category);
    if (category !== 0) return category;
    const type = a.recommendationType.localeCompare(b.recommendationType);
    if (type !== 0) return type;
    return a.recommendationId.localeCompare(b.recommendationId);
  });
}

export function stableRecommendationHash(payload: unknown, prefix = 'recommendation-v1'): string {
  const text = stableStringify(payload);
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
    hash >>>= 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return JSON.stringify(String(value));
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(item => stableStringify(item)).join(',')}]`;
  if (value instanceof Map) return stableStringify([...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))));
  if (value instanceof Set) return stableStringify([...value].sort((a, b) => String(a).localeCompare(String(b))));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

export function uniqueSorted(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))).sort((a, b) => a.localeCompare(b));
}
