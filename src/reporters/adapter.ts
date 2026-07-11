import type { ProbeResult, SuiteResult } from "../domain/types";
import type {
  ReportLocation,
  ReportMetadataValue,
  ReportResult,
  ReportTool,
  RunReport,
} from "./types";

export interface SuiteReportOptions {
  id?: string;
  name?: string;
  tool?: Partial<ReportTool>;
  metadata?: Readonly<Record<string, ReportMetadataValue>>;
  /** Raw retrieved text is omitted by default because CI artifacts may be shared. */
  includeContextExcerpts?: boolean;
  resolveLocation?: (
    probe: ProbeResult,
    index: number,
  ) => ReportLocation | undefined;
}

function mapProbe(
  probe: ProbeResult,
  index: number,
  options: SuiteReportOptions,
): ReportResult {
  const location = options.resolveLocation?.(probe, index);
  return {
    id: probe.id,
    name: probe.name,
    description: probe.description,
    category: probe.category,
    status: probe.status,
    severity: probe.severity,
    summary: probe.summary,
    durationMs: probe.durationMs,
    identity: { id: probe.identity.id, name: probe.identity.name },
    assertions: probe.assertions.map((result) => {
      const assertion = result.assertion;
      return {
        kind: assertion.kind,
        subject:
          assertion.kind === "source" ? assertion.sourceId : assertion.canaryId,
        description: assertion.description,
        expectation: assertion.expectation,
        actual: result.actual,
        passed: result.passed,
        message: result.message,
      };
    }),
    evidence: probe.evidence.map((evidence) => ({ ...evidence })),
    trace: probe.trace.map((step) => ({
      id: step.id,
      stage: step.stage,
      label: step.label,
      status: step.status,
      detail: step.detail,
      durationMs: step.durationMs,
      ...(step.chunkIds?.length || step.policyIds?.length
        ? {
            artifactIds: [
              ...(step.chunkIds ?? []),
              ...(step.policyIds ?? []),
            ],
          }
        : {}),
    })),
    remediation: probe.remediation,
    ...(location ? { location } : {}),
    properties: {
      boundaryViolationCount: probe.boundaryViolationCount,
      visibleSourceIds: [...probe.visibleSourceIds],
      contextChunks: probe.contextChunks.map((chunk) => ({
        id: chunk.chunkId,
        sourceId: chunk.sourceId,
        sourceName: chunk.sourceName,
        documentIds: [...chunk.documentIds],
        canaryIds: [...chunk.canaryIds],
        authorized: chunk.authorized,
        relevanceScore: chunk.relevanceScore,
        ...(options.includeContextExcerpts ? { excerpt: chunk.excerpt } : {}),
      })),
    },
  };
}

/** Adapt the deterministic simulator result to the framework-neutral report schema. */
export function fromSuiteResult(
  suite: SuiteResult,
  options: SuiteReportOptions = {},
): RunReport {
  const results = suite.probes.map((probe, index) => mapProbe(probe, index, options));
  const tool: ReportTool = {
    name: options.tool?.name ?? "ContextFence",
    ...(options.tool?.version ? { version: options.tool.version } : {}),
    ...(options.tool?.informationUri
      ? { informationUri: options.tool.informationUri }
      : {}),
  };

  return {
    schemaVersion: "1.0",
    id: options.id ?? `contextfence-${suite.evaluatedAt}`,
    name: options.name ?? "ContextFence boundary test run",
    evaluatedAt: suite.evaluatedAt,
    tool,
    summary: {
      status: suite.violationCount > 0 ? "failed" : "passed",
      total: suite.probes.length,
      passed: suite.passCount,
      failed: suite.violationCount,
      skipped: 0,
      errors: 0,
      durationMs: suite.durationMs,
      boundaryViolationRate: suite.boundaryViolationRate,
      risk: {
        score: suite.risk.score,
        severity: suite.risk.severity,
        label: suite.risk.label,
        rationale: [...suite.risk.rationale],
      },
    },
    results,
    metadata: {
      ...options.metadata,
      enabledFaults: [...suite.enabledFaults],
      boundaryMetrics: {
        rate: suite.boundaryMetrics.rate,
        violatingProbes: suite.boundaryMetrics.violatingProbes,
        totalProbes: suite.boundaryMetrics.totalProbes,
        unauthorizedChunks: suite.boundaryMetrics.unauthorizedChunks,
        totalContextChunks: suite.boundaryMetrics.totalContextChunks,
      },
    },
  };
}
