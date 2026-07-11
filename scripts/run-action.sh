#!/usr/bin/env bash
set -euo pipefail

die() {
  printf '::error title=Invalid ContextFence Action input::%s\n' "$*" >&2
  exit 2
}

[[ "${INPUT_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] ||
  die "version must be an exact semantic version, received '${INPUT_VERSION}'"
[[ "${INPUT_FORMAT}" =~ ^(pretty|json|junit|sarif|html)$ ]] ||
  die "format must be one of: pretty, json, junit, sarif, html"
[[ "${INPUT_FAIL_ON}" =~ ^(none|low|medium|high|critical)$ ]] ||
  die "fail-on must be one of: none, low, medium, high, critical"
[[ "${INPUT_TIMEOUT}" =~ ^[1-9][0-9]*$ ]] || die "timeout must be a positive integer"
[[ "${INPUT_CONCURRENCY}" =~ ^[1-9][0-9]*$ ]] || die "concurrency must be a positive integer"
[[ "${INPUT_DRY_RUN}" =~ ^(true|false)$ ]] || die "dry-run must be true or false"

for path_input in "${INPUT_CONTRACT}" "${INPUT_OUTPUT}" "${INPUT_WORKING_DIRECTORY}"; do
  LC_ALL=C
  if [[ "${path_input}" =~ [[:cntrl:]] ]]; then
    die "contract, output, and working-directory must not contain control characters"
  fi
done

workspace="$(cd "${GITHUB_WORKSPACE:?GITHUB_WORKSPACE is not set}" && pwd -P)"
path_guard="${GITHUB_ACTION_PATH:?GITHUB_ACTION_PATH is not set}/scripts/resolve-action-path.mjs"
working_directory="$(
  node "${path_guard}" directory "${workspace}" "${workspace}" "${INPUT_WORKING_DIRECTORY}"
)" || die "working-directory must be a directory inside GITHUB_WORKSPACE"
contract_path="$(
  node "${path_guard}" file "${workspace}" "${working_directory}" "${INPUT_CONTRACT}"
)" || die "contract must be a regular file inside GITHUB_WORKSPACE"

cd "${working_directory}"

args=(
  test "${contract_path}"
  --format "${INPUT_FORMAT}"
  --fail-on "${INPUT_FAIL_ON}"
  --timeout "${INPUT_TIMEOUT}"
  --concurrency "${INPUT_CONCURRENCY}"
)

if [[ -n "${INPUT_TARGET}" ]]; then
  args+=(--target "${INPUT_TARGET}")
fi

report_path=""
if [[ -n "${INPUT_OUTPUT}" ]]; then
  report_path="$(
    node "${path_guard}" output "${workspace}" "${working_directory}" "${INPUT_OUTPUT}"
  )" || die "output must resolve inside GITHUB_WORKSPACE"
  args+=(--output "${report_path}")
fi

if [[ "${INPUT_DRY_RUN}" == "true" ]]; then
  args+=(--dry-run)
fi

printf 'report=%s\n' "${report_path}" >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT is not set}"
printf '::group::ContextFence %s\n' "${INPUT_VERSION}"
printf 'Contract: %s\n' "${contract_path}"
printf 'Working directory: %s\n' "${INPUT_WORKING_DIRECTORY}"
printf 'Report: %s\n' "${report_path:-stdout}"
printf '::endgroup::\n'

tool_directory="$(mktemp -d)"
trap 'rm -rf "${tool_directory}"' EXIT

npm install \
  --prefix "${tool_directory}" \
  --registry=https://registry.npmjs.org \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --package-lock=false \
  --save-exact \
  "contextfence@${INPUT_VERSION}"

installed_version="$(
  node -e "const manifest = require(process.argv[1]); process.stdout.write(manifest.version)" \
    "${tool_directory}/node_modules/contextfence/package.json"
)"
[[ "${installed_version}" == "${INPUT_VERSION}" ]] ||
  die "installed package version ${installed_version} does not match ${INPUT_VERSION}"

"${tool_directory}/node_modules/.bin/contextfence" "${args[@]}"
