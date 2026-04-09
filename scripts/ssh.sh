#!/bin/sh
# Deploy coderaft lib/ to a remote host via SSH and run the server.
#
# Usage:
#   ./scripts/ssh.sh [extra args...]
#
# Environment variables:
#   SSH_HOST  Remote host (default: 10.0.10.251)
#   SSH_PORT  SSH port (default: 8022)
#   PORT      Server port (default: 6063)

SSH_HOST="${SSH_HOST:-10.0.10.251}"
SSH_PORT="${SSH_PORT:-8022}"
PORT="${PORT:-6063}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="coderaft"

echo "=> Syncing lib/ to $SSH_HOST:~/$REMOTE_DIR/lib..."
tar -C "$ROOT_DIR" -cf - lib/ | ssh -p "$SSH_PORT" "$SSH_HOST" "mkdir -p ~/$REMOTE_DIR && tar -C ~/$REMOTE_DIR -xf -"

echo "=> Starting server on port $PORT (forwarding locally)..."
ssh -p "$SSH_PORT" -L "$PORT:localhost:$PORT" "$SSH_HOST" \
  "DEBUG=* node ~/$REMOTE_DIR/lib/src/cli.ts ~/$REMOTE_DIR --port $PORT $*"
