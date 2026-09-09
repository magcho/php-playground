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
fi

echo "[phbox] warming runner images"
docker compose --project-directory "$ROOT" --profile warmup run --rm image-warmup

echo "[phbox] building and starting"
docker compose --project-directory "$ROOT" up -d --build

echo "[phbox] up → http://0.0.0.0:${PHBOX_PORT:-8080}"
