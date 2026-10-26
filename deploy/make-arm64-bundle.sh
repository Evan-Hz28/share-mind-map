#!/usr/bin/env bash
# 构建 arm64 镜像并打离线更新包，全程不改动本机 :latest 的长期指向。
#
# 背景：本机是 amd64，生产是 arm64，而镜像名固定是 <project>-<service>:latest。
# 直接 build arm64 会把 :latest 覆盖成 arm64，之后本机 compose up 会报
# "requested image's platform (linux/arm64) does not match the detected host platform"。
# 这里把 arm64 构建到 :arm64，只在调用 make-bundle.sh 的那一刻临时把它指成 :latest，
# 结束后（包括失败和 Ctrl-C）再恢复原来的 :latest 镜像。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARM_COMPOSE="$SCRIPT_DIR/compose.arm64.yaml"
DEPLOY_ENV="$SCRIPT_DIR/.env"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/dist-deploy}"

SERVICES="web,api,worker"
SKIP_BUILD=0

info() { printf '==> %s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: deploy/make-arm64-bundle.sh [选项]

  --only <服务[,服务]>  只处理这些服务，默认 web,api,worker。例: --only web
  --skip-build          跳过 arm64 构建，直接用现有的 :arm64 镜像
  --out <dir>           传给 make-bundle.sh 的产物目录，默认 <repo>/dist-deploy
  -h, --help            显示帮助

流程: build linux/arm64 -> 校验架构 -> 临时 retag 成 :latest -> make-bundle.sh -> 恢复 :latest
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --only)
      [ $# -ge 2 ] || die "--only 需要一个服务列表参数"
      SERVICES="$2"
      shift
      ;;
    --skip-build) SKIP_BUILD=1 ;;
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

[ -f "$ROOT_DIR/compose.yaml" ] || die "找不到 $ROOT_DIR/compose.yaml"
[ -f "$ARM_COMPOSE" ] || die "找不到 $ARM_COMPOSE"
[ -f "$DEPLOY_ENV" ] || die "找不到 $DEPLOY_ENV（打包用的环境文件，含真实配置）"

# 本机 docker 可能需要 sudo（会话早于 docker 组变更时），和 make-bundle.sh 保持一致。
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

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-}"
if [ -z "$PROJECT_NAME" ]; then
  PROJECT_NAME="$(
    grep -E '^COMPOSE_PROJECT_NAME=' "$DEPLOY_ENV" 2>/dev/null | tail -n 1 | cut -d= -f2- || true
  )"
fi
PROJECT_NAME="${PROJECT_NAME:-share-mind-map}"

IFS=',' read -r -a SERVICE_LIST <<<"$SERVICES"
for svc in "${SERVICE_LIST[@]}"; do
  case "$svc" in
    web | api | worker) ;;
    *) die "--only 里的 '$svc' 不支持（可选: web / api / worker）" ;;
  esac
done
[ "${#SERVICE_LIST[@]}" -gt 0 ] || die "--only 不能为空"

if [ "$SKIP_BUILD" -eq 0 ]; then
  info "构建 linux/arm64 镜像: ${SERVICE_LIST[*]}"
  COMPOSE_ARGS=(
    compose
    -f "$ROOT_DIR/compose.yaml"
    -f "$ARM_COMPOSE"
    --env-file "$DEPLOY_ENV"
    build
    "${SERVICE_LIST[@]}"
  )
  # sudo 默认会清环境变量，DOCKER_DEFAULT_PLATFORM 必须通过 env 显式带进去。
  if [ "$DOCKER" = "sudo docker" ]; then
    sudo env DOCKER_DEFAULT_PLATFORM=linux/arm64 docker "${COMPOSE_ARGS[@]}"
  else
    DOCKER_DEFAULT_PLATFORM=linux/arm64 docker "${COMPOSE_ARGS[@]}"
  fi
fi

# 逐个校验架构，任何一个是 amd64 都直接退出，避免把错架构打进包。
for svc in "${SERVICE_LIST[@]}"; do
  image="$PROJECT_NAME-$svc:arm64"
  dk image inspect "$image" >/dev/null 2>&1 || die "找不到 $image，先去掉 --skip-build"
  arch="$(dk image inspect "$image" --format '{{.Os}}/{{.Architecture}}')"
  [ "$arch" = "linux/arm64" ] || die "$image 的架构是 $arch，不是 linux/arm64"
done

declare -A PREVIOUS_ID=()
restore_latest() {
  for svc in "${SERVICE_LIST[@]}"; do
    image="$PROJECT_NAME-$svc"
    previous="${PREVIOUS_ID[$svc]:-}"
    if [ -n "$previous" ]; then
      dk tag "$previous" "$image:latest" >/dev/null 2>&1 || true
    else
      # 原来就没有 :latest，只摘掉临时标签；:arm64 仍在，镜像不会丢。
      dk image rm "$image:latest" >/dev/null 2>&1 || true
    fi
  done
}
trap restore_latest EXIT

for svc in "${SERVICE_LIST[@]}"; do
  image="$PROJECT_NAME-$svc"
  PREVIOUS_ID[$svc]="$(dk image inspect "$image:latest" --format '{{.Id}}' 2>/dev/null || true)"
  dk tag "$image:arm64" "$image:latest"
done

info "打包（:latest 临时指向 arm64，结束自动恢复）"
COMPOSE_ENV_FILE="$DEPLOY_ENV" "$SCRIPT_DIR/make-bundle.sh" --only "$SERVICES" --out "$OUT_DIR"
