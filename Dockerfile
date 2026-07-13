FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.0.8 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY index.html tsconfig*.json vite.config.ts ./
COPY public ./public
COPY src ./src

ARG VITE_BASE=/
ARG VITE_SITE_URL=https://devectorio.github.io/contextfence/
RUN pnpm typecheck && VITE_SITE_URL="${VITE_SITE_URL}" pnpm exec vite build --base="${VITE_BASE}"

FROM nginxinc/nginx-unprivileged:1.28-alpine@sha256:7377697a821c131a924a7105fafbe7414db4e9fcc77a6f08f776f33f141ec3f8 AS runtime

LABEL org.opencontainers.image.title="ContextFence" \
      org.opencontainers.image.description="RAG permission boundary regression lab" \
      org.opencontainers.image.source="https://github.com/devectorio/contextfence" \
      org.opencontainers.image.licenses="Apache-2.0"

COPY --chown=101:101 docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist/web /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
