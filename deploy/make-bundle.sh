#!/usr/bin/env bash
# 在开发机生成离线部署包：镜像 + compose.yaml + 环境模板 + deploy.sh 打成一个 tar.gz。
# 目标服务器解压后执行包内的 deploy.sh 即可整套启动，无需源码、无需 Docker Hub。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/compose.yaml"
ROOT_ENV="${COMPOSE_ENV_FILE:-$ROOT_DIR/.env}"

OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist-deploy}"
BUNDLE_NAME="${BUNDLE_NAME:-}"
WITH_BASE_IMAGES=0
WITH_DATA=0
ONLY_SERVICES=""
UPDATE_MODE=0

# 数据卷归档时用的镜像，按可用性自动挑一个（目标机是海外机器，用 alpine 即可）。
ARCHIVE_IMAGE_CANDIDATES=("alpine:3.21" "node:24-alpine" "alpine:latest")

info() { printf '==> %s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: deploy/make-bundle.sh [选项]

  --with-base-images   同时打包 postgres/redis/mailpit（目标机无法访问 Docker Hub 时需要）
  --with-data          同时打包数据卷（postgres/redis/minio），要求本机服务已停止
  --only <服务[,服务]>  只打包这些服务的镜像，用于功能更新。例: --only web（约 25MB）
                       可选: web / api / worker，逗号分隔
  --out <dir>          产物目录，默认 <repo>/dist-deploy
  -h, --help           显示帮助

产物: <dir>/share-mind-map-deploy.tar.gz（用 --only 时是 share-mind-map-update.tar.gz）
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --with-base-images) WITH_BASE_IMAGES=1 ;;
    --with-data) WITH_DATA=1 ;;
    --only)
      [ $# -ge 2 ] || die "--only 需要一个服务列表参数"
      ONLY_SERVICES="$2"
      shift
      ;;
    --out)
      [ $# -ge 2 ] || die "--out 需要一个目录参数"
      OUT_DIR="$2"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "未知参数: $1（用 --help 查看用法）" ;;
  esac
  shift
done

[ -f "$COMPOSE_FILE" ] || die "找不到 $COMPOSE_FILE"

# 本机 docker 可能需要 sudo（会话早于 docker 组变更时）。
DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
  else
    die "无法访问 Docker，请确认 docker 已安装且当前用户有权限"
  fi
fi
# shellcheck disable=SC2086  # $DOCKER 需要按词拆分
dk() { $DOCKER "$@"; }

dk compose version >/dev/null 2>&1 || die "缺少 docker compose v2 插件"

# ---- 解析 compose.yaml，避免镜像版本与 compose 脱节 ----

# 允许用环境变量覆盖（调试/多套环境时有用）。
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
if [ -z "$PROJECT_NAME" ]; then
  PROJECT_NAME="$(
    grep -E '^COMPOSE_PROJECT_NAME=' "$ROOT_ENV" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
  )"
fi
PROJECT_NAME="${PROJECT_NAME:-share-mind-map}"

mapfile -t BUILD_SERVICES < <(
  awk '
    BEGIN { in_services = 0; n = 0; svc = "" }
    /^services:[[:space:]]*$/ { in_services = 1; next }
    in_services && /^[^[:space:]]/ { in_services = 0 }
    in_services && /^  [A-Za-z0-9_.-]+:[[:space:]]*$/ {
      svc = $1
      sub(/:$/, "", svc)
      order[++n] = svc
      next
    }
    in_services && /^    build:[[:space:]]*$/ { if (svc != "") has_build[svc] = 1 }
    END { for (i = 1; i <= n; i++) if (has_build[order[i]]) print order[i] }
  ' "$COMPOSE_FILE"
)
[ "${#BUILD_SERVICES[@]}" -gt 0 ] || die "没有在 compose.yaml 里解析到任何带 build 的服务"

APP_IMAGES=()
if [ -n "$ONLY_SERVICES" ]; then
  # 更新模式：只导出被点名的服务镜像，包体积按服务算（web 约 25MB）。
  IFS=',' read -r -a REQUESTED <<<"$ONLY_SERVICES"
  for svc in "${REQUESTED[@]}"; do
    svc="${svc// /}"
    [ -n "$svc" ] || continue
    hit=0
    for known in "${BUILD_SERVICES[@]}"; do
      [ "$known" = "$svc" ] && hit=1
    done
    [ "$hit" -eq 1 ] || die "--only 里的 '$svc' 不是 compose.yaml 的可构建服务（可选: ${BUILD_SERVICES[*]}）"
    APP_IMAGES+=("${PROJECT_NAME}-${svc}:latest")
  done
  BUNDLE_NAME="${BUNDLE_NAME:-share-mind-map-update}"
  UPDATE_MODE=1
  info "更新模式：只打包 ${APP_IMAGES[*]}"
else
  for svc in "${BUILD_SERVICES[@]}"; do
    APP_IMAGES+=("${PROJECT_NAME}-${svc}:latest")
  done
  BUNDLE_NAME="${BUNDLE_NAME:-share-mind-map-deploy}"
fi

REQUIRED_IMAGES=()
BASE_IMAGES=()
while read -r img; do
  [ -n "$img" ] || continue
  case "$img" in
    # quay.io 的 MinIO 系列已下架，无法再拉取，必须随包搬运。
    quay.io/*) REQUIRED_IMAGES+=("$img") ;;
    *) BASE_IMAGES+=("$img") ;;
  esac
done < <(grep -E '^    image:' "$COMPOSE_FILE" | awk '{print $2}')

if [ -n "$ONLY_SERVICES" ]; then
  IMAGES=("${APP_IMAGES[@]}")
elif [ "$WITH_BASE_IMAGES" -eq 1 ]; then
  IMAGES=("${APP_IMAGES[@]}" "${REQUIRED_IMAGES[@]}" "${BASE_IMAGES[@]}")
else
  IMAGES=("${APP_IMAGES[@]}" "${REQUIRED_IMAGES[@]}")
  info "不打包 postgres/redis/mailpit（目标机需能访问 Docker Hub），需要时加 --with-base-images"
fi

for img in "${IMAGES[@]}"; do
  dk image inspect "$img" >/dev/null 2>&1 || die "本机缺少镜像 $img，请先 docker compose --env-file .env build 并 up 过一次"
done

# ---- 数据卷 ----

ARCHIVE_IMAGE=""
if [ "$WITH_DATA" -eq 1 ]; then
  if [ -n "$(dk compose --env-file "$ROOT_ENV" ps -q 2>/dev/null || true)" ]; then
    die "打包数据前需要先停服务：$DOCKER compose --env-file .env down"
  fi
  for img in "${ARCHIVE_IMAGE_CANDIDATES[@]}"; do
    if dk image inspect "$img" >/dev/null 2>&1; then
      ARCHIVE_IMAGE="$img"
      break
    fi
  done
  [ -n "$ARCHIVE_IMAGE" ] || die "找不到可用于归档数据卷的镜像（试过: ${ARCHIVE_IMAGE_CANDIDATES[*]}）"
fi

# ---- 打包 ----

mkdir -p "$OUT_DIR"
STAGE="$OUT_DIR/$BUNDLE_NAME"
rm -rf "$STAGE"
mkdir -p "$STAGE"

info "复制 compose.yaml / 环境模板 / deploy.sh"
cp "$COMPOSE_FILE" "$STAGE/compose.yaml"
cp "$SCRIPT_DIR/deploy.sh" "$STAGE/deploy.sh"
cp "$SCRIPT_DIR/README.md" "$STAGE/README.md"
chmod 755 "$STAGE/deploy.sh"
if [ "$UPDATE_MODE" -eq 1 ]; then : >"$STAGE/.update-package"; fi

if [ -f "$ROOT_ENV" ]; then
  cp "$ROOT_ENV" "$STAGE/env.bundle"
  chmod 600 "$STAGE/env.bundle"
else
  cp "$ROOT_DIR/.env.example" "$STAGE/env.bundle"
  chmod 600 "$STAGE/env.bundle"
  warn "本机没有 .env，已用 .env.example 作为环境模板（deploy.sh 会自动改写公网地址）"
fi

if [ "$WITH_DATA" -eq 1 ]; then
  info "归档数据卷（镜像: $ARCHIVE_IMAGE）"
  DATA_STAGE="$STAGE/.data-stage"
  mkdir -p "$DATA_STAGE"
  for vol in postgres-data redis-data minio-data; do
    name="${PROJECT_NAME}_${vol}"
    if ! dk volume inspect "$name" >/dev/null 2>&1; then
      warn "卷 $name 不存在，跳过"
      continue
    fi
    dk run --rm -v "$name":/data:ro -v "$DATA_STAGE":/backup "$ARCHIVE_IMAGE" \
      tar czf "/backup/vol-${vol}.tgz" -C /data .
    info "已归档 $name ($(du -h "$DATA_STAGE/vol-${vol}.tgz" | cut -f1))"
  done
  tar czf "$STAGE/data.tar.gz" -C "$DATA_STAGE" .
  rm -rf "$DATA_STAGE"
fi

DIRTY_COUNT="$(git -C "$ROOT_DIR" status --porcelain 2>/dev/null | wc -l || echo 0)"
if [ "$DIRTY_COUNT" -gt 0 ]; then
  warn "工作区有 $DIRTY_COUNT 个未提交改动。包里装的是本机现有镜像，若这些改动还没 build 进镜像，包里就是旧代码："
  warn "  先跑 docker compose --env-file .env build web api worker && docker compose --env-file .env up -d 再打包"
fi

info "导出镜像，共 ${#IMAGES[@]} 个"
dk save "${IMAGES[@]}" | gzip -1 >"$STAGE/images.tar.gz"
printf '%s\n' "${IMAGES[@]}" >"$STAGE/images.list"

# 注意：本机若使用 containerd 镜像存储，save 出来的是 OCI 布局（层是压缩过的 blob），
# 因此体积接近最终大小、gzip 收益很小。目标机 Docker 需要 25+ 才能直接 load。
DOCKER_VERSION="$(dk version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)"

{
  echo "bundle: $BUNDLE_NAME"
  echo "created: $(date -Iseconds)"
  echo "project: $PROJECT_NAME"
  echo "source-docker: $DOCKER_VERSION"
  echo "git-commit: $(git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "git-dirty: $(git -C "$ROOT_DIR" status --porcelain 2>/dev/null | wc -l) 个文件有未提交改动"
  echo "with-base-images: $WITH_BASE_IMAGES"
  echo "with-data: $WITH_DATA"
  echo
  echo "[images]"
  for img in "${IMAGES[@]}"; do
    echo "  $img  $(dk image inspect "$img" --format '{{.Id}}' | cut -c1-19)"
  done
} >"$STAGE/MANIFEST.txt"

info "打包 tar.gz"
tar czf "$OUT_DIR/${BUNDLE_NAME}.tar.gz" -C "$OUT_DIR" "$BUNDLE_NAME"
rm -rf "$STAGE"

BUNDLE="$OUT_DIR/${BUNDLE_NAME}.tar.gz"
info "完成: $BUNDLE ($(du -h "$BUNDLE" | cut -f1))"
sha256sum "$BUNDLE" | tee "$BUNDLE.sha256"
cat <<EOF

传到目标服务器并运行：
  scp $BUNDLE <user>@<host>:~/
  ssh <user>@<host>
  tar xzf $(basename "$BUNDLE") && cd $BUNDLE_NAME && ./deploy.sh
EOF
