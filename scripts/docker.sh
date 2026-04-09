#!/bin/sh
# Run coderaft inside a Docker container with lib/ bind-mounted.
#
# Usage:
#   ./scripts/docker.sh [extra args...]
#
# Environment variables:
#   IMAGE  Docker image (default: node:slim)
#   PORT   Port to expose (default: 6063)

IMAGE="${IMAGE:-node:lts-slim}"
PORT="${PORT:-6063}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

docker rm -f coderaft 2>/dev/null

docker run --rm -it \
  --name coderaft \
  -v "$ROOT_DIR":/coderaft \
  -p "$PORT:$PORT" \
  "$IMAGE" \
  sh -c "node /coderaft/lib/src/cli.ts /coderaft --port $PORT $*"
