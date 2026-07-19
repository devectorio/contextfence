# BuildKit supplies its actual platform automatically. The default preserves a
# usable single-platform `docker build` path for legacy local builders.
ARG BUILDPLATFORM=linux/amd64

# The compiled Vite site is architecture-independent. Keep this stage native to
# the Buildx host so multi-architecture publishing does not run pnpm under QEMU.
FROM --platform=$BUILDPLATFORM node:26.5.0-alpine@sha256:e88a35be04478413b7c71c455cd9865de9b9360e1f43456be5951032d7ac1a66 AS build

WORKDIR /app

# Corepack is not bundled in newer Node base images. Install the pinned package
# manager explicitly so Dependabot can safely advance this image.
RUN npm install --global pnpm@11.0.8 --ignore-scripts

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html tsconfig*.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG VITE_BASE=/
ARG VITE_SITE_URL=https://devectorio.github.io/contextfence/
RUN pnpm typecheck && VITE_SITE_URL="${VITE_SITE_URL}" pnpm exec vite build --base="${VITE_BASE}"

FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:a718212f9cf21e241f14067333000a3f0930292f5354fe0db269e9a2a2596b9e AS runtime

LABEL org.opencontainers.image.title="ContextFence" \
      org.opencontainers.image.description="RAG permission boundary regression lab" \
      org.opencontainers.image.source="https://github.com/devectorio/contextfence" \
      org.opencontainers.image.licenses="Apache-2.0"

COPY --chown=101:101 docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist/web /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
