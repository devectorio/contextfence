import { stableStringify } from "./internal";
import type { RunReport } from "./types";

/** Serialize the portable report schema as deterministic, pretty-printed JSON. */
export function toJson(report: RunReport): string {
  return `${stableStringify(report)}\n`;
}

