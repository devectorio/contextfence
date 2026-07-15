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

## Expand an authorization matrix

Instead of hand-writing one probe per `(identity, forbidden source)` pair, declare the intended authorization model once and let ContextFence expand the full identity × source grid. The leak fixture returns one identity-blind response to every role, so the matrix flags every cell that should have been denied and exits `1`:

```bash
contextfence test examples/contracts/matrix-leak.boundary.yaml
```

`contracts/matrix.boundary.yaml` is the same construct pointed at an authorized OpenAI-compatible target. Plan the generated grid without a network call:

```bash
CONTEXTFENCE_TARGET_URL="https://rag-staging.example.test" \
CONTEXTFENCE_TARGET_API_KEY="synthetic" \
CONTEXTFENCE_NEWSROOM_TOKEN="synthetic" \
CONTEXTFENCE_FINANCE_TOKEN="synthetic" \
CONTEXTFENCE_LEGAL_TOKEN="synthetic" \
contextfence test examples/contracts/matrix.boundary.yaml --dry-run
```

Every identity outside a source's `allow` list becomes a critical deny probe (`source_absent` + `not_contains` the canary); every authorized identity becomes a medium positive control. Adding one identity or one source re-derives the entire grid.

## Generate a matrix from an access manifest

When the authorization model already exists elsewhere, describe it as a connector-neutral manifest and let ContextFence write the contract:

```bash
contextfence generate examples/manifests/northstar-access.yaml --output boundary.yaml
```

`manifests/northstar-access.yaml` lists identities and, per source, the identities allowed to retrieve it. Probe keys and canaries are derived deterministically when omitted, and target and identity credentials are emitted as environment placeholders. Review the generated contract, seed each canary into a disposable test index, then run it with `contextfence test`.

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
