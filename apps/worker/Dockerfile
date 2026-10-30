FROM node:24.16.0-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /workspace
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @share-mind-map/worker... build
RUN pnpm --filter @share-mind-map/worker deploy --legacy --prod /runtime

FROM node:24.16.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
# git 用于运行时同步上游用例仓库；python 用来跑 pytest。
RUN sed -i 's|deb.debian.org|mirrors.tencentyun.com|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends git python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY api-tests/worker-requirements.txt /tmp/api-tests-requirements.txt
RUN python3 -m venv /opt/api-tests-venv \
    && /opt/api-tests-venv/bin/pip install --no-cache-dir \
         -i https://mirrors.tencentyun.com/pypi/simple \
         -r /tmp/api-tests-requirements.txt \
    && rm /tmp/api-tests-requirements.txt
# 上游依赖快照的哈希，同步任务用它判断是否需要重建镜像。
COPY api-tests/upstream-requirements.txt /app/api-tests/upstream-requirements.txt
RUN sha256sum /app/api-tests/upstream-requirements.txt | cut -d' ' -f1 \
      > /app/api-tests/upstream-requirements.sha
COPY --from=build --chown=node:node /runtime/ ./
COPY --from=build --chown=node:node /workspace/tests/fixtures/xmind/ ./fixtures/xmind/
# 只带 pytest 插件；用例本体由同步任务拉到 /app/api-test-repo 的卷里。
COPY --chown=node:node api-tests/harness/ /app/api-tests/harness/
RUN mkdir -p /app/api-test-repo && chown -R node:node /app/api-test-repo
COPY --chown=node:node --chmod=755 infra/docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint
USER node
EXPOSE 3001
ENTRYPOINT ["worker-entrypoint"]
