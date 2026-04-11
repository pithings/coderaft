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

# Detect remote OS (Windows vs POSIX) — on Windows, default SSH shell is cmd.exe
# which doesn't understand `~`, `mkdir -p`, or `VAR=value cmd` syntax.
REMOTE_OS="$(ssh -p "$SSH_PORT" "$SSH_HOST" "uname -s 2>/dev/null || ver" 2>/dev/null)"
case "$REMOTE_OS" in
  *Windows*|*Microsoft*) IS_WINDOWS=1 ;;
  *) IS_WINDOWS=0 ;;
esac

echo "=> Syncing lib/ and shims/ to $SSH_HOST:~/$REMOTE_DIR/..."
if [ "$IS_WINDOWS" = "1" ]; then
  # Prepare remote dir & wipe stale sources in a separate ssh call so stdin
  # of the second call is cleanly consumed only by `tar -xf -`.
  ssh -p "$SSH_PORT" "$SSH_HOST" "if not exist \"%USERPROFILE%\\$REMOTE_DIR\" mkdir \"%USERPROFILE%\\$REMOTE_DIR\"" || exit 1
  ssh -p "$SSH_PORT" "$SSH_HOST" "if exist \"%USERPROFILE%\\$REMOTE_DIR\\lib\\src\" rmdir /S /Q \"%USERPROFILE%\\$REMOTE_DIR\\lib\\src\"" || true
  ssh -p "$SSH_PORT" "$SSH_HOST" "if exist \"%USERPROFILE%\\$REMOTE_DIR\\shims\" rmdir /S /Q \"%USERPROFILE%\\$REMOTE_DIR\\shims\"" || true
  # tar.exe ships with Windows 10+ and understands `-xf -` from stdin.
  tar -C "$ROOT_DIR" --no-xattrs -h -cf - lib/ shims/ | ssh -p "$SSH_PORT" "$SSH_HOST" "tar -C \"%USERPROFILE%\\$REMOTE_DIR\" -xf -" || exit 1
  # Verify a known file reached the remote with the expected content.
  ssh -p "$SSH_PORT" "$SSH_HOST" "findstr /C:\"pathToFileURL\" \"%USERPROFILE%\\$REMOTE_DIR\\lib\\src\\server.ts\" >nul && echo sync-verified || echo sync-WARN-old-server-ts"
else
  tar -C "$ROOT_DIR" --no-xattrs -h -cf - lib/ shims/ | ssh -p "$SSH_PORT" "$SSH_HOST" "mkdir -p ~/$REMOTE_DIR && tar -C ~/$REMOTE_DIR -xf -"
fi

echo "=> Starting server on remote port $REMOTE_PORT (forwarding to localhost:$PORT and localhost:$REMOTE_PORT)..."
if [ "$IS_WINDOWS" = "1" ]; then
  ssh -t -p "$SSH_PORT" -L "$PORT:localhost:$REMOTE_PORT" -L "$REMOTE_PORT:localhost:$REMOTE_PORT" "$SSH_HOST" \
    "set DEBUG=* && node \"%USERPROFILE%\\$REMOTE_DIR\\lib\\src\\cli.ts\" \"%USERPROFILE%\\$REMOTE_DIR\" --port $REMOTE_PORT $*"
else
  ssh -t -p "$SSH_PORT" -L "$PORT:localhost:$REMOTE_PORT" -L "$REMOTE_PORT:localhost:$REMOTE_PORT" "$SSH_HOST" \
    "DEBUG=* node ~/$REMOTE_DIR/lib/src/cli.ts ~/$REMOTE_DIR --port $REMOTE_PORT $*"
fi
