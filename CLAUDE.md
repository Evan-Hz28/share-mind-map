# Response Style

- 执行任务过程中，不要输出中间进度说明。
- 不要在每次工具调用前后解释操作。
- 不要输出类似“我来检查一下”“接下来验证”等过渡性文本。
- 直接调用工具完成任务。
- 任务完成后，再统一输出最终结果。
- 只有遇到需要用户决策、授权或无法继续的问题时，才输出中间消息。

# 开发环境（本机）

## 机器与工具链

- 开发机是腾讯云 Ubuntu 24.04.4 LTS，**amd64**，7.5 GiB 内存，sudo 免密。和生产目标（arm64）架构不同。
- Node `v24.21.0`（`engines` 要求 `>=24 <25`），pnpm `11.5.0` 由 corepack 装在 `~/.local/bin/pnpm`。
- Docker Engine 29.1.3 + Compose 2.40.3，来自 Ubuntu 官方源（`docker.io`、`docker-compose-v2`）。
- Docker Hub 直连被 DNS 污染，`/etc/docker/daemon.json` 配了腾讯云内网加速器 `https://mirror.ccs.tencentyun.com`，改完要 `sudo systemctl restart docker`。该加速器只对 Docker Hub 生效，**不覆盖 quay.io / cgr.dev**。
- Playwright Chromium 已装（`~/.cache/ms-playwright/`），并装了 `fonts-wqy-microhei`，否则 headless 截图里的中文是豆腐块。
- 仓库只有 `@playwright/test`，脚本里要 `import { chromium } from "@playwright/test"`，不要找裸 `playwright` 包。

## 本地配置与端口

- 仓库根 `.env` 是开发用配置（权限 600，已被 `.gitignore` 忽略）；`deploy/.env` 是打包用的副本，含真实口令，权限也应保持 600，二者不要提交。
- 宿主机进程用 `DATABASE_URL`、`REDIS_URL`、`MINIO_ENDPOINT`；容器内用对应的 `COMPOSE_*` 服务名 URL，不能写 `localhost`。
- 只有 web 发布到 `0.0.0.0:8080`，其余端口只绑 `127.0.0.1`：

| 服务 | 端口 |
| --- | --- |
| Web | 8080 |
| API | 3000 |
| Worker | 3001 |
| PostgreSQL | 15432 |
| Redis | 16379 |
| MinIO API / Console | 9000 / 9001 |
| Mailpit SMTP / HTTP | 1025 / 8025 |

- 本机当前 7 个容器常驻 healthy，`minio-init` 是一次性容器，正常退出。
- 前端不把地址编进构建产物（`location.origin` + nginx 反代 `/api/`），换域名或 IP 不用重新 build。
- MinIO 已换 `cgr.dev/chainguard/minio`，容器以 uid **65532**（nonroot）运行。`minio-data` 卷如果是老镜像建的（root 属主），启动会报 `Unable to initialize backend: Unable to write to the backend`。修复：
  ```bash
  sudo chown -R 65532:65532 /var/lib/docker/volumes/share-mind-map_minio-data/_data
  ```
  生产机换镜像时同样要处理。

## 常用命令

```bash
# 首次安装
corepack enable
corepack prepare pnpm@11.5.0 --activate
pnpm install --frozen-lockfile
pnpm exec playwright install chromium

# 只起依赖（本机跑 API/Worker 时）
docker compose --env-file .env up -d postgres redis minio minio-init mailpit
set -a; . ./.env; set +a

# 整套构建 + 启动
docker compose --env-file .env build web api worker
docker compose --env-file .env up -d
docker compose --env-file .env ps
pnpm compose:health

# 首次创建管理员 / 恢复管理员（交互式，密码只显示一次）
docker compose --env-file .env exec api node dist/cli/init-admin.js
docker compose --env-file .env exec api node dist/cli/recover-admin.js
```

本机跑 API / Worker / 前端 dev server 的完整步骤（含迁移命令）见 [README.md](README.md) 的“本机开发”。前端 dev server 要把 `.env` 的 `WEB_ORIGIN` 临时改成 `http://127.0.0.1:5173`。

## 验证

```bash
pnpm lint
pnpm typecheck
pnpm test:unit
```

- **不要用 `pnpm check` / `pnpm format:check` 做门禁**：当前 HEAD 就有 12 个文件未通过 Prettier（含 `deploy/README.md`），`format:check` 必然失败。
- 集成测试和 e2e 依赖本地 compose 栈；e2e 命令见 README。
- 本地验证用 amd64 镜像：`docker compose --env-file .env build <改过的服务>` + `up -d`。本机 `:latest` **必须始终是 amd64**；生产包走部署章节的 `deploy/make-arm64-bundle.sh`，它把 arm64 构建到 `<service>:arm64`，不覆盖 `:latest`。
- `docker compose up -d web` **会连同依赖一起收敛**：`web` 的 `depends_on` 是 `api`（`service_healthy`），api 再带 redis / minio。镜像 id 变了就会重建 api——所以 `:latest` 被 arm64 覆盖后，`up -d web` 同样会撞 platform 不匹配，不是「只警告」。只动 web 用 `up -d --no-deps web`，但那也跳过了 api 启动时的数据库迁移。

# 部署（AWS testhub）

## 目标环境

- 生产机：AWS `ap-southeast-3` 的 EC2 `i-0d156fae74838d6f`，架构 **arm64**，`ec2-user@15.232.217.124`，密钥 `~/.ssh/kitar.id.pem`。
- 对外入口：`https://testhub.kitarx.com`，由 ALB `testhub-alb` 终止 TLS（ACM `*.kitarx.com`），转发到 target group 的 8080 端口。EC2 不直接对公网开放 8080。
- 部署目录：目标机 `~/share-mind-map-deploy`，解压离线包得到。`.env` 里是 `APP_ENV=development`、`COOKIE_SECURE=false`、`TRUST_PROXY_COUNT=1`，`WEB_ORIGIN`/`API_PUBLIC_URL=https://testhub.kitarx.com`。
- 目标机 1.8 GiB 内存、无 swap，7 个容器常驻约 900 MiB。Docker 29.x，能访问 Docker Hub 和 cgr.dev。

## 日常更新（api / web / worker）

镜像标签约定（两个平台互不覆盖）：

| 标签 | 内容 | 用在哪 |
| --- | --- | --- |
| `share-mind-map-<service>:latest` | 本机开发镜像，**amd64** | `docker compose up`、`make-bundle.sh` 的输入 |
| `share-mind-map-<service>:arm64` | 生产镜像，`linux/arm64` | 常驻开发机，可反复复用 |

开发机执行：

```bash
cd /home/ubuntu/project/share-mind-map

# 一条命令：构建 arm64 -> 校验架构 -> 临时 retag -> 打包 -> 恢复 :latest
# 改了什么就写什么；不写 --only 默认 web,api,worker
deploy/make-arm64-bundle.sh --only web

# 已经构建过 :arm64，只重新打包（会复用现有镜像，代码改了没重建就会打旧代码）
deploy/make-arm64-bundle.sh --only web --skip-build
```

脚本做的事：

1. `DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose -f compose.yaml -f deploy/compose.arm64.yaml --env-file deploy/.env build …`，产出 `:arm64`，**不碰 `:latest`**；
2. `docker image inspect` 校验每个都是 `linux/arm64`，不是就在 retag 前退出；
3. 记录当前 `:latest` 的 image id，把 `:arm64` 临时 tag 成 `:latest`（`make-bundle.sh` 只认 `:latest`）；
4. 跑 `deploy/make-bundle.sh --only …`；
5. `trap EXIT` 恢复 `:latest`（失败、Ctrl-C 也执行；原本没有 `:latest` 时只摘掉临时 tag）。

所以本机 `:latest` 始终是 amd64，`docker compose up -d` 不会撞 platform 不匹配。首次构建 arm64 在 QEMU 下较慢，之后同平台改动有层缓存。

手工等价步骤（需要自己收尾）：

```bash
DOCKER_DEFAULT_PLATFORM=linux/arm64 \
  docker compose -f compose.yaml -f deploy/compose.arm64.yaml \
  --env-file deploy/.env build web
docker image inspect share-mind-map-web:arm64 --format '{{.Os}}/{{.Architecture}}'  # 必须 linux/arm64
docker tag share-mind-map-web:arm64 share-mind-map-web:latest
COMPOSE_ENV_FILE=deploy/.env deploy/make-bundle.sh --only web
docker compose --env-file .env build web   # 把 :latest 恢复成 amd64
```

构建前确认改动已经在工作区，`make-bundle.sh` 打的是**本机现有镜像**，不是源码。它会在有未提交改动时警告，但警告不代表镜像里有新代码。

传包并更新：

```bash
scp -i ~/.ssh/kitar.id.pem dist-deploy/share-mind-map-update.tar.gz \
  ec2-user@15.232.217.124:~/

ssh -i ~/.ssh/kitar.id.pem ec2-user@15.232.217.124
tar xzf ~/share-mind-map-update.tar.gz --strip-components=1 -C ~/share-mind-map-deploy
cd ~/share-mind-map-deploy
./deploy.sh
```

`deploy.sh` 会 load 新镜像、校验 `images.list`、`docker compose up -d`，compose 只重建镜像真的变了的容器。

## 必须遵守

- **不要加 `--with-base-images`**。开发机是 amd64，打进去的 postgres/redis/mailpit 是 amd64，到 arm64 目标机会 platform mismatch。目标机能出网，基础镜像让它自己拉。
- **`deploy/compose.arm64.yaml` 只用于 `build`**，不要带它 `up`：那几个服务会去找 `:arm64` 镜像。
- **更新包必须解压到原部署目录**，用 `--strip-components=1 -C ~/share-mind-map-deploy`。解到新目录会重新生成 `.env`，丢掉现有配置和会话。
- **不要给更新时的 `deploy.sh` 传 `--public-url`**。`.env` 已存在时脚本会沿用现有地址，传了反而会改写。
- **web 镜像把 nginx 配置和前端静态资源一起烤进去了**。改前端必须重新 build web，不能只改容器里的文件。
- **数据库迁移由 API 容器启动时自动执行**，不需要单独跑。
- **`compose.yaml` 会被更新包覆盖**。当前版本 MinIO 已改用 `cgr.dev/chainguard/minio:latest-dev` 和 `minio-client:latest-dev`，下一次更新会重建 minio 容器一次，数据在 `minio-data` 卷里，不受影响。
- **MinIO 新镜像以 uid 65532 运行**，老卷是 root 属主会启动失败（`Unable to write to the backend`）。本机已修；生产机换镜像后若有同样报错：
  ```bash
  sudo chown -R 65532:65532 /var/lib/docker/volumes/share-mind-map_minio-data/_data
  ```
- **只改数据（如工作区名称）不需要构建或部署**，直接改库，浏览器刷新即可：
  ```bash
  docker compose --env-file .env exec -T postgres psql -U mindmap -d share_mind_map \
    -c "UPDATE workspaces SET name='TestHub', updated_at=now() WHERE name='Share Mind Map';"
  ```
  工作区名由 `/api/v1/me` 每次从库里读，刷新页面后生效。

## 验证

在目标机部署目录执行：

```bash
docker compose --env-file .env ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:3000/health/ready
docker compose --env-file .env logs --no-color --tail=100 api worker web
```

外部验证 `https://testhub.kitarx.com/health` 返回 200。7 个容器里除 `minio-init`（一次性退出）外都应 healthy。

## 首次安装

全新机器才需要：

```bash
scp -i ~/.ssh/kitar.id.pem dist-deploy/share-mind-map-deploy.tar.gz \
  ec2-user@15.232.217.124:~/
ssh -i ~/.ssh/kitar.id.pem ec2-user@15.232.217.124
tar xzf share-mind-map-deploy.tar.gz
cd share-mind-map-deploy
./deploy.sh --public-url https://testhub.kitarx.com
```

必须显式传 `--public-url`：`deploy/.env` 里的 `WEB_ORIGIN`/`API_PUBLIC_URL` 还是开发机的 IP，不传会写成错误地址。

首次部署后创建管理员（临时密码只显示一次，登录强制改密）：

```bash
docker compose --env-file .env exec api node dist/cli/init-admin.js
```

全新安装时工作区名称在 `init-admin` 交互里手工输入，代码里没有默认值；要 `TestHub` 就在这里填。
