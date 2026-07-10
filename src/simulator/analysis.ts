import type {
  FaultConfig,
  RagSystem,
  Remediation,
  RemediationComparison,
} from "../domain/types";
import { evaluateSuite } from "./engine";

/**
 * Re-run the exact same contracts with each proposed control applied. This makes
 * remediation claims falsifiable: every projected improvement is backed by a
 * second deterministic suite execution.
 */
export function compareRemediations(
  system: RagSystem,
  currentFaults: FaultConfig,
  remediations: Remediation[],
): RemediationComparison[] {
  const baseline = evaluateSuite(system, currentFaults);

  return remediations
    .map((remediation) => {
      const projectedFaults: FaultConfig = { ...currentFaults };
      for (const fault of remediation.fixes) projectedFaults[fault] = false;
      const projected = evaluateSuite(system, projectedFaults);
      return {
        remediation,
        projectedRisk: projected.risk,
        projectedViolationCount: projected.violationCount,
        projectedBoundaryViolationRate: projected.boundaryViolationRate,
        violationsPrevented: Math.max(
          0,
          baseline.violationCount - projected.violationCount,
        ),
        riskReduction: Math.max(0, baseline.risk.score - projected.risk.score),
        residualFaults: projected.enabledFaults,
      };
    })
    .sort(
      (left, right) =>
        left.projectedRisk.score - right.projectedRisk.score ||
        right.violationsPrevented - left.violationsPrevented ||
        left.remediation.latencyImpactMs - right.remediation.latencyImpactMs,
    );
}
