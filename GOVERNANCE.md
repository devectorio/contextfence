# Governance

ContextFence is an Apache-2.0 project maintained by Devector Consulting Ltd. The project is intentionally small and opinionated about one thing: RAG permission claims should be backed by deterministic, reviewable evidence.

## Maintainer model

The current maintainer is [@devanchohan](https://github.com/devanchohan). The maintainer is responsible for release stewardship, security response, contributor experience, and keeping the open-source core useful without a hosted account.

Contributors are welcome to propose and implement changes. Sustained contributors may be invited to become maintainers when they demonstrate sound judgment on security, compatibility, review quality, and community conduct.

## How decisions are made

Small fixes follow normal pull-request review. For material changes to the boundary contract, evidence model, assertion semantics, release process, or supported adapter surface:

1. Open an issue or proposal that states the threat case and the observable evidence needed.
2. Describe compatibility, safety, privacy, and vendor-lock-in trade-offs.
3. Prefer a paired vulnerable and remediated fixture with deterministic tests.
4. Let the maintainer record the decision and rationale in the issue, pull request, or documentation.

The project favours a useful framework-neutral local runner over features that require a Devector account. When there is a trade-off, security, reproducibility, and clear failure modes come before convenience or scope expansion.

## Changes and releases

Maintainers review release and security-sensitive changes more closely than ordinary documentation or fixture additions. Protected branch checks, protected release tags, the release runbook, provenance, and immutable registry versions form the release process.

No contributor is expected to disclose a vulnerability publicly. Follow [SECURITY.md](SECURITY.md) for private reporting and coordinated disclosure.

## Conduct and escalation

All participants follow the [Code of Conduct](CODE_OF_CONDUCT.md). Questions about governance, maintainer conduct, or unresolved project decisions can be sent privately to [dev@devector.io](mailto:dev@devector.io) with the subject `[ContextFence Governance]`.
