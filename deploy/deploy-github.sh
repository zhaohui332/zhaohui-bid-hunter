#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

export GITHUB_USER="${GITHUB_USER:-zhaohui332}"
export GITHUB_REPO="${GITHUB_REPO:-zhaohui-bid-hunter}"
if [ -z "${GITHUB_TOKEN:-}" ]; then
  read -r -s -p "请输入 GitHub Personal Access Token: " GITHUB_TOKEN
  echo
  export GITHUB_TOKEN
fi

if command -v node >/dev/null 2>&1; then
  NODE_BIN="node"
else
  NODE_BIN="/Users/linjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
fi

"$NODE_BIN" deploy/deploy-github.mjs
