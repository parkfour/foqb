#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Park Four, LLC
# SPDX-License-Identifier: AGPL-3.0-or-later

# One-command / one-click local launcher for FOQB.
# Starts a complete, self-contained local instance with Docker.
#
# Usage:
#   ./quickstart.sh          # start FOQB and open in browser (http://localhost:8090)
#   ./quickstart.sh down     # stop running containers
#   ./quickstart.sh logs     # view container logs
#   ./quickstart.sh status   # check container status
#   ./quickstart.sh restart  # restart containers

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

log()  { printf '\033[1;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; notify "FOQB Error" "$1"; exit 1; }

notify() {
  local title="$1" msg="$2"
  if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    if command -v notify-send >/dev/null 2>&1; then
      notify-send "$title" "$msg" 2>/dev/null || true
      return
    fi
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    osascript -e "display notification \"$msg\" with title \"$title\"" 2>/dev/null || true
  fi
}

open_browser() {
  local url="$1"
  if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$url" >/dev/null 2>&1 &
      return
    fi
  fi
  if [ "$(uname -s)" = "Darwin" ]; then
    open "$url" >/dev/null 2>&1 &
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 -m webbrowser "$url" >/dev/null 2>&1 &
    return
  fi
}

# Subcommands
case "${1:-}" in
  down|stop)
    log "Stopping FOQB..."
    docker compose -f docker/compose.yml down
    ok "FOQB stopped."
    exit 0
    ;;
  logs)
    docker compose -f docker/compose.yml logs -f
    exit 0
    ;;
  status|ps)
    docker compose -f docker/compose.yml ps
    exit 0
    ;;
  restart)
    log "Restarting FOQB..."
    docker compose -f docker/compose.yml restart
    ok "FOQB restarted."
    exit 0
    ;;
  help|-h|--help)
    echo "Usage: ./quickstart.sh [down|logs|status|restart]"
    echo "  (no args)  Start FOQB and open in browser"
    echo "  down       Stop all containers"
    echo "  logs       Follow container logs"
    echo "  status     Check container status"
    echo "  restart    Restart containers"
    exit 0
    ;;
esac

# 1. Docker checks
if ! command -v docker >/dev/null 2>&1; then
  die "Docker is not installed. Please install Docker (https://docs.docker.com/get-docker/) to run FOQB."
fi

if ! command -v curl >/dev/null 2>&1; then
  die "curl is required to check that FOQB has started. Please install curl."
fi

if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose (v2) is required. Please install or update Docker Compose."
fi

if ! docker info >/dev/null 2>&1; then
  die "Docker daemon is not running. Please start Docker Desktop or the Docker service and run this again."
fi

# 2. Prepare environment file
if [ ! -f docker/.env ]; then
  # New secrets can't open a database made with the old ones.
  volume="${COMPOSE_PROJECT_NAME:-foqb}_db-data"
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    die "docker/.env is missing, but a database from an earlier install exists (volume $volume). Put that install's docker/.env back, or start over with: docker volume rm $volume (then restore your data from a backup)."
  fi
  log "Generating initial configuration in docker/.env..."
  docker/setup.sh "http://localhost:8090"
fi

PORT=8090
if [ -f docker/.env ]; then
  p=$(grep '^APP_PORT=' docker/.env | cut -d= -f2 || true)
  if [ -n "$p" ]; then PORT="$p"; fi
fi
URL="http://localhost:${PORT}"

# 3. Start containers
log "Starting FOQB containers with Docker Compose..."
notify "FOQB" "Starting local instance..."
docker compose -f docker/compose.yml up -d

# 4. Wait for web server to respond
log "Waiting for FOQB to be ready at $URL..."
ready=0
for i in $(seq 1 45); do
  if curl -s --max-time 2 -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null | grep -q '^[23]'; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -eq 1 ]; then
  echo
  printf '\033[1;32m==========================================================\033[0m\n'
  printf '\033[1;32m  FOQB is ready! Open: %s\033[0m\n' "$URL"
  printf '\033[1;32m==========================================================\033[0m\n\n'
  echo "Getting started:"
  echo "  1. Sign up for your account — the first account becomes the Site Admin."
  echo "  2. Create your organization — starter chart of accounts is seeded automatically."
  echo "  3. Stop anytime with: ./quickstart.sh down"
  echo
  notify "FOQB Ready" "FOQB is running at $URL"
  open_browser "$URL"
else
  warn "Containers started, but FOQB did not respond within 90 seconds."
  warn "Check logs with: ./quickstart.sh logs"
  warn "Check container status with: ./quickstart.sh status"
fi
