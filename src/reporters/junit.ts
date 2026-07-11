import {
  escapeXmlAttribute,
  escapeXmlText,
  formatSeconds,
  stableStringify,
} from "./internal";
import type {
  ReportMetadataValue,
  ReportResult,
  RunReport,
} from "./types";

function metadataText(value: ReportMetadataValue): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return stableStringify(value, 0);
}

function resultDetails(result: ReportResult): string {
  const lines = [result.summary, `Severity: ${result.severity}`];
  if (result.identity) {
    lines.push(`Identity: ${result.identity.name} (${result.identity.id})`);
  }
  if (result.location) {
    const position = result.location.startLine
      ? `:${result.location.startLine}${result.location.startColumn ? `:${result.location.startColumn}` : ""}`
      : "";
    lines.push(`Location: ${result.location.uri}${position}`);
  }
  if (result.assertions?.length) {
    lines.push("", "Assertions:");
    for (const assertion of result.assertions) {
      lines.push(
        `- ${assertion.passed ? "PASS" : "FAIL"} [${assertion.kind}:${assertion.subject}] ${assertion.message}`,
      );
    }
  }
  if (result.evidence?.length) {
    lines.push("", "Evidence:");
    for (const evidence of result.evidence) {
      lines.push(
        `- [${evidence.severity}] ${evidence.label} (${evidence.kind}:${evidence.id}): ${evidence.detail}`,
      );
    }
  }
  if (result.trace?.length) {
    lines.push("", "Trace:");
    for (const step of result.trace) {
      lines.push(`- ${step.status.toUpperCase()} ${step.label}: ${step.detail}`);
    }
  }
  if (result.remediation) lines.push("", `Remediation: ${result.remediation}`);
  return lines.join("\n");
}

function renderTestCase(result: ReportResult, suiteName: string): string[] {
  const className = result.category
    ? `${suiteName}.${result.category}`
    : suiteName;
  const lines = [
    `    <testcase name="${escapeXmlAttribute(result.name)}" classname="${escapeXmlAttribute(className)}" time="${formatSeconds(result.durationMs)}">`,
  ];
  const details = escapeXmlText(resultDetails(result));

  if (result.status === "failed") {
    lines.push(
      `      <failure type="ContextFenceBoundaryViolation.${escapeXmlAttribute(result.severity)}" message="${escapeXmlAttribute(result.summary)}">${details}</failure>`,
    );
  } else if (result.status === "error") {
    lines.push(
      `      <error type="ContextFenceReporterError" message="${escapeXmlAttribute(result.summary)}">${details}</error>`,
    );
  } else if (result.status === "skipped") {
    lines.push(
      `      <skipped message="${escapeXmlAttribute(result.summary)}" />`,
    );
  }

  lines.push(`      <system-out>${details}</system-out>`, "    </testcase>");
  return lines;
}

/** Serialize a report using the broadly supported JUnit XML dialect. */
export function toJUnit(report: RunReport): string {
  const failures = report.results.filter((result) => result.status === "failed").length;
  const errors = report.results.filter((result) => result.status === "error").length;
  const skipped = report.results.filter((result) => result.status === "skipped").length;
  const rootAttributes =
    `name="${escapeXmlAttribute(report.name)}" tests="${report.results.length}" ` +
    `failures="${failures}" errors="${errors}" ` +
    `time="${formatSeconds(report.summary.durationMs)}"`;
  const suiteAttributes =
    `name="${escapeXmlAttribute(report.name)}" tests="${report.results.length}" ` +
    `failures="${failures}" errors="${errors}" skipped="${skipped}" ` +
    `time="${formatSeconds(report.summary.durationMs)}" timestamp="${escapeXmlAttribute(report.evaluatedAt)}"`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites ${rootAttributes}>`,
    `  <testsuite ${suiteAttributes}>`,
    "    <properties>",
    `      <property name="contextfence.report.id" value="${escapeXmlAttribute(report.id)}" />`,
    `      <property name="contextfence.schema.version" value="${report.schemaVersion}" />`,
    `      <property name="contextfence.tool.name" value="${escapeXmlAttribute(report.tool.name)}" />`,
  ];

  if (report.tool.version) {
    lines.push(
      `      <property name="contextfence.tool.version" value="${escapeXmlAttribute(report.tool.version)}" />`,
    );
  }
  if (report.summary.risk) {
    lines.push(
      `      <property name="contextfence.risk.score" value="${escapeXmlAttribute(String(report.summary.risk.score))}" />`,
      `      <property name="contextfence.risk.severity" value="${report.summary.risk.severity}" />`,
    );
  }
  for (const [key, value] of Object.entries(report.metadata ?? {}).sort(
    ([left], [right]) => left < right ? -1 : left > right ? 1 : 0,
  )) {
    lines.push(
      `      <property name="contextfence.metadata.${escapeXmlAttribute(key)}" value="${escapeXmlAttribute(metadataText(value))}" />`,
    );
  }

  lines.push("    </properties>");
  for (const result of report.results) {
    lines.push(...renderTestCase(result, report.name));
  }
  lines.push("  </testsuite>", "</testsuites>");
  return `${lines.join("\n")}\n`;
}
