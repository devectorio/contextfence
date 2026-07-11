#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import process from 'node:process'

const [mode, workspaceInput, baseInput, pathInput] = process.argv.slice(2)

function abort(message) {
  console.error(message)
  process.exit(1)
}

function isInside(root, candidate, allowRoot = false) {
  const relation = relative(root, candidate)
  return (allowRoot || relation !== '') && relation !== '..' && !relation.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(relation)
}

if (!['directory', 'file', 'output'].includes(mode) || !workspaceInput || !baseInput || !pathInput) {
  abort('Usage: resolve-action-path.mjs <directory|file|output> <workspace> <base> <path>')
}

let workspace
let base
try {
  workspace = realpathSync(workspaceInput)
  base = realpathSync(baseInput)
} catch {
  abort('Workspace or base directory does not exist.')
}

if (!isInside(workspace, base, true)) abort('Base directory escapes the workspace.')

const candidate = resolve(base, pathInput)
if (!isInside(workspace, candidate, mode === 'directory')) {
  abort('Requested path lexically escapes the workspace.')
}

if (mode === 'directory' || mode === 'file') {
  let canonical
  try {
    canonical = realpathSync(candidate)
  } catch {
    abort('Requested path does not exist.')
  }
  if (!isInside(workspace, canonical, mode === 'directory')) {
    abort('Requested path resolves through a symlink outside the workspace.')
  }
  const stats = statSync(canonical)
  if (mode === 'directory' && !stats.isDirectory()) abort('Requested path is not a directory.')
  if (mode === 'file' && !stats.isFile()) abort('Requested path is not a regular file.')
  process.stdout.write(canonical)
  process.exit(0)
}

let existingParent = dirname(candidate)
const missingSegments = []
while (!existsSync(existingParent)) {
  const parent = dirname(existingParent)
  if (parent === existingParent) abort('Could not find an existing output parent.')
  missingSegments.unshift(basename(existingParent))
  existingParent = parent
}

let canonicalParent
try {
  canonicalParent = resolve(realpathSync(existingParent), ...missingSegments)
} catch {
  abort('Could not resolve the output parent.')
}

let output = join(canonicalParent, basename(candidate))
if (!isInside(workspace, output)) abort('Output parent resolves outside the workspace.')

mkdirSync(canonicalParent, { recursive: true })
canonicalParent = realpathSync(canonicalParent)
output = join(canonicalParent, basename(candidate))
if (!isInside(workspace, output)) abort('Created output parent resolves outside the workspace.')

try {
  if (lstatSync(output).isSymbolicLink()) {
    abort('Output must not be an existing symbolic link.')
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

process.stdout.write(output)
