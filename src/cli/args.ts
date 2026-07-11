import type { BoundarySeverity } from "../contract/types";

export const CONTEXTFENCE_VERSION = "0.1.0";
export const CLI_FORMATS = ["pretty", "json", "junit", "sarif", "html"] as const;
export type CliFormat = (typeof CLI_FORMATS)[number];
export type FailOnSeverity = "none" | BoundarySeverity;

export interface TestCommandArguments {
  kind: "test";
  file: string;
  target?: string;
  format: CliFormat;
  output?: string;
  failOn: FailOnSeverity;
  timeoutMs: number;
  concurrency: number;
  dryRun: boolean;
}

export type CliArguments =
  | { kind: "help"; topic: "root" | "test" }
  | { kind: "version" }
  | TestCommandArguments;

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const VALUE_OPTIONS = new Set([
  "--target",
  "--format",
  "--output",
  "--fail-on",
  "--timeout",
  "--concurrency",
]);
const FAIL_ON_VALUES = new Set<FailOnSeverity>([
  "none",
  "low",
  "medium",
  "high",
  "critical",
]);

function positiveInteger(
  value: string,
  option: string,
  minimum: number,
  maximum: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new CliUsageError(`${option} must be an integer from ${minimum} to ${maximum}.`);
  }
  const parsed = Number(value);
  if (parsed < minimum || parsed > maximum) {
    throw new CliUsageError(`${option} must be an integer from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

/** Parse the dependency-free, intentionally strict CLI surface. */
export function parseCliArguments(argv: readonly string[]): CliArguments {
  if (argv.length === 0 || (argv.length === 1 && ["-h", "--help"].includes(argv[0]))) {
    return { kind: "help", topic: "root" };
  }
  if (argv.length === 1 && ["-v", "--version"].includes(argv[0])) {
    return { kind: "version" };
  }
  if (argv[0] !== "test") {
    throw new CliUsageError(`Unknown command ${argv[0]}.`);
  }
  if (argv.length === 2 && ["-h", "--help"].includes(argv[1])) {
    return { kind: "help", topic: "test" };
  }

  const options = new Map<string, string>();
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      if (flags.has(argument)) throw new CliUsageError(`${argument} was supplied more than once.`);
      flags.add(argument);
      continue;
    }
    if (argument === "-h" || argument === "--help") {
      if (argv.length === 2) return { kind: "help", topic: "test" };
      throw new CliUsageError("--help cannot be combined with test arguments.");
    }
    if (argument === "-v" || argument === "--version") {
      throw new CliUsageError("--version is only valid before a command.");
    }
    if (argument.startsWith("--")) {
      const equalsIndex = argument.indexOf("=");
      const option = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument;
      if (!VALUE_OPTIONS.has(option)) throw new CliUsageError(`Unknown option ${option}.`);
      if (options.has(option)) throw new CliUsageError(`${option} was supplied more than once.`);
      const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : argv[++index];
      if (value === undefined || value.length === 0 || (equalsIndex < 0 && value.startsWith("--"))) {
        throw new CliUsageError(`${option} requires a value.`);
      }
      options.set(option, value);
      continue;
    }
    if (argument.startsWith("-")) throw new CliUsageError(`Unknown option ${argument}.`);
    positional.push(argument);
  }

  if (positional.length !== 1) {
    throw new CliUsageError("test requires exactly one boundary contract file.");
  }
  const formatValue = options.get("--format") ?? "pretty";
  if (!(CLI_FORMATS as readonly string[]).includes(formatValue)) {
    throw new CliUsageError(`--format must be one of ${CLI_FORMATS.join(", ")}.`);
  }
  const failOnValue = options.get("--fail-on") ?? "low";
  if (!FAIL_ON_VALUES.has(failOnValue as FailOnSeverity)) {
    throw new CliUsageError("--fail-on must be one of none, low, medium, high, critical.");
  }
  return {
    kind: "test",
    file: positional[0],
    ...(options.has("--target") ? { target: options.get("--target") } : {}),
    format: formatValue as CliFormat,
    ...(options.has("--output") ? { output: options.get("--output") } : {}),
    failOn: failOnValue as FailOnSeverity,
    timeoutMs: positiveInteger(options.get("--timeout") ?? "30000", "--timeout", 100, 300_000),
    concurrency: positiveInteger(options.get("--concurrency") ?? "4", "--concurrency", 1, 32),
    dryRun: flags.has("--dry-run"),
  };
}

export const ROOT_HELP = `ContextFence ${CONTEXTFENCE_VERSION} — permission regression tests for RAG systems

Usage:
  contextfence test <boundary.yaml> [options]
  contextfence --help
  contextfence --version

Commands:
  test    Validate and execute a versioned boundary contract

Run "contextfence test --help" for test options.
`;

export const TEST_HELP = `Usage: contextfence test <boundary.yaml> [options]

Options:
  --target <url>          Override target.baseUrl (HTTPS; local HTTP allowed)
  --format <format>       pretty, json, junit, sarif, or html (default: pretty)
  --output <path>         Write the report to a file; use - for stdout
  --fail-on <severity>    none, low, medium, high, or critical (default: low)
  --timeout <ms>          Per-probe timeout, 100..300000 (default: 30000)
  --concurrency <count>   Concurrent probes, 1..32 (default: 4)
  --dry-run               Parse and validate without contacting the target
  -h, --help              Show this help
`;

