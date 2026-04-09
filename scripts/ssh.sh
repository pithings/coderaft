#!/bin/sh
# Deploy coderaft lib/ to a remote host via SSH and run the server.
#
# Usage:
#   ./scripts/ssh.sh <host> [-p ssh_port] [extra args...]
#
# Environment variables:
#   PORT       Local port (default: 6063)
#   REMOTE_PORT  Remote server port (default: random)

SSH_HOST="$1"
if [ -z "$SSH_HOST" ]; then
  echo "Usage: $0 <host> [-p ssh_port] [extra args...]" >&2
  exit 1
fi
shift

SSH_PORT=22
while getopts "p:" opt; do
  case "$opt" in
    p) SSH_PORT="$OPTARG" ;;
    *) echo "Usage: $0 <host> [-p ssh_port] [extra args...]" >&2; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

PORT="${PORT:-6063}"
REMOTE_PORT="${REMOTE_PORT:-$(shuf -i 10000-65000 -n 1)}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_DIR="coderaft"

echo "=> Syncing lib/ and shims/ to $SSH_HOST:~/$REMOTE_DIR/..."
tar -C "$ROOT_DIR" --no-xattrs -h -cf - lib/ shims/ | ssh -p "$SSH_PORT" "$SSH_HOST" "mkdir -p ~/$REMOTE_DIR && tar -C ~/$REMOTE_DIR -xf -"

echo "=> Starting server on remote port $REMOTE_PORT (forwarding to localhost:$PORT and localhost:$REMOTE_PORT)..."
ssh -t -p "$SSH_PORT" -L "$PORT:localhost:$REMOTE_PORT" -L "$REMOTE_PORT:localhost:$REMOTE_PORT" "$SSH_HOST" \
  "DEBUG=* node ~/$REMOTE_DIR/lib/src/cli.ts ~/$REMOTE_DIR --port $REMOTE_PORT $*"
