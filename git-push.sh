#!/bin/bash
# ============================================================
# git-push.sh — 标准化 Git 提交流程
# 用法: bash git-push.sh [commit message]
# 未传 message 时自动生成 Conventional Commit 信息
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

REMOTE="origin"
BRANCH="main"

# ── 1. 检查工作区状态 ──
echo ">>> 检查工作区状态..."
git status --short

# 如果没有任何改动，直接退出
if git diff-index --quiet HEAD -- 2>/dev/null && [ -z "$(git ls-files --others --exclude-standard)" ]; then
    echo "✅ 工作区干净，无需提交。"
    exit 0
fi

# ── 2. 生成 Commit Message ──
if [ $# -ge 1 ]; then
    MESSAGE="$*"
else
    # 自动生成 Conventional Commit 格式：type(scope): summary
    ADDED=$(git diff --cached --name-only 2>/dev/null | wc -l)
    MODIFIED=$(git diff --name-only 2>/dev/null | wc -l)
    DELETED=$(git diff --cached --diff-filter=D --name-only 2>/dev/null | wc -l)
    NEW_FILES=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l)

    # 推断 type
    if [ "$DELETED" -gt 0 ] && [ "$ADDED" -eq 0 ] && [ "$MODIFIED" -eq 0 ]; then
        TYPE="chore"
    elif [ "$NEW_FILES" -gt 0 ]; then
        TYPE="feat"
    elif [ "$ADDED" -gt 0 ] || [ "$MODIFIED" -gt 0 ]; then
        TYPE="fix"
    else
        TYPE="chore"
    fi

    # 推断 scope
    CHANGES=""
    for f in $(git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null); do
        case "$f" in
            backend/*)   SCOPE="backend" ;;
            frontend/*)  SCOPE="frontend" ;;
            docs/*)      SCOPE="docs" ;;
            openspec/*)  SCOPE="openspec" ;;
            *.md)        SCOPE="docs" ;;
            *.sh|*.ps1)  SCOPE="devops" ;;
            *)           SCOPE="root" ;;
        esac
    done

    TIMESTAMP="$(date '+%Y-%m-%d %H:%M')"
    MESSAGE="${TYPE}(${SCOPE}): update at ${TIMESTAMP}"
fi

echo ""
echo ">>> Commit 信息: ${MESSAGE}"

# ── 3. 暂存所有变更 ──
git add -A

# ── 4. 提交 ──
git commit -m "${MESSAGE}"

# ── 5. 推送到远程仓库 ──
echo ""
echo ">>> 推送到 ${REMOTE}/${BRANCH}..."
git push "${REMOTE}" "${BRANCH}"

echo ""
echo "========================================"
echo "  ✅ 提交并推送成功"
echo "  Remote: ${REMOTE}/${BRANCH}"
echo "  Message: ${MESSAGE}"
echo "========================================"
