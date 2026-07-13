/// <reference types="node" />

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { defaultFaults, demoSystem } from "../data/demo";
import { evaluateSuite } from "../simulator/engine";
import {
  fromSuiteResult,
  toHtml,
  toJson,
  toJUnit,
  toSarif,
  type ReportResult,
  type RunReport,
  type SuiteReportOptions,
} from "./index";

const hostile = `Boundary </style><script>alert("owned")</script> & "quotes" 'apostrophe'\u0001`;

const baseResult: ReportResult = {
  id: `probe<&"'`,
  name: hostile,
  description: `Description ${hostile}`,
  category: "source/isolation",
  status: "failed",
  severity: "critical",
  summary: `Restricted <chunk> escaped & ${hostile}`,
  durationMs: 12,
  identity: { id: `user<&"`, name: `Ada & <Admin>` },
  assertions: [
    {
      kind: "canary",
      subject: `secret<&"`,
      description: hostile,
      expectation: "absent",
      actual: "present",
      passed: false,
      message: `Expected absent; got <present> & "unsafe"`,
    },
  ],
  evidence: [
    {
      kind: "canary",
      id: `ev<&"`,
      label: hostile,
      detail: `Evidence & <detail> "quoted"`,
      severity: "critical",
    },
  ],
  trace: [
    {
      id: "trace-1",
      stage: "context",
      label: `Assemble <context>`,
      status: "fail",
      detail: `Unauthorized & dangerous`,
      durationMs: 3,
      artifactIds: [`chunk<&"`],
    },
  ],
  remediation: `Filter before retrieval & invalidate <cache>.`,
  location: {
    uri: `fixtures/boundary<&".yaml`,
    startLine: 12,
    startColumn: 4,
  },
  properties: { zeta: true, alpha: `<value>&"` },
};

function fixtureReport(results: readonly ReportResult[] = [
  baseResult,
  {
    ...baseResult,
    id: "probe-pass",
    name: "Expected access",
    status: "passed",
    severity: "none",
    summary: "Declared access remained available.",
    evidence: [],
  },
  {
    ...baseResult,
    id: "probe-skip",
    name: "Optional target",
    status: "skipped",
    severity: "low",
    summary: "Target was not configured.",
  },
  {
    ...baseResult,
    id: "probe-error",
    name: "Adapter health",
    status: "error",
    severity: "high",
    summary: "The adapter could not complete.",
  },
]): RunReport {
  return {
    schemaVersion: "1.0",
    id: "run-2026-07-11",
    name: hostile,
    evaluatedAt: "2026-07-11T09:10:11.000Z",
    tool: {
      name: "ContextFence & Friends",
      version: "0.2.0",
      informationUri: "https://example.invalid/contextfence",
    },
    summary: {
      status: "failed",
      total: results.length,
      passed: results.filter((result) => result.status === "passed").length,
      failed: results.filter((result) => result.status === "failed").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      errors: results.filter((result) => result.status === "error").length,
      durationMs: results.reduce((total, result) => total + result.durationMs, 0),
      boundaryViolationRate: 25,
      risk: {
        score: 91,
        severity: "critical",
        label: "Critical boundary failure",
        rationale: [hostile],
      },
    },
    results,
    metadata: {
      zeta: Number.NaN,
      attack: hostile,
      alpha: { second: 2, first: 1 },
    },
  };
}

describe("portable suite adapter", () => {
  it("preserves security evidence without adding runtime-dependent values", () => {
    const suite = evaluateSuite(demoSystem, defaultFaults);
    const options: SuiteReportOptions = {
      id: "ci-42",
      name: "Staging boundaries",
      tool: { version: "0.2.0" },
      metadata: { commit: "abc123" },
      resolveLocation: (_probe, index) => ({
        uri: "boundary.yaml",
        startLine: index + 10,
      }),
    };
    const report = fromSuiteResult(suite, options);

    expect(report).toEqual(fromSuiteResult(suite, options));
    expect(report.id).toBe("ci-42");
    expect(report.summary).toMatchObject({
      total: suite.probes.length,
      passed: suite.passCount,
      failed: suite.violationCount,
      boundaryViolationRate: suite.boundaryViolationRate,
    });
    expect(report.results[0].location).toEqual({
      uri: "boundary.yaml",
      startLine: 10,
    });
    expect(
      report.results.some((result) => (result.evidence?.length ?? 0) > 0),
    ).toBe(true);
    expect(report.metadata).toMatchObject({ commit: "abc123" });
    expect(toJson(report)).not.toContain('"excerpt"');
    expect(
      toJson(fromSuiteResult(suite, { ...options, includeContextExcerpts: true })),
    ).toContain('"excerpt"');
  });
});

describe("JSON reporter", () => {
  it("is deterministic, stable-keyed, valid JSON, and newline terminated", () => {
    const report = fixtureReport();
    const first = toJson(report);
    const second = toJson(report);
    const parsed = JSON.parse(first) as RunReport;

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(parsed.results[0].summary).toBe(baseResult.summary);
    expect(Object.keys(parsed.metadata ?? {})).toEqual(["alpha", "attack", "zeta"]);
    expect(parsed.metadata?.zeta).toBeNull();
  });
});

describe("JUnit reporter", () => {
  it("emits accurate counts and escapes XML text, attributes, and control bytes", () => {
    const xml = toJUnit(fixtureReport());
    const document = new DOMParser().parseFromString(xml, "application/xml");

    expect(xml).toBe(toJUnit(fixtureReport()));
    expect(xml).toContain(
      'tests="4" failures="1" errors="1" skipped="1" time="0.048"',
    );
    expect(xml).toContain("&lt;/style&gt;&lt;script&gt;");
    expect(xml).toContain("&quot;quotes&quot; &apos;apostrophe&apos;");
    expect(xml).toContain("\uFFFD");
    expect(xml).not.toContain("\u0001");
    expect(xml).not.toContain("<script>");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.querySelectorAll("testcase")).toHaveLength(4);
    expect(xml.endsWith("\n")).toBe(true);
  });
});

describe("SARIF reporter", () => {
  it("emits SARIF 2.1.0 findings with stable fingerprints and source locations", () => {
    interface SarifShape {
      version: string;
      runs: Array<{
        tool: { driver: { rules: Array<{ id: string }> } };
        results: Array<{
          ruleId: string;
          level: string;
          fingerprints: Record<string, string>;
          locations: Array<{
            physicalLocation?: {
              artifactLocation: { uri: string };
              region: { startLine: number; startColumn: number };
            };
          }>;
          properties: { testId: string };
        }>;
      }>;
    }

    const sarif = toSarif(fixtureReport());
    const parsed = JSON.parse(sarif) as SarifShape;
    const run = parsed.runs[0];

    expect(sarif).toBe(toSarif(fixtureReport()));
    expect(parsed.version).toBe("2.1.0");
    expect(run.results).toHaveLength(2);
    expect(run.results[0]).toMatchObject({
      ruleId: "probe",
      level: "error",
      properties: { testId: `probe<&"'` },
    });
    expect(run.results[0].fingerprints["contextfence/v1"]).toMatch(/^[0-9a-f]{16}$/);
    const rerun = fixtureReport();
    rerun.id = "run-2026-07-12";
    expect(
      (JSON.parse(toSarif(rerun)) as SarifShape).runs[0].results[0]
        .fingerprints["contextfence/v1"],
    ).toBe(run.results[0].fingerprints["contextfence/v1"]);
    expect(run.results[0].locations[0].physicalLocation).toMatchObject({
      artifactLocation: { uri: `fixtures/boundary<&".yaml` },
      region: { startLine: 12, startColumn: 4 },
    });
    expect(run.tool.driver.rules.map((rule) => rule.id)).toEqual([
      "probe",
      "probe-error",
    ]);
  });

  it("maps critical/high, medium, low, and none severities predictably", () => {
    const severities = ["critical", "high", "medium", "low", "none"] as const;
    const results = severities.map<ReportResult>((severity) => ({
      ...baseResult,
      id: `severity-${severity}`,
      name: severity,
      severity,
      status: "failed",
    }));
    const parsed = JSON.parse(toSarif(fixtureReport(results))) as {
      runs: Array<{
        results: Array<{ level: string }>;
        tool: {
          driver: {
            rules: Array<{
              properties: { "security-severity": string };
            }>;
          };
        };
      }>;
    };

    expect(parsed.runs[0].results.map((result) => result.level)).toEqual([
      "error",
      "error",
      "warning",
      "note",
      "none",
    ]);
    expect(
      parsed.runs[0].tool.driver.rules.map(
        (rule) => rule.properties["security-severity"],
      ),
    ).toEqual(["9.5", "8.0", "5.5", "2.0", "0.0"]);
  });

  it("normalizes long separator runs without retaining invalid rule IDs", () => {
    const hyphenHeavyId = `${"-".repeat(20_000)}probe${"-".repeat(20_000)}`;
    const parsed = JSON.parse(
      toSarif(
        fixtureReport([
          {
            ...baseResult,
            id: hyphenHeavyId,
          },
        ]),
      ),
    ) as { runs: Array<{ results: Array<{ ruleId: string }> }> };

    expect(parsed.runs[0].results[0].ruleId).toBe("probe");
  });
});

describe("HTML reporter", () => {
  it("is standalone, script-free, escaped, and protected by a matching style hash", () => {
    const html = toHtml(fixtureReport());
    const document = new DOMParser().parseFromString(html, "text/html");
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    const declaredHash = html.match(/style-src 'sha256-([^']+)'/)?.[1];

    expect(html).toBe(toHtml(fixtureReport()));
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("&lt;/style&gt;&lt;script&gt;");
    expect(html).not.toMatch(/<script(?:\s|>)/i);
    expect(html).not.toMatch(/\s(?:src|href|style|on[a-z]+)=/i);
    expect(document.querySelectorAll("script")).toHaveLength(0);
    expect(document.querySelector("h1")?.textContent).toContain("<script>");
    expect(style).toBeDefined();
    expect(declaredHash).toBe(
      createHash("sha256").update(style ?? "").digest("base64"),
    );
    expect(html.endsWith("\n")).toBe(true);
  });
});
