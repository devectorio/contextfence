import { describe, expect, it } from "vitest";
import { BoundaryContractError } from "./errors";
import { generateBoundaryContract } from "./generate";
import { parseBoundaryContract } from "./parser";

const MANIFEST = `
version: 1
name: northstar
identities:
  - id: newsroom-editor
    name: Newsroom editor
  - id: finance-analyst
    name: Finance analyst
sources:
  - id: finance/acquisition-plan.md
    key: finance-acquisition
    label: the acquisition plan
    canary: CF_FINANCE_CANARY
    allow:
      - finance-analyst
`;

describe("access manifest generator", () => {
  it("emits a matrix contract that round-trips through the real validator", () => {
    const yaml = generateBoundaryContract(MANIFEST, { adapter: "openai-compatible" });
    expect(yaml).toContain("matrix:");
    expect(yaml).toContain("X-Identity-Token: ${CONTEXTFENCE_FINANCE_ANALYST_TOKEN}");

    const loaded = parseBoundaryContract(yaml, {
      sourceName: "generated.yaml",
      env: {
        CONTEXTFENCE_TARGET_URL: "https://rag.example.test",
        CONTEXTFENCE_TARGET_API_KEY: "synthetic",
        CONTEXTFENCE_NEWSROOM_EDITOR_TOKEN: "synthetic-newsroom",
        CONTEXTFENCE_FINANCE_ANALYST_TOKEN: "synthetic-finance",
      },
    });
    // Two identities x one source -> one deny probe + one positive control.
    expect(loaded.contract.probes.map((probe) => probe.id)).toEqual([
      "matrix-finance-acquisition-newsroom-editor-deny",
      "matrix-finance-acquisition-finance-analyst-allow",
    ]);
  });

  it("derives keys and canaries from the source id when omitted", () => {
    const yaml = generateBoundaryContract(
      `identities:\n  - id: guest\nsources:\n  - id: "HR/Salaries 2026.pdf"\n`,
      { adapter: "mock" },
    );
    expect(yaml).toContain("key: hr-salaries-2026-pdf");
    expect(yaml).toContain("canary: CF_HR_SALARIES_2026_PDF");
    // A mock contract with a * fallback is fully self-validating offline.
    const loaded = parseBoundaryContract(yaml);
    expect(loaded.contract.probes).toHaveLength(1);
    expect(loaded.contract.probes[0].category).toBe("matrix-deny");
  });

  it("rejects an allow entry that references an undefined identity", () => {
    const manifest = MANIFEST.replace("- finance-analyst", "- ghost");
    try {
      generateBoundaryContract(manifest, {}, "manifest.yaml");
      throw new Error("Expected generation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryContractError);
      const formatted = (error as BoundaryContractError).format();
      expect(formatted).toContain("$.sources[0].allow[0]");
      expect(formatted).toContain("UNKNOWN_IDENTITY");
    }
  });

  it("rejects manifests without identities or sources", () => {
    for (const broken of ["sources:\n  - id: s\n", "identities:\n  - id: a\n"]) {
      expect(() => generateBoundaryContract(broken)).toThrowError(BoundaryContractError);
    }
  });

  it("rejects unknown manifest fields and invalid identity ids", () => {
    const formatted = (() => {
      try {
        generateBoundaryContract("identities:\n  - id: 'not valid'\nsources:\n  - id: s\nextra: nope\n");
        return "";
      } catch (error) {
        return (error as BoundaryContractError).format();
      }
    })();
    expect(formatted).toContain("UNKNOWN_FIELD");
    expect(formatted).toContain("INVALID_IDENTIFIER");
  });
});
