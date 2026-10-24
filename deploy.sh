#!/usr/bin/env bash
# 增量部署：默认全部前端；-b 后端；-a 前后端；也可指定一个或多个相对路径。
set -Eeuo pipefail
trap 'status=$?; printf "部署失败（第 %s 行，退出码 %s）。\n" "$LINENO" "$status" >&2; exit "$status"' ERR

HOST="root@106.14.218.12"
KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS=(-o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o BatchMode=yes -i "$KEY")
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$PROJECT_ROOT"

fail() { printf '%s\n' "$1" >&2; exit 2; }
selected=()
restart_backend=false
shopt -s nullglob

case "${1:-}" in
    -b|-a)
        [[ $# -eq 1 ]] || fail "-b / -a 不可与文件参数混用。"
        [[ "$1" != -a ]] || selected+=(frontend)
        backend_files=(backend/*.py)
        [[ ${#backend_files[@]} -gt 0 ]] || fail "没有找到后端 Python 文件。"
        selected+=("${backend_files[@]}")
        restart_backend=true
        ;;
    "") selected=(frontend) ;;
    *)
        for supplied in "$@"; do
            case "$supplied" in
                frontend|frontend/*|backend/*) relative="$supplied" ;;
                -*) fail "不支持的选项：$supplied" ;;
                *) relative="frontend/$supplied" ;;
            esac
            selected+=("$relative")
        done
        ;;
esac

# 先检查所有参数，防止传到一半才发现路径无效；不上传链接指向的外部文件。
for relative in "${selected[@]}"; do
    [[ "$relative" != *$'\n'* && "$relative" != *$'\r'* ]] || fail "路径不能包含换行。"
    [[ -e "$relative" ]] || fail "找不到：$relative"
    resolved="$(realpath -- "$relative")"
    case "$resolved" in
        "$PROJECT_ROOT/frontend"|"$PROJECT_ROOT/frontend/"*) ;;
        "$PROJECT_ROOT/backend/"*) restart_backend=true ;;
        *) fail "仅允许部署 frontend / backend 内的文件：$relative" ;;
    esac
    [[ "$relative" != /* && "/$relative/" != */../* && "/$relative/" != */./* ]] || fail "请使用不含 . 或 .. 的项目相对路径。"
    [[ ! -L "$relative" ]] || fail "不部署符号链接：$relative"
    [[ -z "$(find "$relative" -type l -print -quit)" ]] || fail "目录包含符号链接：$relative"
done

if "$restart_backend"; then
    printf '先检查服务器 JWT 配置（不显示密钥）。\n'
    ssh "${SSH_OPTS[@]}" "$HOST" '/opt/blog/.venv/bin/python -' <<'BLOG_JWT_CHECK'
from dotenv import dotenv_values
secret = (dotenv_values('/opt/blog/.env').get('JWT_SECRET_KEY') or '').strip()
if not secret or secret == 'blog-dev-secret-key-change-in-production':
    raise SystemExit('服务器尚未配置独立 JWT_SECRET_KEY，已停止部署；请先补全配置。')
BLOG_JWT_CHECK
fi

printf '准备上传 %s 个文件或目录。\n' "${#selected[@]}"
ssh "${SSH_OPTS[@]}" "$HOST" 'mkdir -p /opt/blog/frontend /opt/blog/backend'
# tar 保留相对目录层级并递归包含 vendor；远端命令不拼接用户传入的路径。
tar -cf - -- "${selected[@]}" | ssh "${SSH_OPTS[@]}" "$HOST" 'tar -xf - -C /opt/blog'
if "$restart_backend"; then
    printf '文件已上传，等待服务重启和健康检查。\n'
    ssh "${SSH_OPTS[@]}" "$HOST" 'systemctl restart blog.service && systemctl is-active --quiet blog.service && curl --fail --silent --show-error --retry 30 --retry-delay 1 --retry-connrefused --retry-max-time 60 --max-time 5 http://127.0.0.1:8000/api/v1/health >/dev/null'
fi
printf '部署完成。\n'
