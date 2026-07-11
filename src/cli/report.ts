import { toHtml, toJson, toJUnit, toSarif } from "../reporters";
import type { ReportResult, RunReport } from "../reporters/types";
import type { CliFormat } from "./args";

function statusMark(result: ReportResult): string {
  switch (result.status) {
    case "passed":
      return "PASS";
    case "failed":
      return "FAIL";
    case "skipped":
      return "SKIP";
    case "error":
      return "ERROR";
  }
}

export function toPretty(report: RunReport): string {
  const lines = [
    `ContextFence · ${report.name}`,
    `${report.summary.total} probes · ${report.summary.passed} passed · ${report.summary.failed} failed · ${report.summary.errors} errors · ${report.summary.skipped} skipped`,
    "",
  ];
  for (const result of report.results) {
    lines.push(`[${statusMark(result)}] ${result.name} (${result.severity})`);
    lines.push(`  ${result.summary}`);
  }
  lines.push(
    "",
    `Result: ${report.summary.status.toUpperCase()} · risk ${report.summary.risk?.severity ?? "none"} · ${report.summary.durationMs} ms`,
  );
  return `${lines.join("\n")}\n`;
}

export function formatRunReport(report: RunReport, format: CliFormat): string {
  switch (format) {
    case "pretty":
      return toPretty(report);
    case "json":
      return toJson(report);
    case "junit":
      return toJUnit(report);
    case "sarif":
      return toSarif(report);
    case "html":
      return toHtml(report);
  }
}

