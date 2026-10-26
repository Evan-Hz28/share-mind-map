# 离线部署包

把一个 tar.gz 传到目标服务器、解压、跑一条命令，就能起完整套服务。目标机**不需要**源码、Node、pnpm，也**不需要**访问 Docker Hub（MinIO 那两个镜像在 quay.io 已经拉不到了，必须随包搬运）。

## 在开发机打包

```bash
deploy/make-bundle.sh                 # 默认：应用 3 个镜像 + MinIO 2 个镜像，约 500MB
deploy/make-bundle.sh --with-data     # 额外带上数据库/Redis/MinIO 数据（需先停服务）
deploy/make-bundle.sh --with-base-images   # 目标机连不上 Docker Hub 时，把 postgres/redis/mailpit 也带上
```

产物在 `dist-deploy/share-mind-map-deploy.tar.gz`（附 `.sha256`）。镜像清单、版本和 git commit 记录在包内 `MANIFEST.txt`。

`--with-data` 要求本机服务已停止，先执行：

```bash
docker compose --env-file .env down
```

打包完成后可以 `docker compose --env-file .env up -d` 恢复本机服务。

## 在目标服务器部署

```bash
scp dist-deploy/share-mind-map-deploy.tar.gz <user>@<host>:~/
ssh <user>@<host>

# 只有全新机器才需要：apt update && apt install -y docker.io docker-compose-v2
tar xzf share-mind-map-deploy.tar.gz
cd share-mind-map-deploy
./deploy.sh
```

`deploy.sh` 会依次：检测 docker/compose → 生成 `.env`（首次从 `env.bundle` 复制）→ 把 `WEB_ORIGIN` 和 `API_PUBLIC_URL` 改写成目标机的公网地址（用 `https://api.ipify.org` 自动识别，失败则退回 `hostname -I`）→ `docker load` 导入镜像 → `docker compose up -d` → 等 web 与 api 健康检查通过 → 打印访问地址。

带数据迁移时：

```bash
./deploy.sh --data data.tar.gz
```

### 参数

| 参数 | 作用 |
| --- | --- |
| `--public-url http://1.2.3.4:8080` | 手动指定对外地址，不自动探测 |
| `--data <file>` | 启动前恢复数据卷（先 `compose down` 再恢复） |
| `--no-load` | 跳过镜像导入（镜像已在本机时用） |
| `--dry-run` | 只检查环境、改写 `.env`、校验编排，不启动容器 |

全新机器建议先 `./deploy.sh --dry-run --no-load` 看一遍再做真部署。

### 功能更新（不用重跑整套流程）

改完代码、build 出新镜像之后，只打包**变了的服务**，传过去重跑 `deploy.sh` 就行：

```bash
# 开发机
docker compose --env-file .env build web && docker compose --env-file .env up -d web
./deploy/make-bundle.sh --only web            # 约 25MB，产出 share-mind-map-update.tar.gz

# 目标机：解压覆盖到原来的部署目录（--strip-components=1，不要解到新目录）
scp dist-deploy/share-mind-map-update.tar.gz <user>@<host>:~/
ssh <user>@<host>
tar xzf share-mind-map-update.tar.gz --strip-components=1 -C ~/share-mind-map-deploy
cd ~/share-mind-map-deploy && ./deploy.sh     # load 新镜像 -> 只重建 web
```

一定要解到原有部署目录：包里的 `compose.yaml` 和 `deploy.sh` 会覆盖，但 `.env` 不在包里，因此会原样保留。如果解到新目录，`deploy.sh` 会警告你放错了地方（`.env` 会被重新生成）。

`--only` 支持 `web` / `api` / `worker`，逗号分隔（如 `--only web,api`）。数据库、Redis、MinIO 的数据卷都不受影响，compose 只会重建镜像真的变了的那个容器，停机时间就是一次容器重启。

### arm64 打包不要覆盖本机 `:latest`

镜像名固定是 `share-mind-map-<service>:latest`。开发机是 amd64，直接 `DOCKER_DEFAULT_PLATFORM=linux/arm64 docker compose build` 会把 `:latest` 换成 arm64，之后本机 `docker compose up` 会拿 arm64 镜像重建容器，报 platform 不匹配。

用打包脚本代替「手工 build + make-bundle」：

```bash
deploy/make-arm64-bundle.sh --only web   # 改了什么写什么，默认 web,api,worker
deploy/make-arm64-bundle.sh --only web --skip-build   # 已经 build 过 :arm64，只打包
```

它按 [compose.arm64.yaml](compose.arm64.yaml) 把镜像构建成 `<service>:arm64`（不碰 `:latest`）→ 校验必须是 `linux/arm64` → 打包期间临时把 `:arm64` 指成 `:latest`（`make-bundle.sh` 只认 `:latest`）→ 结束（含失败和 Ctrl-C）自动恢复原来的 `:latest`。

所以本机 `:latest` 永远是本地开发镜像，`docker compose up -d` 不会再撞平台问题；arm64 镜像常驻 `share-mind-map-<service>:arm64`，下次 `--skip-build` 可直接复用。

`.env` 已存在时 `deploy.sh` **不会**再改写 `WEB_ORIGIN`/`API_PUBLIC_URL`，所以不会把手工配好的域名或公网地址冲掉；要改就显式传 `--public-url`。

## 路线 B：目标机自己拉代码构建（不用离线包）

目标机能访问 GitHub、Docker Hub、npm registry 时走这条，比搬包更直接，也不需要目标机装 Node/pnpm（构建在容器里做，宿主机只要 Docker + Compose v2）。**对 Docker 版本没有 25+ 的要求**，那条限制只针对离线包的 OCI 归档。

```bash
# 目标机：仓库是公开的，HTTPS 直接克隆
git clone https://github.com/Evan-Hz28/share-mind-map.git ~/share-mind-map
cd ~/share-mind-map

# .env 被 gitignore，不会随仓库过来，必须自己生成
install -m 600 .env.example .env
sed -i 's|^WEB_ORIGIN=.*|WEB_ORIGIN=http://<公网IP>:8080|;
        s|^API_PUBLIC_URL=.*|API_PUBLIC_URL=http://<公网IP>:8080|' .env

# 构建 + 启动（首次 5~15 分钟，取决于到 npm registry 的速度）
docker compose --env-file .env build web api worker
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

之后更新就是常规三连：

```bash
git pull && docker compose --env-file .env build web api worker && docker compose --env-file .env up -d
```

### 这条路的三个坑

1. **MinIO 两个镜像仍然搬不过去**。`quay.io/minio/minio` 和 `quay.io/minio/mc` 这两个 tag 在 quay.io 和 Docker Hub 上都已经拉不到（实测 `docker manifest inspect` 全部失败），任何 registry 都没有。全新机器上 `compose up` 会在这一步卡住，必须从开发机单独搬一次（实测 81MB，两个镜像共用层，比镜像列表里的 241MB+117MB 小得多）：
   ```bash
   # 开发机（本仓库已产出一份：dist-deploy/minio-images.tar.gz）
   docker save quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z \
               quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z | gzip -1 > minio-images.tar.gz
   scp minio-images.tar.gz <user>@<host>:~/
   # 目标机（一次性，之后一直在本地镜像库里）
   gunzip -c minio-images.tar.gz | docker load
   # 确认导入后的名字没丢（丢了就 docker tag <镜像ID> quay.io/minio/minio:<tag>）
   docker image inspect quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z \
                        quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z >/dev/null && echo ok
   ```
   归档是 amd64-only（原镜像虽是 arm64/amd64/ppc64le 多架构，但只保存了本机在用的 amd64 内容），目标机也必须是 amd64；另外同离线包一样，需要目标机 Docker 25+ 才能 load 这种 OCI 归档。
2. **没推上去的改动不会过去**。目标机拉到的是 `origin/main`，本机未提交的改动和未 push 的提交都到不了。部署前确认 `git status` 干净、`git log origin/main..HEAD` 为空。
3. **构建要能访问 npm registry**。三个 Dockerfile 都是 `corepack prepare pnpm@11.5.0`（下载 pnpm）+ `pnpm install --frozen-lockfile`（下载全部依赖），全程在容器里跑。只有 GitHub 通、npm registry 被墙或限速的机器上，`build` 会卡在第一步。另外构建产物加缓存要占几个 GB（api 镜像 483MB、worker 395MB、web 81MB），磁盘紧张时先 `docker system df` 看一眼。

前端不把对外地址编进构建产物（`apps/web/src/api.ts` 用的是 `import.meta.env.VITE_API_BASE_URL ?? location.origin`，`/api/` 由 nginx 反代到 `api:3000`），所以同一份镜像换 IP 或域名都不用重新 build。两条路线在这一点上行为一致。

### 首次部署要初始化管理员

数据库是空的时候，`deploy.sh` 结束时会提示执行：

```bash
sudo docker compose --env-file .env exec api node dist/cli/init-admin.js
```

带上 `--data` 迁移了旧库的话不需要这一步，原账号直接可用。

## 注意事项

- **目标机 Docker 要 25+**：本机用的是 containerd 镜像存储，`docker save` 出来的是 OCI 布局（层是压缩过的 blob），所以 `images.tar.gz` 只有 ~205MB、gzip 几乎压不动，老版本 Docker（24 及以前）可能 load 不了。`deploy.sh` 会检查版本并在过老时警告。
- **改密码的时机**：`POSTGRES_PASSWORD` 只在 PostgreSQL 首次 `initdb` 时生效，服务起来之后再改 `.env` 会导致 API 连不上库（要进容器 `ALTER ROLE` 才行）。Redis/MinIO 的密码每次启动都从环境变量读，随时可改。`SESSION_SECRET` 轮换会让所有人重新登录。
- **端口**：只有 web 发布到 `0.0.0.0:8080`，其余（api 3000、worker 3001、postgres 15432、redis 16379、minio 9000/9001、mailpit 8025）都只绑 `127.0.0.1`。云服务器需要在安全组放行 TCP 8080。
- **重启行为**：容器带 `restart: on-failure:5`，宿主机重启后会自动拉起，不依赖部署目录。但日常运维（`compose ps/logs/down`）还是要回到解压出来的目录，别删。
- **改代码后重新部署**：在开发机重新 `build` 出镜像，再跑一次 `make-bundle.sh`，目标机 `./deploy.sh --no-load` 之前先 `docker load` 新镜像；或者直接重传整个包。数据库数据卷不受影响。
- **web 镜像把 nginx 配置和静态资源一起烤进去了**，改前端必须重新 build web，不是挂载。
- **`env.bundle` 里是开发机的 `.env`**（含数据库/Redis/MinIO 密码和 `SESSION_SECRET`），权限 600。要换密码请改包内 `.env`，并遵守上面对 `POSTGRES_PASSWORD` 的说明。

## 手工验证

```bash
sudo docker compose --env-file .env ps              # 7 个容器，除 minio-init 外都应是 healthy/running
curl -fsS http://127.0.0.1:8080/health              # {"status":"ok"}
curl -fsS http://127.0.0.1:3000/health/ready        # API 就绪（说明迁移已跑完）
sudo docker compose --env-file .env logs --no-color --tail=50 api worker
```
