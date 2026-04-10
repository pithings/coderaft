#!/bin/sh
# Build and run the coderaft Docker image.
#
# Usage:
#   ./scripts/docker.sh [extra args...]
#
# Environment variables:
#   IMAGE  Docker image tag (default: coderaft:local)
#   PORT   Port to expose (default: 6063)

IMAGE="${IMAGE:-coderaft:local}"
PORT="${PORT:-6063}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

docker build -t "$IMAGE" "$ROOT_DIR" || exit $?

docker rm -f coderaft 2>/dev/null

docker run --rm -it \
  --name coderaft \
  -p "$PORT:$PORT" \
  "$IMAGE" \
  coderaft /data/workspace --port "$PORT" "$@"
