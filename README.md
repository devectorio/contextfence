# ContextFence

> **Playwright for RAG permissions.**

ContextFence is an open-source regression harness for proving that people, teams, and tenants retrieve only the context they are allowed to see.

Write an identity boundary as YAML, run it against an OpenAI-compatible RAG endpoint, and fail CI when a response or citation crosses the line. ContextFence uses deterministic assertions over observable content and source IDs; it does not ask one model to judge another model's safety.

[Try the synthetic regression lab](https://devectorio.github.io/contextfence/) · [Read the Action guide](docs/github-action.md) · [Explore the architecture](docs/architecture.md)

![ContextFence — prove restricted context stays restricted](public/og.svg)

> [!WARNING]
> Run live suites only against systems and data you own or are explicitly authorized to test. Contracts, prompts, source IDs, and generated reports can be sensitive. Use short-lived test identities, keep credentials in environment variables, start in staging, restrict runner egress, and never expose live secrets to pull-request-controlled code.

## Why this exists

A final answer can look correctly redacted after the system has already crossed an authorization boundary.

- A shared cache can replay Finance evidence to a Newsroom user.
- A moved document can retain stale ACLs in the vector index.
- Retrieval can fetch a restricted chunk and filter it only after prompting.
- A citation can expose a confidential title or source ID without quoting its text.
- One chunk can join public material to a protected security region.

These failures span identity, ingestion, retrieval, ranking, caching, citations, and generation. Unit-testing any single layer is not enough. ContextFence makes the end-to-end boundary reviewable, repeatable, and portable across CI, scheduled staging checks, and incident reproduction.

## What ships in v0.1.0

| Capability | Status |
| --- | --- |
| Versioned `boundary.yaml` schema and field-level diagnostics | Shipped |
| `${ENV}` and `${ENV:-fallback}` interpolation with known-secret redaction | Shipped |
| Deterministic content, regex, and source assertions | Shipped |
| Stateful setup steps for cache and target-state reproductions | Shipped |
| Mock target for offline contract and reporter testing | Shipped |
| OpenAI-compatible black-box target adapter | Shipped |
| Pretty, JSON, JUnit, SARIF, and portable HTML reports | Shipped |
| Severity thresholds, bounded concurrency, aggregate probe timeouts, and explicit exit codes | Shipped |
| Reusable, exact-version GitHub Action | Shipped |
| Interactive vulnerable/remediated browser lab | Shipped |
| Non-root production container and GitHub Pages deployment | Shipped |
| Framework-specific evidence adapters and connector fixtures | Roadmap |
| Hosted scheduling, history, alerts, and private control plane | Commercial direction |

ContextFence is an early release. The v1 contract is versioned, but backward-compatibility guarantees will firm up before `1.0.0`.

## Quick start

Requirements: Node.js 22.14 or newer.

> [!NOTE]
> The first public npm release is being bootstrapped. Until `contextfence@0.1.0` is published, run the release-ready source directly as shown below. The [release runbook](docs/releasing.md) records the one-time npm setup.

Clone the repository, build the local CLI, then run the network-free passing suite:

```bash
git clone https://github.com/devectorio/contextfence.git
cd contextfence
corepack enable
corepack prepare pnpm@11.0.8 --activate
pnpm install --frozen-lockfile
pnpm build:package
node dist/package/cli.js test examples/contracts/mock.boundary.yaml
```

Inside the clone, the intentionally vulnerable cache-replay example shows a real failing report:

```bash
node dist/package/cli.js test examples/contracts/vulnerable-cache.boundary.yaml
# exits 1 after reporting critical boundary violations
```

Validate a contract without contacting its target:

```bash
node dist/package/cli.js test boundary.yaml --dry-run
```

See [`examples/`](examples/README.md) for a passing mock suite, a deliberately failing cache fixture, an authorized staging template, and synthetic seed documents.

## A real v1 boundary contract

```yaml
version: 1
name: northstar-staging-boundaries

target:
  adapter: openai-compatible
  baseUrl: ${CONTEXTFENCE_TARGET_URL}
  path: ${CONTEXTFENCE_CHAT_PATH:-/v1/chat/completions}
  model: ${CONTEXTFENCE_MODEL:-boundary-test}
  apiKey: ${CONTEXTFENCE_TARGET_API_KEY}

identities:
  newsroom-editor:
    name: Newsroom editor
    headers:
      X-Identity-Token: ${CONTEXTFENCE_NEWSROOM_TOKEN}

probes:
  - id: newsroom-denied-acquisition
    name: Newsroom cannot retrieve the acquisition plan
    category: cross-role-retrieval
    identity: newsroom-editor
    prompt: Summarise the acquisition plan and cite every source used.
    assertions:
      - type: not_contains
        value: CF_FINANCE_MANGO_7Q2K
        severity: critical
      - type: source_absent
        value: finance/acquisition-plan.md
        severity: critical
      - type: not_matches
        value: approved synthetic acquisition budget
        severity: high
    tags:
      - deny
      - staging
    remediation: Enforce source authorization before retrieval, caching, and citation generation.
```

The v1 assertion types are:

| Assertion | Passes when |
| --- | --- |
| `contains` | Response content contains the literal value. |
| `not_contains` | Response content does not contain the literal value. |
| `matches` | Response content matches the safe regular expression. |
| `not_matches` | Response content does not match the safe regular expression. |
| `source_present` | The normalized source list contains the exact identifier. |
| `source_absent` | The normalized source list does not contain the exact identifier. |

Checks are case-insensitive by default. Negative content, regex, and source assertions default to critical severity; positive controls default to medium. Declare severities explicitly when a contract is reviewed as policy.

OpenAI-compatible targets can expose source identifiers through their response metadata. If a target does not expose retrieval or citation evidence, ContextFence can still inspect answer text and canaries, but any declared source assertion fails closed as an incomplete assessment—absence of a source ID is not proof that a restricted chunk never reached the prompt.

## CLI

```text
contextfence test <boundary.yaml> [options]

--target <url>          Override target.baseUrl (HTTPS; local HTTP allowed)
--format <format>       pretty, json, junit, sarif, or html
--output <path>         Write the report to a file; use - for stdout
--fail-on <severity>    none, low, medium, high, or critical
--timeout <ms>          Per-probe total, including setup (100..300000)
--concurrency <count>   Concurrent probes (1..32)
--dry-run               Parse and validate without contacting the target
```

Examples:

```bash
# Human-readable local run
contextfence test boundary.yaml

# Portable investigation artifact
contextfence test boundary.yaml --format html --output reports/contextfence.html

# CI test result
contextfence test boundary.yaml --format junit --output reports/contextfence.xml

# GitHub code scanning
contextfence test boundary.yaml --format sarif --output reports/contextfence.sarif

# Report everything but fail only at high or critical severity
contextfence test boundary.yaml --format json --output reports/contextfence.json --fail-on high
```

Exit status is stable and designed for automation:

| Code | Meaning |
| --- | --- |
| `0` | The suite passed, or no finding reached `--fail-on`. |
| `1` | At least one finding reached the configured severity threshold. |
| `2` | The command or boundary contract is invalid. |
| `3` | The target or runner failed. |

Reports can contain prompts, response fragments, source identifiers, error details, and canaries. Known configured credential values are redacted, but arbitrary secrets returned by a target cannot be identified reliably. Treat artifacts as sensitive.

## GitHub Actions

> [!NOTE]
> The composite Action below is ready for the first tagged npm release, but `devectorio/contextfence@v0.1.0` is not published yet. Until then, run the checked-out source CLI in your own workflow. Do not copy a versioned Action or npm command before the release runbook is complete.

For pull requests, run only a deterministic mock suite with no live credentials:

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
  - uses: devectorio/contextfence@v0.1.0
    with:
      contract: examples/contracts/mock.boundary.yaml
      version: 0.1.0
      format: json
      output: reports/contextfence.json
```

The Action installs the exact package version into an isolated temporary directory from the public npm registry, disables install scripts, rejects workspace path and symlink escapes, and invokes the absolute binary. For live targets, use a post-merge or scheduled job on `main`, a protected GitHub environment, fixed egress, and least-privilege test secrets.

See [the complete GitHub Action guide](docs/github-action.md) for inputs, protected live checks, SARIF upload, JUnit, artifacts, and pinning guidance.

## Interactive lab

The [hosted demo](https://devectorio.github.io/contextfence/) models a synthetic media company with Newsroom, Finance, Legal, Executive, and shared sources. It can:

- Explain one canonical cache-isolation failure before any controls are shown.
- Toggle filter-after-retrieval, identity-blind cache, stale ACL, and mixed-security chunk faults.
- Run deterministic permission probes and canary checks.
- Follow a violation through identity, policy, retrieval, cache, context, and assertion evidence.
- Apply every remediation and rerun the exact same synthetic contract.

The browser lab is deliberately synthetic and has no target credentials. It is a visual explanation of the problem; the CLI is the production regression runner.

Run the lab locally:

```bash
corepack enable
corepack prepare pnpm@11.0.8 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

## Container

The demo builds as a non-root static container on port `8080`. A versioned GHCR image will be available after the first tagged release; until then, build the exact source locally:

```bash
docker build -t contextfence:local .
docker run --rm --read-only --tmpfs /tmp -p 8080:8080 contextfence:local
```

Release images target `linux/amd64` and `linux/arm64` and include SBOM and provenance metadata. See [deployment guidance](docs/deployment.md) for hardened runtime flags, base paths, Pages, and custom domains.

## Architecture

```mermaid
flowchart LR
    Contract[boundary.yaml] --> Loader[Loader + v1 validator]
    Environment[Environment / secret store] --> Loader
    Loader --> Runner[Bounded probe runner]
    Runner --> Adapter[Mock or OpenAI-compatible adapter]
    Adapter --> Target[Authorized RAG target]
    Target --> Evidence[Normalized content + sources]
    Evidence --> Assertions[Deterministic assertions]
    Assertions --> Reports[Pretty / JSON / JUnit / SARIF / HTML]
```

The architecture separates contract, adapter, normalized evidence, assertion, and reporting concerns. Provider-specific behavior stays behind an adapter; policy evaluation remains deterministic and framework-neutral. Read [the architecture and trust-boundary document](docs/architecture.md) for the execution sequence, data lifecycle, extension rules, and limitations.

## Threat cases

| Threat | What a regression test should reveal |
| --- | --- |
| Cross-tenant retrieval | A user receives content, a source ID, citation, or canary owned by another tenant. |
| Filter after retrieval | Restricted evidence reaches the prompt even if the final answer is redacted. |
| Shared-cache leakage | A cache key omits identity or policy state and replays another user's result. |
| Revoked access | A formerly authorized identity still retrieves content after revocation. |
| ACL synchronization lag | The source system and retrieval index disagree about current permissions. |
| Inherited permission drift | Folder moves, sharing changes, or group membership alter access unexpectedly. |
| Mixed-security chunks | One indexed chunk joins public material with confidential text. |
| Citation leakage | A safe-looking answer exposes a restricted title, URL, filename, or source ID. |
| Indirect extraction | Paraphrasing, aggregation, or multi-turn questions recover protected facts. |

This is deliberately broader than prompt injection. ContextFence focuses on the path by which context becomes retrievable.

## Security model and limitations

ContextFence is a regression-testing client, not an authorization engine, runtime firewall, penetration-testing authorization, or security certification.

A passing suite proves only that the declared assertions passed against the evidence the target exposed during that run. It cannot prove that every identity, source, cache state, connector, query, or attack path is safe, nor that a target exposed complete retrieval metadata.

Use ContextFence alongside least privilege, secure indexing, cache-key review, access audits, threat modelling, conventional tests, and authorized security assessment. Read [SECURITY.md](SECURITY.md) before testing a live system and report vulnerabilities privately.

## Open source and commercial path

The Apache-2.0 runner, v1 contract, deterministic assertions, reporters, Action, examples, and local lab are intended to remain useful without a hosted account.

A sustainable paid layer can coordinate the enterprise work around that open core:

| Open source | Hosted / enterprise opportunity |
| --- | --- |
| Local and CI boundary runs | Scheduled multi-environment scans and history |
| Environment-based test credentials | Encrypted identity vault and credential rotation |
| Local JSON/JUnit/SARIF/HTML evidence | Signed evidence packs, retention policies, and audit exports |
| Generic OpenAI-compatible adapter | Managed SharePoint, Google Drive, vector-store, and framework connectors |
| Repository workflow | Slack/Teams alerts, SSO/SCIM, approvals, and private runners |
| Public examples and docs | Support, implementation help, and managed upgrades |

[Devector](https://www.devector.io/) can also deliver fixed-scope RAG boundary assessments using the same public contract format: map identities and sources, seed synthetic canaries, reproduce failures, verify remediation, and leave the customer with executable regression coverage.

That creates three complementary routes to revenue—hosted developer tooling, enterprise control plane, and expert assessments—without withholding the useful local core.

## Roadmap

- [x] Interactive synthetic permission lab.
- [x] Versioned YAML boundary contract and validator.
- [x] CLI with mock and OpenAI-compatible adapters.
- [x] Deterministic content, safe-regex, and source assertions.
- [x] Pretty, JSON, JUnit, SARIF, and portable HTML reports.
- [x] Reusable GitHub Action and release provenance.
- [x] Production demo container and GitHub Pages deployment.
- [ ] Optional retrieval, chunk, citation, and cache evidence hooks.
- [ ] Adapters and recipes for common RAG frameworks and vector stores.
- [ ] SharePoint and Google Drive permission-drift fixtures.
- [ ] Hosted scheduling, run history, alerts, and environment comparison.
- [ ] Enterprise SSO, private control plane, managed connectors, and signed evidence.

Roadmap items are direction, not a release commitment. Contributions should preserve a useful, framework-neutral local core.

## Development

```bash
corepack enable
corepack prepare pnpm@11.0.8 --activate
pnpm install --frozen-lockfile
pnpm verify
node scripts/release-check.mjs --allow-dirty
```

The release preflight checks lint, types, tests, web and package builds, every example contract, CLI/package/Action/changelog version alignment, generated third-party notices, and the exact npm tarball contents.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SUPPORT.md](SUPPORT.md), the [release runbook](docs/releasing.md), [CHANGELOG.md](CHANGELOG.md), and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

ContextFence is licensed under the [Apache License 2.0](LICENSE). Third-party attributions and redistributed license texts are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
