import { describe, expect, it } from "vitest";
import {
  defaultFaults,
  demoRemediations,
  demoSystem,
  safeFaults,
} from "../data/demo";
import type { FaultConfig } from "../domain/types";
import { compareRemediations } from "./analysis";
import {
  buildAccessMatrix,
  evaluateDocumentAccess,
  evaluateProbe,
  evaluateSuite,
} from "./engine";

const faults = (...enabled: (keyof FaultConfig)[]): FaultConfig => ({
  ...safeFaults,
  ...Object.fromEntries(enabled.map((fault) => [fault, true])),
});

describe("ContextFence fixture integrity", () => {
  it("has resolvable identities, documents, policies, chunks, and canaries", () => {
    const identityIds = new Set(demoSystem.identities.map((identity) => identity.id));
    const documentIds = new Set(demoSystem.documents.map((document) => document.id));
    const sourceIds = new Set(demoSystem.sources.map((source) => source.id));
    const canaryIds = new Set(demoSystem.canaries.map((canary) => canary.id));

    expect(demoSystem.roles).toHaveLength(4);
    expect(demoSystem.sources).toHaveLength(5);
    expect(demoSystem.probes.length).toBeGreaterThanOrEqual(8);
    for (const probe of demoSystem.probes) expect(identityIds.has(probe.identityId)).toBe(true);
    for (const document of demoSystem.documents) expect(sourceIds.has(document.sourceId)).toBe(true);
    for (const chunk of demoSystem.chunks) {
      expect(sourceIds.has(chunk.sourceId)).toBe(true);
      expect(documentIds.has(chunk.primaryDocumentId)).toBe(true);
      for (const segment of chunk.segments) {
        expect(documentIds.has(segment.documentId)).toBe(true);
        for (const canaryId of segment.canaryIds) expect(canaryIds.has(canaryId)).toBe(true);
      }
    }
  });
});

describe("policy evaluation and matrix", () => {
  it("uses current policy by default and demonstrates the stale ACL snapshot", () => {
    const maya = demoSystem.identities.find((identity) => identity.id === "maya-chen")!;
    expect(
      evaluateDocumentAccess(demoSystem, maya, "doc-source-protection", "current").allowed,
    ).toBe(false);
    expect(
      evaluateDocumentAccess(demoSystem, maya, "doc-source-protection", "indexed").allowed,
    ).toBe(true);
  });

  it("builds full, partial, and denied role/source cells", () => {
    const matrix = buildAccessMatrix(demoSystem);
    const cell = (roleId: string, sourceId: string) =>
      matrix.cells.find((candidate) => candidate.roleId === roleId && candidate.sourceId === sourceId);

    expect(cell("newsroom", "company-wiki")?.access).toBe("full");
    expect(cell("newsroom", "editorial-hub")?.access).toBe("partial");
    expect(cell("newsroom", "finance-vault")?.access).toBe("none");
    expect(cell("executive", "finance-vault")?.access).toBe("partial");
    expect(cell("legal", "legal-matters")?.access).toBe("full");
  });
});

describe("probe engine", () => {
  it("passes every contract when all four controls are sound", () => {
    const suite = evaluateSuite(demoSystem, safeFaults);
    expect(suite.violationCount).toBe(0);
    expect(suite.passCount).toBe(demoSystem.probes.length);
    expect(suite.boundaryViolationRate).toBe(0);
    expect(suite.risk).toMatchObject({ score: 0, severity: "none" });
  });

  it("finds critical evidence in the intentionally faulty demo", () => {
    const suite = evaluateSuite(demoSystem, defaultFaults);
    expect(suite.violationCount).toBeGreaterThan(0);
    expect(suite.boundaryViolationRate).toBeGreaterThan(0);
    expect(suite.risk.severity).toBe("critical");
    expect(
      suite.probes.some((probe) =>
        probe.evidence.some((evidence) => evidence.kind === "canary"),
      ),
    ).toBe(true);
  });

  it("reproduces an identity-blind semantic cache leak", () => {
    const probe = demoSystem.probes.find((item) => item.id === "probe-cache-isolation")!;
    const result = evaluateProbe(demoSystem, probe, faults("identity-blind-cache"));
    expect(result.status).toBe("failed");
    expect(result.contextChunks.flatMap((chunk) => chunk.canaryIds)).toContain("canary-cedar");
    expect(result.trace.find((step) => step.stage === "cache")?.status).toBe("fail");
  });

  it("shows why citation filtering after prompt assembly is too late", () => {
    const probe = demoSystem.probes.find((item) => item.id === "probe-legal-isolation")!;
    const result = evaluateProbe(demoSystem, probe, faults("post-retrieval-filter"));
    expect(result.status).toBe("failed");
    expect(result.contextChunks.some((chunk) => chunk.sourceId === "legal-matters")).toBe(true);
    expect(result.visibleSourceIds).not.toContain("legal-matters");
    expect(result.trace.find((step) => step.stage === "post-filter")?.status).toBe("warn");
  });

  it("catches a revocation that has not reached the vector index", () => {
    const probe = demoSystem.probes.find((item) => item.id === "probe-acl-revocation")!;
    const result = evaluateProbe(demoSystem, probe, faults("acl-sync-delay"));
    expect(result.status).toBe("failed");
    expect(result.contextChunks.flatMap((chunk) => chunk.canaryIds)).toContain("canary-source");
    expect(result.trace.find((step) => step.stage === "policy")?.status).toBe("warn");
  });

  it("detects sensitive text hitchhiking in a shared vector chunk", () => {
    const probe = demoSystem.probes.find((item) => item.id === "probe-chunk-boundary")!;
    const result = evaluateProbe(demoSystem, probe, faults("cross-boundary-chunks"));
    const boundaryChunk = result.contextChunks.find(
      (chunk) => chunk.chunkId === "chunk-boundary-vendor-aurora",
    );
    expect(result.status).toBe("failed");
    expect(boundaryChunk?.documentIds).toEqual(["doc-vendor-checklist", "doc-aurora"]);
    expect(boundaryChunk?.authorized).toBe(false);
  });

  it("is deterministic down to traces and synthetic durations", () => {
    expect(evaluateSuite(demoSystem, defaultFaults)).toEqual(
      evaluateSuite(demoSystem, defaultFaults),
    );
  });
});

describe("remediation evidence", () => {
  it("projects each remediation by rerunning the same contracts", () => {
    const comparisons = compareRemediations(
      demoSystem,
      defaultFaults,
      demoRemediations,
    );
    const defenseInDepth = comparisons.find(
      (comparison) => comparison.remediation.id === "remediation-defense-in-depth",
    );
    expect(defenseInDepth?.projectedViolationCount).toBe(0);
    expect(defenseInDepth?.projectedRisk.score).toBe(0);
    expect(defenseInDepth?.residualFaults).toEqual([]);
    expect(comparisons[0].remediation.id).toBe("remediation-defense-in-depth");
  });
});
