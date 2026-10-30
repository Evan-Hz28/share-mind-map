FROM node:24.16.0-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /workspace
# 先只复制依赖清单，改源码不会让 install 层失效。workspace 有 8 个包，
# --parents 保留通配符匹配出的目录层级，以后加包不用改这里。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY --parents apps/*/package.json packages/*/package.json ./
# store 挂 BuildKit 缓存：清单真变了也只从本地硬链接还原，不走网络。
RUN --mount=type=cache,id=pnpm-web,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store
COPY . .
RUN pnpm --filter @share-mind-map/web... build

FROM nginxinc/nginx-unprivileged:1.29.1-alpine AS runtime

COPY --from=build --chown=101:101 /workspace/apps/web/dist/ /usr/share/nginx/html/
COPY --chown=101:101 infra/nginx/default.conf /etc/nginx/conf.d/default.conf
USER 101
EXPOSE 8080
