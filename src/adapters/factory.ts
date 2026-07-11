import type { BoundaryTarget } from "../contract/types";
import { createMockAdapter } from "./mock";
import { createOpenAICompatibleAdapter } from "./openai-compatible";
import type { AdapterFactoryOptions, BoundaryTargetAdapter } from "./types";

/** Resolve a validated target, applying the CLI URL override without mutating the contract. */
export function createTargetAdapter(
  target: BoundaryTarget,
  options: AdapterFactoryOptions = {},
): BoundaryTargetAdapter {
  if (target.adapter === "mock") return createMockAdapter(target);
  return createOpenAICompatibleAdapter(
    {
      ...target,
      ...(options.targetOverride ? { baseUrl: options.targetOverride } : {}),
    },
    { fetch: options.fetch },
  );
}

