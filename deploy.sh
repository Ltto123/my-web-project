#!/bin/bash
# ============================================================
# deploy.sh — 轻量增量部署
# 用法:
#   bash deploy.sh              → 部署所有前端文件（不改后端）
#   bash deploy.sh style.css    → 只部署指定文件
#   bash deploy.sh -b           → 部署后端（会重启服务）
#   bash deploy.sh -a           → 全量部署
# ============================================================

HOST="root@106.14.218.12"
KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=yes -o BatchMode=yes"

cd "$(dirname "$0")"

deploy_frontend_file() {
    local f="$1"
    if [ -f "frontend/$f" ]; then
        scp -q $SSH_OPTS -i "$KEY" "frontend/$f" "$HOST:/opt/blog/frontend/"
        echo "  ✓ $f"
    else
        echo "  ✗ 找不到: $f"
    fi
}

deploy_backend() {
    scp -q $SSH_OPTS -i "$KEY" backend/*.py "$HOST:/opt/blog/backend/"
    ssh -q $SSH_OPTS -i "$KEY" "$HOST" "systemctl restart blog.service" &
    echo "  ✓ 后端已上传，服务重启中..."
}

case "${1:-}" in
    -b)
        echo ">>> 部署后端..."
        deploy_backend
        ;;
    -a)
        echo ">>> 部署前端..."
        scp -q $SSH_OPTS -i "$KEY" frontend/* "$HOST:/opt/blog/frontend/"
        echo "  ✓ 前端完成"
        echo ">>> 部署后端..."
        deploy_backend
        ;;
    "")
        echo ">>> 部署前端..."
        for f in frontend/*; do
            deploy_frontend_file "$(basename "$f")"
        done
        echo "✅ 完成"
        ;;
    *)
        echo ">>> 部署指定文件..."
        for f in "$@"; do
            if [[ "$f" == backend/* ]]; then
                scp -q $SSH_OPTS -i "$KEY" "$f" "$HOST:/opt/blog/backend/"
                ssh -q $SSH_OPTS -i "$KEY" "$HOST" "systemctl restart blog.service" &
                echo "  ✓ $f（服务重启中）"
            else
                deploy_frontend_file "$f"
            fi
        done
        echo "✅ 完成"
        ;;
esac
