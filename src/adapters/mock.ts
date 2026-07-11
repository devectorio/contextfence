import { TargetAdapterError } from "../contract/errors";
import type { MockTarget } from "../contract/types";
import type {
  BoundaryTargetAdapter,
  ProbeTargetRequest,
  ProbeTargetResponse,
} from "./types";

function responseKey(request: ProbeTargetRequest): string {
  return request.phase === "setup"
    ? `${request.probeId}:setup:${request.setupIndex ?? 0}`
    : request.probeId;
}

function wait(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  if (delayMs === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** A deterministic in-memory adapter for examples, tests, and offline contract authoring. */
export function createMockAdapter(config: MockTarget): BoundaryTargetAdapter {
  return {
    kind: "mock",
    async execute(request: ProbeTargetRequest): Promise<ProbeTargetResponse> {
      const key = responseKey(request);
      const response = Object.hasOwn(config.responses, key)
        ? config.responses[key]
        : config.responses["*"];
      if (!response) {
        throw new TargetAdapterError(
          `Mock target has no response configured for ${key}.`,
          "MOCK_RESPONSE_MISSING",
        );
      }
      await wait(response.delayMs, request.signal);
      if (response.status < 200 || response.status >= 300) {
        throw new TargetAdapterError(
          `Target returned HTTP ${response.status}.`,
          "HTTP_ERROR",
          response.status,
        );
      }
      return {
        content: response.content,
        sources: [...response.sources],
        sourceMetadataAvailable: true,
        status: response.status,
      };
    },
  };
}
