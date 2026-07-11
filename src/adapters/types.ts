import type {
  BoundaryIdentity,
  BoundaryTarget,
} from "../contract/types";

export type ProbeTargetPhase = "setup" | "probe";

export interface ProbeTargetRequest {
  probeId: string;
  phase: ProbeTargetPhase;
  setupIndex?: number;
  identityId: string;
  identity: BoundaryIdentity;
  prompt: string;
  signal: AbortSignal;
}

export interface ProbeTargetResponse {
  content: string;
  sources: string[];
  /** False means source assertions cannot be evaluated safely. */
  sourceMetadataAvailable: boolean;
  status: number;
}

/** A black-box target only knows how to execute one identity-bound prompt. */
export interface BoundaryTargetAdapter {
  readonly kind: BoundaryTarget["adapter"];
  execute(request: ProbeTargetRequest): Promise<ProbeTargetResponse>;
}

export interface AdapterFactoryOptions {
  targetOverride?: string;
  fetch?: typeof globalThis.fetch;
}
