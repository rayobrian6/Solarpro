export function stableEngineeringStateHash(prefix: string, values: Array<string | number | boolean | null | undefined>): string {
  const payload = Array.from(new Set(values.filter(value => value !== null && value !== undefined && String(value).length > 0).map(String))).sort((a, b) => a.localeCompare(b)).join('\n');
  let hash = 5381;
  for (let i = 0; i < payload.length; i += 1) {
    hash = ((hash << 5) + hash) ^ payload.charCodeAt(i);
    hash >>>= 0;
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}
