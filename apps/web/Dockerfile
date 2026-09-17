FROM node:24.16.0-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @share-mind-map/web... build

FROM nginxinc/nginx-unprivileged:1.29.1-alpine AS runtime

COPY --from=build --chown=101:101 /workspace/apps/web/dist/ /usr/share/nginx/html/
COPY --chown=101:101 infra/nginx/default.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
