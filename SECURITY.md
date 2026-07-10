# Security policy

ContextFence exists to help teams test security boundaries, so reports about weaknesses in ContextFence itself deserve careful handling.

## Supported versions

ContextFence is currently an early-stage project. Security fixes are made on the latest `main` branch and the newest published `0.1.x` release, when releases exist. Older snapshots are not supported.

| Version | Supported |
| --- | --- |
| Latest `main` / latest release | Yes, on a best-effort basis |
| Older snapshots | No |

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability.

Use GitHub's private vulnerability reporting for this repository when it is available. Otherwise, email [dev@devector.io](mailto:dev@devector.io) with the subject `[ContextFence Security]`.

Include, where possible:

- The affected commit, release, or component.
- A concise description of the impact and required preconditions.
- Reproduction steps or a minimal proof of concept using synthetic data.
- Any suggested mitigation.
- Whether you have disclosed the issue anywhere else.

Please do not include real access tokens, confidential documents, customer prompts, or data retrieved from a system you do not own or have explicit permission to test.

We aim to acknowledge a complete report within three business days and provide an initial assessment within seven business days. These are targets rather than a service-level agreement. We will coordinate a fix and disclosure timeline with the reporter when the issue is confirmed.

## Safe research

We welcome good-faith research that:

- Uses systems and data you own or are explicitly authorized to test.
- Avoids privacy violations, service disruption, persistence, and lateral movement.
- Collects only the evidence needed to demonstrate the issue.
- Gives maintainers a reasonable opportunity to investigate and remediate before publication.

This policy does not authorize testing of Devector clients, third-party model providers, source systems, vector databases, or deployments merely because they use ContextFence.

## Sensitive test data

- Prefer synthetic documents and non-secret canary values.
- Supply credentials through environment variables or an external secret manager.
- Never commit tokens, production exports, retrieved confidential chunks, or raw incident artifacts.
- Treat generated HTML, JSON, JUnit, SARIF, screenshots, and CI logs as potentially sensitive: reports can contain source identifiers, prompts, or evidence.
- Review and redact artifacts before sharing them outside the authorized team.

## Security limitations

ContextFence is a regression-testing tool, not a runtime authorization system or security certification. A passing suite shows only that the declared probes passed against the observed target at that time. It cannot prove that every identity, source, query, cache state, connector, or attack path is safe.
