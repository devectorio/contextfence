import {
  TargetAdapterError,
  TargetConfigurationError,
} from "../contract/errors";
import type { OpenAICompatibleTarget } from "../contract/types";
import { assertAllowedTargetUrl } from "../contract/url";
import type {
  BoundaryTargetAdapter,
  ProbeTargetRequest,
  ProbeTargetResponse,
} from "./types";

export interface OpenAICompatibleAdapterOptions {
  fetch?: typeof globalThis.fetch;
}

function endpointUrl(config: OpenAICompatibleTarget): string {
  if (!config.baseUrl) {
    throw new TargetConfigurationError(
      "OpenAI-compatible target requires target.baseUrl or the --target flag.",
    );
  }
  const base = assertAllowedTargetUrl(config.baseUrl);
  const endpoint = `${base.toString().replace(/\/+$/, "")}${config.path}`;
  assertAllowedTargetUrl(endpoint);
  return endpoint;
}

async function readLimitedBody(response: Response, limit: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body?.cancel();
    throw new TargetAdapterError(
      `Target response exceeded the configured ${limit}-byte limit.`,
      "RESPONSE_TOO_LARGE",
      response.status,
    );
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new TargetAdapterError(
        `Target response exceeded the configured ${limit}-byte limit.`,
        "RESPONSE_TOO_LARGE",
        response.status,
      );
    }
    result += decoder.decode(chunk.value, { stream: true });
  }
  return result + decoder.decode();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const parts = value
    .map((part) => {
      if (typeof part === "string") return part;
      const record = asRecord(part);
      return typeof record?.text === "string" ? record.text : "";
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join("") : undefined;
}

interface SourceCollector {
  values: string[];
  totalCharacters: number;
  visitedValues: number;
  overflowed: boolean;
  malformed: boolean;
}

function collectSourceValues(value: unknown, output: SourceCollector, depth = 0): void {
  if (value === undefined || value === null) return;
  if (output.overflowed) return;
  output.visitedValues += 1;
  if (
    depth > 16 ||
    output.visitedValues > 10_000 ||
    output.values.length >= 2_048 ||
    output.totalCharacters >= 262_144
  ) {
    output.overflowed = true;
    return;
  }
  if (typeof value === "string") {
    if (value.trim().length === 0) {
      output.malformed = true;
    } else if (value.length <= 8_192 && output.totalCharacters + value.length <= 262_144) {
      output.values.push(value);
      output.totalCharacters += value.length;
    } else {
      output.overflowed = true;
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSourceValues(item, output, depth + 1);
      if (output.overflowed) break;
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    output.malformed = true;
    return;
  }
  let recognized = false;
  for (const key of ["id", "source", "url", "title", "file_id", "filename"]) {
    if (!Object.hasOwn(record, key)) continue;
    if (typeof record[key] === "string") {
      recognized = true;
      collectSourceValues(record[key], output, depth + 1);
    } else if (record[key] !== null) {
      output.malformed = true;
    }
  }
  for (const key of ["url_citation", "file_citation"]) {
    if (!Object.hasOwn(record, key)) continue;
    recognized = true;
    collectSourceValues(record[key], output, depth + 1);
  }
  if (!recognized) output.malformed = true;
}

function parseResponse(body: string, status: number): ProbeTargetResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new TargetAdapterError(
      "Target returned a non-JSON response.",
      "INVALID_RESPONSE_JSON",
      status,
    );
  }
  const root = asRecord(parsed);
  const choices = root?.choices;
  const choice = Array.isArray(choices) ? asRecord(choices[0]) : undefined;
  const message = asRecord(choice?.message);
  const content = contentText(message?.content) ?? contentText(choice?.text);
  if (content === undefined) {
    throw new TargetAdapterError(
      "Target response did not include choices[0].message.content.",
      "INVALID_RESPONSE_SHAPE",
      status,
    );
  }

  const sources: SourceCollector = {
    values: [],
    totalCharacters: 0,
    visitedValues: 0,
    overflowed: false,
    malformed: false,
  };
  collectSourceValues(root?.sources, sources);
  collectSourceValues(root?.citations, sources);
  collectSourceValues(message?.sources, sources);
  collectSourceValues(message?.citations, sources);
  collectSourceValues(message?.annotations, sources);
  const rootContext = asRecord(root?.context);
  const messageContext = asRecord(message?.context);
  const sourceMetadataAvailable = Boolean(
    (root && (Object.hasOwn(root, "sources") || Object.hasOwn(root, "citations"))) ||
    (message && (
      Object.hasOwn(message, "sources") ||
      Object.hasOwn(message, "citations") ||
      Object.hasOwn(message, "annotations")
    )) ||
    (rootContext && Object.hasOwn(rootContext, "sources")) ||
    (messageContext && Object.hasOwn(messageContext, "sources"))
  );
  collectSourceValues(rootContext?.sources, sources);
  collectSourceValues(messageContext?.sources, sources);
  if (sources.overflowed) {
    throw new TargetAdapterError(
      "Target source metadata exceeded safe evidence limits.",
      "SOURCE_METADATA_TOO_LARGE",
      status,
    );
  }
  if (sources.malformed) {
    throw new TargetAdapterError(
      "Target returned malformed source metadata.",
      "INVALID_SOURCE_METADATA",
      status,
    );
  }
  return {
    content,
    sources: [...new Set(sources.values)],
    sourceMetadataAvailable,
    status,
  };
}

/** Execute probes against the conventional POST /chat/completions API shape. */
export function createOpenAICompatibleAdapter(
  config: OpenAICompatibleTarget,
  options: OpenAICompatibleAdapterOptions = {},
): BoundaryTargetAdapter {
  const url = endpointUrl(config);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new TargetConfigurationError("This runtime does not provide global fetch.");
  }

  return {
    kind: "openai-compatible",
    async execute(request: ProbeTargetRequest): Promise<ProbeTargetResponse> {
      if (request.signal.aborted) {
        throw new TargetAdapterError("Target request was aborted.", "REQUEST_ABORTED");
      }
      const headers = new Headers(config.headers);
      for (const [name, value] of Object.entries(request.identity.headers)) {
        headers.set(name, value);
      }
      headers.set("content-type", "application/json");
      headers.set("accept", "application/json");
      if (config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);

      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (config.systemPrompt) messages.push({ role: "system", content: config.systemPrompt });
      if (request.identity.systemPrompt) {
        messages.push({ role: "system", content: request.identity.systemPrompt });
      }
      messages.push({ role: "user", content: request.prompt });

      let response: Response;
      try {
        response = await fetchImplementation(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: config.model,
            messages,
            temperature: 0,
            stream: false,
          }),
          redirect: "error",
          signal: request.signal,
        });
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new TargetAdapterError("Target request failed.", "NETWORK_ERROR");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new TargetAdapterError(
          `Target returned HTTP ${response.status}.`,
          "HTTP_ERROR",
          response.status,
        );
      }
      const body = await readLimitedBody(response, config.responseLimitBytes);
      return parseResponse(body, response.status);
    },
  };
}
