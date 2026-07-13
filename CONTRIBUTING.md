# Contributing to ContextFence

Thank you for helping make RAG permission boundaries easier to test and explain.

ContextFence is early-stage. Small, focused contributions with a clear threat case and deterministic evidence are especially valuable.

## Before you start

- Search existing issues before opening a new one.
- For a substantial feature or schema change, open a proposal before investing in implementation.
- Report vulnerabilities privately according to [SECURITY.md](SECURITY.md), not in an issue or pull request.
- Use only synthetic or explicitly authorized data in examples, fixtures, screenshots, and tests.

## Development setup

Requirements:

- Node.js 22.14 or newer
- pnpm 11.0.8

```bash
corepack enable
corepack prepare pnpm@11.0.8 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Before submitting a pull request, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Good contribution areas

- Deterministic assertions over source IDs, chunks, citations, caches, and canaries.
- Reproducible fixtures for realistic permission failures.
- Contract/schema design with clear validation errors and backwards-compatibility thinking.
- Framework-neutral target and evidence adapters.
- Machine-readable reporting and CI integration.
- Accessible interaction, keyboard navigation, responsive layout, and clear evidence presentation.
- Documentation that states assumptions and limitations precisely.

## Design principles

Contributions should preserve these principles:

1. **Evidence before verdicts.** Prefer observable artifacts to an LLM judging another LLM.
2. **Identity is part of state.** Authentication, group membership, policy version, and cache identity must not be treated as incidental metadata.
3. **Safe by default.** Logs and reports should minimize sensitive content and support redaction.
4. **Framework neutrality.** Keep the boundary contract independent from any one orchestration framework, vector store, or model provider.
5. **Honest claims.** ContextFence supplies repeatable regression evidence, not a guarantee that a target cannot leak.
6. **Useful local core.** The open-source runner and assertion model should remain useful without a hosted service.

## Tests and fixtures

- Add a regression test for every bug fix.
- Prefer small, typed fixtures with explicit identities, policy state, sources, and expected evidence.
- Cover both the violating case and the remediated case when adding a threat scenario.
- Use conspicuous synthetic canaries; never use real secrets or realistic credentials.
- Keep nondeterminism out of the core assertion suite. If an LLM-assisted heuristic is necessary, isolate and label it clearly.

## Pull requests

Keep pull requests focused. In the description, explain:

- The boundary or failure mode being addressed.
- Why the chosen evidence proves the assertion.
- Security and privacy implications.
- Tests added or updated.
- Any user-facing or schema compatibility impact.

CI must pass before merge. Maintainers may ask to split unrelated changes or move broad design discussions into a proposal.

## Commit and code style

- Follow the existing TypeScript and React style.
- Let the repository's ESLint and TypeScript configuration define formatting and correctness expectations.
- Use clear domain names over security acronyms where possible.
- Comments should explain non-obvious security reasoning, not restate the code.

## Licensing

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), the same license as the project.

## Community expectations

Be direct, respectful, and generous with context. Security work benefits from careful disagreement; it does not benefit from personal attacks, disclosure of private data, or inflated claims.
