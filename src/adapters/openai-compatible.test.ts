import { describe, expect, it, vi } from "vitest";
import { TargetAdapterError, TargetConfigurationError } from "../contract/errors";
import type { OpenAICompatibleTarget } from "../contract/types";
import { createOpenAICompatibleAdapter } from "./openai-compatible";

const config = (overrides: Partial<OpenAICompatibleTarget> = {}): OpenAICompatibleTarget => ({
  adapter: "openai-compatible",
  baseUrl: "https://rag.example.test/v1",
  path: "/chat/completions",
  model: "secure-rag",
  apiKey: "sk-test",
  headers: { "X-Environment": "test" },
  responseLimitBytes: 8_192,
  ...overrides,
});

const request = (signal = new AbortController().signal) => ({
  probeId: "probe-a",
  phase: "probe" as const,
  identityId: "guest",
  identity: {
    name: "Guest",
    headers: { "X-Principal": "guest" },
    systemPrompt: "Act as the guest principal.",
  },
  prompt: "What can I see?",
  signal,
});

describe("OpenAI-compatible adapter", () => {
  it("sends deterministic chat parameters and extracts content and source identifiers", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "secure-rag", temperature: 0, stream: false });
      expect(body.messages).toEqual([
        { role: "system", content: "Act as the guest principal." },
        { role: "user", content: "What can I see?" },
      ]);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer sk-test");
      expect(headers.get("x-principal")).toBe("guest");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ type: "text", text: "Only public context." }],
                citations: [{ id: "public-wiki", url: "https://docs.example/public" }],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const adapter = createOpenAICompatibleAdapter(config(), {
      fetch: fetchMock as typeof fetch,
    });
    await expect(adapter.execute(request())).resolves.toEqual({
      content: "Only public context.",
      sources: ["public-wiki", "https://docs.example/public"],
      sourceMetadataAvailable: true,
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rag.example.test/v1/chat/completions",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
  });

  it("does not include a non-2xx response body in its error", async () => {
    const secretBody = "server echoed sk-user-secret";
    const adapter = createOpenAICompatibleAdapter(config(), {
      fetch: vi.fn(async () => new Response(secretBody, { status: 401, statusText: "Unauthorized" })) as typeof fetch,
    });
    try {
      await adapter.execute(request());
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TargetAdapterError);
      expect((error as Error).message).toBe("Target returned HTTP 401.");
      expect((error as Error).message).not.toContain(secretBody);
    }
  });

  it("caps response bodies before JSON parsing", async () => {
    const adapter = createOpenAICompatibleAdapter(config({ responseLimitBytes: 8 }), {
      fetch: vi.fn(async () => new Response("123456789", { status: 200 })) as typeof fetch,
    });
    await expect(adapter.execute(request())).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("fails closed when citation metadata exceeds evidence limits", async () => {
    const adapter = createOpenAICompatibleAdapter(config({ responseLimitBytes: 20_000 }), {
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer", citations: ["x".repeat(8_193)] } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });
    await expect(adapter.execute(request())).rejects.toMatchObject({
      code: "SOURCE_METADATA_TOO_LARGE",
    });
  });

  it("fails closed when a declared citation field has an unsupported shape", async () => {
    const adapter = createOpenAICompatibleAdapter(config(), {
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "answer", citations: [false] } }],
          }),
          { status: 200 },
        )) as typeof fetch,
    });
    await expect(adapter.execute(request())).rejects.toMatchObject({
      code: "INVALID_SOURCE_METADATA",
    });
  });

  it("rejects credentials in URLs and non-local plaintext HTTP", () => {
    expect(() =>
      createOpenAICompatibleAdapter(config({ baseUrl: "https://user:pass@example.test/v1" })),
    ).toThrowError(TargetConfigurationError);
    expect(() =>
      createOpenAICompatibleAdapter(config({ baseUrl: "http://example.test/v1" })),
    ).toThrowError(/HTTPS/);
  });
});
