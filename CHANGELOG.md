# Changelog

All notable changes to ContextFence are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-07-18

### Added

- Declarative `matrix` block that expands an authorization model (identities, sources, per-source `allow` lists, and canaries) into the full identity × source grid of deterministic probes: a critical deny probe for every unauthorized identity and a positive control for every authorized one. Generated probes compile down to ordinary v1 probes and report against their source line. Includes `examples/contracts/matrix.boundary.yaml` and `examples/contracts/matrix-leak.boundary.yaml`.
- `contextfence generate` command that turns a connector-neutral access manifest (identities, sources, and per-source `allow` lists) into a matrix boundary contract, deriving probe keys and canaries deterministically and emitting environment placeholders for target and identity credentials. Includes `examples/manifests/northstar-access.yaml`.
- A clearer interactive lab path: one cache-isolation failure by default, scroll-to-result behavior, published npm and GitHub Action quick starts, and an explicit Boundary Baseline implementation offering.
- `CITATION.cff`, a sitemap, and expanded social metadata for discovery and research use.

### Changed

- The package homepage now leads to the Devector ContextFence product page; funding links lead to the public assessment scope rather than a generic contact endpoint.

## [0.1.0] - 2026-07-11

### Added

- Interactive, responsive regression lab for exploring RAG permission failures and remediations.
- Versioned YAML boundary contracts with identity, target, probe, severity, and deterministic assertion definitions.
- `contextfence test` CLI with environment interpolation, dry runs, target overrides, concurrency, timeouts, severity thresholds, and explicit exit codes.
- Mock and OpenAI-compatible target adapters.
- Pretty, JSON, JUnit, SARIF, and portable HTML reports with redaction-aware evidence handling.
- Source, citation, response, regex, and containment assertions over observable target evidence.
- Reusable `action.yml` for running pinned ContextFence versions in GitHub Actions.
- Synthetic example contracts, fixture documents, and a local mock target.
- Production non-root container, multi-architecture GHCR publishing, and GitHub Pages demo deployment.
- npm trusted-publishing workflow with registry provenance, GitHub artifact attestation, checksum, packed-CLI smoke test, and generated GitHub Release.
- CI, CodeQL analysis, Dependabot updates, issue forms, pull request template, security policy, contribution guide, code of conduct, and release runbook.

### Security

- Target credentials are resolved from environment variables rather than committed contracts.
- Machine-readable reports minimize request headers and support safe, synthetic reproduction workflows.
- Release automation uses short-lived OIDC credentials instead of a long-lived npm publishing token after the one-time package bootstrap.

[Unreleased]: https://github.com/devectorio/contextfence/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/devectorio/contextfence/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/devectorio/contextfence/releases/tag/v0.1.0
