import type { BoundaryTargetAdapter, ProbeTargetResponse } from "../adapters/types";
import { TargetConfigurationError } from "../contract/errors";
import type {
  BoundaryAssertion,
  BoundaryContract,
  BoundaryProbe,
  BoundarySeverity,
  SourcePosition,
} from "../contract/types";
import { isSafeRegularExpression } from "../contract/regex";
import type {
  ReportAssertion,
  ReportResult,
  ReportSeverity,
  ReportTraceStep,
  RunReport,
} from "../reporters/types";
import { CONTEXTFENCE_VERSION } from "./args";

export interface BoundaryRunOptions {
  timeoutMs?: number;
  concurrency?: number;
  dryRun?: boolean;
  sourceName?: string;
  probeLocations?: Readonly<Record<string, SourcePosition>>;
  redact?: (value: string) => string;
  now?: () => Date;
  monotonicNow?: () => number;
}

const SEVERITY_RANK: Record<ReportSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
const RISK_WEIGHT: Record<ReportSeverity, number> = {
  none: 0,
  low: 5,
  medium: 12,
  high: 24,
  critical: 40,
};

function maxSeverity(values: readonly ReportSeverity[]): ReportSeverity {
  return values.reduce<ReportSeverity>(
    (highest, severity) =>
      SEVERITY_RANK[severity] > SEVERITY_RANK[highest] ? severity : highest,
    "none",
  );
}

interface ProbeObservation {
  content: string;
  foldedContent: string;
  sources: ReadonlySet<string>;
  foldedSources: ReadonlySet<string>;
}

function buildObservation(response: ProbeTargetResponse): ProbeObservation {
  return {
    content: response.content,
    foldedContent: response.content.toLowerCase(),
    sources: new Set(response.sources),
    foldedSources: new Set(response.sources.map((source) => source.toLowerCase())),
  };
}

function presentInText(
  observation: ProbeObservation,
  value: string,
  caseSensitive: boolean,
): boolean {
  return caseSensitive
    ? observation.content.includes(value)
    : observation.foldedContent.includes(value.toLowerCase());
}

function presentInSources(
  observation: ProbeObservation,
  value: string,
  caseSensitive: boolean,
): boolean {
  return caseSensitive
    ? observation.sources.has(value)
    : observation.foldedSources.has(value.toLowerCase());
}

function evaluateAssertion(
  assertion: BoundaryAssertion,
  observation: ProbeObservation,
  index: number,
  redact: (value: string) => string,
): { assertion: ReportAssertion; severity: BoundarySeverity | "none" } {
  let observed: boolean;
  let expected: boolean;
  let actualLabel: string;
  let expectationLabel: string;
  switch (assertion.type) {
    case "contains":
    case "not_contains": {
      observed = presentInText(observation, assertion.value, assertion.caseSensitive);
      expected = assertion.type === "contains";
      actualLabel = observed ? "present" : "absent";
      expectationLabel = expected ? "present" : "absent";
      break;
    }
    case "matches":
    case "not_matches": {
      if (!isSafeRegularExpression(assertion.value)) {
        throw new TargetConfigurationError("Unsafe regular expression reached assertion execution.");
      }
      observed = new RegExp(assertion.value, assertion.caseSensitive ? "" : "i").test(
        observation.content,
      );
      expected = assertion.type === "matches";
      actualLabel = observed ? "matched" : "not matched";
      expectationLabel = expected ? "match" : "no match";
      break;
    }
    case "source_present":
    case "source_absent": {
      observed = presentInSources(
        observation,
        assertion.value,
        assertion.caseSensitive,
      );
      expected = assertion.type === "source_present";
      actualLabel = observed ? "present" : "absent";
      expectationLabel = expected ? "present" : "absent";
      break;
    }
  }
  const passed = observed === expected;
  const defaultMessage = passed
    ? `${assertion.type} assertion passed.`
    : `${assertion.type} assertion failed: observed ${actualLabel}, expected ${expectationLabel}.`;
  return {
    assertion: {
      kind: assertion.type,
      subject: `assertion-${index + 1}`,
      expectation: expectationLabel,
      actual: actualLabel,
      passed,
      message: redact(assertion.message ?? defaultMessage),
    },
    severity: passed ? "none" : assertion.severity,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown target failure.";
}

async function executeProbe(
  contract: BoundaryContract,
  probe: BoundaryProbe,
  adapter: BoundaryTargetAdapter,
  timeoutMs: number,
  sourceName: string,
  location: SourcePosition | undefined,
  redact: (value: string) => string,
  monotonicNow: () => number,
): Promise<ReportResult> {
  const startedAt = monotonicNow();
  const signal = AbortSignal.timeout(timeoutMs);
  const trace: ReportTraceStep[] = [];
  const outputProbeId = redact(probe.id);
  const outputIdentityId = redact(probe.identity);
  const outputSourceName = redact(sourceName);
  try {
    for (const [setupIndex, step] of probe.setup.entries()) {
      const identity = contract.identities[step.identity];
      await adapter.execute({
        probeId: probe.id,
        phase: "setup",
        setupIndex,
        identityId: step.identity,
        identity,
        prompt: step.prompt,
        signal,
      });
    }
    if (probe.setup.length > 0) {
      trace.push({
        id: `${outputProbeId}:setup`,
        stage: "setup",
        label: "Prime target state",
        status: "pass",
        detail: `${probe.setup.length} setup request${probe.setup.length === 1 ? "" : "s"} completed.`,
        durationMs: 0,
      });
    }

    const identity = contract.identities[probe.identity];
    const response = await adapter.execute({
      probeId: probe.id,
      phase: "probe",
      identityId: probe.identity,
      identity,
      prompt: probe.prompt,
      signal,
    });
    if (
      !response.sourceMetadataAvailable &&
      probe.assertions.some(
        (assertion) =>
          assertion.type === "source_present" || assertion.type === "source_absent",
      )
    ) {
      throw new TargetConfigurationError(
        "Target response omitted source metadata required by a source assertion.",
      );
    }
    trace.push({
      id: `${outputProbeId}:target`,
      stage: "target",
      label: "Execute identity-bound prompt",
      status: "pass",
      detail: `Target returned HTTP ${response.status}; ${response.sources.length} source identifier${response.sources.length === 1 ? "" : "s"} observed.`,
      durationMs: 0,
    });

    const observation = buildObservation(response);
    const evaluated = probe.assertions.map((assertion, index) =>
      evaluateAssertion(assertion, observation, index, redact),
    );
    const assertions = evaluated.map((item) => item.assertion);
    const severity = maxSeverity(evaluated.map((item) => item.severity));
    const failedEvaluations = evaluated.filter((item) => !item.assertion.passed);
    const failed = failedEvaluations.map((item) => item.assertion);
    trace.push({
      id: `${outputProbeId}:assertions`,
      stage: "assertion",
      label: "Evaluate boundary assertions",
      status: failed.length > 0 ? "fail" : "pass",
      detail: `${assertions.length - failed.length}/${assertions.length} assertions passed.`,
      durationMs: 0,
    });
    const durationMs = Math.max(0, Math.round(monotonicNow() - startedAt));
    return {
      id: outputProbeId,
      name: redact(probe.name),
      ...(probe.description ? { description: redact(probe.description) } : {}),
      ...(probe.category ? { category: redact(probe.category) } : {}),
      status: failed.length > 0 ? "failed" : "passed",
      severity,
      summary: failed.length > 0
        ? `${failed.length} boundary assertion${failed.length === 1 ? "" : "s"} failed.`
        : "Every declared boundary assertion passed.",
      durationMs,
      identity: { id: outputIdentityId, name: redact(identity.name) },
      assertions,
      evidence: failedEvaluations.map((item, index) => ({
        kind: "assertion",
        id: `${outputProbeId}:assertion:${index + 1}`,
        label: "Boundary assertion violation",
        detail: item.assertion.message,
        severity: item.severity,
      })),
      trace,
      ...(probe.remediation ? { remediation: redact(probe.remediation) } : {}),
      location: {
        uri: outputSourceName,
        ...(location ? { startLine: location.line, startColumn: location.column } : {}),
      },
      properties: {
        tags: probe.tags.map(redact),
        responseStatus: response.status,
        observedSourceCount: response.sources.length,
      },
    };
  } catch (error) {
    const timedOut = signal.aborted;
    const summary = timedOut
      ? `Target request timed out after ${timeoutMs} ms.`
      : `Target execution failed: ${redact(errorMessage(error))}`;
    return {
      id: outputProbeId,
      name: redact(probe.name),
      ...(probe.description ? { description: redact(probe.description) } : {}),
      ...(probe.category ? { category: redact(probe.category) } : {}),
      status: "error",
      severity: "critical",
      summary,
      durationMs: Math.max(0, Math.round(monotonicNow() - startedAt)),
      identity: {
        id: outputIdentityId,
        name: redact(contract.identities[probe.identity]?.name ?? probe.identity),
      },
      trace: [
        ...trace,
        {
          id: `${outputProbeId}:target`,
          stage: "target",
          label: "Execute identity-bound prompt",
          status: "fail",
          detail: summary,
          durationMs: 0,
        },
      ],
      ...(probe.remediation ? { remediation: redact(probe.remediation) } : {}),
      location: {
        uri: outputSourceName,
        ...(location ? { startLine: location.line, startColumn: location.column } : {}),
      },
      properties: { tags: probe.tags.map(redact) },
    };
  }
}

function skippedProbe(
  contract: BoundaryContract,
  probe: BoundaryProbe,
  sourceName: string,
  location: SourcePosition | undefined,
  redact: (value: string) => string,
): ReportResult {
  const outputProbeId = redact(probe.id);
  return {
    id: outputProbeId,
    name: redact(probe.name),
    ...(probe.description ? { description: redact(probe.description) } : {}),
    ...(probe.category ? { category: redact(probe.category) } : {}),
    status: "skipped",
    severity: "none",
    summary: "Validated without contacting the target (--dry-run).",
    durationMs: 0,
    identity: {
      id: redact(probe.identity),
      name: redact(contract.identities[probe.identity].name),
    },
    location: {
      uri: redact(sourceName),
      ...(location ? { startLine: location.line, startColumn: location.column } : {}),
    },
    properties: { tags: probe.tags.map(redact) },
  };
}

async function runWithConcurrency<T>(
  length: number,
  concurrency: number,
  work: (index: number) => Promise<T>,
): Promise<T[]> {
  const output = new Array<T>(length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await work(index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, length) }, () => worker()),
  );
  return output;
}

/** Run every probe with bounded concurrency while preserving declaration order. */
export async function runBoundaryContract(
  contract: BoundaryContract,
  adapter: BoundaryTargetAdapter | undefined,
  options: BoundaryRunOptions = {},
): Promise<RunReport> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const concurrency = options.concurrency ?? 4;
  const dryRun = options.dryRun ?? false;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300_000) {
    throw new TargetConfigurationError("timeoutMs must be an integer from 100 to 300000.");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
    throw new TargetConfigurationError("concurrency must be an integer from 1 to 32.");
  }
  if (!dryRun && !adapter) {
    throw new TargetConfigurationError("A target adapter is required unless dryRun is enabled.");
  }

  const redact = options.redact ?? ((value: string) => value);
  const sourceName = options.sourceName ?? "boundary.yaml";
  const evaluatedAt = (options.now ?? (() => new Date()))().toISOString();
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const results = dryRun
    ? contract.probes.map((probe) =>
        skippedProbe(
          contract,
          probe,
          sourceName,
          options.probeLocations?.[probe.id],
          redact,
        ),
      )
    : await runWithConcurrency(contract.probes.length, concurrency, (index) => {
        const probe = contract.probes[index];
        return executeProbe(
          contract,
          probe,
          adapter as BoundaryTargetAdapter,
          timeoutMs,
          sourceName,
          options.probeLocations?.[probe.id],
          redact,
          monotonicNow,
        );
      });

  const passed = results.filter((result) => result.status === "passed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const errors = results.filter((result) => result.status === "error").length;
  const failedSeverities = results
    .filter((result) => result.status === "failed")
    .map((result) => result.severity);
  const riskScore = Math.min(
    100,
    failedSeverities.reduce((total, severity) => total + RISK_WEIGHT[severity], 0),
  );
  const riskSeverity = maxSeverity(failedSeverities);
  const status = errors > 0 ? "error" : failed > 0 ? "failed" : "passed";
  const evaluated = passed + failed;
  const riskRationale = [
    ...(errors > 0
      ? [`${errors} probe${errors === 1 ? "" : "s"} could not be evaluated.`]
      : []),
    ...(failed > 0
      ? [`${failed} of ${results.length} probes violated their declared boundary.`]
      : []),
    ...(errors === 0 && failed === 0
      ? [dryRun ? "Target execution was skipped." : "Every declared assertion passed."]
      : []),
  ];
  return {
    schemaVersion: "1.0",
    id: `contextfence-${evaluatedAt}`,
    name: redact(contract.name),
    evaluatedAt,
    tool: {
      name: "ContextFence",
      version: CONTEXTFENCE_VERSION,
      informationUri: "https://github.com/devectorio/contextfence",
    },
    summary: {
      status,
      total: results.length,
      passed,
      failed,
      skipped,
      errors,
      durationMs: results.reduce((total, result) => total + result.durationMs, 0),
      ...(evaluated > 0 ? { boundaryViolationRate: (failed / evaluated) * 100 } : {}),
      risk: {
        score: riskScore,
        severity: riskSeverity,
        label: errors > 0
          ? "Boundary assessment incomplete"
          : dryRun || evaluated === 0
            ? "Contract validated; target not evaluated"
          : riskScore === 0
            ? "No observed boundary violations"
            : `${riskSeverity} boundary risk`,
        rationale: riskRationale,
      },
    },
    results,
    metadata: {
      contractVersion: contract.version,
      contractSource: redact(sourceName),
      targetAdapter: contract.target.adapter,
      concurrency,
      timeoutMs,
      dryRun,
    },
  };
}

export function highestFailedSeverity(report: RunReport): ReportSeverity {
  return maxSeverity(
    report.results
      .filter((result) => result.status === "failed")
      .map((result) => result.severity),
  );
}
