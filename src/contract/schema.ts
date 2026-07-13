import { BoundaryContractError, TargetConfigurationError } from "./errors";
import type {
  BoundaryAssertion,
  BoundaryAssertionType,
  BoundaryContract,
  BoundaryIdentity,
  BoundaryProbe,
  BoundarySeverity,
  BoundarySetupStep,
  BoundaryTarget,
  ContractDiagnostic,
  MockTargetResponse,
} from "./types";
import { BOUNDARY_CONTRACT_VERSION } from "./types";
import { assertAllowedTargetUrl } from "./url";
import { isSafeRegularExpression } from "./regex";

export interface ValidationIssue {
  path: readonly (string | number)[];
  message: string;
  code: string;
}

interface ValidationResult {
  contract: BoundaryContract;
  issues: ValidationIssue[];
  /** YAML node path for each probe in contract.probes, aligned by index. */
  probePaths: ReadonlyArray<readonly (string | number)[]>;
}

const MAX_MATRIX_SOURCES = 500;
const MAX_GENERATED_PROBES = 1_000;
const DEFAULT_MATRIX_REMEDIATION =
  "Filter retrieval by the effective identity before ranking, caching, prompting, and citation generation.";

const SEVERITIES = new Set<BoundarySeverity>([
  "low",
  "medium",
  "high",
  "critical",
]);
const ASSERTION_TYPES = new Set<BoundaryAssertionType>([
  "contains",
  "not_contains",
  "matches",
  "not_matches",
  "source_present",
  "source_absent",
]);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADERS = new Set(["connection", "content-length", "host", "transfer-encoding"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pathText(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`,
    "$",
  );
}

function defaultSeverity(type: BoundaryAssertionType): BoundarySeverity {
  return type === "not_contains" || type === "not_matches" || type === "source_absent"
    ? "critical"
    : "medium";
}

type IssueReporter = (
  path: readonly (string | number)[],
  message: string,
  code: string,
) => void;

interface MatrixHelpers {
  record: (input: unknown, path: readonly (string | number)[]) => Record<string, unknown>;
  knownKeys: (
    input: Record<string, unknown>,
    allowed: readonly string[],
    path: readonly (string | number)[],
  ) => void;
  requiredString: (input: unknown, path: readonly (string | number)[], label: string) => string;
  optionalString: (
    input: unknown,
    path: readonly (string | number)[],
    label: string,
  ) => string | undefined;
  identifier: (input: unknown, path: readonly (string | number)[], label: string) => string;
}

/**
 * Expand a declarative authorization matrix into deterministic probes. For every source, each
 * identity outside its `allow` list yields a critical deny probe (source_absent + not_contains
 * canary); each authorized identity yields a medium positive-control probe. The matrix is a
 * source-level convenience that compiles down to ordinary v1 probes—the runner never sees it.
 */
function expandMatrix(
  rawMatrix: unknown,
  identities: Record<string, BoundaryIdentity>,
  probes: BoundaryProbe[],
  probePaths: Array<readonly (string | number)[]>,
  probeIds: Set<string>,
  issue: IssueReporter,
  helpers: MatrixHelpers,
): void {
  const { record, knownKeys, requiredString, optionalString, identifier } = helpers;
  const matrixPath = ["matrix"] as const;
  const matrix = record(rawMatrix, matrixPath);
  knownKeys(matrix, ["prompt", "sources", "positiveControls", "remediation"], matrixPath);

  const promptTemplate = requiredString(matrix.prompt, [...matrixPath, "prompt"], "matrix.prompt");
  const matrixRemediation = optionalString(
    matrix.remediation,
    [...matrixPath, "remediation"],
    "remediation",
  );

  let positiveControls = true;
  if (matrix.positiveControls !== undefined) {
    if (typeof matrix.positiveControls !== "boolean") {
      issue([...matrixPath, "positiveControls"], "positiveControls must be a boolean.", "TYPE_BOOLEAN");
    } else {
      positiveControls = matrix.positiveControls;
    }
  }

  const identityIds = Object.keys(identities);

  if (!Array.isArray(matrix.sources)) {
    issue([...matrixPath, "sources"], "matrix.sources must be a sequence.", "TYPE_SEQUENCE");
    return;
  }
  if (matrix.sources.length === 0) {
    issue([...matrixPath, "sources"], "matrix.sources must define at least one source.", "REQUIRED");
    return;
  }
  if (matrix.sources.length > MAX_MATRIX_SOURCES) {
    issue(
      [...matrixPath, "sources"],
      `At most ${MAX_MATRIX_SOURCES} matrix sources are allowed.`,
      "RESOURCE_LIMIT",
    );
    return;
  }

  const seenKeys = new Set<string>();
  for (const [sourceIndex, rawSource] of matrix.sources.entries()) {
    const sourcePath = [...matrixPath, "sources", sourceIndex] as const;
    const source = record(rawSource, sourcePath);
    knownKeys(source, ["key", "id", "canary", "label", "allow", "remediation"], sourcePath);
    const key = identifier(source.key, [...sourcePath, "key"], "matrix source key");
    if (key) {
      if (seenKeys.has(key)) {
        issue([...sourcePath, "key"], "matrix source key is duplicated.", "DUPLICATE_ID");
      }
      seenKeys.add(key);
    }
    const id = requiredString(source.id, [...sourcePath, "id"], "id");
    const canary = requiredString(source.canary, [...sourcePath, "canary"], "canary");
    const label = optionalString(source.label, [...sourcePath, "label"], "label") ?? id;
    const sourceRemediation = optionalString(
      source.remediation,
      [...sourcePath, "remediation"],
      "remediation",
    );

    const allow = new Set<string>();
    if (source.allow !== undefined) {
      if (!Array.isArray(source.allow)) {
        issue([...sourcePath, "allow"], "allow must be a sequence of identity ids.", "TYPE_SEQUENCE");
      } else {
        for (const [allowIndex, rawAllow] of source.allow.entries()) {
          const allowedId = requiredString(rawAllow, [...sourcePath, "allow", allowIndex], "identity");
          if (allowedId && !Object.hasOwn(identities, allowedId)) {
            issue([...sourcePath, "allow", allowIndex], "Referenced identity is not defined.", "UNKNOWN_IDENTITY");
          } else if (allowedId) {
            allow.add(allowedId);
          }
        }
      }
    }
    if (!key || !id || !canary) continue;

    const prompt = promptTemplate.split("{label}").join(label).split("{id}").join(id);

    for (const identityId of identityIds) {
      const denied = !allow.has(identityId);
      if (!denied && !positiveControls) continue;
      const probeId = `matrix-${key}-${identityId}-${denied ? "deny" : "allow"}`;
      if (!IDENTIFIER.test(probeId)) {
        issue(
          [...sourcePath, "key"],
          `Generated probe id "${probeId}" exceeds identifier limits; shorten the source key or identity id.`,
          "INVALID_IDENTIFIER",
        );
        continue;
      }
      if (probeIds.has(probeId)) {
        issue(
          [...sourcePath, "key"],
          `Generated probe id "${probeId}" collides with an existing probe.`,
          "DUPLICATE_ID",
        );
        continue;
      }
      probeIds.add(probeId);
      const identityName = identities[identityId].name;
      probes.push(
        denied
          ? {
              id: probeId,
              name: `${identityName} must not retrieve ${label}`,
              description: `Denied identity ${identityId} must receive neither ${id} nor its canary.`,
              category: "matrix-deny",
              identity: identityId,
              prompt,
              setup: [],
              assertions: [
                { type: "source_absent", value: id, severity: "critical", caseSensitive: false },
                {
                  type: "not_contains",
                  value: canary,
                  severity: "critical",
                  caseSensitive: false,
                  message: `Protected canary for ${id} crossed the boundary to ${identityId}.`,
                },
              ],
              tags: ["matrix", "deny"],
              remediation: sourceRemediation ?? matrixRemediation ?? DEFAULT_MATRIX_REMEDIATION,
            }
          : {
              id: probeId,
              name: `${identityName} can retrieve ${label}`,
              description: `Authorized identity ${identityId} should retrieve ${id}.`,
              category: "matrix-allow",
              identity: identityId,
              prompt,
              setup: [],
              assertions: [
                { type: "source_present", value: id, severity: "medium", caseSensitive: false },
                {
                  type: "contains",
                  value: canary,
                  severity: "medium",
                  caseSensitive: false,
                  message: `Authorized identity ${identityId} did not receive ${id}; check for over-restriction or empty retrieval.`,
                },
              ],
              tags: ["matrix", "allow"],
            },
      );
      probePaths.push(sourcePath);
    }
  }
}

/** Validate and normalize the public v1 schema. The issue paths map directly to YAML nodes. */
export function validateBoundaryContractValue(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const issue = (
    path: readonly (string | number)[],
    message: string,
    code: string,
  ) => issues.push({ path, message, code });

  const record = (
    input: unknown,
    path: readonly (string | number)[],
  ): Record<string, unknown> => {
    if (!isRecord(input)) {
      issue(path, "Expected a mapping.", "TYPE_MAPPING");
      return {};
    }
    return input;
  };
  const knownKeys = (
    input: Record<string, unknown>,
    allowed: readonly string[],
    path: readonly (string | number)[],
  ) => {
    const known = new Set(allowed);
    for (const key of Object.keys(input)) {
      if (!known.has(key)) issue([...path, key], `Unknown field ${key}.`, "UNKNOWN_FIELD");
    }
  };
  const requiredString = (
    input: unknown,
    path: readonly (string | number)[],
    label: string,
  ): string => {
    if (typeof input !== "string" || input.trim().length === 0) {
      issue(path, `${label} must be a non-empty string.`, "TYPE_STRING");
      return "";
    }
    return input;
  };
  const optionalString = (
    input: unknown,
    path: readonly (string | number)[],
    label: string,
  ): string | undefined => {
    if (input === undefined) return undefined;
    return requiredString(input, path, label);
  };
  const identifier = (
    input: unknown,
    path: readonly (string | number)[],
    label: string,
  ): string => {
    const result = requiredString(input, path, label);
    if (result && !IDENTIFIER.test(result)) {
      issue(
        path,
        `${label} must start with an alphanumeric character and contain only letters, numbers, dot, underscore, colon, or hyphen (maximum 128 characters).`,
        "INVALID_IDENTIFIER",
      );
    }
    return result;
  };
  const headers = (
    input: unknown,
    path: readonly (string | number)[],
  ): Record<string, string> => {
    if (input === undefined) return {};
    const source = record(input, path);
    const result: Record<string, string> = {};
    for (const [name, headerValue] of Object.entries(source)) {
      if (!HEADER_NAME.test(name)) {
        issue([...path, name], "Header name contains invalid characters.", "INVALID_HEADER");
      }
      if (FORBIDDEN_HEADERS.has(name.toLowerCase())) {
        issue([...path, name], `Header ${name} is managed by the HTTP client.`, "FORBIDDEN_HEADER");
      }
      if (typeof headerValue !== "string") {
        issue([...path, name], "Header value must be a string.", "TYPE_STRING");
      } else if ([...headerValue].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return (
          (codePoint < 0x20 && codePoint !== 0x09) ||
          codePoint === 0x7f ||
          codePoint > 0xff
        );
      })) {
        issue([...path, name], "Header value contains a character unsupported by HTTP field values.", "INVALID_HEADER");
      } else if (headerValue.length > 8_192) {
        issue([...path, name], "Header value exceeds the 8192-character limit.", "RESOURCE_LIMIT");
      } else {
        result[name] = headerValue;
      }
    }
    return result;
  };

  const root = record(value, []);
  const resourceStack: Array<{ value: unknown; path: readonly (string | number)[]; depth: number }> = [
    { value, path: [], depth: 0 },
  ];
  let visitedValues = 0;
  while (resourceStack.length > 0 && visitedValues <= 20_000) {
    const current = resourceStack.pop();
    if (!current) break;
    visitedValues += 1;
    if (current.depth > 64) {
      issue(current.path, "Contract nesting may not exceed 64 levels.", "RESOURCE_LIMIT");
      continue;
    }
    if (typeof current.value === "string" && current.value.length > 65_536) {
      issue(current.path, "String value exceeds the 65536-character limit.", "RESOURCE_LIMIT");
    } else if (Array.isArray(current.value)) {
      if (current.value.length > 5_000) {
        issue(current.path, "Sequence exceeds the 5000-item limit.", "RESOURCE_LIMIT");
      }
      for (const [index, child] of current.value.entries()) {
        resourceStack.push({ value: child, path: [...current.path, index], depth: current.depth + 1 });
      }
    } else if (isRecord(current.value)) {
      const entries = Object.entries(current.value);
      if (entries.length > 5_000) {
        issue(current.path, "Mapping exceeds the 5000-field limit.", "RESOURCE_LIMIT");
      }
      for (const [key, child] of entries) {
        resourceStack.push({ value: child, path: [...current.path, key], depth: current.depth + 1 });
      }
    }
  }
  if (visitedValues > 20_000) {
    issue([], "Contract exceeds the 20000-value limit.", "RESOURCE_LIMIT");
  }
  knownKeys(root, ["version", "name", "description", "target", "identities", "probes", "matrix"], []);

  const rawVersion = root.version;
  if (rawVersion !== 1 && rawVersion !== BOUNDARY_CONTRACT_VERSION) {
    issue(["version"], 'Only boundary contract version "1" is supported.', "UNSUPPORTED_VERSION");
  }
  const name = requiredString(root.name, ["name"], "name");
  const description = optionalString(root.description, ["description"], "description");

  const targetRecord = record(root.target, ["target"]);
  const adapterValue = targetRecord.adapter;
  let target: BoundaryTarget;
  if (adapterValue === "mock") {
    knownKeys(targetRecord, ["adapter", "responses"], ["target"]);
    const responseRecord = record(targetRecord.responses, ["target", "responses"]);
    const responses = Object.create(null) as Record<string, MockTargetResponse>;
    for (const [responseKey, rawResponse] of Object.entries(responseRecord)) {
      const responsePath = ["target", "responses", responseKey] as const;
      if (typeof rawResponse === "string") {
        responses[responseKey] = {
          content: rawResponse,
          sources: [],
          status: 200,
          delayMs: 0,
        };
        continue;
      }
      const response = record(rawResponse, responsePath);
      knownKeys(response, ["content", "sources", "status", "delayMs"], responsePath);
      const content = requiredString(response.content, [...responsePath, "content"], "content");
      let sources: string[] = [];
      if (response.sources !== undefined) {
        if (!Array.isArray(response.sources)) {
          issue([...responsePath, "sources"], "sources must be a sequence of strings.", "TYPE_SEQUENCE");
        } else {
          sources = response.sources.map((source, index) =>
            requiredString(source, [...responsePath, "sources", index], "source"),
          );
        }
      }
      const status = response.status === undefined ? 200 : response.status;
      if (!Number.isInteger(status) || Number(status) < 100 || Number(status) > 599) {
        issue([...responsePath, "status"], "status must be an integer from 100 to 599.", "OUT_OF_RANGE");
      }
      const delayMs = response.delayMs === undefined ? 0 : response.delayMs;
      if (!Number.isInteger(delayMs) || Number(delayMs) < 0 || Number(delayMs) > 300_000) {
        issue([...responsePath, "delayMs"], "delayMs must be an integer from 0 to 300000.", "OUT_OF_RANGE");
      }
      responses[responseKey] = {
        content,
        sources,
        status: Number(status),
        delayMs: Number(delayMs),
      };
    }
    if (Object.keys(responses).length === 0) {
      issue(["target", "responses"], "Mock target must define at least one response.", "REQUIRED");
    }
    target = { adapter: "mock", responses };
  } else {
    if (adapterValue !== "openai-compatible") {
      issue(
        ["target", "adapter"],
        'adapter must be "openai-compatible" or "mock".',
        "INVALID_ENUM",
      );
    }
    knownKeys(
      targetRecord,
      [
        "adapter",
        "baseUrl",
        "path",
        "model",
        "apiKey",
        "headers",
        "systemPrompt",
        "responseLimitBytes",
      ],
      ["target"],
    );
    const baseUrl = optionalString(targetRecord.baseUrl, ["target", "baseUrl"], "baseUrl");
    if (baseUrl) {
      try {
        assertAllowedTargetUrl(baseUrl);
      } catch (error) {
        issue(
          ["target", "baseUrl"],
          error instanceof TargetConfigurationError ? error.message : "baseUrl is invalid.",
          "INVALID_TARGET_URL",
        );
      }
    }
    const path = targetRecord.path === undefined
      ? "/chat/completions"
      : requiredString(targetRecord.path, ["target", "path"], "path");
    if (path && (!path.startsWith("/") || path.includes("://") || /[?#]/.test(path))) {
      issue(
        ["target", "path"],
        "path must be an absolute URL path without a query string or fragment.",
        "INVALID_TARGET_PATH",
      );
    }
    const model = requiredString(targetRecord.model, ["target", "model"], "model");
    const apiKey = optionalString(targetRecord.apiKey, ["target", "apiKey"], "apiKey");
    const systemPrompt = optionalString(
      targetRecord.systemPrompt,
      ["target", "systemPrompt"],
      "systemPrompt",
    );
    const responseLimitBytes = targetRecord.responseLimitBytes === undefined
      ? 1_048_576
      : targetRecord.responseLimitBytes;
    if (
      !Number.isInteger(responseLimitBytes) ||
      Number(responseLimitBytes) < 1_024 ||
      Number(responseLimitBytes) > 2_097_152
    ) {
      issue(
        ["target", "responseLimitBytes"],
        "responseLimitBytes must be an integer from 1024 to 2097152.",
        "OUT_OF_RANGE",
      );
    }
    target = {
      adapter: "openai-compatible",
      ...(baseUrl ? { baseUrl } : {}),
      path,
      model,
      ...(apiKey ? { apiKey } : {}),
      headers: headers(targetRecord.headers, ["target", "headers"]),
      ...(systemPrompt ? { systemPrompt } : {}),
      responseLimitBytes: Number(responseLimitBytes),
    };
  }

  const identityRecord = record(root.identities, ["identities"]);
  const identities: Record<string, BoundaryIdentity> = {};
  for (const [identityId, rawIdentity] of Object.entries(identityRecord)) {
    identifier(identityId, ["identities", identityId], "identity id");
    const identity = record(rawIdentity, ["identities", identityId]);
    knownKeys(identity, ["name", "headers", "systemPrompt"], ["identities", identityId]);
    const identityName = identity.name === undefined
      ? identityId
      : requiredString(identity.name, ["identities", identityId, "name"], "name");
    const systemPrompt = optionalString(
      identity.systemPrompt,
      ["identities", identityId, "systemPrompt"],
      "systemPrompt",
    );
    identities[identityId] = {
      name: identityName,
      headers: headers(identity.headers, ["identities", identityId, "headers"]),
      ...(systemPrompt ? { systemPrompt } : {}),
    };
  }
  if (Object.keys(identities).length === 0) {
    issue(["identities"], "At least one identity is required.", "REQUIRED");
  }
  if (Object.keys(identities).length > 256) {
    issue(["identities"], "At most 256 identities are allowed.", "RESOURCE_LIMIT");
  }

  const probes: BoundaryProbe[] = [];
  const probePaths: Array<readonly (string | number)[]> = [];
  const probeIds = new Set<string>();
  if (root.probes !== undefined && !Array.isArray(root.probes)) {
    issue(["probes"], "probes must be a sequence.", "TYPE_SEQUENCE");
  } else if (Array.isArray(root.probes)) {
    if (root.probes.length > 1_000) {
      issue(["probes"], "At most 1000 probes are allowed.", "RESOURCE_LIMIT");
    }
    for (const [probeIndex, rawProbe] of root.probes.entries()) {
      const probePath = ["probes", probeIndex] as const;
      const probe = record(rawProbe, probePath);
      knownKeys(
        probe,
        [
          "id",
          "name",
          "description",
          "category",
          "identity",
          "prompt",
          "setup",
          "assertions",
          "tags",
          "remediation",
        ],
        probePath,
      );
      const id = identifier(probe.id, [...probePath, "id"], "probe id");
      if (id && probeIds.has(id)) {
        issue([...probePath, "id"], "Probe id is duplicated.", "DUPLICATE_ID");
      }
      probeIds.add(id);
      const probeName = probe.name === undefined
        ? id
        : requiredString(probe.name, [...probePath, "name"], "name");
      const probeDescription = optionalString(
        probe.description,
        [...probePath, "description"],
        "description",
      );
      const category = optionalString(probe.category, [...probePath, "category"], "category");
      const identityId = identifier(
        probe.identity,
        [...probePath, "identity"],
        "identity",
      );
      if (identityId && !Object.hasOwn(identities, identityId)) {
        issue([...probePath, "identity"], "Referenced identity is not defined.", "UNKNOWN_IDENTITY");
      }
      const prompt = requiredString(probe.prompt, [...probePath, "prompt"], "prompt");

      const setup: BoundarySetupStep[] = [];
      if (probe.setup !== undefined) {
        if (!Array.isArray(probe.setup)) {
          issue([...probePath, "setup"], "setup must be a sequence.", "TYPE_SEQUENCE");
        } else {
          if (probe.setup.length > 50) {
            issue([...probePath, "setup"], "At most 50 setup steps are allowed per probe.", "RESOURCE_LIMIT");
          }
          for (const [setupIndex, rawStep] of probe.setup.entries()) {
            const stepPath = [...probePath, "setup", setupIndex];
            const step = record(rawStep, stepPath);
            knownKeys(step, ["identity", "prompt"], stepPath);
            const stepIdentity = identifier(step.identity, [...stepPath, "identity"], "identity");
            if (stepIdentity && !Object.hasOwn(identities, stepIdentity)) {
              issue([...stepPath, "identity"], "Referenced identity is not defined.", "UNKNOWN_IDENTITY");
            }
            setup.push({
              identity: stepIdentity,
              prompt: requiredString(step.prompt, [...stepPath, "prompt"], "prompt"),
            });
          }
        }
      }

      const assertions: BoundaryAssertion[] = [];
      if (!Array.isArray(probe.assertions)) {
        issue([...probePath, "assertions"], "assertions must be a sequence.", "TYPE_SEQUENCE");
      } else {
        if (probe.assertions.length > 32) {
          issue([...probePath, "assertions"], "At most 32 assertions are allowed per probe.", "RESOURCE_LIMIT");
        }
        let regexAssertionCount = 0;
        for (const [assertionIndex, rawAssertion] of probe.assertions.entries()) {
          const assertionPath = [...probePath, "assertions", assertionIndex];
          const assertion = record(rawAssertion, assertionPath);
          knownKeys(
            assertion,
            ["type", "value", "severity", "caseSensitive", "message"],
            assertionPath,
          );
          const assertionType = assertion.type;
          if (typeof assertionType !== "string" || !ASSERTION_TYPES.has(assertionType as BoundaryAssertionType)) {
            issue(
              [...assertionPath, "type"],
              `type must be one of ${[...ASSERTION_TYPES].join(", ")}.`,
              "INVALID_ENUM",
            );
          }
          const normalizedType = ASSERTION_TYPES.has(assertionType as BoundaryAssertionType)
            ? assertionType as BoundaryAssertionType
            : "not_contains";
          if (normalizedType === "matches" || normalizedType === "not_matches") {
            regexAssertionCount += 1;
            if (regexAssertionCount > 10) {
              issue(
                [...assertionPath, "type"],
                "At most 10 regular-expression assertions are allowed per probe.",
                "RESOURCE_LIMIT",
              );
            }
          }
          const assertionValue = requiredString(
            assertion.value,
            [...assertionPath, "value"],
            "value",
          );
          const severityValue = assertion.severity ?? defaultSeverity(normalizedType);
          if (typeof severityValue !== "string" || !SEVERITIES.has(severityValue as BoundarySeverity)) {
            issue(
              [...assertionPath, "severity"],
              `severity must be one of ${[...SEVERITIES].join(", ")}.`,
              "INVALID_ENUM",
            );
          }
          const caseSensitive = assertion.caseSensitive ?? false;
          if (typeof caseSensitive !== "boolean") {
            issue(
              [...assertionPath, "caseSensitive"],
              "caseSensitive must be a boolean.",
              "TYPE_BOOLEAN",
            );
          }
          const assertionMessage = optionalString(
            assertion.message,
            [...assertionPath, "message"],
            "message",
          );
          if (
            (normalizedType === "matches" || normalizedType === "not_matches") &&
            assertionValue
          ) {
            if (!isSafeRegularExpression(assertionValue)) {
              issue(
                [...assertionPath, "value"],
                "Regular expression is outside the v1 linear subset (literals, escapes, anchors, dot, and unquantified character classes).",
                "UNSAFE_REGEX",
              );
            } else try {
              new RegExp(assertionValue, caseSensitive ? "" : "i");
            } catch {
              issue([...assertionPath, "value"], "value must be a valid regular expression.", "INVALID_REGEX");
            }
          }
          assertions.push({
            type: normalizedType,
            value: assertionValue,
            severity: SEVERITIES.has(severityValue as BoundarySeverity)
              ? severityValue as BoundarySeverity
              : defaultSeverity(normalizedType),
            caseSensitive: typeof caseSensitive === "boolean" ? caseSensitive : false,
            ...(assertionMessage ? { message: assertionMessage } : {}),
          });
        }
      }
      if (assertions.length === 0) {
        issue([...probePath, "assertions"], "At least one assertion is required.", "REQUIRED");
      }

      let tags: string[] = [];
      if (probe.tags !== undefined) {
        if (!Array.isArray(probe.tags)) {
          issue([...probePath, "tags"], "tags must be a sequence of strings.", "TYPE_SEQUENCE");
        } else {
          if (probe.tags.length > 50) {
            issue([...probePath, "tags"], "At most 50 tags are allowed per probe.", "RESOURCE_LIMIT");
          }
          tags = probe.tags.map((tag, tagIndex) =>
            requiredString(tag, [...probePath, "tags", tagIndex], "tag"),
          );
        }
      }
      const remediation = optionalString(
        probe.remediation,
        [...probePath, "remediation"],
        "remediation",
      );
      probes.push({
        id,
        name: probeName,
        ...(probeDescription ? { description: probeDescription } : {}),
        ...(category ? { category } : {}),
        identity: identityId,
        prompt,
        setup,
        assertions,
        tags,
        ...(remediation ? { remediation } : {}),
      });
      probePaths.push(probePath);
    }
  }

  if (root.matrix !== undefined) {
    expandMatrix(root.matrix, identities, probes, probePaths, probeIds, issue, {
      record,
      knownKeys,
      requiredString,
      optionalString,
      identifier,
    });
  }

  if (probes.length === 0) {
    issue(["probes"], "Provide at least one probe or a non-empty matrix block.", "REQUIRED");
  }
  if (probes.length > MAX_GENERATED_PROBES) {
    issue([], `At most ${MAX_GENERATED_PROBES} probes (including matrix expansion) are allowed.`, "RESOURCE_LIMIT");
  }

  if (target.adapter === "mock" && Object.keys(target.responses).length > 0) {
    const fallback = Object.hasOwn(target.responses, "*");
    for (const [probeIndex, probe] of probes.entries()) {
      if (!fallback && !Object.hasOwn(target.responses, probe.id)) {
        issue(
          ["target", "responses"],
          "Mock target has no response for this probe and no * fallback.",
          "MOCK_RESPONSE_MISSING",
        );
      }
      for (const setupIndex of probe.setup.keys()) {
        const key = `${probe.id}:setup:${setupIndex}`;
        if (!fallback && !Object.hasOwn(target.responses, key)) {
          issue(
            ["probes", probeIndex, "setup", setupIndex],
            "Mock target has no response for this setup step and no * fallback.",
            "MOCK_RESPONSE_MISSING",
          );
        }
      }
    }
  }

  return {
    contract: {
      version: BOUNDARY_CONTRACT_VERSION,
      name,
      ...(description ? { description } : {}),
      target,
      identities,
      probes,
    },
    issues,
    probePaths,
  };
}

/** Validate an already parsed value. Prefer parseBoundaryContract for YAML line diagnostics. */
export function validateBoundaryContract(value: unknown): BoundaryContract {
  const result = validateBoundaryContractValue(value);
  if (result.issues.length > 0) {
    const diagnostics: ContractDiagnostic[] = result.issues.map((item) => ({
      path: pathText(item.path),
      message: item.message,
      code: item.code,
      line: 1,
      column: 1,
    }));
    throw new BoundaryContractError("<value>", diagnostics);
  }
  return result.contract;
}
