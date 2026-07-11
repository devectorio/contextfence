# Release runbook

ContextFence publishes four coordinated surfaces:

1. The `contextfence` npm CLI.
2. The composite GitHub Action in the repository tag.
3. A GitHub Release containing the npm tarball and SHA-256 checksum.
4. A multi-architecture demo image at `ghcr.io/devanchohan/contextfence`.

The hosted demo deploys from `main` independently through GitHub Pages.

## One-time repository setup

Complete these controls before creating a release tag:

- Make `devanchohan/contextfence` public so npm provenance can link the public source and workflow.
- Enable GitHub Actions and allow workflows to create packages and releases through `GITHUB_TOKEN`.
- Create a GitHub environment named `npm`. Add required reviewers if the account plan supports them.
- Configure Pages to use **GitHub Actions** as its source.
- Enable private vulnerability reporting, Dependabot alerts, secret scanning, and code scanning.
- Protect `main`, require CI and CodeQL, and prevent force pushes.
- Add a tag ruleset for `v*` that limits tag creation and deletion to maintainers.
- After its first push, make the `ghcr.io/devanchohan/contextfence` package public.

The workflows require no custom repository token. They use the job-scoped `GITHUB_TOKEN` for GitHub and an OIDC identity for npm.

## Bootstrap the npm package once

npm trusted publishing cannot create a package that does not yet exist. For the first release only, reserve `contextfence` with a non-latest bootstrap version from the already inspected tarball. This does not modify the Git worktree:

```bash
node scripts/release-check.mjs

bootstrap_directory="$(mktemp -d)"
npm pack --pack-destination "$bootstrap_directory"
tar -xzf "$bootstrap_directory/contextfence-0.1.0.tgz" -C "$bootstrap_directory"

cd "$bootstrap_directory/package"
npm pkg set version=0.0.0-bootstrap.0
npm pkg set publishConfig.provenance=false --json
npm publish --ignore-scripts --access public --tag bootstrap
```

Authenticate interactively with an npm account that has two-factor authentication. Never create a long-lived automation token for this repository. Confirm the package owner and tarball contents on npm before continuing.

Install npm 11.15 or newer locally, then bind the existing package to the exact release workflow and environment:

```bash
npm trust github contextfence \
  --repo devanchohan/contextfence \
  --file release.yml \
  --env npm \
  --allow-publish

npm trust list contextfence
npm deprecate contextfence@0.0.0-bootstrap.0 "Bootstrap placeholder; install 0.1.0 or newer."
```

The repository, workflow filename, environment name, and package `repository.url` are case-sensitive identity claims. A mismatch makes OIDC publication fail. Once trusted publishing succeeds, configure npm publishing access to require two-factor authentication and disallow traditional tokens.

## Prepare a release

Use stable semantic versions. A version is written in three places and must match:

- `package.json`
- the `version` default in `action.yml`
- a dated heading in `CHANGELOG.md`

Then run the same preflight used by the publisher:

```bash
pnpm install --frozen-lockfile
node scripts/release-check.mjs
```

The preflight rejects a dirty worktree, incomplete npm metadata, a missing `contextfence` binary, action/package version drift, an undated changelog entry, unsafe tarball contents, or failed lint, typecheck, tests, and builds. It also inspects `npm pack --dry-run --json` and requires the README, license, package manifest, and executable in the tarball.

Review before tagging:

- [ ] CLI help and `--version` show the release version.
- [ ] `examples/contracts/mock.boundary.yaml` passes.
- [ ] `examples/contracts/vulnerable-cache.boundary.yaml` fails with findings, not a runtime error.
- [ ] JSON, JUnit, SARIF, and HTML artifacts contain no configured credentials.
- [ ] The packed tarball contains only intended runtime files.
- [ ] `CHANGELOG.md`, README examples, Action docs, and migration notes agree.
- [ ] CI, CodeQL, dependency review, and container build are green on the release commit.
- [ ] The npm trusted publisher still names `devanchohan/contextfence`, `release.yml`, environment `npm`, and allows `npm publish`.
- [ ] No npm token is configured in repository or environment secrets.

## Publish

Create the release from the exact reviewed `main` commit. A signed tag is preferred:

```bash
git switch main
git pull --ff-only
git status --short
git tag -s v0.1.0 -m "ContextFence v0.1.0"
git push origin v0.1.0
```

Pushing the tag starts `.github/workflows/release.yml`. The job:

1. Verifies tag, package, Action, and changelog versions.
2. Re-runs lint, typecheck, tests, and builds from a clean checkout.
3. Inspects and creates the npm tarball.
4. Installs the tarball into a clean temporary directory and smoke-tests the packed CLI.
5. Produces a SHA-256 checksum and GitHub build-provenance attestation.
6. Publishes to npm with short-lived OIDC credentials and npm provenance.
7. Creates the GitHub Release only after npm publication succeeds.

The container workflow independently builds `linux/amd64` and `linux/arm64`, attaches SBOM and provenance metadata, and publishes version and major/minor tags to GHCR.

Never move an existing release tag or reuse a published npm version. Fix the source, increment the patch version, and release again.

## Verify after publication

```bash
npm view contextfence@0.1.0 name version repository dist.integrity --json

verify_directory="$(mktemp -d)"
npm install --prefix "$verify_directory" contextfence@0.1.0
"$verify_directory/node_modules/.bin/contextfence" --version
"$verify_directory/node_modules/.bin/contextfence" test examples/contracts/mock.boundary.yaml

gh release view v0.1.0 --repo devanchohan/contextfence
gh attestation verify contextfence-0.1.0.tgz --repo devanchohan/contextfence

docker pull ghcr.io/devanchohan/contextfence:0.1.0
docker inspect ghcr.io/devanchohan/contextfence:0.1.0
```

Also confirm the npm provenance link resolves to the tagged public workflow and that the GitHub Pages deployment loads assets beneath `/contextfence/`.

## Failure and rollback

Release jobs are deliberately ordered so a failed verification cannot create a GitHub Release. If npm publication succeeds but a later GitHub step fails, rerun only after confirming the registry version and create the GitHub Release manually from the attested workflow artifact; npm will not accept the same version twice.

For a defective non-security release:

1. Deprecate the affected npm version with a concise upgrade instruction.
2. Mark the GitHub Release and container tag as affected.
3. Publish a fixed patch version; do not overwrite artifacts.

For a suspected signing, workflow, or maintainer compromise:

1. Stop release workflows and protect tags.
2. Revoke the npm trusted publisher with `npm trust revoke` and inspect package maintainers.
3. Revoke exposed GitHub/npm sessions and credentials.
4. Preserve workflow logs and attestations privately.
5. Follow `SECURITY.md` and publish an advisory when containment is complete.

Official references: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/), [npm provenance](https://docs.npmjs.com/generating-provenance-statements/), and [GitHub artifact attestations](https://docs.github.com/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).
