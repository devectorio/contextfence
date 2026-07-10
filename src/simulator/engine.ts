import type {
  AccessMatrix,
  AccessMatrixCell,
  AssertionResult,
  BoundaryViolationMetrics,
  Chunk,
  ContextChunkResult,
  FaultConfig,
  FaultMode,
  Identity,
  PolicyDecision,
  ProbeContract,
  ProbeEvidence,
  ProbeResult,
  RagSystem,
  RiskAssessment,
  Severity,
  SuiteResult,
  TraceStep,
} from "../domain/types";

const SAFE_FAULTS: FaultConfig = {
  "post-retrieval-filter": false,
  "identity-blind-cache": false,
  "acl-sync-delay": false,
  "cross-boundary-chunks": false,
};

const SEVERITY_RANK: Record<Severity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  none: 0,
  low: 6,
  medium: 14,
  high: 24,
  critical: 36,
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

interface ProbeRuntime {
  cache: Map<string, ScoredChunk[]>;
}

function normalizeFaults(faults?: Partial<FaultConfig>): FaultConfig {
  return { ...SAFE_FAULTS, ...faults };
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function matchesPrincipal(
  identity: Identity,
  principal: RagSystem["policies"][number]["principal"],
): boolean {
  const constraints = [
    principal.identityIds?.includes(identity.id) ?? false,
    principal.roleIds?.some((roleId) => identity.roleIds.includes(roleId)) ?? false,
    principal.groups?.some((group) => identity.groups.includes(group)) ?? false,
  ];
  const hasConstraint = Boolean(
    principal.identityIds?.length || principal.roleIds?.length || principal.groups?.length,
  );
  return !hasConstraint || constraints.some(Boolean);
}

function matchesResource(
  system: RagSystem,
  documentId: string,
  resource: RagSystem["policies"][number]["resource"],
): boolean {
  const document = system.documents.find((candidate) => candidate.id === documentId);
  if (!document) return false;

  if (resource.documentIds?.length && !resource.documentIds.includes(document.id)) {
    return false;
  }
  if (resource.sourceIds?.length && !resource.sourceIds.includes(document.sourceId)) {
    return false;
  }
  if (
    resource.classifications?.length &&
    !resource.classifications.includes(document.classification)
  ) {
    return false;
  }
  return true;
}

/** Resolve a document decision using either current policy or the index's stale view. */
export function evaluateDocumentAccess(
  system: RagSystem,
  identity: Identity,
  documentId: string,
  view: PolicyDecision["view"] = "current",
): PolicyDecision {
  const matches = system.policies
    .filter((policy) => (view === "current" ? policy.active : policy.indexedActive))
    .filter(
      (policy) =>
        matchesPrincipal(identity, policy.principal) &&
        matchesResource(system, documentId, policy.resource),
    )
    .sort((left, right) => right.priority - left.priority);

  if (matches.length === 0) {
    return {
      allowed: false,
      identityId: identity.id,
      documentId,
      policyIds: [],
      reason: "Default deny: no active policy matched this principal and document.",
      view,
    };
  }

  const highestPriority = matches[0].priority;
  const decisive = matches.filter((policy) => policy.priority === highestPriority);
  const deny = decisive.find((policy) => policy.effect === "deny");
  const allowed = !deny && decisive.some((policy) => policy.effect === "allow");

  return {
    allowed,
    identityId: identity.id,
    documentId,
    policyIds: decisive.map((policy) => policy.id),
    reason: deny
      ? `Denied by ${deny.name}.`
      : allowed
        ? `Allowed by ${decisive.map((policy) => policy.name).join(", ")}.`
        : "Default deny.",
    view,
  };
}

function canAccessChunk(
  system: RagSystem,
  identity: Identity,
  chunk: Chunk,
  view: PolicyDecision["view"],
  trustPrimaryDocumentOnly: boolean,
): { allowed: boolean; decisions: PolicyDecision[] } {
  const documentIds = trustPrimaryDocumentOnly
    ? [chunk.primaryDocumentId]
    : [...new Set(chunk.segments.map((segment) => segment.documentId))];
  const decisions = documentIds.map((documentId) =>
    evaluateDocumentAccess(system, identity, documentId, view),
  );
  return { allowed: decisions.every((decision) => decision.allowed), decisions };
}

function scoreChunk(system: RagSystem, query: string, chunk: Chunk): number {
  const queryTokens = new Set(tokenize(query));
  const keywordTokens = new Set(chunk.keywords.flatMap(tokenize));
  const textTokens = new Set(chunk.segments.flatMap((segment) => tokenize(segment.text)));
  const titleTokens = new Set(
    chunk.segments.flatMap((segment) => {
      const document = system.documents.find((candidate) => candidate.id === segment.documentId);
      return tokenize(document?.title ?? "");
    }),
  );

  let score = 0;
  for (const token of queryTokens) {
    if (keywordTokens.has(token)) score += 4;
    if (titleTokens.has(token)) score += 2;
    if (textTokens.has(token)) score += 1;
  }
  return score;
}

function retrieve(
  system: RagSystem,
  identity: Identity,
  query: string,
  faults: FaultConfig,
): ScoredChunk[] {
  const policyView: PolicyDecision["view"] = faults["acl-sync-delay"]
    ? "indexed"
    : "current";
  const postFilter = faults["post-retrieval-filter"];

  return system.chunks
    .filter(
      (chunk) =>
        chunk.kind !== "cross-boundary-candidate" || faults["cross-boundary-chunks"],
    )
    .map((chunk) => ({ chunk, score: scoreChunk(system, query, chunk) }))
    .filter((item) => item.score > 0)
    .filter((item) => {
      if (postFilter) return true;
      return canAccessChunk(
        system,
        identity,
        item.chunk,
        policyView,
        faults["cross-boundary-chunks"],
      ).allowed;
    })
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id))
    .slice(0, system.topK);
}

function cacheKey(identity: Identity, query: string, faults: FaultConfig): string {
  const normalizedQuery = tokenize(query).join(" ");
  return faults["identity-blind-cache"]
    ? `query:${normalizedQuery}`
    : `identity:${identity.id}:query:${normalizedQuery}`;
}

function severityMax(values: Severity[]): Severity {
  return values.reduce<Severity>(
    (highest, value) =>
      SEVERITY_RANK[value] > SEVERITY_RANK[highest] ? value : highest,
    "none",
  );
}

function chunkText(chunk: Chunk): string {
  return chunk.segments.map((segment) => segment.text).join(" ");
}

function excerpt(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function buildContextChunkResult(
  system: RagSystem,
  identity: Identity,
  scored: ScoredChunk,
): ContextChunkResult {
  const currentDecision = canAccessChunk(system, identity, scored.chunk, "current", false);
  const source = system.sources.find((candidate) => candidate.id === scored.chunk.sourceId);
  return {
    chunkId: scored.chunk.id,
    sourceId: scored.chunk.sourceId,
    sourceName: source?.name ?? scored.chunk.sourceId,
    primaryDocumentId: scored.chunk.primaryDocumentId,
    documentIds: [...new Set(scored.chunk.segments.map((segment) => segment.documentId))],
    excerpt: excerpt(chunkText(scored.chunk)),
    canaryIds: [...new Set(scored.chunk.segments.flatMap((segment) => segment.canaryIds))],
    relevanceScore: scored.score,
    authorized: currentDecision.allowed,
  };
}

function assertionEvidence(
  system: RagSystem,
  result: AssertionResult,
): ProbeEvidence | undefined {
  if (result.passed) return undefined;

  const assertion = result.assertion;
  if (assertion.kind === "canary") {
    const canary = system.canaries.find(
      (candidate) => candidate.id === assertion.canaryId,
    );
    if (!canary) return undefined;
    return {
      kind: "canary",
      id: canary.id,
      label: canary.token,
      detail: result.message,
      severity: assertion.expectation === "absent" ? canary.severity : "medium",
    };
  }

  const source = system.sources.find(
    (candidate) => candidate.id === assertion.sourceId,
  );
  if (!source) return undefined;
  const leakSeverity: Severity =
    source.sensitivity === "restricted"
      ? "critical"
      : source.sensitivity === "confidential"
        ? "high"
        : "medium";
  return {
    kind: "source",
    id: source.id,
    label: source.name,
    detail: result.message,
    severity: assertion.expectation === "absent" ? leakSeverity : "low",
  };
}

function assertContext(
  system: RagSystem,
  probe: ProbeContract,
  contextChunks: ContextChunkResult[],
): AssertionResult[] {
  const sourceIds = new Set(contextChunks.map((chunk) => chunk.sourceId));
  const canaryIds = new Set(contextChunks.flatMap((chunk) => chunk.canaryIds));

  return probe.assertions.map((assertion) => {
    const present =
      assertion.kind === "source"
        ? sourceIds.has(assertion.sourceId)
        : canaryIds.has(assertion.canaryId);
    const passed = assertion.expectation === "present" ? present : !present;
    const subject =
      assertion.kind === "source"
        ? system.sources.find((source) => source.id === assertion.sourceId)?.name ??
          assertion.sourceId
        : system.canaries.find((canary) => canary.id === assertion.canaryId)?.token ??
          assertion.canaryId;
    return {
      assertion,
      passed,
      actual: present ? "present" : "absent",
      message: passed
        ? `${subject} is ${assertion.expectation} as required.`
        : `${subject} was ${present ? "present" : "absent"}; expected ${assertion.expectation}.`,
    };
  });
}

function resolveRawChunks(
  system: RagSystem,
  probe: ProbeContract,
  identity: Identity,
  faults: FaultConfig,
  runtime: ProbeRuntime,
): { chunks: ScoredChunk[]; cacheHit: boolean; cachePrimed: boolean } {
  let cachePrimed = false;
  if (probe.setup?.cachePrimerIdentityId) {
    const primer = system.identities.find(
      (candidate) => candidate.id === probe.setup?.cachePrimerIdentityId,
    );
    if (primer) {
      runtime.cache.set(cacheKey(primer, probe.query, faults), retrieve(system, primer, probe.query, faults));
      cachePrimed = true;
    }
  }

  const key = cacheKey(identity, probe.query, faults);
  const cached = runtime.cache.get(key);
  if (cached) return { chunks: cached, cacheHit: true, cachePrimed };

  const chunks = retrieve(system, identity, probe.query, faults);
  runtime.cache.set(key, chunks);
  return { chunks, cacheHit: false, cachePrimed };
}

/** Run one contract in an isolated deterministic cache sandbox. */
export function evaluateProbe(
  system: RagSystem,
  probe: ProbeContract,
  faultInput: Partial<FaultConfig> = SAFE_FAULTS,
): ProbeResult {
  const faults = normalizeFaults(faultInput);
  const identity = system.identities.find((candidate) => candidate.id === probe.identityId);
  if (!identity) throw new Error(`Probe ${probe.id} references unknown identity ${probe.identityId}.`);

  const runtime: ProbeRuntime = { cache: new Map() };
  const resolved = resolveRawChunks(system, probe, identity, faults, runtime);
  const policyView: PolicyDecision["view"] = faults["acl-sync-delay"]
    ? "indexed"
    : "current";

  let context = resolved.chunks;
  let visible = resolved.chunks;
  if (faults["post-retrieval-filter"]) {
    visible = resolved.chunks.filter((item) =>
      canAccessChunk(
        system,
        identity,
        item.chunk,
        policyView,
        faults["cross-boundary-chunks"],
      ).allowed,
    );
  } else if (resolved.cacheHit && faults["identity-blind-cache"]) {
    // The faulty shared cache is trusted as already authorized.
    context = resolved.chunks;
    visible = resolved.chunks;
  }

  const contextChunks = context.map((item) => buildContextChunkResult(system, identity, item));
  const assertions = assertContext(system, probe, contextChunks);
  const unauthorizedChunks = contextChunks.filter((chunk) => !chunk.authorized);
  const assertionEvidenceItems = assertions
    .map((assertion) => assertionEvidence(system, assertion))
    .filter((item): item is ProbeEvidence => Boolean(item));
  const chunkEvidence: ProbeEvidence[] = unauthorizedChunks.map((chunk) => {
    const hasCriticalCanary = chunk.canaryIds.some(
      (canaryId) =>
        system.canaries.find((canary) => canary.id === canaryId)?.severity === "critical",
    );
    return {
      kind: "chunk",
      id: chunk.chunkId,
      label: `Unauthorized context: ${chunk.chunkId}`,
      detail: `${identity.name} received context backed by ${chunk.documentIds.join(", ")}.`,
      severity: hasCriticalCanary ? "critical" : "high",
    };
  });
  const evidence = [...assertionEvidenceItems, ...chunkEvidence].filter(
    (item, index, all) => all.findIndex((candidate) => candidate.kind === item.kind && candidate.id === item.id) === index,
  );
  const passed = assertions.every((assertion) => assertion.passed) && unauthorizedChunks.length === 0;
  const severity = passed ? "none" : severityMax(evidence.map((item) => item.severity));
  const visibleSourceIds = [...new Set(visible.map((item) => item.chunk.sourceId))];

  const allPolicyIds = context.flatMap((item) =>
    canAccessChunk(
      system,
      identity,
      item.chunk,
      policyView,
      faults["cross-boundary-chunks"],
    ).decisions.flatMap((decision) => decision.policyIds),
  );
  const trace: TraceStep[] = [
    {
      id: `${probe.id}:identity`,
      stage: "identity",
      label: "Resolve principal",
      status: "pass",
      detail: `${identity.name} resolved with ${identity.roleIds.join(", ")} role.`,
      durationMs: 1,
    },
    {
      id: `${probe.id}:cache`,
      stage: "cache",
      label: "Resolve semantic cache",
      status: resolved.cacheHit && faults["identity-blind-cache"] ? "fail" : "pass",
      detail: resolved.cacheHit
        ? `Cache hit using ${faults["identity-blind-cache"] ? "query-only" : "identity-bound"} key${resolved.cachePrimed ? " after primer" : ""}.`
        : `Cache miss using identity-bound key${resolved.cachePrimed ? "; primer remained isolated" : ""}.`,
      durationMs: 1,
      chunkIds: resolved.chunks.map((item) => item.chunk.id),
    },
    {
      id: `${probe.id}:policy`,
      stage: "policy",
      label: "Evaluate document policy",
      status: faults["acl-sync-delay"] ? "warn" : "pass",
      detail: faults["acl-sync-delay"]
        ? "Retrieval used the index's stale ACL snapshot."
        : "Retrieval used current source-of-truth policies.",
      durationMs: 2,
      policyIds: [...new Set(allPolicyIds)],
    },
    {
      id: `${probe.id}:retrieval`,
      stage: "retrieval",
      label: "Rank top-k chunks",
      status: faults["post-retrieval-filter"] ? "warn" : "pass",
      detail: faults["post-retrieval-filter"]
        ? `Ranked ${context.length} chunks globally before authorization.`
        : `Ranked ${context.length} chunks inside the authorized candidate set.`,
      durationMs: 4,
      chunkIds: context.map((item) => item.chunk.id),
    },
    {
      id: `${probe.id}:context`,
      stage: "context",
      label: "Assemble model context",
      status: unauthorizedChunks.length ? "fail" : "pass",
      detail: unauthorizedChunks.length
        ? `${unauthorizedChunks.length} unauthorized chunk${unauthorizedChunks.length === 1 ? "" : "s"} entered model context.`
        : "Every context segment satisfied current policy.",
      durationMs: 2,
      chunkIds: context.map((item) => item.chunk.id),
    },
    {
      id: `${probe.id}:post-filter`,
      stage: "post-filter",
      label: "Filter response citations",
      status: faults["post-retrieval-filter"] ? "warn" : "skipped",
      detail: faults["post-retrieval-filter"]
        ? `Removed ${context.length - visible.length} citation(s), after model context was already assembled.`
        : "No late filter was required.",
      durationMs: faults["post-retrieval-filter"] ? 1 : 0,
      chunkIds: visible.map((item) => item.chunk.id),
    },
    {
      id: `${probe.id}:assertion`,
      stage: "assertion",
      label: "Assert permission contract",
      status: passed ? "pass" : "fail",
      detail: `${assertions.filter((assertion) => assertion.passed).length}/${assertions.length} explicit assertions passed.`,
      durationMs: 1,
    },
  ];
  const durationMs = trace.reduce((total, step) => total + step.durationMs, 0);

  return {
    id: probe.id,
    name: probe.name,
    description: probe.description,
    identity,
    category: probe.category,
    status: passed ? "passed" : "failed",
    severity,
    summary: passed
      ? `PASS — ${identity.name}'s context stayed inside the declared boundary.`
      : `FAIL — ${evidence[0]?.detail ?? "The permission contract was violated."}`,
    assertions,
    trace,
    evidence,
    remediation: probe.remediation,
    contextChunks,
    visibleSourceIds,
    boundaryViolationCount: unauthorizedChunks.length,
    durationMs,
  };
}

export function buildAccessMatrix(system: RagSystem): AccessMatrix {
  const cells: AccessMatrixCell[] = [];
  for (const role of system.roles) {
    const identity: Identity = {
      id: `matrix-${role.id}`,
      name: `${role.name} role`,
      email: `${role.id}@matrix.invalid`,
      title: "Synthetic policy principal",
      roleIds: [role.id],
      groups: [],
    };
    for (const source of system.sources) {
      const documents = system.documents.filter((document) => document.sourceId === source.id);
      const allowedDocumentIds = documents
        .filter((document) => evaluateDocumentAccess(system, identity, document.id).allowed)
        .map((document) => document.id);
      const deniedDocumentIds = documents
        .filter((document) => !allowedDocumentIds.includes(document.id))
        .map((document) => document.id);
      const access: AccessMatrixCell["access"] =
        allowedDocumentIds.length === 0
          ? "none"
          : deniedDocumentIds.length === 0
            ? "full"
            : "partial";
      cells.push({
        roleId: role.id,
        sourceId: source.id,
        access,
        allowedDocumentIds,
        deniedDocumentIds,
      });
    }
  }
  return { roles: system.roles, sources: system.sources, cells };
}

export function calculateBoundaryViolationMetrics(
  probes: ProbeResult[],
): BoundaryViolationMetrics {
  const violatingProbes = probes.filter((probe) => probe.boundaryViolationCount > 0).length;
  const totalContextChunks = probes.reduce(
    (total, probe) => total + probe.contextChunks.length,
    0,
  );
  const unauthorizedChunks = probes.reduce(
    (total, probe) => total + probe.boundaryViolationCount,
    0,
  );
  return {
    /** Dashboard-friendly percentage in the inclusive 0..100 range. */
    rate: probes.length ? (violatingProbes / probes.length) * 100 : 0,
    violatingProbes,
    totalProbes: probes.length,
    unauthorizedChunks,
    totalContextChunks,
  };
}

export function calculateRiskSeverity(probes: ProbeResult[]): RiskAssessment {
  const failed = probes.filter((probe) => probe.status === "failed");
  const counts: RiskAssessment["counts"] = {
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };
  for (const probe of failed) {
    if (probe.severity !== "none") counts[probe.severity] += 1;
  }
  const score = Math.min(
    100,
    Math.round(failed.reduce((total, probe) => total + SEVERITY_WEIGHT[probe.severity], 0)),
  );
  const scoreSeverity: Severity =
    score === 0
      ? "none"
      : score < 20
        ? "low"
        : score < 45
          ? "medium"
          : score < 75
            ? "high"
            : "critical";
  const severity = severityMax([scoreSeverity, ...failed.map((probe) => probe.severity)]);
  const label: Record<Severity, string> = {
    none: "Boundary intact",
    low: "Low residual risk",
    medium: "Material permission drift",
    high: "High exfiltration risk",
    critical: "Critical boundary failure",
  };
  const rationale = failed
    .flatMap((probe) => probe.evidence.map((evidence) => evidence.detail))
    .filter((item, index, all) => all.indexOf(item) === index)
    .slice(0, 4);
  if (rationale.length === 0) rationale.push("All probe contracts passed against current policy.");
  return { score, severity, label: label[severity], rationale, counts };
}

/**
 * Evaluate every contract in an isolated sandbox. Results and timings are fully
 * deterministic, making this safe for tests, CI snapshots, and UI demos.
 */
export function evaluateSuite(
  system: RagSystem,
  faultInput: Partial<FaultConfig> = SAFE_FAULTS,
): SuiteResult {
  const faults = normalizeFaults(faultInput);
  const probes = system.probes.map((probe) => evaluateProbe(system, probe, faults));
  const boundaryMetrics = calculateBoundaryViolationMetrics(probes);
  const violationCount = probes.filter((probe) => probe.status === "failed").length;
  const passCount = probes.length - violationCount;
  return {
    probes,
    violationCount,
    passCount,
    boundaryViolationRate: boundaryMetrics.rate,
    boundaryMetrics,
    accessMatrix: buildAccessMatrix(system),
    durationMs: probes.reduce((total, probe) => total + probe.durationMs, 0),
    risk: calculateRiskSeverity(probes),
    enabledFaults: (Object.keys(faults) as FaultMode[]).filter((fault) => faults[fault]),
    evaluatedAt: system.evaluatedAt,
  };
}
