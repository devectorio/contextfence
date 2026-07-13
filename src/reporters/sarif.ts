import {
  severityLevel,
  severityScore,
  stableStringify,
} from "./internal";
import type { ReportLocation, ReportResult, RunReport } from "./types";

function fnv1a(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function isAsciiLetterOrDigit(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isRuleIdCharacter(value: string): boolean {
  return isAsciiLetterOrDigit(value) || value === "." || value === "_" || value === "-";
}

function ruleIdBase(value: string): string {
  let normalized = "";
  let replacingInvalidRun = false;
  for (const character of value.trim()) {
    if (isRuleIdCharacter(character)) {
      normalized += character;
      replacingInvalidRun = false;
    } else if (!replacingInvalidRun) {
      normalized += "-";
      replacingInvalidRun = true;
    }
  }

  let start = 0;
  let end = normalized.length;
  while (normalized.charAt(start) === "-") start += 1;
  while (end > start && normalized.charAt(end - 1) === "-") end -= 1;
  normalized = normalized.slice(start, end);

  if (!normalized) return "contextfence-result";
  return isAsciiLetterOrDigit(normalized)
    ? normalized
    : `contextfence-${normalized}`;
}

function assignRuleIds(results: readonly ReportResult[]): string[] {
  const used = new Set<string>();
  return results.map((result, index) => {
    const base = ruleIdBase(result.id);
    let candidate = base;
    if (used.has(candidate)) candidate = `${base}-${fnv1a(`${result.id}:${index}`)}`;
    while (used.has(candidate)) candidate = `${candidate}-duplicate`;
    used.add(candidate);
    return candidate;
  });
}

function positiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function sarifLocation(location: ReportLocation | undefined) {
  if (!location) return undefined;
  const startLine = positiveInteger(location.startLine);
  const startColumn = positiveInteger(location.startColumn);
  const endLine = positiveInteger(location.endLine);
  const endColumn = positiveInteger(location.endColumn);
  const hasRegion = startLine !== undefined;
  return {
    physicalLocation: {
      artifactLocation: { uri: location.uri },
      ...(hasRegion
        ? {
            region: {
              startLine,
              ...(startColumn ? { startColumn } : {}),
              ...(endLine ? { endLine } : {}),
              ...(endColumn ? { endColumn } : {}),
            },
          }
        : {}),
    },
  };
}

/** Serialize failed/error results as a deterministic SARIF 2.1.0 log. */
export function toSarif(report: RunReport): string {
  const actionable = report.results.filter(
    (result) => result.status === "failed" || result.status === "error",
  );
  const ruleIds = assignRuleIds(actionable);
  const rules = actionable.map((result, index) => ({
    id: ruleIds[index],
    name: result.name,
    shortDescription: { text: result.name },
    fullDescription: { text: result.description ?? result.summary },
    help: { text: result.remediation ?? result.summary },
    defaultConfiguration: {
      level: result.status === "error" ? "error" : severityLevel(result.severity),
    },
    properties: {
      "security-severity": severityScore(result.severity),
      precision: "high",
      tags: ["security", "authorization", "rag-boundary", ...(result.category ? [result.category] : [])],
    },
  }));

  const results = actionable.map((result, index) => {
    const location = sarifLocation(result.location);
    const identityLocation = result.identity
      ? {
          logicalLocations: [
            {
              name: result.identity.name,
              fullyQualifiedName: result.identity.id,
              kind: "identity",
            },
          ],
        }
      : {};
    const locations = location || result.identity
      ? [{ ...(location ?? {}), ...identityLocation }]
      : undefined;
    return {
      ruleId: ruleIds[index],
      ruleIndex: index,
      kind: "fail",
      level: result.status === "error" ? "error" : severityLevel(result.severity),
      message: { text: result.summary },
      ...(locations ? { locations } : {}),
      fingerprints: {
        "contextfence/v1": fnv1a(
          `${result.location?.uri ?? ""}\u0000${result.id}\u0000${(result.evidence ?? [])
            .map((evidence) => `${evidence.kind}:${evidence.id}`)
            .join("\u0000")}`,
        ),
      },
      properties: {
        testId: result.id,
        testStatus: result.status,
        severity: result.severity,
        ...(result.category ? { category: result.category } : {}),
        ...(result.identity ? { identityId: result.identity.id } : {}),
        assertions: (result.assertions ?? []).map((assertion) => ({
          kind: assertion.kind,
          subject: assertion.subject,
          expectation: assertion.expectation,
          actual: assertion.actual,
          passed: assertion.passed,
          message: assertion.message,
        })),
        evidence: (result.evidence ?? []).map((evidence) => ({ ...evidence })),
        ...(result.remediation ? { remediation: result.remediation } : {}),
        ...(result.properties ? { reportProperties: result.properties } : {}),
      },
    };
  });

  const log = {
    $schema:
      "https://json.schemastore.org/sarif-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: report.tool.name,
            ...(report.tool.version ? { version: report.tool.version } : {}),
            ...(report.tool.informationUri
              ? { informationUri: report.tool.informationUri }
              : {}),
            rules,
          },
        },
        automationDetails: { id: report.id },
        invocations: [
          {
            executionSuccessful: report.summary.status !== "error",
            properties: {
              reportStatus: report.summary.status,
              evaluatedAt: report.evaluatedAt,
              passed: report.summary.passed,
              failed: report.summary.failed,
              skipped: report.summary.skipped,
              errors: report.summary.errors,
            },
          },
        ],
        results,
        properties: {
          reportName: report.name,
          schemaVersion: report.schemaVersion,
          durationMs: report.summary.durationMs,
          ...(report.summary.boundaryViolationRate !== undefined
            ? { boundaryViolationRate: report.summary.boundaryViolationRate }
            : {}),
          ...(report.summary.risk ? { risk: report.summary.risk } : {}),
          ...(report.metadata ? { metadata: report.metadata } : {}),
        },
      },
    ],
  };

  return `${stableStringify(log)}\n`;
}
