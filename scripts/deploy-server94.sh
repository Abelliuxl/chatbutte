#!/usr/bin/env bash

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-server94}"
REMOTE_DIR="${REMOTE_DIR:-/home/ubuntu/chatbutte}"
SERVICE_NAME="${SERVICE_NAME:-chatbutte}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Deploying ${ROOT_DIR} -> ${REMOTE_HOST}:${REMOTE_DIR}"

rsync -az --delete \
  --exclude ".git/" \
  --exclude ".claude/" \
  --exclude ".DS_Store" \
  --exclude "scripts/" \
  "${ROOT_DIR}/" "${REMOTE_HOST}:${REMOTE_DIR}/"

ssh "${REMOTE_HOST}" "cat > /tmp/${SERVICE_NAME}.conf" <<EOF
[program:${SERVICE_NAME}]
command=python3 ${REMOTE_DIR}/server.py --port 8080
directory=${REMOTE_DIR}
autostart=true
autorestart=true
user=ubuntu
redirect_stderr=true
stdout_logfile=/var/log/supervisor/${SERVICE_NAME}.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=5
EOF

ssh "${REMOTE_HOST}" \
  "sudo mv /tmp/${SERVICE_NAME}.conf /etc/supervisor/conf.d/${SERVICE_NAME}.conf && sudo supervisorctl reread && sudo supervisorctl update && sudo supervisorctl restart ${SERVICE_NAME} && sudo supervisorctl status ${SERVICE_NAME}"

echo "Deployment complete."
