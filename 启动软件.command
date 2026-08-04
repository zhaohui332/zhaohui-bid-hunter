#!/bin/zsh
cd "$(dirname "$0")"
export PATH="/Users/linjunjie/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH"
exec node server/index.js
