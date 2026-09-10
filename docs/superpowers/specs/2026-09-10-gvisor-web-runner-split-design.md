# PHBox gVisor + web/runner 分離 設計

**日付:** 2026-09-10  
**ステータス:** Draft（実装前レビュー用）  
**対象環境:** Proxmox ゲスト（Ubuntu VM）1 台。nested virtualization 不要。

## 背景と目的

現行 PHBox は単一コンテナに `/var/run/docker.sock` を渡し、短命の Composer / PHP コンテナを起動する（Docker-out-of-Docker）。公開面がソケットを持つため、アプリ侵害時にホスト Docker 相当の権限が得られる。

本設計の目的:

1. 公開面（web）から `docker.sock` を除去する
2. PHP 実行を gVisor (`runsc`) で隔離する（nested virt なしで Proxmox ゲスト上で可能）
3. UI / 公開 API の互換を維持する

## 決定事項（ブレインストーミング結果）

| 項目 | 選択 |
|------|------|
| 全体方針 | A2: 同一 VM 内で `web` / `runner` 分割 |
| web↔runner 通信 | B1: compose 内部 HTTP |
| gVisor 適用範囲 | C1: PHP 実行のみ（Composer は runc） |
| 実装アプローチ | 案1: compose 分割 + PHP に `--runtime=runsc` |

## 非目標

- Firecracker / Kata / nested microVM
- リクエストごとの Proxmox VM/LXC 起動
- Composer コンテナの gVisor 化（初回スコープ外）
- runsc 未導入時の自動 runc フォールバック（隔離が黙って弱まるため禁止）
- セッションストアの外部 DB 化や水平スケール設計

## アーキテクチャ

```
Browser
  → :8080  phbox-web   (Node: UI + 公開 API / docker.sock なし)
              │  内部 HTTP (compose network, ホストに非公開)
              ▼
         phbox-runner  (Node: 実行専用 / docker.sock あり)
              │
              ├─ composer:2     runtime=runc (default)   network=bridge
              └─ php:X.Y-cli    runtime=runsc            network=none
```

- 同一 Proxmox ゲスト上の `docker compose` で完結する
- 公開ポートは `web:8080` のみ。`runner` は publish しない
- セッション永続化は web 側の `/data/sessions`（現行どおり）
- データはホスト bind mount（`PHBOX_DATA`）を web/runner で共有し、runner が短命コンテナへホスト絶対パスでマウントする（現行 `HOST_DATA_DIR` 方式）

## コンポーネント

### `phbox-web`

責務:

- 静的 UI 配信
- 公開 REST API（パス・レスポンス形は現行互換）
- Cookie 匿名セッションの作成・更新
- Packagist 検索（web から直接 HTTPS）
- runner への実行リクエスト中継

持たないもの:

- `docker.sock`
- `docker` CLI
- 短命コンテナの直接起動

環境変数（追加）:

- `RUNNER_URL`（例: `http://runner:8081`）
- `RUNNER_TOKEN`（共有シークレット）
- 既存の `DATA_DIR` / `STATIC_DIR` 等は維持（ただし Docker 関連は不要）

### `phbox-runner`

責務:

- 内部 API のみ提供
- workspace 準備（`runs/<runId>/`）
- Composer install（runc）
- PHP 実行（runsc）
- 既存のリソース制限（memory / cpus / pids / `no-new-privileges` / PHP ini）を維持

持つもの:

- `/var/run/docker.sock`
- `docker-ce-cli`
- ホスト data / php.ini の bind mount

環境変数:

- `PORT=8081`（コンテナ内のみ）
- `RUNNER_TOKEN`
- `DATA_DIR=/data`
- `HOST_DATA_DIR`（ホスト絶対パス）
- `HOST_PHP_INI_PATH`
- 既存の runner 制限系（`RUN_TIMEOUT_MS`, `RUNNER_MEMORY`, PHP image 名など）
- `PHP_RUNTIME=runsc`（明示。未設定時も実装は `runsc` を要求してよい）

## API 契約

### 公開 API（web）— 互換維持

現行どおり:

- `GET /api/health`
- `GET /api/versions`
- `POST|GET /api/session`
- `PUT /api/session/code|php-version|packages`
- `POST /api/run`
- `GET /api/packagist/search`

`GET /api/health` は runner 到達性と runtime 状態を含めてよい（例: `runner: { ok, phpRuntime: "runsc" }`）。

`POST /api/run` のレスポンス形は現行を維持する:

```json
{
  "ok": true,
  "phase": "done",
  "phpVersion": "8.3",
  "packages": {},
  "composer": { "skipped": true, "ok": true, "exitCode": 0, "timedOut": false, "durationMs": 0, "stdout": "", "stderr": "" },
  "execution": { "ok": true, "exitCode": 0, "timedOut": false, "durationMs": 12, "stdout": "...", "stderr": "" }
}
```

### 内部 API（runner）— ホスト非公開

認証: 全リクエストで `Authorization: Bearer <RUNNER_TOKEN>` 必須。不正は `401`。

| Method | Path | 役割 |
|--------|------|------|
| `GET` | `/health` | runner / docker / runsc 利用可否 |
| `POST` | `/v1/run` | コード実行 |

#### `GET /health`

成功例:

```json
{
  "ok": true,
  "service": "phbox-runner",
  "docker": { "ok": true },
  "runtime": { "php": "runsc", "ok": true }
}
```

`runsc` が Docker に未登録、または probe に失敗した場合は `ok: false`（プロセスは起動してよいが、degraded を明示）。

#### `POST /v1/run`

リクエスト:

```json
{
  "sessionId": "uuid",
  "phpVersion": "8.3",
  "code": "<?php echo 1;",
  "packages": { "monolog/monolog": "^3.0" }
}
```

バリデーション:

- `sessionId` 必須（パス traversal 防止。web のセッション ID 形式に合わせる）
- `phpVersion` は設定済みキーのみ
- `code` / `packages` サイズ・個数上限は現行 config と同じ考え方

処理:

1. `DATA_DIR/sessions/<sessionId>/runs/<runId>/` を作成
2. `index.php` / `composer.json` / `run.php` を書き出し（現行 `DockerRunner.prepareWorkspace` 相当）
3. packages があれば Composer（**runtime 指定なし = runc**, `bridge`）
4. PHP 実行（**`--runtime runsc`**, `--network none`, ini bind, 現行制限）
5. 結果を返す（web が公開レスポンスにマッピングできる形）

workspace のホストパス変換は現行 `hostPathFor()` と同じく `DATA_DIR` ↔ `HOST_DATA_DIR` 相対変換とする。

## 実行データフロー

1. Browser → `POST /api/run`（web）
2. web がセッションを更新（code / phpVersion / packages）
3. web → `POST http://runner:8081/v1/run`（Bearer）
4. runner が workspace 作成 → Composer（必要時）→ PHP（runsc）
5. web が結果を現行 JSON で返却し、`sessions.markRun` を実施

タイムアウト:

- web→runner の HTTP クライアントタイムアウトは、Composer + PHP の上限より余裕を持たせる（例: `COMPOSER_TIMEOUT_MS + RUN_TIMEOUT_MS + 5s`）
- runner 内のプロセスタイムアウトは現行どおり

## エラー処理

| 状況 | 挙動 |
|------|------|
| runner 不通 / HTTP タイムアウト | web `502`, `{ "error": "runner unavailable" }` |
| runner `401` | web `502`（内部詳細はクライアントに出さない） |
| 入力バリデーション失敗（web） | 現行どおり `400` |
| Composer 失敗 | `ok: false`, `phase: "composer"` |
| PHP 失敗 / タイムアウト | `ok: false`, `phase: "execution"` |
| runsc 未登録 | health で `runtime.ok=false`。実行時も失敗させ、runc へ黙って落とさない |

## compose / イメージ分割

### `docker-compose.yml`（概念）

- `web`
  - build target または別 Dockerfile で **docker CLI / sock なし**
  - ports: `${PHBOX_PORT:-8080}:8080`
  - volumes: data（必要なら ini は不要）、sock **なし**
  - env: `RUNNER_URL`, `RUNNER_TOKEN`, `DATA_DIR`, `STATIC_DIR`
  - 同一 user-defined network（または bridge 上のサービス名解決が確実な構成）

- `runner`
  - docker CLI あり、sock マウントあり
  - **ports なし**
  - volumes: `PHBOX_DATA`, `PHBOX_INI`, `/var/run/docker.sock`
  - env: `HOST_DATA_DIR`, `HOST_PHP_INI_PATH`, `RUNNER_TOKEN`, PHP/Composer イメージ名、制限値、`PHP_RUNTIME=runsc`

- `image-warmup`（既存）: PHP / Composer pull。必要なら runsc 動作確認用のワンショットを別 profile で追加してよい

ネットワーク:

- 以前の「user-defined network で outbound HTTPS が壊れる」事象があるため、Packagist は **web 側**のまま維持する
- web↔runner の内部通信が確実であること（サービス名 `runner` で到達）を優先。必要なら runner も `network_mode: bridge` + 固定的な到達手段ではなく、compose のデフォルト network で両サービスを同居させる（実機で HTTPS と内部 DNS の両方を確認する）

実装時の制約: web の Packagist 検索が動くこと、かつ `RUNNER_URL=http://runner:8081` が名前解決できること。両立できない場合は設計を改訂する（例: runner を host ネットワークにしない、extra_hosts 等）。**初回実装では両サービスを同一 compose project network に置き、web の outbound を実測して決める。**

### Dockerfile

- マルチステージは維持
- **web イメージ**: Node + 静的ファイル。`docker-ce-cli` を入れない
- **runner イメージ**: Node + `docker-ce-cli`（現行本番イメージに近い）
- 単一 Dockerfile の target 分割、または `Dockerfile.web` / `Dockerfile.runner` のいずれでもよい（実装計画で一方に固定）

### 環境変数（`.env.example` 追加）

```
PHBOX_PORT=8080
PHBOX_DATA=/var/lib/phbox/data
PHBOX_INI=/var/lib/phbox/php.ini
RUNNER_TOKEN=change-me
```

`RUNNER_URL` は compose 内デフォルトで足りる場合は `.env` 必須にしない。

## ホストセットアップ（Proxmox ゲスト）

`deploy.sh` / README に含める必須手順:

1. Docker Engine 24+ / Compose v2（既存）
2. gVisor (`runsc`) のインストール
3. Docker runtime として `runsc` を登録（`/etc/docker/daemon.json` または `dockerd` runtime 設定）
4. `docker runtime` / 短い `docker run --runtime=runsc ...` で確認
5. その後 `docker compose up`

nested virtualization は不要である旨を明記する。

## セキュリティ特性（本設計で得ること / 残るリスク）

得られること:

- 公開コンテナ侵害だけでは直接 `docker.sock` に触れない
- PHP ペイロードは gVisor のシステムコール仲介下で実行される
- runner は非公開 + Bearer トークン

残るリスク:

- runner 侵害時は依然としてホスト Docker 相当
- Composer（runc + ネットワークあり）は PHP より弱い隔離のまま
- gVisor は MicroVM ほどのカーネル分離ではない
- `docker.sock` を持つホスト上の運用者権限モデルは変わらない

## テスト方針

自動化（リポジトリ内）:

- runner: PHP 実行の docker 引数に `--runtime` / `runsc` が含まれること（コマンド組み立ての単体テスト）
- runner: Composer 経路に `--runtime` が付かないこと
- web: runner クライアント成功時に公開レスポンスへ正しくマップすること
- web: runner 不通時に `502 runner unavailable` になること
- runner: Bearer なしで `401` になること

手動（デプロイ検証）:

- compose up 後 `/api/health` が ok
- `/api/run` 成功
- 実行中または直後のコンテナ/イベントで PHP 側 Runtime が `runsc` であること

## ファイル変更の見通し（実装時）

| 領域 | 変更 |
|------|------|
| `docker-compose.yml` | `web` / `runner` 分割、sock は runner のみ |
| `Dockerfile`（または分割） | web から docker CLI 除去 |
| `server/` | web 用エントリと runner 用エントリに分割、または `server/web` / `server/runner` |
| `deploy.sh` / `README.md` | gVisor セットアップと構成説明 |
| `.env.example` | `RUNNER_TOKEN` 追加 |
| テスト | 上記テスト方針 |

既存 `DockerRunner` は runner サービス側へ移し、web は薄い HTTP クライアントに置き換える。

## 成功基準

1. ブラウザから見た操作感・`/api/run` レスポンス形が現行と互換
2. `web` コンテナに `docker.sock` がマウントされていない
3. PHP 実行が `runsc` で行われる（Composer は runc）
4. Proxmox ゲストで nested virt なしにデプロイ手順が完走できる
5. runsc 未設定時に黙って runc へフォールバックしない
