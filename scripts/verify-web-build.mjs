#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const [directoryInput, baseInput = '/'] = process.argv.slice(2)

if (!directoryInput || !baseInput.startsWith('/') || !baseInput.endsWith('/')) {
  console.error('Usage: verify-web-build.mjs <build-directory> </public-base/>')
  process.exit(1)
}

const directory = resolve(directoryInput)
const indexPath = resolve(directory, 'index.html')
if (!existsSync(indexPath)) {
  console.error(`Missing built index: ${indexPath}`)
  process.exit(1)
}

const html = readFileSync(indexPath, 'utf8')
if (html.includes('__CONTEXTFENCE_SITE_URL__')) {
  console.error('Built HTML still contains the unresolved site URL placeholder.')
  process.exit(1)
}
const urls = [
  ...html.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi),
  ...html.matchAll(/\bproperty=["']og:image["'][^>]*\bcontent=["']([^"']+)["']/gi),
].map((match) => match[1])

const localAbsoluteUrls = urls.filter((url) => url.startsWith('/') && !url.startsWith('//'))
const invalidBase = localAbsoluteUrls.filter((url) => !url.startsWith(baseInput))
if (invalidBase.length > 0) {
  console.error(`Built HTML contains URLs outside ${baseInput}: ${invalidBase.join(', ')}`)
  process.exit(1)
}

for (const url of localAbsoluteUrls) {
  const withoutBase = url.slice(baseInput.length).split(/[?#]/, 1)[0]
  const assetPath = resolve(directory, decodeURIComponent(withoutBase))
  if (!existsSync(assetPath)) {
    console.error(`Built HTML references a missing asset: ${url}`)
    process.exit(1)
  }
}

const notices = resolve(directory, 'THIRD_PARTY_NOTICES.txt')
if (!existsSync(notices)) {
  console.error('Built web distribution is missing THIRD_PARTY_NOTICES.txt')
  process.exit(1)
}

console.log(`Verified ${localAbsoluteUrls.length} local asset URLs beneath ${baseInput}.`)
