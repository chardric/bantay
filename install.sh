#!/usr/bin/env bash
# Local Bantay Docker stack installer.
# Usage: ./install.sh [--rebuild]

set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

REBUILD=0
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    -h|--help)
      echo "Usage: $0 [--rebuild]"
      echo "  --rebuild   Force rebuild of local images"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Prereqs
log "Checking prerequisites..."
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Engine first."
docker compose version >/dev/null 2>&1 || die "docker compose plugin not found."
docker info >/dev/null 2>&1 || die "docker daemon unreachable. Start docker (or add user to docker group)."

# 2. .env scaffold
if [ ! -f .env ]; then
  log "Creating .env from .env.example"
  cp .env.example .env
  chmod 600 .env
fi
# shellcheck disable=SC1091
set -a; . ./.env; set +a

# 3. Free-port detection (HUB_PORT)
port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$p" 2>/dev/null | awk 'NR>1{exit 0} END{exit 1}'
  else
    (echo > "/dev/tcp/127.0.0.1/$p") >/dev/null 2>&1
  fi
}
desired_port="${HUB_PORT:-8090}"
chosen_port="$desired_port"
for i in 0 1 2 3 4 5 6 7 8 9; do
  candidate=$((desired_port + i))
  if ! port_in_use "$candidate"; then chosen_port="$candidate"; break; fi
done
if [ "$chosen_port" != "$desired_port" ]; then
  warn "Port $desired_port in use, using $chosen_port instead. Updating .env."
  sed -i.bak "s/^HUB_PORT=.*/HUB_PORT=$chosen_port/" .env && rm -f .env.bak
  HUB_PORT="$chosen_port"
fi

# 4. Directories
log "Ensuring data directories exist"
mkdir -p data/hub data/agent config backups
chmod 700 config

# 5. Build
if [ "$REBUILD" -eq 1 ]; then
  log "Rebuilding images (no cache)"
  docker compose build --no-cache bantay-hub bantay-agent
else
  log "Building images"
  docker compose build bantay-hub bantay-agent
fi

# 6. Start hub first; agent needs KEY from hub UI
log "Starting bantay-hub"
docker compose up -d bantay-hub bantay-backup

# 7. Wait for hub healthcheck
log "Waiting for hub to become healthy (timeout 90s)..."
deadline=$(( $(date +%s) + 90 ))
while :; do
  status="$(docker inspect --format '{{.State.Health.Status}}' bantay-hub 2>/dev/null || echo unknown)"
  case "$status" in
    healthy)  break ;;
    unhealthy) die "bantay-hub became unhealthy. Check: docker compose logs bantay-hub" ;;
  esac
  [ "$(date +%s)" -ge "$deadline" ] && die "Timed out waiting for bantay-hub to become healthy. Check: docker compose logs bantay-hub"
  sleep 2
done
log "Hub is healthy."

# 8. Agent: only start if KEY is present
key_value="$(grep -E '^KEY=' .env | cut -d= -f2- | tr -d '"' | tr -d "'")"
if [ -z "$key_value" ]; then
  cat <<EOF

==============================================================================
Bantay hub is running:  http://localhost:${HUB_PORT}

Next steps:
  1. Open the hub URL above and create the admin account.
  2. Click "Add System". Copy the SSH public key shown.
  3. Paste it into .env as:  KEY="ssh-ed25519 AAAA... user"
  4. Re-run this installer to start the agent:  ./install.sh
==============================================================================

EOF
  exit 0
fi

log "Starting bantay-agent"
docker compose up -d bantay-agent

cat <<EOF

==============================================================================
Bantay stack is up.
  Hub:    http://localhost:${HUB_PORT}
  Agent:  listening on host port ${AGENT_LISTEN:-45876}
  Backup: nightly at ${BACKUP_CRON_EXPRESSION:-0 3 * * *} -> ./backups/
==============================================================================

EOF
