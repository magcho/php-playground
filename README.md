# PHBox — PHP Sandbox

ログイン不要の PHP オンラインサンドボックスです。PHP バージョン切替と Composer による任意ライブラリ導入に対応し、実行は Docker + gVisor で隔離されます。

Proxmox 上の Ubuntu ゲスト向けに、`docker compose` で起動できる構成です（**nested virtualization は不要**）。

## 機能

- **PHP 8.1 / 8.2 / 8.3 / 8.4** を UI から切替
- **Composer** で任意パッケージ・任意バージョンをインストールして実行
- **ログイン不要**（Cookie の匿名セッション）
- 実行は一時 Docker コンテナ（メモリ / CPU / 時間制限、実行時ネットワーク遮断）
- PHP 実行は **gVisor (`runsc`)**、Composer は通常の `runc`
- Packagist 検索付きパッケージ追加 UI

## アーキテクチャ

```
Browser
  → :8080  phbox-web   (Node: UI + 公開 API / docker.sock なし)
              │  内部 HTTP (compose network, ホストに非公開)
              ▼
         phbox-runner  (Node: 実行専用 / docker.sock あり)
              │
              ├─ composer:2     runtime=runc    network=bridge
              └─ php:X.Y-cli    runtime=runsc   network=none
```

公開面の `web` コンテナには Docker ソケットを渡しません。実行は内部の `runner` のみが担当します。

## 必要環境

- Ubuntu 22.04 / 24.04（Proxmox VM 想定）
- Docker Engine 24+
- Docker Compose v2
- **gVisor (`runsc`)** を Docker runtime として登録済み
- 公開したい場合は 80/443 をリバースプロキシ（Caddy / nginx）で終端

### gVisor セットアップ（初回）

```bash
# Install runsc (see https://gvisor.dev/docs/user_guide/install/ for current steps)
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | sudo tee /etc/apt/sources.list.d/gvisor.list
sudo apt-get update && sudo apt-get install -y runsc

# Register with Docker
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

docker info --format '{{json .Runtimes}}'
docker run --rm --runtime=runsc hello-world
```

`runsc` が未登録のとき、runner は **runc へ黙ってフォールバックしません**（health が degraded / 実行失敗）。

## クイックスタート（本番ホスト）

```bash
./deploy.sh
# または手動:
sudo mkdir -p /var/lib/phbox/data
sudo cp runners/php.ini /var/lib/phbox/php.ini
cp .env.example .env   # RUNNER_TOKEN を必ず変更
docker compose --profile warmup run --rm image-warmup
docker compose up -d --build
```

ブラウザで `http://<サーバーIP>:8080` を開きます。

### 環境変数（`.env`）

| 変数 | 既定値 | 説明 |
|------|--------|------|
| `PHBOX_PORT` | `8080` | 公開ポート |
| `PHBOX_DATA` | `/var/lib/phbox/data` | **ホスト上の絶対パス**（必須・Docker ソケット経由マウント用） |
| `PHBOX_INI` | `/var/lib/phbox/php.ini` | サンドボックス用 php.ini のホストパス |
| `RUNNER_TOKEN` | （必須） | web ↔ runner の Bearer 共有シークレット |

`PHBOX_DATA` はコンテナ内の `/data` とホストで同一実体である必要があります。名前付きボリュームではなくバインドマウントを使います。

## 開発（このリポジトリ内）

```bash
cd server && npm install && npm test
cd ../web && npm install && npm run build

# runner（docker.sock + runsc が使えるマシンで）
cd ../server
DATA_DIR=../data HOST_DATA_DIR="$(pwd)/../data" \
  PHP_INI_PATH=../runners/php.ini HOST_PHP_INI_PATH="$(pwd)/../runners/php.ini" \
  RUNNER_TOKEN=dev-token PHP_RUNTIME=runsc PORT=8081 \
  npm run start:runner

# web
DATA_DIR=../data STATIC_DIR=../web/dist \
  RUNNER_URL=http://127.0.0.1:8081 RUNNER_TOKEN=dev-token PORT=8080 \
  npm start
```

## セキュリティ（注意）

- `web` には `docker.sock` がありません（公開面の攻撃面を縮小）
- `runner` 侵害時は依然としてホスト Docker 相当の権限があります
- Composer（runc + ネットワークあり）は PHP（gVisor）より弱い隔離です
- gVisor は MicroVM ほどのカーネル分離ではありません
- インターネット公開時はリバースプロキシ + レート制限 / IP 制限等を推奨

## API 概要

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/health` | ヘルス（runner / runsc 状態含む） |
| GET | `/api/versions` | 利用可能な PHP バージョン |
| POST | `/api/session` | 匿名セッション作成/取得 |
| POST | `/api/run` | コード実行 |
| GET | `/api/packagist/search?q=` | Packagist 検索 |

設計ドキュメント: `docs/superpowers/specs/2026-09-10-gvisor-web-runner-split-design.md`

## ライセンス

MIT
