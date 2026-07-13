# ContextFence GitHub Action

The repository ships a composite Action that installs one exact ContextFence npm version and runs a boundary contract. Keep the Action ref and its `version` input pinned during reviewable releases.

> **Release status:** the Action is wired for the first `v0.1.0` release, but that tag and the `contextfence@0.1.0` npm package do not exist yet. Follow [the release runbook](releasing.md) before using the versioned examples below. Until then, checkout the repository and run `node dist/package/cli.js` after building it.

## Pull request workflow with no secrets

```yaml
name: RAG boundary checks

on:
  pull_request:

permissions:
  contents: read

jobs:
  boundary:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6

      - name: Validate the deterministic boundary suite
        uses: devectorio/contextfence@v0.1.0
        with:
          contract: examples/contracts/mock.boundary.yaml
          version: 0.1.0
          format: json
          output: reports/contextfence.json
          fail-on: low

      - name: Preserve the redacted report
        if: always() && hashFiles('reports/contextfence.json') != ''
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
        with:
          name: contextfence-report
          path: reports/contextfence.json
          if-no-files-found: error
          retention-days: 7
```

No pull request job—forked or same-repository—should receive target secrets. A pull request can change its contract, prompts, headers, output paths, and build inputs.

## Protected live staging workflow

Run live checks only from the trusted default branch, behind a protected GitHub environment. The explicit `if` prevents a manual dispatch against another branch, while `target` fixes egress to the reviewed staging URL.

```yaml
name: Live RAG boundary checks

on:
  workflow_dispatch:
  schedule:
    - cron: "17 3 * * 1-5"

permissions:
  contents: read

jobs:
  staging:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: rag-staging
    steps:
      - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6
        with:
          persist-credentials: false

      - name: Test the protected staging target
        uses: devectorio/contextfence@v0.1.0
        env:
          CONTEXTFENCE_TARGET_URL: https://rag-staging.example.com
          CONTEXTFENCE_TARGET_API_KEY: ${{ secrets.CONTEXTFENCE_TARGET_API_KEY }}
          CONTEXTFENCE_NEWSROOM_TOKEN: ${{ secrets.CONTEXTFENCE_NEWSROOM_TOKEN }}
          CONTEXTFENCE_FINANCE_TOKEN: ${{ secrets.CONTEXTFENCE_FINANCE_TOKEN }}
        with:
          contract: boundaries/staging.yaml
          target: https://rag-staging.example.com
          version: 0.1.0
          format: json
          output: reports/contextfence.json
          fail-on: high
```

Protect `rag-staging` with required reviewers, restrict deployment branches to `main`, use short-lived least-privilege test identities, and enforce an egress allowlist at the runner or network layer. Environment protection is an authorization boundary; repository variables alone are not.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `contract` | `boundary.yaml` | Contract path relative to `working-directory`. |
| `target` | empty | Optional target base URL override. |
| `format` | `json` | `pretty`, `json`, `junit`, `sarif`, or `html`. |
| `output` | `contextfence-results.json` | Report path. Empty means stdout only. |
| `fail-on` | `low` | Lowest failing severity: `none`, `low`, `medium`, `high`, or `critical`. |
| `timeout` | `30000` | Per-probe timeout in milliseconds, including setup requests. |
| `concurrency` | `4` | Maximum concurrent probes. |
| `dry-run` | `false` | Validate and plan without calling the target. |
| `working-directory` | `.` | Directory beneath `GITHUB_WORKSPACE` in which to run. |
| `version` | `0.1.0` | Exact npm package version to execute. Dist-tags and ranges are rejected. |

The `report` output is the report's absolute path, or an empty string when file output is disabled.

The Action resolves real paths for the workspace, working directory, contract, output parent, and existing symlinks. Paths that escape `GITHUB_WORKSPACE` are rejected before the contract is read or report directories are created. It installs the exact npm version into a fresh temporary directory from `registry.npmjs.org`, disables install scripts, checks the installed manifest version, and invokes the absolute binary rather than a project-local executable.

## SARIF upload

SARIF can surface failed assertions in GitHub code scanning. The upload step must use `always()` because ContextFence deliberately returns a non-zero status when a finding reaches the selected threshold.

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@df4cb1c069e1874edd31b4311f1884172cec0e10 # v6

  - name: Run ContextFence
    uses: devectorio/contextfence@v0.1.0
    with:
      contract: boundaries/staging.yaml
      version: 0.1.0
      format: sarif
      output: reports/contextfence.sarif

  - name: Upload SARIF
    if: always() && hashFiles('reports/contextfence.sarif') != ''
    uses: github/codeql-action/upload-sarif@99df26d4f13ea111d4ec1a7dddef6063f76b97e9 # v4
    with:
      sarif_file: reports/contextfence.sarif
```

Uploading SARIF does not make its contents public by itself, but repository and organization access policies still apply. Review source IDs, prompts, response excerpts, and locations before widening access.

## JUnit test results

Use `format: junit` and an `.xml` output path for CI systems that ingest JUnit. ContextFence's own exit status remains authoritative; a test-results uploader should not replace it.

## Exit status

| Code | Meaning |
| --- | --- |
| `0` | Suite passed, or no finding reached `fail-on`. |
| `1` | At least one finding reached `fail-on`. |
| `2` | Contract, command, or usage error. |
| `3` | Target or runtime failure. |

## Pinning and update policy

For the strongest supply-chain posture, pin `uses:` to a reviewed full commit SHA and let Dependabot propose updates. The exact `version` input separately pins the npm package executed by the composite Action. A moving branch or npm dist-tag is not accepted as a package version.

Before updating either pin:

1. Review the repository diff and `CHANGELOG.md`.
2. Verify the npm package's provenance and repository link.
3. Run the mock contract in an unprivileged job.
4. Promote the version to a protected staging environment before production-like targets.
