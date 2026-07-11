/** A JSON-compatible value accepted in portable report metadata. */
export type ReportMetadataValue =
  | string
  | number
  | boolean
  | null
  | readonly ReportMetadataValue[]
  | { readonly [key: string]: ReportMetadataValue };

export type ReportSeverity = "none" | "low" | "medium" | "high" | "critical";

export type ReportResultStatus = "passed" | "failed" | "skipped" | "error";

export interface ReportTool {
  name: string;
  version?: string;
  informationUri?: string;
}

/** Optional source location used by SARIF and human-readable reports. */
export interface ReportLocation {
  uri: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface ReportIdentity {
  id: string;
  name: string;
}

export interface ReportAssertion {
  kind: string;
  subject: string;
  description?: string;
  expectation: string;
  actual: string;
  passed: boolean;
  message: string;
}

export interface ReportEvidence {
  kind: string;
  id: string;
  label: string;
  detail: string;
  severity: ReportSeverity;
}

export interface ReportTraceStep {
  id: string;
  stage: string;
  label: string;
  status: "pass" | "warn" | "fail" | "skipped";
  detail: string;
  durationMs: number;
  artifactIds?: readonly string[];
}

export interface ReportResult {
  id: string;
  name: string;
  description?: string;
  category?: string;
  status: ReportResultStatus;
  severity: ReportSeverity;
  summary: string;
  durationMs: number;
  identity?: ReportIdentity;
  assertions?: readonly ReportAssertion[];
  evidence?: readonly ReportEvidence[];
  trace?: readonly ReportTraceStep[];
  remediation?: string;
  location?: ReportLocation;
  properties?: Readonly<Record<string, ReportMetadataValue>>;
}

export interface ReportRisk {
  score: number;
  severity: ReportSeverity;
  label: string;
  rationale: readonly string[];
}

export interface ReportSummary {
  status: "passed" | "failed" | "error";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  durationMs: number;
  boundaryViolationRate?: number;
  risk?: ReportRisk;
}

/**
 * Framework-neutral input shared by all release reporters. The schema contains
 * no runtime-only values, so equal inputs always produce byte-identical output.
 */
export interface RunReport {
  schemaVersion: "1.0";
  id: string;
  name: string;
  evaluatedAt: string;
  tool: ReportTool;
  summary: ReportSummary;
  results: readonly ReportResult[];
  metadata?: Readonly<Record<string, ReportMetadataValue>>;
}

