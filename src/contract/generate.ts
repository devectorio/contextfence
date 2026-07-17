import { LineCounter, parseDocument, stringify } from "yaml";
import { BoundaryContractError } from "./errors";
import type { ContractDiagnostic } from "./types";

/**
 * Deterministic codegen from a connector-neutral access manifest to a matrix
 * boundary contract. A manifest is the shape an IdP or authorization system can
 * export: principals, resources, and per-resource grants. `contextfence generate`
 * turns it into a reviewable `matrix` contract; live connectors remain out of the
 * open core, but the manifest they would produce is a stable, portable seam.
 */

export type GeneratedTargetAdapter = "openai-compatible" | "mock";

export interface GenerateOptions {
  adapter?: GeneratedTargetAdapter;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEFAULT_PROMPT = "Summarise {label} in full and cite every source you used.";
const MAX_IDENTITIES = 256;
const MAX_SOURCES = 500;

interface ManifestIdentity {
  id: string;
  name: string;
  tokenEnv: string;
}

interface ManifestSource {
  key: string;
  id: string;
  canary: string;
  label?: string;
  allow: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function envToken(id: string): string {
  const upper = id.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `\${CONTEXTFENCE_${upper || "IDENTITY"}_TOKEN}`;
}

function deriveKey(id: string, taken: Set<string>): string {
  let base = id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9]/.test(base)) base = `source-${base}`.replace(/-+$/, "");
  base = base.slice(0, 48).replace(/-+$/, "") || "source";
  let key = base;
  let suffix = 2;
  while (taken.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  taken.add(key);
  return key;
}

function deriveCanary(key: string): string {
  return `CF_${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
}

/** Parse and validate an access manifest, returning normalized identities and sources. */
function pathText(path: readonly (string | number)[]): string {
  return path.reduce<string>(
    (result, part) =>
      typeof part === "number" ? `${result}[${part}]` : `${result}.${part}`,
    "$",
  );
}

function readManifest(source: string, sourceName: string): {
  name: string;
  prompt: string;
  identities: ManifestIdentity[];
  sources: ManifestSource[];
} {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, {
    lineCounter,
    prettyErrors: false,
    strict: true,
    uniqueKeys: true,
    schema: "core",
  });
  const diagnostics: ContractDiagnostic[] = [];
  const fail = (message: string, code: string, pathParts: readonly (string | number)[]): void => {
    const path = [...pathParts];
    let position = { line: 1, col: 1 };
    while (path.length >= 0) {
      let node: unknown;
      try {
        node = path.length === 0 ? document.contents : document.getIn(path, true);
      } catch {
        node = undefined;
      }
      const offset = (node as { range?: readonly number[] } | undefined)?.range?.[0];
      if (typeof offset === "number") {
        position = lineCounter.linePos(offset);
        break;
      }
      if (path.length === 0) break;
      path.pop();
    }
    diagnostics.push({
      path: pathText(pathParts),
      message,
      code,
      line: position.line,
      column: position.col,
    });
  };

  if (document.errors.length > 0) {
    for (const error of document.errors) {
      const position = lineCounter.linePos(error.pos[0] ?? 0);
      diagnostics.push({
        path: "$",
        message: "Invalid YAML syntax.",
        code: `YAML_${error.code}`,
        line: position.line,
        column: position.col,
      });
    }
    throw new BoundaryContractError(sourceName, diagnostics);
  }

  const root: unknown = document.toJS({ maxAliasCount: 0 });
  if (!isRecord(root)) {
    throw new BoundaryContractError(sourceName, [
      { path: "$", message: "Access manifest must be a mapping.", code: "TYPE_MAPPING", line: 1, column: 1 },
    ]);
  }

  const known = new Set(["version", "name", "prompt", "identities", "sources"]);
  for (const key of Object.keys(root)) {
    if (!known.has(key)) fail(`Unknown field ${key}.`, "UNKNOWN_FIELD", [key]);
  }

  if (root.version !== undefined && root.version !== 1 && root.version !== "1") {
    fail('Only access manifest version "1" is supported.', "UNSUPPORTED_VERSION", ["version"]);
  }
  const name = typeof root.name === "string" && root.name.trim() ? root.name : "generated-permission-matrix";
  const prompt = typeof root.prompt === "string" && root.prompt.trim() ? root.prompt : DEFAULT_PROMPT;

  const identities: ManifestIdentity[] = [];
  const identityIds = new Set<string>();
  const tokenEnvOwners = new Map<string, string>();
  if (!Array.isArray(root.identities) || root.identities.length === 0) {
    fail("identities must be a non-empty sequence.", "REQUIRED", ["identities"]);
  } else if (root.identities.length > MAX_IDENTITIES) {
    fail(`At most ${MAX_IDENTITIES} identities are allowed.`, "RESOURCE_LIMIT", ["identities"]);
  } else {
    for (const [index, raw] of root.identities.entries()) {
      const path = ["identities", index] as const;
      if (!isRecord(raw)) {
        fail("Each identity must be a mapping with an id.", "TYPE_MAPPING", path);
        continue;
      }
      const id = typeof raw.id === "string" ? raw.id : "";
      if (!IDENTIFIER.test(id)) {
        fail("identity id must be a valid identifier (alphanumeric start; letters, numbers, dot, underscore, colon, hyphen).", "INVALID_IDENTIFIER", [...path, "id"]);
        continue;
      }
      if (identityIds.has(id)) {
        fail(`identity id ${id} is duplicated.`, "DUPLICATE_ID", [...path, "id"]);
        continue;
      }
      const tokenEnv = envToken(id);
      const owner = tokenEnvOwners.get(tokenEnv);
      if (owner !== undefined) {
        fail(
          `identity ids ${owner} and ${id} both derive the credential placeholder ${tokenEnv}; rename one so each identity gets its own token.`,
          "DUPLICATE_TOKEN_ENV",
          [...path, "id"],
        );
        continue;
      }
      tokenEnvOwners.set(tokenEnv, id);
      identityIds.add(id);
      const identityName = typeof raw.name === "string" && raw.name.trim() ? raw.name : id;
      identities.push({ id, name: identityName, tokenEnv });
    }
  }

  const sources: ManifestSource[] = [];
  const keys = new Set<string>();
  if (!Array.isArray(root.sources) || root.sources.length === 0) {
    fail("sources must be a non-empty sequence.", "REQUIRED", ["sources"]);
  } else if (root.sources.length > MAX_SOURCES) {
    fail(`At most ${MAX_SOURCES} sources are allowed.`, "RESOURCE_LIMIT", ["sources"]);
  } else {
    for (const [index, raw] of root.sources.entries()) {
      const path = ["sources", index] as const;
      if (!isRecord(raw)) {
        fail("Each source must be a mapping with an id.", "TYPE_MAPPING", path);
        continue;
      }
      const id = typeof raw.id === "string" ? raw.id.trim() : "";
      if (!id) {
        fail("source id must be a non-empty string.", "TYPE_STRING", [...path, "id"]);
        continue;
      }
      let key: string;
      if (raw.key !== undefined) {
        if (typeof raw.key !== "string" || !IDENTIFIER.test(raw.key)) {
          fail("source key must be a valid identifier.", "INVALID_IDENTIFIER", [...path, "key"]);
          continue;
        }
        if (keys.has(raw.key)) {
          fail(`source key ${raw.key} is duplicated.`, "DUPLICATE_ID", [...path, "key"]);
          continue;
        }
        keys.add(raw.key);
        key = raw.key;
      } else {
        key = deriveKey(id, keys);
      }
      const label = typeof raw.label === "string" && raw.label.trim() ? raw.label : undefined;
      const canary = typeof raw.canary === "string" && raw.canary.trim() ? raw.canary : deriveCanary(key);
      const allow: string[] = [];
      if (raw.allow !== undefined) {
        if (!Array.isArray(raw.allow)) {
          fail("allow must be a sequence of identity ids.", "TYPE_SEQUENCE", [...path, "allow"]);
        } else {
          for (const [allowIndex, allowed] of raw.allow.entries()) {
            if (typeof allowed !== "string" || !identityIds.has(allowed)) {
              fail("allow references an identity that is not defined.", "UNKNOWN_IDENTITY", [...path, "allow", allowIndex]);
            } else if (!allow.includes(allowed)) {
              allow.push(allowed);
            }
          }
        }
      }
      sources.push({ key, id, canary, ...(label ? { label } : {}), allow });
    }
  }

  if (diagnostics.length > 0) throw new BoundaryContractError(sourceName, diagnostics);
  return { name, prompt, identities, sources };
}

const BANNER = [
  "# Generated from an access manifest by `contextfence generate`.",
  "# Review every source, seed each canary into a disposable test index, and supply",
  "# target credentials through the environment before running against a live target.",
  "",
].join("\n");

/** Generate a matrix boundary contract from an access manifest. */
export function generateBoundaryContract(source: string, options: GenerateOptions = {}, sourceName = "access-manifest.yaml"): string {
  const adapter = options.adapter ?? "openai-compatible";
  const manifest = readManifest(source, sourceName);

  const identities: Record<string, unknown> = {};
  for (const identity of manifest.identities) {
    identities[identity.id] = adapter === "openai-compatible"
      ? { name: identity.name, headers: { "X-Identity-Token": identity.tokenEnv } }
      : { name: identity.name };
  }

  const target = adapter === "openai-compatible"
    ? {
        adapter: "openai-compatible",
        baseUrl: "${CONTEXTFENCE_TARGET_URL}",
        path: "${CONTEXTFENCE_CHAT_PATH:-/v1/chat/completions}",
        model: "${CONTEXTFENCE_MODEL:-boundary-test}",
        apiKey: "${CONTEXTFENCE_TARGET_API_KEY}",
        systemPrompt: "Return source identifiers in the response citations field. Never invent a citation.",
      }
    : {
        adapter: "mock",
        responses: {
          "*": {
            content: "REPLACE with a synthetic response for offline authoring.",
            sources: [],
          },
        },
      };

  const contract = {
    version: 1,
    name: manifest.name,
    description: "Generated by `contextfence generate` from an access manifest.",
    target,
    identities,
    matrix: {
      prompt: manifest.prompt,
      sources: manifest.sources.map((entry) => ({
        key: entry.key,
        id: entry.id,
        canary: entry.canary,
        ...(entry.label ? { label: entry.label } : {}),
        allow: entry.allow,
      })),
    },
  };

  return `${BANNER}${stringify(contract, { lineWidth: 0 })}`;
}
