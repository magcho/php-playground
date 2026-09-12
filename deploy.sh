#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${PHBOX_DATA:-/var/lib/phbox/data}"
INI_PATH="${PHBOX_INI:-/var/lib/phbox/php.ini}"
COMPOSE=(docker compose --project-directory "$ROOT")
LEGACY_CONTAINERS=(phbox phbox-web phbox-runner php-playground php-playground-web-1)

log() { echo "[phbox] $*"; }
err() { echo "[phbox] ERROR: $*" >&2; }

ensure_env() {
  if [[ ! -f "$ROOT/.env" ]]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    sed -i "s|^PHBOX_DATA=.*|PHBOX_DATA=$DATA_DIR|" "$ROOT/.env"
    sed -i "s|^PHBOX_INI=.*|PHBOX_INI=$INI_PATH|" "$ROOT/.env"
    log "created .env from .env.example"
  fi

  # Migrate existing .env that predates RUNNER_TOKEN
  if ! grep -q '^RUNNER_TOKEN=' "$ROOT/.env"; then
    TOKEN="$(openssl rand -hex 24)"
    printf '\nRUNNER_TOKEN=%s\n' "$TOKEN" >>"$ROOT/.env"
    log "appended RUNNER_TOKEN to existing .env"
  fi

  # Replace known placeholders
  if grep -Eq '^RUNNER_TOKEN=(change-me-to-a-long-random-string|change-me|changeme|secret|password|dev-token)?[[:space:]]*$' "$ROOT/.env"; then
    TOKEN="$(openssl rand -hex 24)"
    sed -i "s|^RUNNER_TOKEN=.*|RUNNER_TOKEN=$TOKEN|" "$ROOT/.env"
    log "replaced placeholder RUNNER_TOKEN"
  fi

  # Final validation
  TOKEN_VALUE="$(grep -E '^RUNNER_TOKEN=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '\r')"
  if [[ -z "$TOKEN_VALUE" || ${#TOKEN_VALUE} -lt 16 ]]; then
    err "RUNNER_TOKEN must be set to at least 16 characters in .env"
    exit 1
  fi
}

check_runsc() {
  log "checking gVisor (runsc) Docker runtime registration"
  if ! docker info --format '{{json .Runtimes}}' | grep -q '"runsc"'; then
    cat <<'EOF' >&2
[phbox] ERROR: Docker runtime "runsc" is not registered.

Install gVisor on this Proxmox guest (nested virt NOT required), then merge it
into /etc/docker/daemon.json (do NOT blindly overwrite existing settings):

  # Example (Debian/Ubuntu) — see https://gvisor.dev/docs/user_guide/install/
  curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
  sudo apt-get update && sudo apt-get install -y runsc

  # Merge into existing daemon.json:
  #   "runtimes": { "runsc": { "path": "/usr/bin/runsc" } }
  sudo systemctl restart docker
  docker info --format '{{json .Runtimes}}'
EOF
    exit 1
  fi

  log "smoke-testing runsc with a real container"
  if ! docker run --rm --runtime=runsc --network=none alpine:3.20 /bin/true; then
    err "runsc is registered but failed to execute a container"
    err "fix the runtime path / host constraints before deploying"
    exit 1
  fi
  log "runsc smoke test passed"
}

stop_legacy() {
  log "stopping legacy / conflicting containers if present"
  for name in "${LEGACY_CONTAINERS[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      log "removing container $name"
      docker rm -f "$name" >/dev/null || true
    fi
  done
  # Also stop any compose project still publishing our host port.
  if command -v ss >/dev/null 2>&1; then
    PORT="${PHBOX_PORT:-8080}"
    if ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; then
      log "warning: host port $PORT is still in use after legacy cleanup; compose up may fail"
    fi
  fi
}

health_check() {
  local port="${PHBOX_PORT:-8080}"
  local url="http://127.0.0.1:${port}/api/health"
  local response
  log "waiting for health at $url"
  for _ in $(seq 1 30); do
    if response="$(curl -fsS "$url" 2>/dev/null)"; then
      if grep -q '"ok":true' <<<"$response"; then
        log "health check passed"
        printf '%s\n' "$response"
        return 0
      fi
    fi
    sleep 2
  done
  err "health check failed"
  "${COMPOSE[@]}" ps || true
  "${COMPOSE[@]}" logs --tail=80 web runner || true
  return 1
}

rollback() {
  err "deployment failed — attempting rollback to previous compose project state"
  "${COMPOSE[@]}" down --remove-orphans || true
  # Best-effort: if an older single-service compose still exists in git history,
  # operators should redeploy the previous tag manually.
  err "rollback stopped services. Redeploy the previous known-good revision if needed."
}

main() {
  log "preparing host paths"
  sudo mkdir -p "$DATA_DIR"
  sudo cp "$ROOT/runners/php.ini" "$INI_PATH"

  ensure_env
  check_runsc

  log "building images (without swapping traffic yet)"
  "${COMPOSE[@]}" build

  log "warming runner images"
  "${COMPOSE[@]}" --profile warmup run --rm image-warmup

  stop_legacy

  log "starting new web/runner topology"
  if ! "${COMPOSE[@]}" up -d --remove-orphans; then
    rollback
    exit 1
  fi

  if ! health_check; then
    rollback
    exit 1
  fi

  log "up → http://0.0.0.0:${PHBOX_PORT:-8080}"
  log "note: web has no docker.sock; PHP runs under gVisor (runsc)"
}

main "$@"
