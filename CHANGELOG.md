# Changelog

All notable changes to ContextFence are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/devectorio/contextfence/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/devectorio/contextfence/releases/tag/v0.1.0
