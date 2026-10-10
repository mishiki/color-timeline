#!/bin/sh

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or later is required. Install Node.js, then run this script again." >&2
  exit 1
fi

exec node server.mjs
