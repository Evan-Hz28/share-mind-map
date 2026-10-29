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
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY api-tests/harness/requirements.txt /tmp/api-tests-requirements.txt
RUN python3 -m venv /opt/api-tests-venv \
    && /opt/api-tests-venv/bin/pip install --no-cache-dir -r /tmp/api-tests-requirements.txt \
    && rm /tmp/api-tests-requirements.txt
COPY --from=build --chown=node:node /runtime/ ./
COPY --from=build --chown=node:node /workspace/tests/fixtures/xmind/ ./fixtures/xmind/
COPY --chown=node:node api-tests/ /app/api-tests/
COPY --chown=node:node --chmod=755 infra/docker/worker-entrypoint.sh /usr/local/bin/worker-entrypoint
USER node
EXPOSE 3001
ENTRYPOINT ["worker-entrypoint"]
