#!/bin/bash
# Benchmark install size and time for code-server-slim, code-server, and openvscode-server.
# Runs inside a fresh Docker container for reproducible results.
set -euo pipefail

IMAGE="${IMAGE:-node:22}"
OVSX_TAG="${OVSX_TAG:-openvscode-server-v1.109.5}"

echo "=== Install benchmarks (image: $IMAGE) ==="
echo ""

docker run --rm -e "OVSX_TAG=$OVSX_TAG" "$IMAGE" bash -c '
set -euo pipefail

fmt() { numfmt --to=iec-i --suffix=B "$1" 2>/dev/null || echo "$1 bytes"; }

echo "--- code-server-slim ---"
cd /tmp && mkdir slim && cd slim
START=$(date +%s%N)
npm i --loglevel=error code-server-slim 2>&1 | tail -1
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))
SIZE=$(du -sb node_modules/ | cut -f1)
DEPS=$(npm ls --all --parseable 2>/dev/null | tail -n +3 | wc -l)
echo "  Install time:  ${MS} ms"
echo "  Disk size:     $(fmt $SIZE)"
echo "  Dependencies:  $DEPS"
echo ""

echo "--- code-server ---"
cd /tmp && mkdir cs && cd cs
START=$(date +%s%N)
npm i --loglevel=error --unsafe-perm code-server 2>&1 | tail -1
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))
SIZE=$(du -sb node_modules/ | cut -f1)
DEPS=$(npm ls --all --parseable 2>/dev/null | tail -n +3 | wc -l)
echo "  Install time:  ${MS} ms"
echo "  Disk size:     $(fmt $SIZE)"
echo "  Dependencies:  $DEPS"
echo ""

echo "--- openvscode-server ---"
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  OVSX_ARCH="linux-x64" ;;
  aarch64) OVSX_ARCH="linux-arm64" ;;
  armv7l)  OVSX_ARCH="linux-armhf" ;;
  *)       echo "  Unsupported arch: $ARCH"; exit 0 ;;
esac
TARBALL="${OVSX_TAG}-${OVSX_ARCH}.tar.gz"
URL="https://github.com/gitpod-io/openvscode-server/releases/download/${OVSX_TAG}/${TARBALL}"
echo "  Version: $OVSX_TAG ($OVSX_ARCH)"
cd /tmp
START=$(date +%s%N)
curl -sL "$URL" | tar xz
END=$(date +%s%N)
MS=$(( (END - START) / 1000000 ))
DIR="${OVSX_TAG}-${OVSX_ARCH}"
SIZE=$(du -sb "$DIR" | cut -f1)
echo "  Install time:  ${MS} ms (download + extract)"
echo "  Disk size:     $(fmt $SIZE)"
echo "  Dependencies:  bundled"
'
