import { describe, expect, it } from "vitest";
import type { BoundaryTargetAdapter } from "../adapters/types";
import { createMockAdapter } from "../adapters/mock";
import { createRedactor } from "../contract/env";
import { parseBoundaryContract } from "../contract/parser";
import { CONTEXTFENCE_VERSION } from "./args";
import { runBoundaryContract } from "./runner";

const contractSource = (responses: string) => `
version: 1
name: Black-box suite
target:
  adapter: mock
  responses:
${responses}
identities:
  admin:
    name: Admin
  guest:
    name: Guest
probes:
  - id: cache-isolation
    name: Cache isolation
    category: cache-isolation
    identity: guest
    prompt: Show the quarterly plan
    setup:
      - identity: admin
        prompt: Show the quarterly plan
    assertions:
      - type: not_contains
        value: CF_FINANCE_CANARY
      - type: source_absent
        value: finance-vault
        severity: high
`;

describe("boundary runner", () => {
  it("runs setup first and evaluates assertions into the portable report schema", async () => {
    const loaded = parseBoundaryContract(
      contractSource(`
    cache-isolation:setup:0:
      content: Admin response
    cache-isolation:
      content: Public response
      sources: [public-wiki]
`),
    );
    const report = await runBoundaryContract(
      loaded.contract,
      createMockAdapter(loaded.contract.target as never),
      {
        now: () => new Date("2026-07-11T00:00:00.000Z"),
        monotonicNow: (() => {
          let value = 0;
          return () => value++;
        })(),
      },
    );
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({
      id: "cache-isolation",
      status: "passed",
      severity: "none",
      assertions: [
        { kind: "not_contains", passed: true },
        { kind: "source_absent", passed: true },
      ],
    });
    expect(report.results[0].trace?.map((step) => step.stage)).toEqual([
      "setup",
      "target",
      "assertion",
    ]);
    expect(report.evaluatedAt).toBe("2026-07-11T00:00:00.000Z");
    expect(report.tool.version).toBe(CONTEXTFENCE_VERSION);
  });

  it("preserves contract order under concurrency and scores failed severities", async () => {
    const loaded = parseBoundaryContract(`
version: 1
name: Ordered
target:
  adapter: mock
  responses:
    "*": leaked CF_SECRET
identities:
  guest: {}
probes:
  - id: first
    identity: guest
    prompt: first
    assertions: [{ type: not_contains, value: CF_SECRET, severity: high }]
  - id: second
    identity: guest
    prompt: second
    assertions: [{ type: contains, value: leaked, severity: medium }]
`);
    const report = await runBoundaryContract(
      loaded.contract,
      createMockAdapter(loaded.contract.target as never),
      { concurrency: 2 },
    );
    expect(report.results.map((result) => result.id)).toEqual(["first", "second"]);
    expect(report.results.map((result) => result.status)).toEqual(["failed", "passed"]);
    expect(report.summary).toMatchObject({ failed: 1, passed: 1, boundaryViolationRate: 50 });
    expect(report.summary.risk).toMatchObject({ severity: "high", score: 24 });
  });

  it("normalizes timeouts and marks the assessment incomplete", async () => {
    const loaded = parseBoundaryContract(
      contractSource(`
    "*":
      content: never in time
      delayMs: 150
`),
    );
    const report = await runBoundaryContract(
      loaded.contract,
      createMockAdapter(loaded.contract.target as never),
      { timeoutMs: 100 },
    );
    expect(report.results[0]).toMatchObject({
      status: "error",
      severity: "critical",
      summary: "Target request timed out after 100 ms.",
    });
    expect(report.summary.boundaryViolationRate).toBeUndefined();
    expect(report.summary.risk?.label).toBe("Boundary assessment incomplete");
  });

  it("labels dry runs as validation-only rather than observed safety", async () => {
    const loaded = parseBoundaryContract(
      contractSource(`
    "*": public
`),
    );
    const report = await runBoundaryContract(loaded.contract, undefined, { dryRun: true });
    expect(report.summary.risk?.label).toBe("Contract validated; target not evaluated");
    expect(report.summary.boundaryViolationRate).toBeUndefined();
  });

  it("fails closed when a source assertion has no source metadata", async () => {
    const loaded = parseBoundaryContract(
      contractSource(`
    "*": public
`),
    );
    const adapter: BoundaryTargetAdapter = {
      kind: "mock",
      execute: async () => ({
        content: "public",
        sources: [],
        sourceMetadataAvailable: false,
        status: 200,
      }),
    };
    const report = await runBoundaryContract(loaded.contract, adapter);
    expect(report.results[0]).toMatchObject({
      status: "error",
      summary: "Target execution failed: Target response omitted source metadata required by a source assertion.",
    });
  });

  it("redacts target errors, identifiers, names, and custom messages", async () => {
    const secret = "sk-super-private";
    const loaded = parseBoundaryContract(`
version: 1
name: Suite ${secret}
target:
  adapter: mock
  responses: { "*": ok }
identities:
  guest: { headers: { Authorization: "Bearer ${secret}" } }
probes:
  - id: ${secret}
    name: Probe ${secret}
    identity: guest
    prompt: hello
    assertions: [{ type: contains, value: ok, message: "message ${secret}" }]
`);
    const adapter: BoundaryTargetAdapter = {
      kind: "mock",
      execute: async () => {
        throw new Error(`failed with ${secret}`);
      },
    };
    const report = await runBoundaryContract(loaded.contract, adapter, {
      redact: createRedactor(loaded.contract),
    });
    expect(JSON.stringify(report)).not.toContain(secret);
    expect(report.results[0].summary).toContain("[REDACTED]");
    expect(report.results[0].id).toBe("[REDACTED]");
  });

  it("rejects unsafe regular expressions before evaluating target text", async () => {
    const loaded = parseBoundaryContract(`
version: 1
name: Regex safety
target: { adapter: mock, responses: { "*": ok } }
identities: { guest: {} }
probes:
  - id: regex
    identity: guest
    prompt: hello
    assertions: [{ type: matches, value: "^ok$" }]
`);
    loaded.contract.probes[0].assertions[0].value = "(a+)+$";
    const report = await runBoundaryContract(
      loaded.contract,
      createMockAdapter(loaded.contract.target as never),
    );
    expect(report.results[0]).toMatchObject({
      status: "error",
      summary: "Target execution failed: Unsafe regular expression reached assertion execution.",
    });
  });
});
