#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
DATA_DIR="${PHBOX_DATA:-/var/lib/phbox/data}"
INI_PATH="${PHBOX_INI:-/var/lib/phbox/php.ini}"

echo "[phbox] preparing host paths"
sudo mkdir -p "$DATA_DIR"
sudo cp "$ROOT/runners/php.ini" "$INI_PATH"

if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  sed -i "s|^PHBOX_DATA=.*|PHBOX_DATA=$DATA_DIR|" "$ROOT/.env"
  sed -i "s|^PHBOX_INI=.*|PHBOX_INI=$INI_PATH|" "$ROOT/.env"
  # Generate a token if still placeholder
  if grep -q 'change-me-to-a-long-random-string' "$ROOT/.env"; then
    TOKEN="$(openssl rand -hex 24)"
    sed -i "s|^RUNNER_TOKEN=.*|RUNNER_TOKEN=$TOKEN|" "$ROOT/.env"
    echo "[phbox] generated RUNNER_TOKEN"
  fi
fi

echo "[phbox] checking gVisor (runsc) Docker runtime"
if ! docker info --format '{{json .Runtimes}}' | grep -q '"runsc"'; then
  cat <<'EOF'
[phbox] ERROR: Docker runtime "runsc" is not registered.

Install gVisor on this Proxmox guest (nested virt NOT required), then register it:

  # Example (Debian/Ubuntu) — see https://gvisor.dev/docs/user_guide/install/
  curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
  sudo apt-get update && sudo apt-get install -y runsc

  # Register with Docker (merge into /etc/docker/daemon.json if you already have one):
  sudo tee /etc/docker/daemon.json >/dev/null <<'JSON'
  {
    "runtimes": {
      "runsc": {
        "path": "/usr/bin/runsc"
      }
    }
  }
  JSON
  sudo systemctl restart docker

  # Verify:
  docker info --format '{{json .Runtimes}}'
  docker run --rm --runtime=runsc hello-world
EOF
  exit 1
fi

echo "[phbox] warming runner images"
docker compose --project-directory "$ROOT" --profile warmup run --rm image-warmup

echo "[phbox] building and starting"
docker compose --project-directory "$ROOT" up -d --build

echo "[phbox] up → http://0.0.0.0:${PHBOX_PORT:-8080}"
echo "[phbox] note: web has no docker.sock; PHP runs under gVisor (runsc)"
