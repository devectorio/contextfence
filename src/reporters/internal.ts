import type {
  ReportMetadataValue,
  ReportResultStatus,
  ReportSeverity,
} from "./types";

function sanitizeXmlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowed =
      codePoint === 0x09 ||
      codePoint === 0x0a ||
      codePoint === 0x0d ||
      (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
      (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
      (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    result += allowed ? character : "\uFFFD";
  }
  return result;
}

export function escapeXmlText(value: string): string {
  return sanitizeXmlCharacters(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function escapeHtml(value: string): string {
  return sanitizeXmlCharacters(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeJson(
  value: unknown,
  ancestors: Set<object>,
): ReportMetadataValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (typeof value === "bigint") {
    throw new TypeError("BigInt values cannot be serialized in a report.");
  }
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) {
    throw new TypeError("Circular values cannot be serialized in a report.");
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeJson(item, ancestors) ?? null);
    ancestors.delete(value);
    return normalized;
  }

  const normalized = Object.create(null) as Record<string, ReportMetadataValue>;
  for (const key of Object.keys(value).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const child = normalizeJson((value as Record<string, unknown>)[key], ancestors);
    if (child !== undefined) normalized[key] = child;
  }
  ancestors.delete(value);
  return normalized;
}

/** Stable JSON with recursively sorted object keys and normal JSON number semantics. */
export function stableStringify(value: unknown, indentation = 2): string {
  const normalized = normalizeJson(value, new Set());
  if (normalized === undefined) {
    throw new TypeError("The report root must be JSON serializable.");
  }
  return JSON.stringify(normalized, null, indentation);
}

export function formatSeconds(durationMs: number): string {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return (safeDuration / 1_000).toFixed(3);
}

export function severityLevel(
  severity: ReportSeverity,
): "none" | "note" | "warning" | "error" {
  switch (severity) {
    case "critical":
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "note";
    case "none":
      return "none";
  }
}

export function severityScore(severity: ReportSeverity): string {
  const scores: Record<ReportSeverity, string> = {
    none: "0.0",
    low: "2.0",
    medium: "5.5",
    high: "8.0",
    critical: "9.5",
  };
  return scores[severity];
}

export function resultStatusLabel(status: ReportResultStatus): string {
  const labels: Record<ReportResultStatus, string> = {
    passed: "Passed",
    failed: "Failed",
    skipped: "Skipped",
    error: "Error",
  };
  return labels[status] ?? "Unknown";
}
