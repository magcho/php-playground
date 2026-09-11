# gVisor web/runner 分離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split PHBox into sock-less `web` and Docker/gVisor `runner` services while keeping the public API compatible.

**Architecture:** Same Proxmox guest, compose user-defined network. Web owns sessions/UI and calls runner over internal HTTP with Bearer token. Runner prepares workspaces, runs Composer on runc, and PHP on `runsc` with no silent runc fallback.

**Tech Stack:** Node 22 ESM, Express, Docker CLI + gVisor runsc, docker compose v2, Node built-in test runner.

## Global Constraints

- PHP execution must use `--runtime runsc`; Composer must not set `--runtime`
- Never fall back silently from runsc to runc
- `web` must not mount `/var/run/docker.sock` or ship `docker-ce-cli`
- Public `/api/*` response shapes stay compatible
- Nested virtualization is not required
- Spec: `docs/superpowers/specs/2026-09-10-gvisor-web-runner-split-design.md`

## File map

| Path | Responsibility |
|------|----------------|
| `server/src/config.js` | Shared env: runner URL/token, phpRuntime, timeouts |
| `server/src/services/docker-runner.js` | Build docker args; PHP uses runsc |
| `server/src/services/runner-client.js` | Web → runner HTTP client |
| `server/src/routes/api.js` | Public API; `/run` via client |
| `server/src/routes/runner-api.js` | Internal `/health`, `/v1/run` + Bearer |
| `server/src/index.js` | Web entry (no DockerRunner) |
| `server/src/runner-index.js` | Runner entry |
| `server/test/*.test.js` | Unit tests |
| `Dockerfile` | targets `web` / `runner` |
| `docker-compose.yml` | web + runner (+ warmup) |
| `.env.example`, `deploy.sh`, `README.md` | gVisor host setup |

---

### Task 1: DockerRunner runsc args + unit tests

**Files:**
- Modify: `server/src/config.js`
- Modify: `server/src/services/docker-runner.js`
- Create: `server/test/docker-runner-args.test.js`
- Modify: `server/package.json` (add `"test": "node --test test/**/*.test.js"`)

**Interfaces:**
- Produces: `config.phpRuntime` (default `runsc`)
- Produces: `DockerRunner.buildComposerArgs(hostWorkDir)`, `DockerRunner.buildPhpArgs(hostWorkDir, phpVersion)` returning `string[]`

- [ ] Add `phpRuntime`, `runnerUrl`, `runnerToken` to config
- [ ] Extract arg builders; PHP includes `--runtime`, `config.phpRuntime`; Composer does not
- [ ] Tests assert runtime presence/absence
- [ ] `npm test` passes
- [ ] Commit

### Task 2: Runner HTTP service

**Files:**
- Create: `server/src/routes/runner-api.js`
- Create: `server/src/runner-index.js`
- Create: `server/test/runner-auth.test.js`

**Interfaces:**
- Consumes: `DockerRunner.run(sessionDir, session)`, `config.runnerToken`
- Produces: `GET /health`, `POST /v1/run` with Bearer auth

- [ ] Bearer middleware → 401 without/invalid token
- [ ] `/health` probes docker + `docker info`/`runtime` for runsc (no runc fallback)
- [ ] `/v1/run` validates sessionId UUID, builds session-like object, calls runner
- [ ] Auth test with Express + inject mock runner
- [ ] Commit

### Task 3: Web RunnerClient + API wiring

**Files:**
- Create: `server/src/services/runner-client.js`
- Modify: `server/src/routes/api.js`
- Modify: `server/src/index.js`
- Create: `server/test/runner-client.test.js`

**Interfaces:**
- Produces: `RunnerClient.run({sessionId, phpVersion, code, packages})`, `RunnerClient.health()`
- `/api/run` maps client result; unavailable → 502 `runner unavailable`

- [ ] Implement client with timeout = composer + run + 5s
- [ ] Replace `DockerRunner` in web entry with `RunnerClient`
- [ ] Health includes runner status
- [ ] Tests for mapping + unavailable
- [ ] Commit

### Task 4: Docker image/compose/docs

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `.env.example`, `deploy.sh`, `README.md`

- [ ] Dockerfile targets `web` (no docker CLI) and `runner` (with CLI); CMD points to correct entry
- [ ] compose: web publishes 8080, no sock; runner has sock, no ports; shared data; `RUNNER_TOKEN`; `PHP_RUNTIME=runsc`
- [ ] deploy/README: install gVisor, register runtime, verify, then compose up
- [ ] Commit

### Task 5: Verify and push

- [ ] `npm test` in `server/`
- [ ] Push branch; update PR description for implementation
