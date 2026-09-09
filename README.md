# PHBox — PHP Sandbox

ログイン不要の PHP オンラインサンドボックスです。PHP バージョン切替と Composer による任意ライブラリ導入に対応し、実行は Docker コンテナ内に隔離されます。

Proxmox 上の Ubuntu ホスト向けに、`docker compose` 一行で起動できる構成です。

## 機能

- **PHP 8.1 / 8.2 / 8.3 / 8.4** を UI から切替
- **Composer** で任意パッケージ・任意バージョンをインストールして実行
- **ログイン不要**（Cookie の匿名セッション）
- 実行は一時 Docker コンテナ（メモリ / CPU / 時間制限、実行時ネットワーク遮断）
- Packagist 検索付きパッケージ追加 UI

## 必要環境

- Ubuntu 22.04 / 24.04（Proxmox VM 想定）
- Docker Engine 24+
- Docker Compose v2
- 公開したい場合は 80/443 をリバースプロキシ（Caddy / nginx）で終端

## クイックスタート（本番ホスト）

```bash
sudo mkdir -p /var/lib/phbox/data
sudo cp runners/php.ini /var/lib/phbox/php.ini

# 任意: データディレクトリを変える場合は .env を作成
cp .env.example .env

# ランナーイメージを先に取得（初回を速くする）
docker compose --profile warmup run --rm image-warmup

# 起動
docker compose up -d --build
```

ブラウザで `http://<サーバーIP>:8080` を開きます。

### 環境変数（`.env`）

| 変数 | 既定値 | 説明 |
|------|--------|------|
| `PHBOX_PORT` | `8080` | 公開ポート |
| `PHBOX_DATA` | `/var/lib/phbox/data` | **ホスト上の絶対パス**（必須・Docker ソケット経由マウント用） |
| `PHBOX_INI` | `/var/lib/phbox/php.ini` | サンドボックス用 php.ini のホストパス |

`PHBOX_DATA` はコンテナ内の `/data` とホストで同一実体である必要があります。名前付きボリュームではなくバインドマウントを使います。

## 開発（このリポジトリ内）

```bash
# 依存関係
cd server && npm install
cd ../web && npm install && npm run build

# データディレクトリ
mkdir -p ../data/sessions

# API + 静的ファイル
cd ../server
DATA_DIR=../data HOST_DATA_DIR="$(pwd)/../data" \
  STATIC_DIR=../web/dist PHP_INI_PATH=../runners/php.ini \
  node src/index.js
```

別ターミナルでフロントだけ開発する場合:

```bash
cd web
npm run dev   # http://127.0.0.1:5173 （/api を :8080 にプロキシ）
```

## アーキテクチャ

```
Browser  →  PHBox (Node/Express + 静的 UI)
                │
                ├─ 匿名セッションを /data/sessions/<uuid> に保存
                │
                ├─ composer:2 コンテナで composer install（ネットワークあり）
                │
                └─ php:X.Y-cli コンテナで php run.php（--network none）
```

ホストの `/var/run/docker.sock` を PHBox コンテナに渡し、実行ごとに短命コンテナを起動します。

## セキュリティ（注意）

インターネットに晒す場合は次を推奨します。

- リバースプロキシ + レート制限 / IP 制限 / Basic 認証や Cloudflare
- `PHBOX` 用ファイアウォール（管理セグメントからのみ等）
- ディスク容量監視（Composer vendor の掃除はセッション TTL で実施）
- Docker ソケットは root 相当の権限です。このホストでは信頼できる管理者のみが PHBox を運用してください

サンドボックス側の緩和策:

- 実行タイムアウト・メモリ・CPU・pids 制限
- 実行時 `--network none`
- 危険な PHP 関数を `runners/php.ini` で無効化
- コードサイズ・パッケージ数の上限
- API レート制限

## API 概要

| Method | Path | 説明 |
|--------|------|------|
| GET | `/api/health` | ヘルスチェック |
| GET | `/api/versions` | 利用可能な PHP バージョン |
| POST | `/api/session` | 匿名セッション作成/取得 |
| POST | `/api/run` | コード実行（code / phpVersion / packages） |
| GET | `/api/packagist/search?q=` | Packagist 検索 |

## ライセンス

MIT
