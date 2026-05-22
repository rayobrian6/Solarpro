import type { MarketplaceValueSource } from "@/lib/network/marketplaceIntelligence";

export type IntelligenceLevel = "high" | "medium" | "low" | "unknown";
export type IntelligenceBand = "strong" | "moderate" | "limited" | "unknown";

export interface IntelligenceRange {
  min: number;
  max: number;
  midpoint: number;
  unit: "usd" | "percent" | "score" | "kw" | "kwh";
  label: string;
}

export interface IntelligenceEvidenceNote {
  label: string;
  value: string;
  source:
    | MarketplaceValueSource
    | "bill"
    | "homeowner"
    | "operator"
    | "screening"
    | "enrichment"
    | "derived";
}

export function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function boolValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "1", "y", "on", "interested"].includes(normalized))
      return true;
    if (["false", "no", "0", "n", "off", "not_interested"].includes(normalized))
      return false;
  }
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizedText(value: unknown): string | null {
  const text = stringValue(value);
  return text ? text.toLowerCase().replace(/\s+/g, "_") : null;
}

export function displayText(value: unknown): string | null {
  const text = stringValue(value);
  return text ? text.replace(/_/g, " ") : null;
}

export function capitalizeLabel(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function boundedRange(
  midpoint: number,
  spreadPct: number,
  unit: IntelligenceRange["unit"],
  label: string,
): IntelligenceRange | null {
  if (!Number.isFinite(midpoint) || midpoint <= 0) return null;
  const spread = Math.max(0, spreadPct);
  const min = Math.max(0, Math.round(midpoint * (1 - spread)));
  const max = Math.max(min, Math.round(midpoint * (1 + spread)));
  return { min, max, midpoint: Math.round(midpoint), unit, label };
}

export function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatRange(
  range: IntelligenceRange | null,
  fallback: string,
): string {
  if (!range) return fallback;
  if (range.min === range.max)
    return range.unit === "usd"
      ? formatMoney(range.midpoint)
      : String(range.midpoint);
  if (range.unit === "usd")
    return `${formatMoney(range.min)}–${formatMoney(range.max)}`;
  if (range.unit === "percent") return `${range.min}%–${range.max}%`;
  return `${range.min.toLocaleString("en-US")}–${range.max.toLocaleString("en-US")}`;
}

export function pushUnique(target: string[], value: string | null | undefined) {
  if (value && !target.includes(value)) target.push(value);
}
