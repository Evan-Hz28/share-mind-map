FROM node:24.16.0-trixie-slim AS build

RUN corepack enable && corepack prepare pnpm@11.5.0 --activate
WORKDIR /workspace
# 先只复制依赖清单，改源码不会让 install 层失效。workspace 有 8 个包，
# --parents 保留通配符匹配出的目录层级，以后加包不用改这里。
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY --parents apps/*/package.json packages/*/package.json ./
# store 挂 BuildKit 缓存：清单真变了也只从本地硬链接还原，不走网络。
RUN --mount=type=cache,id=pnpm-worker,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir=/pnpm-store
COPY . .
RUN pnpm --filter @share-mind-map/worker... build
RUN pnpm --filter @share-mind-map/worker deploy --legacy --prod /runtime

FROM node:24.16.0-trixie-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app
# git 用于运行时同步上游用例仓库；python 用来跑 pytest。
# 用 Debian 13 而不是 12：自带 python 3.13，上游有用例用了只有 3.12+ 才认的 f-string 写法。
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
