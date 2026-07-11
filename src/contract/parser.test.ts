import { describe, expect, it } from "vitest";
import { BoundaryContractError } from "./errors";
import { parseBoundaryContract } from "./parser";
import { validateBoundaryContract } from "./schema";

const OPENAI_CONTRACT = `
version: 1
name: Production boundary
target:
  adapter: openai-compatible
  baseUrl: \${TARGET_URL}
  model: secure-rag
  apiKey: \${API_TOKEN}
identities:
  guest:
    name: Guest user
    headers:
      X-Principal: guest
probes:
  - id: finance-isolation
    identity: guest
    prompt: Summarise the finance plan
    assertions:
      - type: not_contains
        value: \${FINANCE_CANARY:-CF_DEFAULT_CANARY}
      - type: source_absent
        value: finance-vault
        severity: high
`;

describe("boundary contract parser", () => {
  it("parses YAML, expands environment values, and records probe locations", () => {
    const loaded = parseBoundaryContract(OPENAI_CONTRACT, {
      sourceName: "example.boundary.yaml",
      env: {
        TARGET_URL: "https://rag.example.test/v1",
        API_TOKEN: "sk-private-value",
      },
    });
    expect(loaded.contract).toMatchObject({
      version: "1",
      name: "Production boundary",
      target: {
        adapter: "openai-compatible",
        baseUrl: "https://rag.example.test/v1",
        path: "/chat/completions",
        responseLimitBytes: 1_048_576,
      },
    });
    expect(loaded.contract.probes[0].assertions[0]).toMatchObject({
      severity: "critical",
      caseSensitive: false,
      value: "CF_DEFAULT_CANARY",
    });
    expect(loaded.probeLocations["finance-isolation"].line).toBeGreaterThan(10);
    expect(loaded.redact("Bearer sk-private-value")).toBe("Bearer [REDACTED]");
  });

  it("reports missing environment variables at their YAML path without values", () => {
    expect.assertions(4);
    try {
      parseBoundaryContract(OPENAI_CONTRACT, {
        sourceName: "boundary.yaml",
        env: { TARGET_URL: "https://rag.example.test/v1" },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryContractError);
      const contractError = error as BoundaryContractError;
      expect(contractError.format()).toContain("$.target.apiKey");
      expect(contractError.format()).toContain("API_TOKEN");
      expect(contractError.format()).not.toContain("FINANCE_CANARY");
    }
  });

  it("does not mistake interpolation output containing ${ for malformed template syntax", () => {
    const loaded = parseBoundaryContract(OPENAI_CONTRACT, {
      env: {
        TARGET_URL: "https://rag.example.test/v1",
        API_TOKEN: "secret${literal-fragment",
      },
    });
    expect(loaded.contract.target).toMatchObject({ apiKey: "secret${literal-fragment" });
    expect(loaded.redact("secret${literal-fragment")).toBe("[REDACTED]");
  });

  it("rejects nested environment references instead of sending a placeholder", () => {
    const nested = OPENAI_CONTRACT.replace("${API_TOKEN}", "${API_TOKEN:-${FALLBACK_TOKEN}}");
    try {
      parseBoundaryContract(nested, {
        env: { TARGET_URL: "https://rag.example.test/v1" },
      });
      throw new Error("Expected nested interpolation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryContractError);
      const formatted = (error as BoundaryContractError).format();
      expect(formatted).toContain("$.target.apiKey");
      expect(formatted).toContain("ENV_INVALID_REFERENCE");
      expect(formatted).not.toContain("FALLBACK_TOKEN}");
    }
  });

  it("never repeats literal values in malformed YAML diagnostics", () => {
    const secret = "sk-must-never-appear";
    const source = `target:\n  apiKey: ${secret}\n  headers: [\n`;
    expect(() => parseBoundaryContract(source)).toThrowError(BoundaryContractError);
    try {
      parseBoundaryContract(source);
    } catch (error) {
      expect((error as BoundaryContractError).format()).not.toContain(secret);
      expect((error as BoundaryContractError).format()).toMatch(/boundary\.yaml:\d+:\d+/);
    }
  });

  it("rejects schema typos, unknown identities, and invalid regex with line-aware paths", () => {
    const source = `
version: 1
name: Broken
target:
  adapter: mock
  responses:
    "*": ok
identities:
  guest: {}
probes:
  - id: typo
    identity: missing
    prompt: hello
    assertion:
      - type: matches
        value: "["
`;
    try {
      parseBoundaryContract(source);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryContractError);
      const formatted = (error as BoundaryContractError).format();
      expect(formatted).toContain("$.probes[0].assertion: Unknown field assertion");
      expect(formatted).toContain("$.probes[0].identity: Referenced identity is not defined");
      expect(formatted).toContain("$.probes[0].assertions: assertions must be a sequence");
    }
  });

  it("accepts JSON-compatible YAML and rejects insecure remote HTTP targets", () => {
    const value = {
      version: "1",
      name: "JSON contract",
      target: {
        adapter: "openai-compatible",
        baseUrl: "http://rag.example.test/v1",
        model: "rag",
      },
      identities: { guest: {} },
      probes: [
        {
          id: "probe",
          identity: "guest",
          prompt: "hello",
          assertions: [{ type: "not_contains", value: "canary" }],
        },
      ],
    };
    try {
      validateBoundaryContract(value);
      throw new Error("Expected insecure URL validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(BoundaryContractError);
      expect((error as BoundaryContractError).format()).toContain("HTTPS");
    }
    value.target.baseUrl = "http://127.0.0.1:8080/v1";
    expect(validateBoundaryContract(JSON.parse(JSON.stringify(value))).target).toMatchObject({
      adapter: "openai-compatible",
      baseUrl: "http://127.0.0.1:8080/v1",
    });
  });

  it("rejects backtracking regex constructs and non-ByteString header values", () => {
    const unsafe = OPENAI_CONTRACT
      .replace("value: ${FINANCE_CANARY:-CF_DEFAULT_CANARY}", 'value: "(a+)+$"')
      .replace("type: not_contains", "type: matches")
      .replace("X-Principal: guest", 'X-Principal: "guest💩"');
    try {
      parseBoundaryContract(unsafe, {
        env: {
          TARGET_URL: "https://rag.example.test/v1",
          API_TOKEN: "token",
        },
      });
      throw new Error("Expected validation failure");
    } catch (error) {
      const formatted = (error as BoundaryContractError).format();
      expect(formatted).toContain("UNSAFE_REGEX");
      expect(formatted).toContain("INVALID_HEADER");
    }
  });
});
