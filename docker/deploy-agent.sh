#!/usr/bin/env bash
# Install bantay-agent on a remote host as either a docker container or a
# native systemd service.
#
# Usage:
#   deploy-agent.sh <host_ip> <arch> [--mode docker|native]
#
# Defaults: --mode=docker. Use --mode=native for tiny hosts (RPi, OrangePi)
# where docker overhead is unwelcome, or hosts without docker installed.
#
# Arch values: amd64 | arm64 | armv7
# (uname -m mapping: x86_64=amd64, aarch64=arm64, armv7l=armv7)
#
# Both modes:
#   - Expect cross-compiled agent binary at $BANTAY_BUILD_DIR/agent-<arch>
#     (default: /tmp/bantay-agent-builds). Auto-cross-compiles if missing
#     and run from inside the bantay repo tree.
#   - SSH in as user 'richard' with key auth + passwordless sudo on target.
#   - Install the agent listening on :45876 with the shared hub SSH key.
#
# Docker mode:
#   - Builds bantay-local/agent:local on the target using docker/Dockerfile.thin.
#   - Auto-discovers all real disks via findmnt and bind-mounts each as
#     /extra-filesystems/<basename>:ro. Container runs privileged + pid=host
#     (needed for SMART + DRM fdinfo GPU collector).
#   - Writable bind-mount on ./data so hub auto-updates persist across
#     container recreates.
#
# Native mode:
#   - Installs binary at /opt/bantay-agent/bantay-agent owned by 'beszel'
#     system user.
#   - Drops /etc/systemd/system/bantay-agent.service with ProtectSystem=strict
#     + ReadWritePaths=/opt/bantay-agent so hub auto-updates can swap binaries.
#   - Extra filesystems are NOT auto-discovered for native installs. Edit the
#     unit and add Environment="EXTRA_FILESYSTEMS=/mnt/foo,/mnt/bar" if needed.
#
# Exits non-zero on missing prereqs, sha256 mismatch on upload, or service
# failure. Idempotent: rerunning replaces the binary and recreates the service.

set -euo pipefail

usage() {
    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \?//' | head -n -1
}

HOST=""
ARCH=""
MODE="docker"

while [ $# -gt 0 ]; do
    case "$1" in
        --mode) MODE="${2:?--mode needs a value}"; shift 2 ;;
        --mode=*) MODE="${1#--mode=}"; shift ;;
        -h|--help) usage; exit 0 ;;
        --) shift; break ;;
        -*) echo "unknown flag: $1" >&2; exit 2 ;;
        *)
            if   [ -z "$HOST" ]; then HOST="$1"
            elif [ -z "$ARCH" ]; then ARCH="$1"
            else echo "unexpected positional arg: $1" >&2; exit 2
            fi
            shift ;;
    esac
done

[ -n "$HOST" ] || { echo "missing <host_ip>" >&2; exit 2; }
[ -n "$ARCH" ] || { echo "missing <arch> (amd64|arm64|armv7)" >&2; exit 2; }
case "$ARCH" in
    amd64|arm64|armv7) ;;
    *) echo "invalid arch: $ARCH (want amd64|arm64|armv7)" >&2; exit 2 ;;
esac
case "$MODE" in
    docker|native) ;;
    *) echo "invalid mode: $MODE (want docker|native)" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="${BANTAY_BUILD_DIR:-/tmp/bantay-agent-builds}"
AGENT_BIN="$BUILD_DIR/agent-$ARCH"

# Hub's SSH ed25519 public key — agents accept connections from any client
# whose key matches this. Mirrors `KEY` env across all docker-compose files.
HUB_SSH_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBZJC06qMGWLHq8nGCS5ykgdC+MLJKL32y0uuDvZAR8u beszel-hub"

# Cross-compile if the binary is missing and we're sitting in the repo.
if [ ! -x "$AGENT_BIN" ]; then
    if [ -d "$REPO_ROOT/internal/cmd/agent" ]; then
        echo ">>> [build] $AGENT_BIN missing — cross-compiling from $REPO_ROOT"
        mkdir -p "$BUILD_DIR"
        case "$ARCH" in
            amd64) GOENV=(GOOS=linux GOARCH=amd64) ;;
            arm64) GOENV=(GOOS=linux GOARCH=arm64) ;;
            armv7) GOENV=(GOOS=linux GOARCH=arm GOARM=7) ;;
        esac
        # Prefer /usr/local/go (newer toolchain) when available; the system
        # /usr/bin/go on some Debian boxes can segfault under GOTOOLCHAIN=auto.
        GO_BIN="go"
        if [ -x /usr/local/go/bin/go ]; then
            export PATH="/usr/local/go/bin:$PATH"
            export GOTOOLCHAIN=local
        fi
        ( cd "$REPO_ROOT" && \
          env CGO_ENABLED=0 "${GOENV[@]}" "$GO_BIN" build -ldflags '-w -s' -o "$AGENT_BIN" ./internal/cmd/agent )
    else
        echo "missing $AGENT_BIN and no repo at $REPO_ROOT to cross-compile from." >&2
        echo "Set BANTAY_BUILD_DIR or run this script from inside the bantay repo." >&2
        exit 2
    fi
fi
[ -x "$AGENT_BIN" ] || { echo "binary still missing: $AGENT_BIN" >&2; exit 2; }

LOCAL_SHA=$(sha256sum "$AGENT_BIN" | head -c 64)
echo ">>> [$HOST] mode=$MODE arch=$ARCH binary_sha=${LOCAL_SHA:0:12}"

# SSH + sudo preflight so we fail fast with a clear error instead of mid-install.
ssh -o ConnectTimeout=5 -o BatchMode=yes "richard@$HOST" 'sudo -n true' \
    || { echo "SSH or passwordless sudo to richard@$HOST failed" >&2; exit 2; }

if [ "$MODE" = "docker" ]; then
    # ----- DOCKER MODE -----
    DOCKERFILE="$SCRIPT_DIR/Dockerfile.thin"
    [ -f "$DOCKERFILE" ] || DOCKERFILE="$BUILD_DIR/Dockerfile.thin"
    [ -f "$DOCKERFILE" ] || { echo "missing $DOCKERFILE" >&2; exit 2; }

    # Confirm docker is available on the target before building.
    ssh "richard@$HOST" 'command -v docker >/dev/null && docker --version >/dev/null' \
        || { echo "docker not available on richard@$HOST — use --mode native instead" >&2; exit 2; }

    echo ">>> [$HOST] discovering disks..."
    MOUNTS=$(ssh "richard@$HOST" "findmnt --real --list --noheadings --output SOURCE,TARGET | awk '\$1 ~ /^\/dev\// {print \$2}' | sort -u")
    EXTRAS=()
    while IFS= read -r mp; do
        [ -z "$mp" ] && continue
        case "$mp" in
            / | /boot | /boot/* | /var/lib/docker* ) continue ;;
        esac
        EXTRAS+=("$mp")
    done <<< "$MOUNTS"
    if [ ${#EXTRAS[@]} -eq 0 ]; then
        echo ">>> [$HOST] no extra disks discovered — root only"
    else
        echo ">>> [$HOST] extra disks found:"
        printf '       %s\n' "${EXTRAS[@]}"
    fi

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
        name=$(basename "$mp")
        [ "$name" = "/" ] && name="root"
        printf '      - %s:/extra-filesystems/%s:ro\n' "$mp" "$name" >> "$COMPOSE"
    done
    cat >> "$COMPOSE" <<EOF
    environment:
      TZ: Asia/Manila
      KEY: "$HUB_SSH_KEY"
      LISTEN: "45876"
      LOG_LEVEL: "info"
      BANTAY_AGENT_INSTALL_PATH: "/var/lib/bantay-agent/agent"
EOF

    echo ">>> [$HOST] copying binary, Dockerfile, compose..."
    scp -q "$AGENT_BIN" "$DOCKERFILE" "$COMPOSE" "richard@$HOST:/tmp/"

    REMOTE_SHA=$(ssh "richard@$HOST" "sha256sum /tmp/agent-$ARCH | head -c 64")
    [ "$REMOTE_SHA" = "$LOCAL_SHA" ] || { echo "sha mismatch local=$LOCAL_SHA remote=$REMOTE_SHA" >&2; exit 3; }

    echo ">>> [$HOST] building image and recreating container..."
    ssh "richard@$HOST" "
        set -e
        cd /tmp
        mv -f agent-$ARCH agent
        docker build -t bantay-local/agent:local -f Dockerfile.thin .
        mkdir -p ~/docker-apps/active/beszel-agent
        cp /tmp/$(basename "$COMPOSE") ~/docker-apps/active/beszel-agent/docker-compose.yml
        cd ~/docker-apps/active/beszel-agent
        docker compose down 2>/dev/null || true
        docker compose up -d
        sleep 1
        docker ps --format '{{.Names}}\t{{.Status}}' | grep bantay-agent
    "
    echo ">>> [$HOST] done (docker)"

else
    # ----- NATIVE MODE -----
    echo ">>> [$HOST] copying binary..."
    scp -q "$AGENT_BIN" "richard@$HOST:/tmp/bantay-agent.new"

    REMOTE_SHA=$(ssh "richard@$HOST" "sha256sum /tmp/bantay-agent.new | head -c 64")
    [ "$REMOTE_SHA" = "$LOCAL_SHA" ] || { echo "sha mismatch local=$LOCAL_SHA remote=$REMOTE_SHA" >&2; exit 3; }

    echo ">>> [$HOST] installing user, binary, systemd unit..."
    ssh "richard@$HOST" "set -e
        sudo useradd --system --shell /usr/sbin/nologin --home-dir /var/lib/bantay-agent --create-home beszel 2>/dev/null || true
        sudo mkdir -p /opt/bantay-agent
        sudo install -o beszel -g beszel -m 0755 /tmp/bantay-agent.new /opt/bantay-agent/bantay-agent
        sudo chown -R beszel:beszel /opt/bantay-agent /var/lib/bantay-agent
        rm -f /tmp/bantay-agent.new

        sudo tee /etc/systemd/system/bantay-agent.service >/dev/null <<UNIT
[Unit]
Description=Bantay Agent
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=/opt/bantay-agent/bantay-agent
User=beszel
Group=beszel
Restart=always
RestartSec=3

# Hub-pushed self-update writes /opt/bantay-agent/bantay-agent.new then renames.
# ReadWritePaths punches through ProtectSystem=strict.
ReadWritePaths=/opt/bantay-agent
StateDirectory=bantay-agent

Environment=LISTEN=45876
Environment=LOG_LEVEL=info
Environment=BANTAY_AGENT_INSTALL_PATH=/opt/bantay-agent/bantay-agent
Environment=\"KEY=$HUB_SSH_KEY\"

KeyringMode=private
LockPersonality=yes
ProtectClock=yes
ProtectHome=read-only
ProtectHostname=yes
ProtectKernelLogs=yes
ProtectSystem=strict
RemoveIPC=yes
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT

        sudo systemctl daemon-reload
        sudo systemctl enable bantay-agent >/dev/null
        sudo systemctl restart bantay-agent
        sleep 2
        echo --- service:
        sudo systemctl is-active bantay-agent
        echo --- listener:
        sudo ss -tlnp 2>&1 | grep 45876 || { echo 'NOT LISTENING'; exit 1; }
    "
    echo ">>> [$HOST] done (native)"
fi

echo ""
echo "Next: add the system in the Bantay UI"
echo "  http://10.254.254.5:8091  ->  Add System  ->  Host: $HOST  Port: 45876"
