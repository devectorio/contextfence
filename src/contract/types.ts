export const BOUNDARY_CONTRACT_VERSION = "1" as const;

export type BoundarySeverity = "low" | "medium" | "high" | "critical";

export type BoundaryAssertionType =
  | "contains"
  | "not_contains"
  | "matches"
  | "not_matches"
  | "source_present"
  | "source_absent";

export interface BoundaryAssertion {
  type: BoundaryAssertionType;
  value: string;
  severity: BoundarySeverity;
  caseSensitive: boolean;
  message?: string;
}

export interface BoundaryIdentity {
  name: string;
  headers: Record<string, string>;
  systemPrompt?: string;
}

export interface BoundarySetupStep {
  identity: string;
  prompt: string;
}

export interface BoundaryProbe {
  id: string;
  name: string;
  description?: string;
  category?: string;
  identity: string;
  prompt: string;
  setup: BoundarySetupStep[];
  assertions: BoundaryAssertion[];
  tags: string[];
  remediation?: string;
}

export interface OpenAICompatibleTarget {
  adapter: "openai-compatible";
  /** May be omitted from the file when supplied with the CLI's --target flag. */
  baseUrl?: string;
  path: string;
  model: string;
  apiKey?: string;
  headers: Record<string, string>;
  systemPrompt?: string;
  responseLimitBytes: number;
}

export interface MockTargetResponse {
  content: string;
  sources: string[];
  status: number;
  delayMs: number;
}

export interface MockTarget {
  adapter: "mock";
  /** Probe id, `<probe id>:setup:<zero-based index>`, or `*` fallback. */
  responses: Record<string, MockTargetResponse>;
}

export type BoundaryTarget = OpenAICompatibleTarget | MockTarget;

export interface BoundaryContract {
  version: typeof BOUNDARY_CONTRACT_VERSION;
  name: string;
  description?: string;
  target: BoundaryTarget;
  identities: Record<string, BoundaryIdentity>;
  probes: BoundaryProbe[];
}

export interface SourcePosition {
  line: number;
  column: number;
}

export interface ContractDiagnostic extends SourcePosition {
  path: string;
  message: string;
  code: string;
}

export interface LoadedBoundaryContract {
  contract: BoundaryContract;
  sourceName: string;
  probeLocations: Readonly<Record<string, SourcePosition>>;
  redact: (value: string) => string;
}

