#!/usr/bin/env bash
# 在目标服务器上执行（部署包内）：加载镜像 -> 生成/改写 .env -> 启动整套服务 -> 健康检查。
# 依赖：docker + docker compose v2。不需要源码、不需要 pnpm、不需要访问 Docker Hub。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_URL=""
SKIP_LOAD=0
DRY_RUN=0
DATA_ARCHIVE=""
ARCHIVE_IMAGE="${ARCHIVE_IMAGE:-alpine:3.21}"

info() { printf '==> %s\n' "$*"; }
warn() { printf '警告: %s\n' "$*" >&2; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法: ./deploy.sh [选项]

  --public-url <url>   对外访问地址，默认按 http://<公网IP>:<WEB_PORT> 自动推导
                       例: --public-url http://1.2.3.4:8080
  --data <file>        启动前恢复数据卷归档（make-bundle.sh --with-data 产出的 data.tar.gz）
  --no-load            跳过镜像导入（镜像已在目标机本地时用）
  --dry-run            只做检查与 .env 改写，不真正启动容器
  -h, --help           显示帮助

更新场景：拿到新的更新包后重复执行本脚本即可（会 load 新镜像并只重建有变化的容器）。
          .env 已存在时不会改写对外地址，除非显式传 --public-url。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --public-url)
      [ $# -ge 2 ] || die "--public-url 需要一个参数"
      PUBLIC_URL="$2"
      shift
      ;;
    --data)
      [ $# -ge 2 ] || die "--data 需要一个文件参数"
      DATA_ARCHIVE="$2"
      shift
      ;;
    --no-load) SKIP_LOAD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "未知参数: $1（用 --help 查看用法）" ;;
  esac
  shift
done

cd "$HERE" || die "无法进入 $HERE"

# ---- 环境检查 ----

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    DOCKER="sudo docker"
    warn "当前用户没有 docker 权限，已自动改用 sudo（建议 usermod -aG docker $USER 后重登）"
  else
    die "无法访问 Docker。请先安装并启动 docker：apt install -y docker.io docker-compose-v2"
  fi
fi
# shellcheck disable=SC2086  # $DOCKER 需要按词拆分
dk() { $DOCKER "$@"; }

dk compose version >/dev/null 2>&1 ||
  die "缺少 docker compose v2 插件，请执行：apt install -y docker-compose-v2"

[ -f compose.yaml ] || die "当前目录缺少 compose.yaml，请在解压出来的部署包目录里运行"

# ---- .env ----

ENV_CREATED=0
if [ ! -f .env ]; then
  if [ -f env.bundle ]; then
    cp env.bundle .env
    chmod 600 .env
    ENV_CREATED=1
    info "已从 env.bundle 生成 .env"
  elif [ -f .env.example ]; then
    cp .env.example .env
    chmod 600 .env
    ENV_CREATED=1
    info "已从 .env.example 生成 .env"
  else
    die "找不到 .env / env.bundle / .env.example，无法生成配置。若这是更新包，请先跑一次完整部署包"
  fi
fi

env_value() {
  local key="$1" default="$2" line
  line="$(grep -E "^${key}=" .env | tail -n 1 || true)"
  if [ -n "$line" ]; then printf '%s' "${line#*=}"; else printf '%s' "$default"; fi
}

set_env() {
  local key="$1" value="$2" escaped
  escaped="$(printf '%s' "$value" | sed -e 's/[&|\\]/\\&/g')"
  if grep -qE "^${key}=" .env; then
    sed -i -E "s|^${key}=.*$|${key}=${escaped}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

is_private_ip() {
  case "$1" in
    10.* | 127.* | 192.168.* | 172.1[6-9].* | 172.2[0-9].* | 172.3[01].*) return 0 ;;
    *) return 1 ;;
  esac
}

detect_public_ip() {
  local url ip
  for url in https://api.ipify.org https://ifconfig.me/ip https://ipinfo.io/ip https://icanhazip.com https://ip.sb; do
    ip="$(curl -fsS --max-time 5 "$url" 2>/dev/null | tr -d '[:space:]' || true)"
    [ -n "$ip" ] || continue
    case "$ip" in *[!0-9.]*) continue ;; esac
    [ "$(printf '%s' "$ip" | tr -cd '.' | wc -c)" -ge 3 ] || continue
    printf '%s' "$ip"
    return 0
  done
  return 1
}

PROJECT_NAME="$(env_value COMPOSE_PROJECT_NAME share-mind-map)"
WEB_PORT="$(env_value WEB_PORT 8080)"
API_PORT="$(env_value API_PORT 3000)"

WRITE_URL=0
if [ -n "$PUBLIC_URL" ]; then
  WRITE_URL=1
elif [ "$ENV_CREATED" -eq 0 ]; then
  # .env 已存在：沿用现有地址，避免更新时把手工配好的域名/公网地址覆盖掉。
  PUBLIC_URL="$(env_value WEB_ORIGIN "http://127.0.0.1:${WEB_PORT}")"
  info "沿用 .env 里已有的对外地址: $PUBLIC_URL（要改就传 --public-url）"
else
  detected_ip="$(detect_public_ip || true)"
  if [ -n "$detected_ip" ]; then
    info "自动探测到公网 IP: $detected_ip"
  else
    detected_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$detected_ip" ] || is_private_ip "$detected_ip"; then
      cat >&2 <<EOF
错误: 无法自动识别公网地址（探测接口均不可用，本机地址 ${detected_ip:-未知} 是内网地址）。
      请显式指定对外地址后重跑，例如：
        ./deploy.sh --public-url http://<公网IP>:${WEB_PORT}
      或者改用域名：--public-url https://mindmap.example.com
EOF
      exit 1
    fi
    warn "探测接口都不可用，改用本机地址 $detected_ip"
  fi
  PUBLIC_URL="http://${detected_ip}:${WEB_PORT}"
  WRITE_URL=1
  info "将使用对外地址: $PUBLIC_URL"
fi

if [ "$WRITE_URL" -eq 1 ]; then
  set_env WEB_ORIGIN "$PUBLIC_URL"
  set_env API_PUBLIC_URL "$PUBLIC_URL"
  info "已写入 .env: WEB_ORIGIN / API_PUBLIC_URL = $PUBLIC_URL"
fi

if [ -f .update-package ] && [ "$ENV_CREATED" -eq 1 ]; then
  warn "这是更新包，但当前目录里没有 .env，说明它没被解压到原有部署目录上。"
  warn "更新已有部署请这样解压（不要放进新目录）："
  warn "  tar xzf <更新包>.tar.gz --strip-components=1 -C <原有部署目录>"
fi

# ---- 导入镜像 ----

# 镜像归档是 OCI 布局，需要 Docker 25+ 才能直接 load。
TARGET_DOCKER_VERSION="$(dk version --format '{{.Server.Version}}' 2>/dev/null || echo unknown)"
TARGET_DOCKER_MAJOR="${TARGET_DOCKER_VERSION%%.*}"
case "$TARGET_DOCKER_MAJOR" in
  '' | *[!0-9]*) warn "无法识别 Docker 版本（$TARGET_DOCKER_VERSION）" ;;
  *)
    if [ "$TARGET_DOCKER_MAJOR" -lt 25 ]; then
      warn "目标机 Docker $TARGET_DOCKER_VERSION 偏老，可能无法 load 本包（需要 25+）；失败就先升级 Docker"
    fi
    ;;
esac

if [ "$SKIP_LOAD" -eq 0 ]; then
  [ -f images.tar.gz ] || die "缺少 images.tar.gz（或加 --no-load 跳过导入）"
  info "导入镜像（$(du -h images.tar.gz | cut -f1)），这一步比较慢，请勿中断"
  gunzip -c images.tar.gz | dk load
else
  info "已跳过镜像导入（--no-load）"
fi

if [ -f images.list ]; then
  while read -r img; do
    [ -n "$img" ] || continue
    dk image inspect "$img" >/dev/null 2>&1 ||
      die "镜像缺失: $img（导入失败或包不完整）"
  done <images.list
  info "镜像校验通过（$(grep -c . images.list) 个）"
fi

# ---- 恢复数据卷（可选，必须在启动前做） ----

if [ -n "$DATA_ARCHIVE" ]; then
  [ -f "$DATA_ARCHIVE" ] || die "找不到数据归档 $DATA_ARCHIVE"
  info "恢复数据前先停止现有容器"
  dk compose --env-file .env down || true

  TMP_DATA="$(mktemp -d)"
  trap 'rm -rf "$TMP_DATA"' EXIT
  tar xzf "$DATA_ARCHIVE" -C "$TMP_DATA"
  for archive in "$TMP_DATA"/vol-*.tgz; do
    [ -f "$archive" ] || continue
    vol="$(basename "$archive" .tgz)"
    vol="${vol#vol-}"
    name="${PROJECT_NAME}_${vol}"
    info "恢复 $name"
    # 卷要重建：既能保证是干净恢复，也能带上 compose 认的标签
    # （否则 compose 会警告 volume 不是它创建的，并因此重建容器）。
    dk volume rm -f "$name" >/dev/null 2>&1 || true
    dk volume create \
      --label "com.docker.compose.project=${PROJECT_NAME}" \
      --label "com.docker.compose.volume=${vol}" \
      "$name" >/dev/null
    dk run --rm -v "$name":/data -v "$TMP_DATA":/backup:ro "$ARCHIVE_IMAGE" \
      tar xzf "/backup/vol-${vol}.tgz" -C /data
  done
fi

# ---- 启动 ----

# 在恢复数据之后判断，避免带数据部署时误提示初始化管理员。
FRESH_INSTALL=1
if dk volume inspect "${PROJECT_NAME}_postgres-data" >/dev/null 2>&1; then
  FRESH_INSTALL=0
fi

if [ "$DRY_RUN" -eq 1 ]; then
  info "dry-run: 校验 compose 编排"
  dk compose --env-file .env up -d --dry-run >/dev/null
  info "dry-run 通过，未启动任何容器"
  exit 0
fi

info "启动服务"
dk compose --env-file .env up -d

# ---- 健康检查 ----

http_ok() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$1" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q -T 5 -O /dev/null "$1" >/dev/null 2>&1
  else
    return 1
  fi
}

if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
  info "等待 web 与 api 就绪（最多 180 秒）"
  web_ok=0
  api_ok=0
  for _ in $(seq 1 90); do
    if [ "$web_ok" -eq 0 ] && http_ok "http://127.0.0.1:${WEB_PORT}/health"; then web_ok=1; fi
    if [ "$api_ok" -eq 0 ] && http_ok "http://127.0.0.1:${API_PORT}/health/ready"; then api_ok=1; fi
    if [ "$web_ok" -eq 1 ] && [ "$api_ok" -eq 1 ]; then break; fi
    sleep 2
  done
else
  warn "目标机没有 curl/wget，跳过 HTTP 健康探测"
  web_ok="?"
  api_ok="?"
fi

echo
dk compose --env-file .env ps
echo

if [ "$web_ok" = "1" ] && [ "$api_ok" = "1" ]; then
  info "部署完成：$PUBLIC_URL"
else
  warn "服务已启动但健康检查未全部通过（web=$web_ok api=$api_ok），看日志："
  echo "  $DOCKER compose --env-file .env logs --no-color --tail=100 api worker web"
fi

cat <<EOF

访问地址
  Web          $PUBLIC_URL
  API 就绪     http://127.0.0.1:${API_PORT}/health/ready

常用命令（在本目录执行）
  $DOCKER compose --env-file .env ps
  $DOCKER compose --env-file .env logs --no-color -f api
  $DOCKER compose --env-file .env down      # 停止，保留数据卷
EOF

if [ "$FRESH_INSTALL" -eq 1 ]; then
  cat <<EOF

首次部署：数据库是空的，需要创建首个管理员
  $DOCKER compose --env-file .env exec api node dist/cli/init-admin.js
  （只显示一次临时密码，首次登录必须改密）
EOF
fi

info "提示：记得在云控制台/防火墙放行 TCP ${WEB_PORT}，否则外部访问不通"
