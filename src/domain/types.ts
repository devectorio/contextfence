/** Domain contracts for ContextFence, a deterministic RAG permission test runner. */

export type Id = string;
export type ISODateTime = string;

export type RoleId = "newsroom" | "finance" | "legal" | "executive";

export type FaultMode =
  | "post-retrieval-filter"
  | "identity-blind-cache"
  | "acl-sync-delay"
  | "cross-boundary-chunks";

export type Severity = "none" | "low" | "medium" | "high" | "critical";

export type ProbeCategory =
  | "expected-access"
  | "source-isolation"
  | "cache-isolation"
  | "acl-revocation"
  | "chunk-boundary";

export interface Role {
  id: RoleId;
  name: string;
  department: string;
  description: string;
}

export interface Identity {
  id: Id;
  name: string;
  email: string;
  title: string;
  roleIds: RoleId[];
  groups: string[];
}

export type SourceKind =
  | "vector-store"
  | "drive"
  | "warehouse"
  | "knowledge-base";

export interface Source {
  id: Id;
  name: string;
  kind: SourceKind;
  description: string;
  sensitivity: "shared" | "internal" | "confidential" | "restricted";
}

export interface Document {
  id: Id;
  sourceId: Id;
  title: string;
  classification: "internal" | "confidential" | "restricted";
  tags: string[];
  updatedAt: ISODateTime;
}

export interface Canary {
  id: Id;
  token: string;
  documentId: Id;
  description: string;
  severity: Exclude<Severity, "none">;
}

export interface ChunkSegment {
  documentId: Id;
  text: string;
  canaryIds: Id[];
}

export interface Chunk {
  id: Id;
  sourceId: Id;
  /** The document whose metadata is attached to the vector record. */
  primaryDocumentId: Id;
  segments: ChunkSegment[];
  keywords: string[];
  tokenCount: number;
  kind: "standard" | "cross-boundary-candidate";
}

export interface PolicyPrincipal {
  roleIds?: RoleId[];
  identityIds?: Id[];
  groups?: string[];
}

export interface PolicyResource {
  sourceIds?: Id[];
  documentIds?: Id[];
  classifications?: Document["classification"][];
}

export interface AccessPolicy {
  id: Id;
  name: string;
  description: string;
  effect: "allow" | "deny";
  principal: PolicyPrincipal;
  resource: PolicyResource;
  priority: number;
  /** Current source-of-truth state. */
  active: boolean;
  /** State still present in the retrieval index. */
  indexedActive: boolean;
  updatedAt: ISODateTime;
}

export interface SourceAssertion {
  kind: "source";
  sourceId: Id;
  expectation: "present" | "absent";
  description: string;
}

export interface CanaryAssertion {
  kind: "canary";
  canaryId: Id;
  expectation: "present" | "absent";
  description: string;
}

export type ProbeAssertion = SourceAssertion | CanaryAssertion;

export interface ProbeSetup {
  /** Warms the same query as an authorized principal before the assertion runs. */
  cachePrimerIdentityId?: Id;
}

export interface ProbeContract {
  id: Id;
  name: string;
  description: string;
  category: ProbeCategory;
  identityId: Id;
  query: string;
  assertions: ProbeAssertion[];
  setup?: ProbeSetup;
  remediation: string;
}

export interface RagSystem {
  organization: {
    id: Id;
    name: string;
    industry: string;
    description: string;
  };
  roles: Role[];
  identities: Identity[];
  sources: Source[];
  documents: Document[];
  chunks: Chunk[];
  policies: AccessPolicy[];
  canaries: Canary[];
  probes: ProbeContract[];
  topK: number;
  evaluatedAt: ISODateTime;
}

export type FaultConfig = Record<FaultMode, boolean>;

export interface PolicyDecision {
  allowed: boolean;
  identityId: Id;
  documentId: Id;
  policyIds: Id[];
  reason: string;
  view: "current" | "indexed";
}

export type TraceStage =
  | "identity"
  | "cache"
  | "policy"
  | "retrieval"
  | "context"
  | "post-filter"
  | "assertion";

export interface TraceStep {
  id: Id;
  stage: TraceStage;
  label: string;
  status: "pass" | "warn" | "fail" | "skipped";
  detail: string;
  durationMs: number;
  chunkIds?: Id[];
  policyIds?: Id[];
}

export interface AssertionResult {
  assertion: ProbeAssertion;
  passed: boolean;
  actual: string;
  message: string;
}

export interface ProbeEvidence {
  kind: "source" | "canary" | "policy" | "chunk";
  id: Id;
  label: string;
  detail: string;
  severity: Severity;
}

export interface ContextChunkResult {
  chunkId: Id;
  sourceId: Id;
  sourceName: string;
  primaryDocumentId: Id;
  documentIds: Id[];
  excerpt: string;
  canaryIds: Id[];
  relevanceScore: number;
  authorized: boolean;
}

export interface ProbeResult {
  id: Id;
  name: string;
  description: string;
  identity: Identity;
  category: ProbeCategory;
  status: "passed" | "failed";
  severity: Severity;
  summary: string;
  assertions: AssertionResult[];
  trace: TraceStep[];
  evidence: ProbeEvidence[];
  remediation: string;
  contextChunks: ContextChunkResult[];
  visibleSourceIds: Id[];
  boundaryViolationCount: number;
  durationMs: number;
}

export interface AccessMatrixCell {
  roleId: RoleId;
  sourceId: Id;
  access: "full" | "partial" | "none";
  allowedDocumentIds: Id[];
  deniedDocumentIds: Id[];
}

export interface AccessMatrix {
  roles: Role[];
  sources: Source[];
  cells: AccessMatrixCell[];
}

export interface BoundaryViolationMetrics {
  rate: number;
  violatingProbes: number;
  totalProbes: number;
  unauthorizedChunks: number;
  totalContextChunks: number;
}

export interface RiskAssessment {
  score: number;
  severity: Severity;
  label: string;
  rationale: string[];
  counts: Record<Exclude<Severity, "none">, number>;
}

export interface SuiteResult {
  probes: ProbeResult[];
  violationCount: number;
  passCount: number;
  boundaryViolationRate: number;
  boundaryMetrics: BoundaryViolationMetrics;
  accessMatrix: AccessMatrix;
  durationMs: number;
  risk: RiskAssessment;
  enabledFaults: FaultMode[];
  evaluatedAt: ISODateTime;
}

export interface Remediation {
  id: Id;
  name: string;
  description: string;
  fixes: FaultMode[];
  effort: "low" | "medium" | "high";
  latencyImpactMs: number;
  tradeoff: string;
}

export interface RemediationComparison {
  remediation: Remediation;
  projectedRisk: RiskAssessment;
  projectedViolationCount: number;
  projectedBoundaryViolationRate: number;
  violationsPrevented: number;
  riskReduction: number;
  residualFaults: FaultMode[];
}
