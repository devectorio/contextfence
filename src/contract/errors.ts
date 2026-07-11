import type { ContractDiagnostic } from "./types";

export class BoundaryContractError extends Error {
  readonly diagnostics: readonly ContractDiagnostic[];
  readonly sourceName: string;

  constructor(sourceName: string, diagnostics: readonly ContractDiagnostic[]) {
    super(`Boundary contract validation failed with ${diagnostics.length} error${diagnostics.length === 1 ? "" : "s"}.`);
    this.name = "BoundaryContractError";
    this.sourceName = sourceName;
    this.diagnostics = diagnostics;
  }

  format(): string {
    return this.diagnostics
      .map(
        (diagnostic) =>
          `${this.sourceName}:${diagnostic.line}:${diagnostic.column} ${diagnostic.path}: ${diagnostic.message} [${diagnostic.code}]`,
      )
      .join("\n");
  }
}

export class TargetConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TargetConfigurationError";
  }
}

export class TargetAdapterError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(message: string, code = "TARGET_ERROR", status?: number) {
    super(message);
    this.name = "TargetAdapterError";
    this.code = code;
    this.status = status;
  }
}

