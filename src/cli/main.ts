#!/usr/bin/env node

import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createTargetAdapter } from "../adapters";
import {
  BoundaryContractError,
  TargetConfigurationError,
  parseBoundaryContract,
} from "../contract";
import type { BoundarySeverity } from "../contract/types";
import type { ReportSeverity, RunReport } from "../reporters/types";
import {
  CONTEXTFENCE_VERSION,
  CliUsageError,
  ROOT_HELP,
  TEST_HELP,
  parseCliArguments,
  type FailOnSeverity,
} from "./args";
import { formatRunReport } from "./report";
import { runBoundaryContract } from "./runner";

export const CLI_EXIT_CODE = {
  success: 0,
  findings: 1,
  configuration: 2,
  runtime: 3,
} as const;

export interface CliIO {
  stdout(value: string): void;
  stderr(value: string): void;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  env: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
}

function defaultIO(): CliIO {
  return {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
    readText: readContractFile,
    writeText: writeReportFile,
    env: process.env,
    fetch: globalThis.fetch,
  };
}

const MAX_CONTRACT_BYTES = 1_048_576;

async function readContractFile(path: string): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_CONTRACT_BYTES + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const result = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset > MAX_CONTRACT_BYTES) throw new Error("Contract file exceeds size limit.");
    return buffer.subarray(0, offset).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function writeReportFile(path: string, value: string): Promise<void> {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(value, "utf8");
  } finally {
    await handle.close();
  }
}

const SEVERITY_RANK: Record<ReportSeverity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function reachesThreshold(report: RunReport, threshold: FailOnSeverity): boolean {
  if (threshold === "none") return false;
  return report.results.some(
    (result) =>
      result.status === "failed" &&
      SEVERITY_RANK[result.severity] >= SEVERITY_RANK[threshold as BoundarySeverity],
  );
}

/** Execute the CLI without exiting, so embedders and tests can own process lifecycle. */
export async function runCli(
  argv: readonly string[],
  io: CliIO = defaultIO(),
): Promise<number> {
  let redact = (value: string) => value;
  try {
    const args = parseCliArguments(argv);
    if (args.kind === "help") {
      io.stdout(args.topic === "root" ? ROOT_HELP : TEST_HELP);
      return CLI_EXIT_CODE.success;
    }
    if (args.kind === "version") {
      io.stdout(`${CONTEXTFENCE_VERSION}\n`);
      return CLI_EXIT_CODE.success;
    }

    let source: string;
    try {
      source = await io.readText(args.file);
    } catch {
      io.stderr(`ContextFence could not read ${args.file}.\n`);
      return CLI_EXIT_CODE.configuration;
    }
    const loaded = parseBoundaryContract(source, {
      sourceName: args.file,
      env: io.env,
      targetOverride: args.target,
    });
    redact = loaded.redact;
    if (args.target && loaded.contract.target.adapter === "mock") {
      throw new TargetConfigurationError("--target cannot be used with the mock adapter.");
    }
    const resolvedAdapter = createTargetAdapter(loaded.contract.target, {
      targetOverride: args.target,
      fetch: io.fetch,
    });
    const report = await runBoundaryContract(
      loaded.contract,
      args.dryRun ? undefined : resolvedAdapter,
      {
      timeoutMs: args.timeoutMs,
      concurrency: args.concurrency,
      dryRun: args.dryRun,
      sourceName: loaded.sourceName,
      probeLocations: loaded.probeLocations,
      redact,
      },
    );
    const rendered = formatRunReport(report, args.format);
    if (args.output && args.output !== "-") {
      try {
        await io.writeText(args.output, rendered);
      } catch {
        io.stderr(`ContextFence could not write ${args.output}.\n`);
        return CLI_EXIT_CODE.runtime;
      }
      io.stdout(`ContextFence report written to ${args.output}.\n`);
    } else {
      io.stdout(rendered);
    }

    if (report.summary.errors > 0) return CLI_EXIT_CODE.runtime;
    return reachesThreshold(report, args.failOn)
      ? CLI_EXIT_CODE.findings
      : CLI_EXIT_CODE.success;
  } catch (error) {
    if (error instanceof CliUsageError) {
      io.stderr(`${error.message}\n\n${ROOT_HELP}`);
      return CLI_EXIT_CODE.configuration;
    }
    if (error instanceof BoundaryContractError) {
      io.stderr(`ContextFence configuration error:\n${error.format()}\n`);
      return CLI_EXIT_CODE.configuration;
    }
    if (error instanceof TargetConfigurationError) {
      io.stderr(`ContextFence configuration error: ${redact(error.message)}\n`);
      return CLI_EXIT_CODE.configuration;
    }
    const message = error instanceof Error ? error.message : "Unknown runtime failure.";
    io.stderr(`ContextFence runtime error: ${redact(message)}\n`);
    return CLI_EXIT_CODE.runtime;
  }
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  process.exitCode = await runCli(argv);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) await main();
