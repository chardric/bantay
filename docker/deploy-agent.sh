#!/usr/bin/env bash
# Deploy bantay-agent to a remote docker host, auto-discovering all real disks
# on that host and bind-mounting each one as a separate /extra-filesystems entry
# so the agent reports them all individually.
#
# Usage:  deploy-agent.sh <host_ip> <arch>   # arch: amd64 | arm64 | armv7
# Run from this machine; assumes ~/.ssh keys for richard@<host_ip>.

set -euo pipefail

HOST="${1:?missing host_ip}"
ARCH="${2:?missing arch (amd64|arm64|armv7)}"

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# Cross-compiled agent binaries live in BANTAY_BUILD_DIR (default /tmp/bantay-agent-builds)
# so this script can be checked into git while the binaries (~9 MB each) stay out.
BUILD_DIR="${BANTAY_BUILD_DIR:-/tmp/bantay-agent-builds}"
AGENT_BIN="$BUILD_DIR/agent-$ARCH"
# Prefer Dockerfile.thin alongside this script; fall back to BUILD_DIR.
DOCKERFILE="$SCRIPT_DIR/Dockerfile.thin"
[ -f "$DOCKERFILE" ] || DOCKERFILE="$BUILD_DIR/Dockerfile.thin"

[ -x "$AGENT_BIN" ] || { echo "missing $AGENT_BIN — cross-compile first"; exit 2; }
[ -f "$DOCKERFILE" ] || { echo "missing $DOCKERFILE"; exit 2; }

# Discover real (block-device-backed) mountpoints on the remote host using
# findmnt --real (excludes pseudo filesystems by design).
echo ">>> [$HOST] discovering disks..."
MOUNTS=$(ssh -o BatchMode=yes "richard@$HOST" "findmnt --real --list --noheadings --output SOURCE,TARGET | awk '\$1 ~ /^\/dev\// {print \$2}' | sort -u")

EXTRAS=()
while IFS= read -r mp; do
    [ -z "$mp" ] && continue
    case "$mp" in
        / | /boot | /boot/* | /var/lib/docker* )
            continue ;;
    esac
    EXTRAS+=("$mp")
done <<< "$MOUNTS"

if [ ${#EXTRAS[@]} -eq 0 ]; then
    echo ">>> [$HOST] no extra disks discovered — root only"
else
    echo ">>> [$HOST] extra disks found:"
    printf '       %s\n' "${EXTRAS[@]}"
fi

# Build the compose file.
COMPOSE=$(mktemp)
trap 'rm -f "$COMPOSE"' EXIT

cat > "$COMPOSE" <<'EOF'
services:
  bantay-agent:
    image: bantay-local/agent:local
    container_name: bantay-agent
    restart: unless-stopped
    network_mode: host
    pid: host
    privileged: true
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /dev:/dev
      - ./data:/var/lib/bantay-agent
EOF

for mp in "${EXTRAS[@]}"; do
    # Use the mountpoint's basename as the in-container name. If two
    # mountpoints share a basename, fall back to a path-derived label.
    name=$(basename "$mp")
    [ "$name" = "/" ] && name="root"
    printf '      - %s:/extra-filesystems/%s:ro\n' "$mp" "$name" >> "$COMPOSE"
done

cat >> "$COMPOSE" <<'EOF'
    environment:
      TZ: Asia/Manila
      KEY: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBZJC06qMGWLHq8nGCS5ykgdC+MLJKL32y0uuDvZAR8u beszel-hub"
      LISTEN: "45876"
      LOG_LEVEL: "info"
EOF

echo ">>> [$HOST] generated compose:"
sed 's/^/       /' "$COMPOSE"

echo ">>> [$HOST] copying binary, Dockerfile, compose..."
scp -q "$AGENT_BIN" "$DOCKERFILE" "$COMPOSE" "richard@$HOST:/tmp/"

echo ">>> [$HOST] building image and recreating container..."
ssh -o BatchMode=yes "richard@$HOST" "
    set -e
    cd /tmp
    mv -f agent-$ARCH agent
    docker build -t bantay-local/agent:local -f Dockerfile.thin .
    mkdir -p ~/docker-apps/active/beszel-agent
    cp /tmp/$(basename "$COMPOSE") ~/docker-apps/active/beszel-agent/docker-compose.yml
    cd ~/docker-apps/active/beszel-agent
    docker compose down
    docker compose up -d
    sleep 1
    docker ps --format '{{.Names}}\t{{.Status}}' | grep bantay-agent
"
echo ">>> [$HOST] done"
