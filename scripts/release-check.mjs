#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

function fail(message) {
  console.error(`\nRelease check failed: ${message}`)
  process.exit(1)
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  })

  if (result.error) fail(`${command} could not start: ${result.error.message}`)
  const expectedStatus = options.expectedStatus ?? 0
  if (result.status !== expectedStatus) {
    fail(`${command} exited with status ${result.status}; expected ${expectedStatus}`)
  }
  return result.stdout ?? ''
}

function option(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) fail(`${name} requires a value`)
  return value
}

if (process.argv.includes('--help')) {
  console.log(`Usage: node scripts/release-check.mjs [options]

Options:
  --version <semver>  Require this package version (normally derived from the tag)
  --allow-dirty       Permit a dirty Git worktree
  --skip-checks       Skip lint, typecheck, tests, and build
  --help              Show this message`)
  process.exit(0)
}

const packageJson = readJson('package.json')
const version = option('--version') ?? packageJson.version
const stableSemver = /^[0-9]+\.[0-9]+\.[0-9]+$/

if (!stableSemver.test(version)) fail(`release version must be stable semver, received '${version}'`)
if (packageJson.version !== version) {
  fail(`package.json is ${packageJson.version}, expected ${version}`)
}

const requiredMetadata = ['name', 'version', 'description', 'license', 'repository', 'homepage', 'bugs', 'engines', 'bin']
for (const field of requiredMetadata) {
  if (!packageJson[field] || (typeof packageJson[field] === 'object' && Object.keys(packageJson[field]).length === 0)) {
    fail(`package.json is missing publish metadata: ${field}`)
  }
}

if (packageJson.private === true) fail('package.json still has private: true')
if (packageJson.license !== 'Apache-2.0') fail(`expected Apache-2.0 license, received '${packageJson.license}'`)
if (packageJson.publishConfig?.access !== 'public') fail('package.json publishConfig.access must be public')
if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) {
  fail('package.json must use a files allowlist')
}
if (packageJson.bin.contextfence !== 'dist/package/cli.js') {
  fail('package.json must expose contextfence through the npm-canonical dist/package/cli.js path')
}

const expectedTag = `v${version}`
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== expectedTag) {
  fail(`workflow tag '${process.env.GITHUB_REF_NAME}' does not match ${expectedTag}`)
}

const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
const releaseHeading = `## [${version}] - `
const hasDatedReleaseHeading = changelog.split(/\r?\n/).some((line) => {
  if (!line.startsWith(releaseHeading)) return false
  return /^\d{4}-\d{2}-\d{2}$/.test(line.slice(releaseHeading.length))
})
if (!hasDatedReleaseHeading) {
  fail(`CHANGELOG.md has no dated ${version} release heading`)
}

const action = readFileSync(resolve(root, 'action.yml'), 'utf8')
const actionVersion = action.match(/  version:\n(?:    .*\n)*?    default: ([^\n]+)/)?.[1]?.trim()
if (actionVersion !== version) {
  fail(`action.yml installs ${actionVersion ?? 'an unknown version'}, expected ${version}`)
}

if (!process.argv.includes('--allow-dirty')) {
  const status = run('git', ['status', '--porcelain'], { capture: true })
  if (status.trim()) fail('Git worktree is dirty; commit the release candidate first')
}

run('node', ['scripts/generate-third-party-notices.mjs', '--check'])

if (!process.argv.includes('--skip-checks')) {
  run('pnpm', ['lint'])
  run('pnpm', ['typecheck'])
  run('pnpm', ['test'])
  run('pnpm', ['build'])
  const cliVersion = run('node', ['dist/package/cli.js', '--version'], { capture: true }).trim()
  if (cliVersion !== version) {
    fail(`packed CLI reports version '${cliVersion}', expected '${version}'`)
  }
  run('node', ['dist/package/cli.js', 'test', 'examples/contracts/mock.boundary.yaml'])
  run(
    'node',
    ['dist/package/cli.js', 'test', 'examples/contracts/vulnerable-cache.boundary.yaml'],
    { expectedStatus: 1 },
  )
  run(
    'node',
    ['dist/package/cli.js', 'test', 'examples/contracts/matrix-leak.boundary.yaml'],
    { expectedStatus: 1 },
  )
  run(
    'node',
    ['dist/package/cli.js', 'test', 'examples/contracts/matrix.boundary.yaml', '--dry-run'],
    {
      env: {
        CONTEXTFENCE_TARGET_URL: 'https://rag-staging.example.test',
        CONTEXTFENCE_TARGET_API_KEY: 'synthetic-release-check-key',
        CONTEXTFENCE_NEWSROOM_TOKEN: 'synthetic-newsroom-token',
        CONTEXTFENCE_FINANCE_TOKEN: 'synthetic-finance-token',
        CONTEXTFENCE_LEGAL_TOKEN: 'synthetic-legal-token',
      },
    },
  )
  run('node', ['dist/package/cli.js', 'generate', 'examples/manifests/northstar-access.yaml'], {
    capture: true,
  })
  run(
    'node',
    ['dist/package/cli.js', 'test', 'examples/contracts/openai-compatible.boundary.yaml', '--dry-run'],
    {
      env: {
        CONTEXTFENCE_TARGET_URL: 'https://rag-staging.example.test',
        CONTEXTFENCE_TARGET_API_KEY: 'synthetic-release-check-key',
        CONTEXTFENCE_NEWSROOM_TOKEN: 'synthetic-newsroom-token',
        CONTEXTFENCE_FINANCE_TOKEN: 'synthetic-finance-token',
      },
    },
  )
}

const packOutput = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { capture: true })
let pack
try {
  ;[pack] = JSON.parse(packOutput)
} catch {
  fail('npm pack did not return valid JSON')
}

const packedFiles = new Set(pack.files.map(({ path }) => path))
for (const required of [
  'LICENSE',
  'README.md',
  'CITATION.cff',
  'docs/boundary-baseline.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'SUPPORT.md',
  'SECURITY.md',
  'THIRD_PARTY_NOTICES.txt',
  'docs/architecture.md',
  'docs/deployment.md',
  'docs/github-action.md',
  'docs/releasing.md',
  'public/og.svg',
  'package.json',
  packageJson.bin.contextfence.replace(/^\.\//, ''),
]) {
  if (!packedFiles.has(required)) fail(`npm tarball is missing ${required}`)
}

const citation = readFileSync(resolve(root, 'CITATION.cff'), 'utf8')
if (!citation.includes(`version: ${version}`)) {
  fail(`CITATION.cff must declare release version ${version}`)
}

const releaseNotesPath = `docs/releases/v${version}.md`
if (!existsSync(resolve(root, releaseNotesPath))) {
  fail(`Release notes are missing: ${releaseNotesPath}`)
}
const releaseNotes = readFileSync(resolve(root, releaseNotesPath), 'utf8')
if (!releaseNotes.includes(`ContextFence v${version}`)) {
  fail(`${releaseNotesPath} must identify ContextFence v${version}`)
}

const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
for (const link of [
  'https://devectorio.github.io/contextfence/og.svg',
  'https://github.com/devectorio/contextfence/blob/main/docs/github-action.md',
  'https://github.com/devectorio/contextfence/blob/main/docs/architecture.md',
  'https://github.com/devectorio/contextfence/blob/main/docs/releasing.md',
]) {
  if (!readme.includes(link)) fail(`README must use a portable public link: ${link}`)
}

const forbidden = [...packedFiles].filter(
  (path) =>
    path === '.env' ||
    path.startsWith('.env.') ||
    path.startsWith('coverage/') ||
    path.startsWith('reports/') ||
    path.includes('/node_modules/'),
)
if (forbidden.length) fail(`npm tarball contains forbidden files: ${forbidden.join(', ')}`)

console.log(`\nRelease candidate ${packageJson.name}@${version} is ready.`)
console.log(`Tarball preview: ${pack.filename} (${pack.size} bytes, ${pack.files.length} files)`)
