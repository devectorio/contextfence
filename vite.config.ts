import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const productionCsp = "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'"

function publicSiteUrl() {
  const configured = process.env.VITE_SITE_URL || 'https://devanchohan.github.io/contextfence/'
  const url = new URL(configured)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_SITE_URL must be an HTTP(S) URL without credentials, query, or fragment')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    {
      name: 'contextfence-site-metadata',
      transformIndexHtml(html) {
        return html.replaceAll('__CONTEXTFENCE_SITE_URL__', publicSiteUrl())
      },
    },
    {
      name: 'contextfence-production-csp',
      apply: 'build',
      transformIndexHtml(html) {
        return html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${productionCsp}" />`,
        )
      },
    },
    react(),
  ],
  build: {
    outDir: 'dist/web',
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
