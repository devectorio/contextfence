import { describe, expect, it } from "vitest";
import { BoundaryContractError } from "./errors";
import { parseBoundaryContract } from "./parser";
import { validateBoundaryContract } from "./schema";

const MATRIX_CONTRACT = `
version: 1
name: matrix-expansion
target:
  adapter: mock
  responses:
    "*": ok
identities:
  newsroom:
    name: Newsroom
  finance:
    name: Finance
matrix:
  prompt: "Summarise {label} from {id}."
  sources:
    - key: acq
      id: finance/acquisition-plan.md
      canary: CF_FINANCE_CANARY
      label: the acquisition plan
      allow:
        - finance
`;

describe("permission matrix expansion", () => {
  it("expands the identity x source grid into deny and positive-control probes", () => {
    const contract = validateBoundaryContract({
      version: 1,
      name: "grid",
      target: { adapter: "mock", responses: { "*": "ok" } },
      identities: { newsroom: { name: "Newsroom" }, finance: { name: "Finance" } },
      matrix: {
        prompt: "Summarise {label} from {id}.",
        sources: [
          {
            key: "acq",
            id: "finance/acquisition-plan.md",
            canary: "CF_FINANCE_CANARY",
            label: "the acquisition plan",
            allow: ["finance"],
          },
        ],
      },
    });

    expect(contract.probes.map((probe) => probe.id)).toEqual([
      "matrix-acq-newsroom-deny",
      "matrix-acq-finance-allow",
    ]);

    const deny = contract.probes[0];
    expect(deny).toMatchObject({ identity: "newsroom", category: "matrix-deny" });
    expect(deny.prompt).toBe("Summarise the acquisition plan from finance/acquisition-plan.md.");
    expect(deny.assertions).toEqual([
      { type: "source_absent", value: "finance/acquisition-plan.md", severity: "critical", caseSensitive: false },
      expect.objectContaining({ type: "not_contains", value: "CF_FINANCE_CANARY", severity: "critical" }),
    ]);
    expect(deny.remediation).toContain("effective identity");

    const allow = contract.probes[1];
    expect(allow).toMatchObject({ identity: "finance", category: "matrix-allow" });
    expect(allow.assertions).toEqual([
      { type: "source_present", value: "finance/acquisition-plan.md", severity: "medium", caseSensitive: false },
      expect.objectContaining({ type: "contains", value: "CF_FINANCE_CANARY", severity: "medium" }),
    ]);
  });

  it("suppresses positive controls when positiveControls is false", () => {
    const contract = validateBoundaryContract({
      version: 1,
      name: "deny-only",
      target: { adapter: "mock", responses: { "*": "ok" } },
      identities: { newsroom: { name: "Newsroom" }, finance: { name: "Finance" } },
      matrix: {
        prompt: "Summarise {label}.",
        positiveControls: false,
        sources: [{ key: "acq", id: "finance/plan.md", canary: "CF", allow: ["finance"] }],
      },
    });
    expect(contract.probes.map((probe) => probe.id)).toEqual(["matrix-acq-newsroom-deny"]);
  });

  it("denies every identity when a source has no allow list", () => {
    const contract = validateBoundaryContract({
      version: 1,
      name: "all-denied",
      target: { adapter: "mock", responses: { "*": "ok" } },
      identities: { a: { name: "A" }, b: { name: "B" } },
      matrix: {
        prompt: "Summarise {label}.",
        sources: [{ key: "s", id: "secret/s.md", canary: "CF" }],
      },
    });
    expect(contract.probes.map((probe) => probe.identity)).toEqual(["a", "b"]);
    expect(contract.probes.every((probe) => probe.category === "matrix-deny")).toBe(true);
  });

  it("appends matrix probes after explicit probes and records their YAML location", () => {
    const withExplicit = MATRIX_CONTRACT.replace(
      "matrix:",
      `probes:
  - id: manual
    identity: newsroom
    prompt: hello
    assertions:
      - type: not_contains
        value: CF_FINANCE_CANARY
matrix:`,
    );
    const loaded = parseBoundaryContract(withExplicit, { sourceName: "matrix.yaml" });
    expect(loaded.contract.probes.map((probe) => probe.id)).toEqual([
      "manual",
      "matrix-acq-newsroom-deny",
      "matrix-acq-finance-allow",
    ]);
    // The generated probe location points at its matrix source, not line 1.
    expect(loaded.probeLocations["matrix-acq-newsroom-deny"].line).toBeGreaterThan(10);
  });

  it("rejects an allow entry that references an undefined identity", () => {
    const source = MATRIX_CONTRACT.replace("- finance", "- ghost");
    expect(() => parseBoundaryContract(source)).toThrowError(BoundaryContractError);
    try {
      parseBoundaryContract(source);
    } catch (error) {
      const formatted = (error as BoundaryContractError).format();
      expect(formatted).toContain("$.matrix.sources[0].allow[0]");
      expect(formatted).toContain("UNKNOWN_IDENTITY");
    }
  });

  it("rejects a matrix without sources and a source missing its canary", () => {
    const expectFormat = (value: unknown, pattern: RegExp) => {
      try {
        validateBoundaryContract(value);
        throw new Error("Expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(BoundaryContractError);
        expect((error as BoundaryContractError).format()).toMatch(pattern);
      }
    };
    expectFormat(
      {
        version: 1,
        name: "empty",
        target: { adapter: "mock", responses: { "*": "ok" } },
        identities: { a: { name: "A" } },
        matrix: { prompt: "hi", sources: [] },
      },
      /at least one source/i,
    );
    expectFormat(
      {
        version: 1,
        name: "no-canary",
        target: { adapter: "mock", responses: { "*": "ok" } },
        identities: { a: { name: "A" } },
        matrix: { prompt: "hi", sources: [{ key: "s", id: "secret/s.md" }] },
      },
      /canary must be a non-empty string/i,
    );
  });

  it("rejects duplicate source keys", () => {
    try {
      validateBoundaryContract({
        version: 1,
        name: "dupe",
        target: { adapter: "mock", responses: { "*": "ok" } },
        identities: { a: { name: "A" } },
        matrix: {
          prompt: "hi",
          sources: [
            { key: "s", id: "one.md", canary: "CF1" },
            { key: "s", id: "two.md", canary: "CF2" },
          ],
        },
      });
      throw new Error("Expected duplicate keys to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryContractError);
      expect((error as BoundaryContractError).format()).toMatch(/duplicated/i);
    }
  });
});
