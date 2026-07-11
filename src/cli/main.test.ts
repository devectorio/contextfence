import { describe, expect, it } from "vitest";
import type { CliIO } from "./main";
import { CLI_EXIT_CODE, runCli } from "./main";

const contract = (content: string, status = 200) => `
version: 1
name: CLI suite
target:
  adapter: mock
  responses:
    "*":
      content: ${content}
      status: ${status}
identities:
  guest: {}
probes:
  - id: isolation
    identity: guest
    prompt: hello
    assertions:
      - type: not_contains
        value: CF_SECRET
        severity: high
`;

function memoryIO(source = contract("public")) {
  let stdout = "";
  let stderr = "";
  const writes = new Map<string, string>();
  const io: CliIO = {
    stdout: (value) => { stdout += value; },
    stderr: (value) => { stderr += value; },
    readText: async () => source,
    writeText: async (path, value) => { writes.set(path, value); },
    env: {},
  };
  return {
    io,
    output: () => stdout,
    errors: () => stderr,
    writes,
  };
}

describe("CLI main command", () => {
  it("returns stable help and version output", async () => {
    const help = memoryIO();
    expect(await runCli(["--help"], help.io)).toBe(0);
    expect(help.output()).toContain("contextfence test <boundary.yaml>");
    const version = memoryIO();
    expect(await runCli(["--version"], version.io)).toBe(0);
    expect(version.output()).toBe("0.1.0\n");
  });

  it("writes JSON and honors the finding threshold", async () => {
    const passing = memoryIO();
    expect(await runCli(["test", "boundary.yaml", "--format=json"], passing.io)).toBe(0);
    expect(JSON.parse(passing.output()).summary.status).toBe("passed");

    const finding = memoryIO(contract("CF_SECRET"));
    expect(await runCli(["test", "boundary.yaml", "--fail-on", "high"], finding.io)).toBe(
      CLI_EXIT_CODE.findings,
    );
    const ignored = memoryIO(contract("CF_SECRET"));
    expect(await runCli(["test", "boundary.yaml", "--fail-on", "critical"], ignored.io)).toBe(
      CLI_EXIT_CODE.success,
    );
  });

  it("uses runtime exit 3 for target failures and still emits evidence", async () => {
    const failing = memoryIO(contract("unavailable", 503));
    expect(await runCli(["test", "boundary.yaml", "--format", "json"], failing.io)).toBe(3);
    expect(JSON.parse(failing.output()).results[0].status).toBe("error");
  });

  it("validates invalid target overrides even in dry-run mode", async () => {
    const openAi = memoryIO(`
version: 1
name: Dry run
target: { adapter: openai-compatible, model: rag }
identities: { guest: {} }
probes:
  - id: probe
    identity: guest
    prompt: hello
    assertions: [{ type: not_contains, value: canary }]
`);
    expect(
      await runCli(
        ["test", "boundary.yaml", "--dry-run", "--target", "http://evil.example/v1"],
        openAi.io,
      ),
    ).toBe(CLI_EXIT_CODE.configuration);
    expect(openAi.errors()).toContain("HTTPS");
  });

  it("applies --target before environment expansion of target.baseUrl", async () => {
    const openAi = memoryIO(`
version: 1
name: Override
target:
  adapter: openai-compatible
  baseUrl: \${MISSING_TARGET_URL}
  model: rag
identities: { guest: {} }
probes:
  - id: probe
    identity: guest
    prompt: hello
    assertions: [{ type: not_contains, value: canary }]
`);
    expect(
      await runCli(
        ["test", "boundary.yaml", "--dry-run", "--target", "https://rag.example.test/v1"],
        openAi.io,
      ),
    ).toBe(CLI_EXIT_CODE.success);
    expect(openAi.errors()).toBe("");
    expect(openAi.output()).toContain("Validated without contacting the target");
  });

  it("returns configuration exit 2 for malformed contracts and usage", async () => {
    const malformed = memoryIO("apiKey: sk-do-not-print\ntarget: [\n");
    expect(await runCli(["test", "boundary.yaml"], malformed.io)).toBe(2);
    expect(malformed.errors()).not.toContain("sk-do-not-print");
    const usage = memoryIO();
    expect(await runCli(["wat"], usage.io)).toBe(2);
    expect(usage.errors()).toContain("Unknown command wat");
  });

  it("writes output files without duplicating the report on stdout", async () => {
    const context = memoryIO();
    expect(
      await runCli(
        ["test", "boundary.yaml", "--format", "junit", "--output", "report.xml"],
        context.io,
      ),
    ).toBe(0);
    expect(context.writes.get("report.xml")).toContain("<testsuites");
    expect(context.output()).toBe("ContextFence report written to report.xml.\n");
  });
});
