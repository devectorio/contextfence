# ContextFence examples

Every company, identity, document, endpoint, and canary in this directory is synthetic. The examples are safe to copy, but a contract becomes sensitive as soon as it contains real endpoint names, identity headers, prompts, source identifiers, or report evidence.

## Start with the deterministic mock

The passing suite exercises response and source assertions without a network call:

```bash
contextfence test examples/contracts/mock.boundary.yaml
```

The cache-replay suite models a known violation and should exit with code `1` at the default severity threshold:

```bash
contextfence test examples/contracts/vulnerable-cache.boundary.yaml
```

Use `--dry-run` to validate and plan either contract without executing probes:

```bash
contextfence test examples/contracts/mock.boundary.yaml --dry-run
```

## Point at a real, authorized test target

Copy `contracts/openai-compatible.boundary.yaml`, then supply credentials through the environment:

```bash
export CONTEXTFENCE_TARGET_URL="https://rag-staging.example.test"
export CONTEXTFENCE_TARGET_API_KEY="replace-in-your-shell"
export CONTEXTFENCE_NEWSROOM_TOKEN="replace-in-your-shell"
export CONTEXTFENCE_FINANCE_TOKEN="replace-in-your-shell"

contextfence test examples/contracts/openai-compatible.boundary.yaml \
  --format html \
  --output contextfence-report.html
```

Only test systems and data you own or are explicitly authorized to assess. Start in staging, use test identities, make probes read-only, and review generated reports before sharing them. Report files can contain prompts, source IDs, response fragments, and other sensitive evidence.

## Seed documents

The files under `fixtures/` show the sort of conspicuous synthetic canaries that make unauthorized retrieval objectively detectable. They are documentation fixtures, not secrets and not automatically ingested by the CLI. Seed equivalent documents into a disposable test index only when you control the complete ingestion and deletion lifecycle.

The mock adapter is designed for contract development, reporter integration, and CI examples. It does not prove the behavior of a live RAG system.
