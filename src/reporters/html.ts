import {
  escapeHtml,
  resultStatusLabel,
  stableStringify,
} from "./internal";
import type {
  ReportAssertion,
  ReportEvidence,
  ReportResult,
  ReportTraceStep,
  RunReport,
} from "./types";

// Keep this string byte-for-byte aligned with STYLE_SHA256. The hash permits
// this one style block without weakening the report's otherwise deny-all CSP.
const REPORT_CSS = `
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#070a0f;color:#e8edf5;font-synthesis:none}
*{box-sizing:border-box}
body{margin:0;min-width:320px;background:radial-gradient(circle at 12% 0,#17223a 0,transparent 30rem),#070a0f;line-height:1.55}
.shell{width:min(1120px,calc(100% - 32px));margin:0 auto;padding:52px 0 72px}
.eyebrow{margin:0 0 8px;color:#75e5be;font:700 12px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase}
h1,h2,h3,p{margin-top:0}
h1{max-width:820px;margin-bottom:14px;font-size:clamp(32px,6vw,64px);line-height:1.02;letter-spacing:-.045em}
.lede{max-width:760px;margin-bottom:8px;color:#aeb9ca;font-size:18px}
.meta-line{color:#7f8ba0;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere}
.summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:36px 0 18px}
.card,.panel,.result{border:1px solid #273146;background:rgba(14,19,29,.9);box-shadow:0 16px 46px rgba(0,0,0,.22)}
.card{min-height:112px;padding:18px;border-radius:14px}
.card span{display:block;color:#8490a4;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.card strong{display:block;margin-top:8px;font-size:30px;line-height:1}
.risk{display:flex;align-items:center;justify-content:space-between;gap:24px;margin-bottom:36px;padding:20px 22px;border-radius:14px}
.risk p{margin:4px 0 0;color:#9ca8ba}
.badge{display:inline-flex;align-items:center;width:max-content;padding:5px 9px;border:1px solid currentColor;border-radius:999px;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase}
.severity-none,.status-passed{color:#75e5be}.severity-low,.status-skipped{color:#74baff}.severity-medium{color:#f0c96a}.severity-high,.severity-critical,.status-failed,.status-error{color:#ff7a87}
.section-title{display:flex;align-items:end;justify-content:space-between;gap:24px;margin:42px 0 14px}
.section-title h2{margin:0;font-size:24px}.section-title p{margin:0;color:#7f8ba0}
.results{display:grid;gap:14px}
.result{overflow:hidden;border-radius:16px}.result-failed,.result-error{border-color:#63333d}.result-passed{border-color:#245243}
.result summary{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:16px;padding:20px 22px;cursor:pointer;list-style:none}.result summary::-webkit-details-marker{display:none}
.result summary:before{content:"+";display:grid;width:26px;height:26px;place-items:center;border:1px solid #344058;border-radius:7px;color:#91a0b7;font:18px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.result[open] summary:before{content:"−"}
.result-title h3{margin:0 0 3px;font-size:17px}.result-title p{margin:0;color:#8895aa;font-size:13px}.result-badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px}
.result-body{padding:0 22px 22px;border-top:1px solid #242d40}.result-body>p{margin:18px 0;color:#c0c9d6}
.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.fact{padding:12px;border:1px solid #283247;border-radius:10px;background:#0a0e16}.fact b{display:block;color:#8290a7;font-size:11px;text-transform:uppercase;letter-spacing:.07em}.fact span{display:block;margin-top:3px;overflow-wrap:anywhere}
.subsection{margin-top:24px}.subsection h3{margin-bottom:10px;font-size:14px;letter-spacing:.04em}
.list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.list li{padding:11px 12px;border-left:3px solid #344159;background:#0a0e16;border-radius:0 8px 8px 0}.list li.bad{border-left-color:#ff6374}.list li.good{border-left-color:#65d6ab}.list small{display:block;margin-top:3px;color:#8996aa}
.table-wrap{overflow-x:auto;border:1px solid #283247;border-radius:10px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:10px 12px;border-bottom:1px solid #232c3f;text-align:left;vertical-align:top}th{color:#8491a6;background:#0a0e16;font-size:11px;text-transform:uppercase;letter-spacing:.07em}tr:last-child td{border-bottom:0}td code{color:#9adfc8}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}code{font-size:.9em}pre{max-height:460px;margin:0;padding:14px;overflow:auto;border:1px solid #283247;border-radius:10px;background:#080b11;color:#b8c3d3;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.remediation{padding:14px;border:1px solid #4a4127;border-radius:10px;background:#171408;color:#f2d783}
.panel{padding:18px;border-radius:14px}.panel details summary{cursor:pointer;font-weight:700}.panel pre{margin-top:14px}
footer{display:flex;justify-content:space-between;gap:24px;margin-top:36px;padding-top:18px;border-top:1px solid #242d40;color:#778399;font-size:12px}
@media(max-width:820px){.summary{grid-template-columns:repeat(2,minmax(0,1fr))}.facts{grid-template-columns:1fr}.result summary{grid-template-columns:auto 1fr}.result-badges{grid-column:2;justify-content:flex-start}.risk{align-items:flex-start;flex-direction:column}}
@media(max-width:520px){.shell{width:min(100% - 20px,1120px);padding-top:30px}.summary{grid-template-columns:1fr 1fr}.card{min-height:96px;padding:14px}.card strong{font-size:25px}.result summary,.result-body{padding-left:14px;padding-right:14px}.result summary{gap:10px}.section-title,footer{align-items:flex-start;flex-direction:column;gap:6px}}
@media print{:root{color-scheme:light;background:#fff;color:#111}body{background:#fff}.shell{width:100%;padding:0}.card,.panel,.result{break-inside:avoid;background:#fff;box-shadow:none}.result:not([open]) .result-body{display:block}.meta-line,.lede,.risk p,.result-title p{color:#444}footer{color:#555}}
`;

// Computed from REPORT_CSS with SHA-256; verified in the reporter test suite.
const STYLE_SHA256 = "2zw/FBZYwvVqIxbZqV6M8m6aPPw2ArBhyKhl4K3oXk4=";

function severityClass(severity: ReportResult["severity"]): string {
  const classes: Record<ReportResult["severity"], string> = {
    none: "severity-none",
    low: "severity-low",
    medium: "severity-medium",
    high: "severity-high",
    critical: "severity-critical",
  };
  return classes[severity] ?? "severity-none";
}

function statusClass(status: ReportResult["status"]): string {
  const classes: Record<ReportResult["status"], string> = {
    passed: "status-passed",
    failed: "status-failed",
    skipped: "status-skipped",
    error: "status-error",
  };
  return classes[status] ?? "status-error";
}

function formatPercentage(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function renderAssertions(assertions: readonly ReportAssertion[]): string {
  if (!assertions.length) return "";
  return `<section class="subsection"><h3>Assertions</h3><ul class="list">${assertions
    .map(
      (assertion) =>
        `<li class="${assertion.passed ? "good" : "bad"}"><b>${assertion.passed ? "PASS" : "FAIL"} · ${escapeHtml(assertion.kind)} · <code>${escapeHtml(assertion.subject)}</code></b><small>${escapeHtml(assertion.message)}</small></li>`,
    )
    .join("")}</ul></section>`;
}

function renderEvidence(evidence: readonly ReportEvidence[]): string {
  if (!evidence.length) return "";
  return `<section class="subsection"><h3>Evidence</h3><ul class="list">${evidence
    .map(
      (item) =>
        `<li class="bad"><span class="badge ${severityClass(item.severity)}">${escapeHtml(item.severity)}</span> <b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)} · <code>${escapeHtml(`${item.kind}:${item.id}`)}</code></small></li>`,
    )
    .join("")}</ul></section>`;
}

function renderTrace(trace: readonly ReportTraceStep[]): string {
  if (!trace.length) return "";
  return `<section class="subsection"><h3>Execution trace</h3><div class="table-wrap"><table><thead><tr><th>Stage</th><th>Status</th><th>Detail</th><th>Time</th></tr></thead><tbody>${trace
    .map(
      (step) =>
        `<tr><td>${escapeHtml(step.label)}<br><code>${escapeHtml(step.stage)}</code></td><td class="${step.status === "fail" ? "status-failed" : step.status === "pass" ? "status-passed" : "severity-medium"}">${escapeHtml(step.status.toUpperCase())}</td><td>${escapeHtml(step.detail)}${step.artifactIds?.length ? `<br><small><code>${escapeHtml(step.artifactIds.join(", "))}</code></small>` : ""}</td><td>${escapeHtml(String(step.durationMs))} ms</td></tr>`,
    )
    .join("")}</tbody></table></div></section>`;
}

function renderResult(result: ReportResult): string {
  const identity = result.identity
    ? `${result.identity.name} (${result.identity.id})`
    : "Not supplied";
  const location = result.location
    ? `${result.location.uri}${result.location.startLine ? `:${result.location.startLine}${result.location.startColumn ? `:${result.location.startColumn}` : ""}` : ""}`
    : "Not supplied";
  const properties = result.properties
    ? `<section class="subsection"><h3>Result data</h3><pre>${escapeHtml(stableStringify(result.properties))}</pre></section>`
    : "";

  return `<details class="result ${statusClass(result.status).replace("status-", "result-")}"${result.status === "failed" || result.status === "error" ? " open" : ""}><summary><div class="result-title"><h3>${escapeHtml(result.name)}</h3><p><code>${escapeHtml(result.id)}</code>${result.category ? ` · ${escapeHtml(result.category)}` : ""}</p></div><span class="result-badges"><span class="badge ${statusClass(result.status)}">${resultStatusLabel(result.status)}</span><span class="badge ${severityClass(result.severity)}">${escapeHtml(result.severity)}</span></span></summary><div class="result-body"><p>${escapeHtml(result.summary)}</p><div class="facts"><div class="fact"><b>Identity</b><span>${escapeHtml(identity)}</span></div><div class="fact"><b>Duration</b><span>${escapeHtml(String(result.durationMs))} ms</span></div><div class="fact"><b>Location</b><span>${escapeHtml(location)}</span></div></div>${renderAssertions(result.assertions ?? [])}${renderEvidence(result.evidence ?? [])}${renderTrace(result.trace ?? [])}${result.remediation ? `<section class="subsection"><h3>Remediation</h3><div class="remediation">${escapeHtml(result.remediation)}</div></section>` : ""}${properties}</div></details>`;
}

/** Render a self-contained, script-free HTML investigation report. */
export function toHtml(report: RunReport): string {
  const risk = report.summary.risk;
  const metadata = report.metadata
    ? `<section class="panel"><details><summary>Run metadata</summary><pre>${escapeHtml(stableStringify(report.metadata))}</pre></details></section>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'sha256-${STYLE_SHA256}'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(report.name)} · ContextFence report</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main class="shell">
<header><p class="eyebrow">ContextFence / boundary evidence</p><h1>${escapeHtml(report.name)}</h1><p class="lede">Deterministic authorization regression evidence for retrieval-augmented systems.</p><p class="meta-line"><code>${escapeHtml(report.id)}</code> · <time datetime="${escapeHtml(report.evaluatedAt)}">${escapeHtml(report.evaluatedAt)}</time> · ${escapeHtml(report.tool.name)}${report.tool.version ? ` ${escapeHtml(report.tool.version)}` : ""}</p></header>
<section class="summary" aria-label="Run summary"><div class="card"><span>Status</span><strong class="${statusClass(report.summary.status === "error" ? "error" : report.summary.status === "failed" ? "failed" : "passed")}">${escapeHtml(report.summary.status.toUpperCase())}</strong></div><div class="card"><span>Passed</span><strong>${report.summary.passed}</strong></div><div class="card"><span>Failed</span><strong>${report.summary.failed + report.summary.errors}</strong></div><div class="card"><span>Boundary rate</span><strong>${formatPercentage(report.summary.boundaryViolationRate)}</strong></div><div class="card"><span>Duration</span><strong>${report.summary.durationMs}<small> ms</small></strong></div></section>
<section class="risk"><div><span class="badge ${severityClass(risk?.severity ?? "none")}">${escapeHtml(risk?.severity ?? "not assessed")}</span><h2>${escapeHtml(risk?.label ?? "Risk not assessed")}</h2><p>${escapeHtml(risk?.rationale.join(" · ") ?? "No aggregate risk assessment was supplied.")}</p></div>${risk ? `<strong>${escapeHtml(String(risk.score))}/100</strong>` : ""}</section>
<div class="section-title"><h2>Probe results</h2><p>${report.summary.total} checks · ${report.summary.skipped} skipped</p></div>
<section class="results">${report.results.map(renderResult).join("")}</section>
<div class="section-title"><h2>Evidence envelope</h2><p>Portable schema ${report.schemaVersion}</p></div>
${metadata}
<footer><span>Generated by ${escapeHtml(report.tool.name)}. No scripts or external assets.</span><span>Passing probes reduce uncertainty; they do not certify the entire system.</span></footer>
</main>
</body>
</html>
`;
}
