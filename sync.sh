#!/usr/bin/env bash
# Rebases our feature branch onto whatever upstream has released, so the next merge is one step
# and the conflicts, if any, are all in one place.
#
#   ./sync.sh            # rebase onto origin/main (the upstream mirror)
#   ./sync.sh v1.6.0     # rebase onto a given upstream tag
#
# Run it from the repository root. It leaves the working tree on the branch, ready to test; it
# does not push anything.
set -euo pipefail

BRANCH=${BRANCH:-feature/trackferry-plus}
TARGET=${1:-origin/main}

cd "$(git rev-parse --show-toplevel)"

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区不干净，先提交或 stash：" >&2
  git status --short >&2
  exit 1
fi

echo "== 拉取上游 =="
git fetch origin --tags --force

echo "== 切到 $BRANCH =="
git checkout "$BRANCH"

echo "== 当前基线 =="
git log --oneline -1 "$TARGET"

echo "== rebase 到 $TARGET =="
if ! git rebase "$TARGET"; then
  cat >&2 <<'EOF'

rebase 停在了冲突上。冲突文件里标着两边的内容：

  git status                 # 看哪些文件
  git diff                   # 看两边怎么改的
  # 改好后：
  git add <文件> && git rebase --continue
  # 想放弃：
  git rebase --abort

我们这边全部改动都在一个提交里，冲突只会出现在这一层。
EOF
  exit 1
fi

echo
echo "== rebase 完成，验证一下 =="
echo "  go vet ./... && go test ./..."
echo "  (cd web && npm ci && npm run build)"
echo
echo "都过了再打 tag 推上去。"
