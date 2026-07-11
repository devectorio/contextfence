const ENVIRONMENT_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SECRET_NAME = /(?:api[_-]?key|auth|bearer|credential|password|secret|token|cookie)/i;
const SENSITIVE_HEADER = /^(?:authorization|cookie|proxy-authorization|x-api-key|api-key|x-auth-token)$/i;

export interface EnvironmentInterpolationIssue {
  path: string;
  pathParts: readonly (string | number)[];
  message: string;
  code: string;
}

interface InterpolationResult {
  value: unknown;
  diagnostics: EnvironmentInterpolationIssue[];
  interpolatedSecrets: string[];
}

function pathLabel(path: readonly (string | number)[]): string {
  if (path.length === 0) return "$";
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`,
    "$",
  );
}

function hasMalformedEnvironmentReference(template: string): boolean {
  let searchFrom = 0;
  while (true) {
    const start = template.indexOf("${", searchFrom);
    if (start < 0) return false;
    const end = template.indexOf("}", start + 2);
    if (end < 0) return true;
    const expression = template.slice(start + 2, end);
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?::-[^{}]*)?$/.test(expression)) return true;
    searchFrom = end + 1;
  }
}

function interpolateString(
  input: string,
  path: readonly (string | number)[],
  env: Readonly<Record<string, string | undefined>>,
  diagnostics: InterpolationResult["diagnostics"],
  secrets: string[],
): string {
  const escapedMarker = "\u0000CONTEXTFENCE_ESCAPED_DOLLAR\u0000";
  const escaped = input.replaceAll("$${", `${escapedMarker}{`);
  const hasMalformedReference = hasMalformedEnvironmentReference(escaped);
  const output = escaped.replace(
    ENVIRONMENT_REFERENCE,
    (_reference, name: string, fallback: string | undefined) => {
      const configured = env[name];
      const value = configured && configured.length > 0 ? configured : fallback;
      if (value === undefined) {
        diagnostics.push({
          path: pathLabel(path),
          pathParts: path,
          message: `Environment variable ${name} is required but was not set.`,
          code: "ENV_MISSING",
        });
        return "";
      }
      const lastPath = path.at(-1);
      const sensitivePath =
        lastPath === "apiKey" ||
        lastPath === "prompt" ||
        lastPath === "systemPrompt" ||
        path.includes("headers") ||
        (lastPath === "value" && path.includes("assertions"));
      if ((SECRET_NAME.test(name) || sensitivePath) && value.length > 0) secrets.push(value);
      return value;
    },
  );

  if (hasMalformedReference) {
    diagnostics.push({
      path: pathLabel(path),
      pathParts: path,
      message: "Environment reference is malformed; expected ${NAME} or ${NAME:-default}.",
      code: "ENV_INVALID_REFERENCE",
    });
  }
  return output.replaceAll(`${escapedMarker}{`, "${");
}

function visit(
  input: unknown,
  path: readonly (string | number)[],
  env: Readonly<Record<string, string | undefined>>,
  diagnostics: InterpolationResult["diagnostics"],
  secrets: string[],
): unknown {
  if (typeof input === "string") {
    return interpolateString(input, path, env, diagnostics, secrets);
  }
  if (Array.isArray(input)) {
    return input.map((item, index) =>
      visit(item, [...path, index], env, diagnostics, secrets),
    );
  }
  if (input && typeof input === "object") {
    return Object.fromEntries(
      Object.entries(input).map(([key, value]) => [
        key,
        visit(value, [...path, key], env, diagnostics, secrets),
      ]),
    );
  }
  return input;
}

/** Expand environment references without mutating the parsed YAML object. */
export function interpolateEnvironment(
  input: unknown,
  env: Readonly<Record<string, string | undefined>>,
): InterpolationResult {
  const diagnostics: InterpolationResult["diagnostics"] = [];
  const interpolatedSecrets: string[] = [];
  const value = visit(input, [], env, diagnostics, interpolatedSecrets);
  return { value, diagnostics, interpolatedSecrets };
}

function collectConfiguredSecrets(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const root = input as Record<string, unknown>;
  const target = root.target;
  if (!target || typeof target !== "object") return [];
  const values: string[] = [];
  const targetRecord = target as Record<string, unknown>;
  if (typeof targetRecord.apiKey === "string") values.push(targetRecord.apiKey);

  const inspectHeaders = (headers: unknown) => {
    if (!headers || typeof headers !== "object") return;
    for (const [name, value] of Object.entries(headers)) {
      if (SENSITIVE_HEADER.test(name) && typeof value === "string") {
        values.push(value);
        const credential = value.replace(/^(?:Bearer|Basic)\s+/i, "");
        if (credential !== value) values.push(credential);
      }
    }
  };
  inspectHeaders(targetRecord.headers);

  const identities = root.identities;
  if (identities && typeof identities === "object") {
    for (const identity of Object.values(identities)) {
      if (identity && typeof identity === "object") {
        inspectHeaders((identity as Record<string, unknown>).headers);
      }
    }
  }
  return values;
}

/** Build a longest-first literal redactor for diagnostics and runtime errors. */
export function createRedactor(
  input: unknown,
  interpolatedSecrets: readonly string[] = [],
): (value: string) => string {
  const secrets = [...new Set([...interpolatedSecrets, ...collectConfiguredSecrets(input)])]
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length);
  return (value: string) =>
    secrets.reduce(
      (redacted, secret) => redacted.replaceAll(secret, "[REDACTED]"),
      value,
    );
}
