# ARM 开发机打包部署指南

> **适用场景**：开发机从 amd64 Linux 换成 arm64 Linux，打包后部署到生产机（AWS arm64 EC2，`https://testhub.kitarx.com`）。
> **结论**：生产机和开发机同架构后，不再需要 QEMU，直接原生构建再打包即可；`deploy/deploy.sh` 的部署流程不变。

---

## 1. 一次性准备

arm 开发机上需要：

- arm64 Linux（`uname -m` 为 `aarch64`）；
- Docker 25+ 和 `docker compose` v2 插件，当前用户有权限（脚本也会自动退回 `sudo`）；
- 完整的源码目录；
- **`deploy/.env`**（被打包脚本使用，且不在 git 里，必须单独拷贝，权限 600）。

如果新机也要本地开发、跑测试，还需要 Node 24、pnpm 11.5.0，并重新安装依赖；**只打包部署则不需要**，依赖都在 Docker 构建阶段安装。

### 从旧机迁移时

拷贝：

```bash
rsync -av --exclude node_modules --exclude dist-deploy \
  <旧机>:/path/share-mind-map/ ./share-mind-map/
chmod 600 share-mind-map/.env share-mind-map/deploy/.env
```

`.env` 和 `deploy/.env` 虽然被 git 忽略，但不在上面的排除列表里，会随 rsync 一起过来；如果用 `git clone` 迁移，则需要手动 `scp` 这两个文件。

不要带走：

- `node_modules/`：含 amd64 原生模块（如 API 的 `argon2`），换架构后不可用；
- `dist-deploy/`：里面的包是 amd64 镜像，必须重新打。

生产机的 SSH 私钥（`~/.ssh/kitar.id.pem`）也要拷到新机。

---

## 2. 首次在 arm 机构建

镜像不在项目目录里，迁移后第一次必须构建：

```bash
cd share-mind-map

docker compose --env-file deploy/.env build web api worker

# 确认产物是 arm64
docker image inspect share-mind-map-web:latest --format '{{.Os}}/{{.Architecture}}'
# 期望输出 linux/arm64
```

基础镜像（postgres / redis / minio / mailpit / node / nginx）都有 arm64 版本，正常拉取即可。

---

## 3. 打包

### 日常更新包（只改了一两个服务）

```bash
COMPOSE_ENV_FILE=deploy/.env deploy/make-bundle.sh --only web
```

产物：`dist-deploy/share-mind-map-update.tar.gz`。

### 完整部署包（首次安装或全量重装）

```bash
COMPOSE_ENV_FILE=deploy/.env deploy/make-bundle.sh
```

产物：`dist-deploy/share-mind-map-deploy.tar.gz`。

注意：

- 打包的是**本机现有镜像**，不是源码。改了代码要先重新 `docker compose ... build`。
- 不要加 `--with-base-images`；生产机能自己拉基础镜像。
- `make-bundle.sh` 默认读根目录 `.env`，所以必须显式传 `COMPOSE_ENV_FILE=deploy/.env`。
- `deploy/make-arm64-bundle.sh` 在 arm 机上仍可用，只是退化成“同架构重打标签”，日常直接用上面的命令更简单。

---

## 4. 部署到生产机

### 更新已有部署

```bash
scp -i ~/.ssh/kitar.id.pem dist-deploy/share-mind-map-update.tar.gz \
  ec2-user@15.232.217.124:~/

ssh -i ~/.ssh/kitar.id.pem ec2-user@15.232.217.124
tar xzf ~/share-mind-map-update.tar.gz --strip-components=1 -C ~/share-mind-map-deploy
cd ~/share-mind-map-deploy
./deploy.sh
```

- 必须解压到**原部署目录**（`--strip-components=1`），不要解到新目录，否则会丢现有 `.env` 和会话。
- 更新时**不要传 `--public-url`**，`.env` 已存在，脚本会沿用现有地址。

### 首次安装（全新机器）

```bash
scp -i ~/.ssh/kitar.id.pem dist-deploy/share-mind-map-deploy.tar.gz \
  ec2-user@15.232.217.124:~/

ssh -i ~/.ssh/kitar.id.pem ec2-user@15.232.217.124
tar xzf share-mind-map-deploy.tar.gz
cd share-mind-map-deploy
./deploy.sh --public-url https://testhub.kitarx.com

# 创建管理员（临时密码只显示一次）
docker compose --env-file .env exec api node dist/cli/init-admin.js
```

首次安装**必须**传 `--public-url`，否则会写成 `deploy/.env` 里的旧开发机地址。

### 部署后验证

```bash
docker compose --env-file .env ps
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:3000/health/ready
```

外部访问 `https://testhub.kitarx.com/health` 应返回 200；除一次性退出的 `minio-init` 外，其余容器应为 healthy。

---

## 5. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 打包脚本报找不到 `deploy/.env` | 迁移时漏拷，补上并 `chmod 600` |
| 报“本机缺少镜像 `share-mind-map-web:latest`” | 还没在新机 build，先执行第 2 节 |
| `--skip-build` 失败 | 迁移后首次没有 `:arm64` 镜像，去掉该参数正常构建 |
| 构建/运行报 platform mismatch | `:latest` 被错架构镜像占用；重新用 arm 机 build |
| 生产机 `deploy.sh` 找不到 `env.bundle` | 用了更新包但目录里没有原 `.env`，先跑一次完整部署包 |
| 更新后地址被改写 | 更新时误传了 `--public-url`，恢复 `.env` 中的 `WEB_ORIGIN` / `API_PUBLIC_URL` |
| 生产机访问不了 Docker Hub / cgr.dev | 基础镜像由生产机自行拉取，确认目标机出网正常 |
