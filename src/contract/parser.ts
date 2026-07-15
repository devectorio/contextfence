import { LineCounter, parseDocument } from "yaml";
import { createRedactor, interpolateEnvironment } from "./env";
import { BoundaryContractError } from "./errors";
import { validateBoundaryContractValue, type ValidationIssue } from "./schema";
import type {
  ContractDiagnostic,
  LoadedBoundaryContract,
  SourcePosition,
} from "./types";

export interface ParseBoundaryContractOptions {
  sourceName?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Replaces an OpenAI-compatible baseUrl before environment expansion. */
  targetOverride?: string;
}

interface RangedNode {
  range?: readonly number[];
}

function pathText(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`,
    "$",
  );
}

function positionForPath(
  document: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
  originalPath: readonly (string | number)[],
): SourcePosition {
  const path = [...originalPath];
  while (path.length >= 0) {
    let node: unknown;
    try {
      node = path.length === 0 ? document.contents : document.getIn(path, true);
    } catch {
      node = undefined;
    }
    const offset = (node as RangedNode | undefined)?.range?.[0];
    if (typeof offset === "number") {
      const position = lineCounter.linePos(offset);
      return { line: position.line, column: position.col };
    }
    if (path.length === 0) break;
    path.pop();
  }
  return { line: 1, column: 1 };
}

function validationDiagnostic(
  issue: ValidationIssue,
  document: ReturnType<typeof parseDocument>,
  lineCounter: LineCounter,
): ContractDiagnostic {
  return {
    ...positionForPath(document, lineCounter, issue.path),
    path: pathText(issue.path),
    message: issue.message,
    code: issue.code,
  };
}

/** Parse YAML/JSON, expand environment references, and validate the normalized v1 contract. */
export function parseBoundaryContract(
  source: string,
  options: ParseBoundaryContractOptions = {},
): LoadedBoundaryContract {
  const sourceName = options.sourceName ?? "boundary.yaml";
  if (new TextEncoder().encode(source).byteLength > 1_048_576) {
    throw new BoundaryContractError(sourceName, [
      {
        path: "$",
        message: "Boundary contract exceeds the 1048576-byte limit.",
        code: "RESOURCE_LIMIT",
        line: 1,
        column: 1,
      },
    ]);
  }
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    schema: "core",
  });

  if (document.errors.length > 0) {
    const diagnostics: ContractDiagnostic[] = document.errors.map((error) => {
      const offset = error.pos[0] ?? 0;
      const position = lineCounter.linePos(offset);
      return {
        path: "$",
        message: "Invalid YAML syntax.",
        code: `YAML_${error.code}`,
        line: position.line,
        column: position.col,
      };
    });
    throw new BoundaryContractError(sourceName, diagnostics);
  }

  let parsed: unknown;
  try {
    parsed = document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new BoundaryContractError(sourceName, [
      {
        path: "$",
        message: "YAML aliases are not supported in boundary contracts.",
        code: "YAML_ALIAS_UNSAFE",
        line: 1,
        column: 1,
      },
    ]);
  }

  let interpolationInput = parsed;
  if (options.targetOverride && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const root = parsed as Record<string, unknown>;
    const rawTarget = root.target;
    if (
      rawTarget &&
      typeof rawTarget === "object" &&
      !Array.isArray(rawTarget) &&
      (rawTarget as Record<string, unknown>).adapter === "openai-compatible"
    ) {
      interpolationInput = {
        ...root,
        target: {
          ...(rawTarget as Record<string, unknown>),
          baseUrl: options.targetOverride,
        },
      };
    }
  }
  const runtimeEnvironment =
    options.env ?? (typeof process === "undefined" ? {} : process.env);
  const interpolation = interpolateEnvironment(interpolationInput, runtimeEnvironment);
  const redact = createRedactor(interpolation.value, interpolation.interpolatedSecrets);
  if (interpolation.diagnostics.length > 0) {
    const diagnostics: ContractDiagnostic[] = interpolation.diagnostics.map((issue) => ({
      ...positionForPath(document, lineCounter, issue.pathParts),
      path: issue.path,
      message: issue.message,
      code: issue.code,
    }));
    throw new BoundaryContractError(sourceName, diagnostics);
  }

  const validation = validateBoundaryContractValue(interpolation.value);
  if (validation.issues.length > 0) {
    throw new BoundaryContractError(
      sourceName,
      validation.issues.map((issue) => {
        const diagnostic = validationDiagnostic(issue, document, lineCounter);
        return { ...diagnostic, message: redact(diagnostic.message) };
      }),
    );
  }

  const probeLocations = Object.fromEntries(
    validation.contract.probes.map((probe, index) => [
      probe.id,
      positionForPath(document, lineCounter, validation.probePaths[index] ?? ["probes", index]),
    ]),
  );
  return {
    contract: validation.contract,
    sourceName,
    probeLocations,
    redact,
  };
}
