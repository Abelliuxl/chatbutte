#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
HOST="${1:-server94}"
REV="$(git rev-parse --short HEAD)"
RELEASE="$(date +%Y%m%d-%H%M%S)-$REV"
TARGET="/home/ubuntu/chatbutte-releases/$RELEASE"
npm ci --no-audit --no-fund
npm run build
npm test
ssh "$HOST" "mkdir -p '$TARGET'"
rsync -az dist server shared package.json package-lock.json LICENSE README.md "$HOST:$TARGET/"
ssh "$HOST" "cd '$TARGET' && npm ci --omit=dev --ignore-scripts --no-audit --no-fund"
ssh "$HOST" bash -s -- "$TARGET" <<'REMOTE'
set -euo pipefail
TARGET="$1"
ACTIVE=/home/ubuntu/chatbutte
if [ ! -L "$ACTIVE" ]; then
  echo 'First-time migration required: active path must be a Node release symlink. See docs/DEPLOYMENT.md.' >&2
  exit 1
fi
PREVIOUS="$(readlink -f "$ACTIVE")"
ln -s "$TARGET" "$ACTIVE.next"
mv -Tf "$ACTIVE.next" "$ACTIVE"
rollback() {
  ln -s "$PREVIOUS" "$ACTIVE.rollback"
  mv -Tf "$ACTIVE.rollback" "$ACTIVE"
  sudo -n supervisorctl restart chatbutte || true
}
if ! sudo -n supervisorctl restart chatbutte; then rollback; exit 1; fi
OK=0
for _ in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then OK=1; break; fi
  sleep 1
done
if [ "$OK" != 1 ]; then rollback; echo 'Health check failed; previous release restored.' >&2; exit 1; fi
printf 'Deployed %s\n' "$TARGET"
REMOTE
curl --fail --silent --show-error https://liuxl.com.cn/chatbutte/api/health
printf '\n'
