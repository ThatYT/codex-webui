# Codex WebUI integration handoff

Prepared: 2026-10-19 (Asia/Shanghai). This document describes the tested single-user home-server deployment and the browser-upload feature. Integration into the owner's server app has not yet been implemented.

## 1. Repository and status

- Fork: https://github.com/ThatYT/codex-webui
- Upstream: https://github.com/lezi-fun/codex-webui
- Feature branch: `feature/browser-uploads`
- Feature PR: https://github.com/ThatYT/codex-webui/pull/1
- Upload implementation commit: `ffd554dd74b0e3dfe7178dd7da87fe35eccc6b40`
- Upstream baseline commit: `1085d93190586fa70bc56de2e3b71cf77c0853c0`
- At handoff preparation, PR #1 is a draft and has not been merged into `main`.
- The owner tested the browser-upload feature and reported satisfaction. The Projects picker has not received a separate explicit final pass confirmation.
- This handoff is a documentation follow-up to the feature commit above; obtain the latest feature-branch revision when continuing work.

## 2. Existing installations: preserve these

| Purpose | Checkout | User service | Loopback port |
| --- | --- | --- | --- |
| Clean, unmodified upstream baseline | `/home/thatyt/Projects/TestCodexWebUI/codex-webui` | `codex-webui-test.service` | `127.0.0.1:8214` |
| Fork with browser uploads | `/home/thatyt/Projects/TestCodexWebUI/codex-webui-dev` | `codex-webui-dev.service` | `127.0.0.1:8218` |

Both services run as the existing Linux user `thatyt`, without root, and use the existing authenticated Codex CLI. Both are enabled as user services. They are separate processes but share the same Codex account and home; this is not account, session, or filesystem isolation.

The older customized authentication/multi-user deployment is outside this work. Do not overwrite it or alter its `ovo`/`thatyt` users, credentials, projects, or sessions. Do not alter the baseline, global Codex CLI, its login, FRP, Caddy, DNS, or firewall as part of routine feature work. Network or account changes require a deliberate integration plan from the owner.

## 3. Runtime and current feature-service configuration

| Setting | Current value |
| --- | --- |
| Working directory | `/home/thatyt/Projects/TestCodexWebUI/codex-webui-dev` |
| Bun | `1.4.3`, `/home/thatyt/Projects/TestCodexWebUI/runtime/bun/bun` |
| Node | `v22.16.0`, `/home/thatyt/.local/opt/librecodex/node22/bin/node` |
| Codex CLI | `0.163.0`, `/home/thatyt/.local/bin/codex` |
| Linux user | `thatyt` |
| `HOME` | `/home/thatyt` |
| `CODEX_HOME` | `/home/thatyt/.codex` |
| `HOST` / `PORT` | `127.0.0.1` / `8218` |
| `CODEX_WEBUI_CWD` | `/home/thatyt/Projects/TestCodexWebUI/upload-test-project` |
| `CODEX_WEBUI_REVIEW_ROOT` | `/home/thatyt/Projects/TestCodexWebUI/upload-test-project` |
| `CODEX_WEBUI_NODE` | `/home/thatyt/.local/opt/librecodex/node22/bin/node` |
| `CODEX_WEBUI_AUTH_STORE` | `/home/thatyt/Projects/TestCodexWebUI/state/codex-webui-dev-auth.json` |
| Startup | `/home/thatyt/Projects/TestCodexWebUI/runtime/bun/bun run start` |

The service PATH is:

```text
/home/thatyt/Projects/TestCodexWebUI/runtime/bun:/home/thatyt/.local/opt/librecodex/node22/bin:/home/thatyt/.local/bin:/usr/bin:/bin
```

`server.ts` launches `codex app-server --stdio` by searching PATH. It does not use `CODEX_CLI_PATH`; placing the intended executable on PATH is necessary. Initialization enables `experimentalApi` and sends the `initialized` notification. The app server's returned `codexHome`, when available, determines the sessions directory used for live-session reads.

The feature unit file is `/home/thatyt/Projects/TestCodexWebUI/codex-webui-dev.service`, linked from `~/.config/systemd/user/`. It uses `Restart=on-failure`, `RestartSec=2`, and `KillMode=control-group`.

Local dependency detail: the feature checkout currently has a `node_modules` symlink to `../codex-webui/node_modules` to reuse the identical existing dependency installation. This symlink is locally excluded from Git, is not part of the fork, and must not be assumed in a fresh checkout. The baseline's `node-pty` native module was built locally because its Linux binary was unavailable. A portable deployment should install dependencies in its own checkout and verify the PTY native module under its target Node runtime.

## 4. Access from the Mac through FRP

The tested feature route is:

```text
Mac Chrome/Safari -> Mac 127.0.0.1:8218
  -> SSH to HK VPS 38.55.193.253:6022
  -> existing FRP mapping to home-server SSH 127.0.0.1:22
  -> home-server app 127.0.0.1:8218
```

Run this on the Mac and leave Terminal open:

```sh
ssh -C -N -T -p 6022 -o ExitOnForwardFailure=yes -o ProxyJump=none -o ProxyCommand=none -L 127.0.0.1:8218:127.0.0.1:8218 thatyt@38.55.193.253
```

Type `http://127.0.0.1:8218` directly into a normal Mac Chrome/Safari address bar. Clicking links in the Codex app can open a separate in-app preview with a changing port, which is not the explicit SSH listener tested here.

The clean baseline remains accessible by forwarding a different Mac port to home-server port 8214. An earlier working baseline tunnel used Mac port 8217. Do not confuse a Mac listener port with the home-server destination port.

If the browser reports connection refused, check on the Mac:

```sh
lsof -nP -iTCP:8218 -sTCP:LISTEN
curl --noproxy '*' --max-time 10 -v http://127.0.0.1:8218/api/health
```

No listener means the local tunnel is absent. An address-already-in-use error means another process owns that Mac port; inspect it or choose a fresh local port. A successful foreground tunnel normally stays running without returning to the shell prompt.

## 5. Application architecture and integration boundaries

- `server.ts`: Bun-hosted HTTP server, Codex child-process lifecycle, JSON-RPC routing, WebSockets, and SSE fallback.
- `public/app.js`: chat state, selected project, composer submission, history, approvals, and active-thread polling.
- `public/index.html` / `public/style.css`: browser shell and styling.
- `server-security.js`: request authorization, origin checks, and RPC allowlist.
- `folder-service.js`: project-folder listing and home-directory browse boundary.
- `terminal-service.js` / `terminal-worker.js`: optional PTY terminal using Node and `node-pty`.
- `live-session-service.js`: reads compatible existing Codex session state. Project listings and session discovery are distinct features.

Browser chat normally uses `/ws`. If WebSocket establishment fails, upstream falls back to `/api/events` plus HTTP POST `/api/rpc` and `/api/codex/respond`. `/terminal` is a separate WebSocket endpoint. Approvals and server notifications also travel over these transports.

Useful HTTP endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | HTTP readiness and Codex initialization status |
| `GET /api/config` | Home, default cwd, review root, projectless mode |
| `GET /api/folders?path=...` | List visible child directories |
| `GET /api/workspace/context?cwd=...` | Workspace context |
| `GET /api/files/search?...` | File mentions/search |
| `GET /api/files/download?path=...&cwd=...` | Download server files within allowed roots |
| `GET /api/images/local?path=...&cwd=...` | Render server images within allowed roots |
| `POST /api/uploads?name=...&cwd=...` | New browser-upload API |
| `POST /api/rpc` | SSE transport's browser-to-Codex RPC |
| `POST /api/codex/respond` | SSE transport's approval/server-request responses |
| `GET /api/events` | SSE stream |
| `POST /api/review/patch` | Review undo/reapply |

The existing upstream also contains optional LAN password/auth routes. No new authentication, multi-user management, or custom routing was added in this feature. Current direct loopback access does not require a web password.

### Guidance for incorporation into the owner's server app

Prefer keeping this backend as a separate loopback service initially. Decide the owning server app's routing and access model before exposing it through any new route. Preserve HTTP, WebSocket upgrades, and streaming SSE; a proxy must not buffer SSE and must permit the upload body size plus adequate request timeouts.

The frontend uses root-relative URLs such as `/api/uploads`, `/ws`, `/terminal`, `/vendor/...`, and `/app.bundle.js`, and has root-based `/settings` navigation. A simple mount under `/codex/` is not supported without adapting frontend URLs, navigation, server routing, and asset loading. A dedicated origin is simpler for routing, but requires a deliberate access-control and origin-header plan.

Request authorization checks Host/Origin and fetch-site headers. Forwarded client headers prevent the automatic direct-loopback authorization shortcut. Simply proxying to localhost does not establish browser authorization. Do not disable these checks to make a proxy work. The parent app needs an explicit, server-validated access-control integration covering every HTTP endpoint and WebSocket handshake, including uploads and terminals. No such integration is included here.

The current filesystem boundary is broadly the Linux user's home directory; the review root is separately configured. The upload handler accepts a cwd anywhere within the browse roots. These boundaries are not tenant isolation. Before adding multiple users, design ownership of projects, uploads, sessions, approvals, terminal access, and Codex credentials explicitly.

## 6. Browser-upload implementation

| File | Responsibility |
| --- | --- |
| `upload-service.js` | Bounded binary request reading, filename validation, canonical project boundary, unique private storage, image classification |
| `server.ts` | Authorized POST route and structured success/error responses |
| `public/attachments.js` | XHR transfer/progress and conversion to Codex input |
| `public/upload-composer.js` | File picker, chips, transfer queue, retry/remove, cancellation, draft attachment lifecycle |
| `public/app.js` | Submission, attachment-only messages, initial turns and steering, failed-send restoration |
| `public/index.html` / `public/style.css` | Hidden multiple-file input and attachment tray |
| `tests/uploads.test.ts` / `tests/uploads.e2e.mjs` | Unit and browser/API coverage |

### Upload API

Request example:

```http
POST /api/uploads?name=notes.txt&cwd=%2Fhome%2Fthatyt%2FProjects%2Fexample
Content-Type: application/octet-stream

<raw file bytes>
```

The body is raw binary, not multipart or JSON/base64. Name and cwd query parameters must be URL encoded. The route runs after the existing request-authorization gate.

Success is HTTP 201 with:

```json
{
  "name": "notes.txt",
  "path": "/home/thatyt/Projects/example/.codex-webui-uploads/upload-<unique-id>/notes.txt",
  "size": 123,
  "kind": "file",
  "cwd": "/home/thatyt/Projects/example"
}
```

Errors are JSON `{ "error": "..." }`. Typical statuses: 400 invalid input/path, 401 authorization failure, 405 wrong method, 413 over the size limit. The storage helper also rejects an outside canonical root with 403; the route's earlier browse validation can reject the same request with 400.

### Limits, inputs, and persistence

- Per-file maximum: 20 MiB, enforced on client and server, including chunked bodies.
- Up to 10 attachments per message is a browser limit; the API does not enforce a per-user file count, disk quota, or aggregate concurrency limit.
- XHR timeout: 300 seconds. Normal file selections are queued serially to reduce pressure on an SSH/FRP connection.
- Server buffers each accepted request body in memory before writing; it is bounded per file, not a streaming-to-disk implementation.
- Filename checks reject path separators, traversal names, control characters, and names over 240 bytes. Files receive unique upload directories, avoiding same-name overwrites. Storage symlinks are rejected.
- Storage: `<project>/.codex-webui-uploads/upload-<unique-id>/<original-name>`. Newly created storage/upload directories are private; files are mode 0600.
- PNG/JPEG/WebP byte signatures produce `{ "type": "localImage", "path": "..." }` Codex input. Other files add their server paths to the text prompt. No document/archive parser was added.
- Input types were checked against the installed Codex 0.163.0 generated schema. Actual file reading still depends on Codex tools and permissions.
- Files persist for chat history after refresh/restart. Removing a chip detaches it from the draft, without deleting its server copy. Unsent draft attachments do not survive browser refresh. Starting a new task or switching conversations clears the draft attachments.
- Failed sends restore attachment chips; failed transfers offer Retry or removal. Pending/failed attachments block submission until resolved or removed.
- No automatic expiration, delete API, quota, or malware scanning was added. Establish retention and capacity policy if this becomes a broader service.
- The fork ignores `.codex-webui-uploads/`; other selected projects need their own ignore rule if desired. Do not delete upload folders still referenced by saved chats.

## 7. Checks already completed

- Build and build-check passed.
- 96 unit tests passed, including five upload tests covering storage, duplicate names, permissions, traversal/symlinks, oversized/chunked/interrupted requests, image classification, and input generation.
- Real Chrome upload test passed against an actual temporary loopback upload API: text/image bytes, file picker, input construction, attachment-only send, failed-send restore/resend, failed-transfer retry, removal, pending-submit blocking, and New task cancellation. No browser JavaScript errors were observed.
- Existing composer Stop/Steer/conflict browser regression test passed.
- Live feature service returned `{"ok":true,"codex":true,"version":"0.2.0"}` and accepted a harmless `deployment-smoke.txt` upload with bytes verified on disk.
- Both service listeners were confirmed strictly on 127.0.0.1, and both repositories were clean after publication of the feature commit.
- Browser tests intercept model RPC submissions; they do not prove a real model read every attachment format. No real model execution was required for the upload tests, and no existing conversation was modified by them.
- The owner subsequently tested the feature and reported satisfaction.

## 8. Earlier latency and Projects findings

Measured on the home server: folder API under 1 ms; normal local Chrome picker/navigation about 134 ms. Measured from the Mac over the explicit tunnel: curl folder request 676 ms; browser folder fetch 1709 ms, correct listing, transport `ws`, connected `true`.

The upstream UI opens long chats by requesting/rendering all turns. A measured large thread transferred about 1.1 MB and produced over 13,000 DOM elements. Upstream active-thread synchronization polls every 800 ms when in progress, 2400 ms when idle; thread list polling is every 3000 ms. This can add transfer and rendering cost on a remote link. These behaviors were not optimized in the upload feature.

The folder fetch has no timeout. A controlled six-extra-SSE-stream test reproduced a stuck folder picker through HTTP connection-slot exhaustion, but the Mac was subsequently confirmed to use a connected WebSocket; that reproduction is not a proven diagnosis of the owner's stall.

The owner reported markedly improved behavior after typing the SSH listener URL directly into normal Mac Chrome/Safari instead of opening a changing-port in-app preview. Do not claim every earlier folder stall is conclusively fixed: a separate final picker result was not supplied.

Earlier detailed timings: `/home/thatyt/Projects/TestCodexWebUI/diagnostics/REPORT.md` and neighboring diagnostic JSON files. These are local deployment artifacts, not part of the fork. They predate some later tunnel confirmations; use this handoff for the final deployment/access status.

## 9. Operator commands and fresh-checkout notes

On the home server as `thatyt`:

```sh
systemctl --user status codex-webui-dev.service
journalctl --user -u codex-webui-dev.service -n 100 --no-pager
curl --noproxy '*' http://127.0.0.1:8218/api/health
```

Restart only the feature instance after rebuilding a code change:

```sh
cd /home/thatyt/Projects/TestCodexWebUI/codex-webui-dev
export PATH=/home/thatyt/Projects/TestCodexWebUI/runtime/bun:/home/thatyt/.local/opt/librecodex/node22/bin:/home/thatyt/.local/bin:/usr/bin:/bin
bun run build
systemctl --user restart codex-webui-dev.service
```

For a fresh feature checkout:

```sh
git clone --branch feature/browser-uploads https://github.com/ThatYT/codex-webui.git
cd codex-webui
git remote add upstream https://github.com/lezi-fun/codex-webui.git
bun install --frozen-lockfile
bun run build
bun run check
bun run test:unit
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome bun tests/uploads.e2e.mjs
```

Provide Bun, Node, an authenticated existing Codex CLI, and a suitable browser path first. The browser path above is specific to this Linux server. If `node-pty` has no compatible native binary, build it for the target Node version using its supported native build tools before relying on terminals. Do not replace the global Codex installation or reauthenticate the existing account just to repair a native dependency.

The build generates ignored `public/app.bundle.js` and `dist/server.js`; Git source alone is not the built frontend. `bun run start` runs `server.ts`. After integration, rerun focused browser tests through the final routing layer, including uploads, WebSocket/SSE, project selection, approvals, saved-chat refresh, and any enabled terminal.

## 10. Suggested next implementation sequence

1. Read the owning server app's repository instructions and inspect its process manager, routes, authentication, and project model.
2. Keep this tested feature service and the clean baseline available for comparison; select a separate integration port or service as needed.
3. Choose root-origin routing versus a true base-path adaptation. Write down the HTTP/WS/SSE and authorization contract before changing network services.
4. Adapt project/session/upload ownership only to the intended user model. Preserve existing Codex login and sessions unless the owner explicitly changes that requirement.
5. Test a harmless uploaded text file and image through the final parent-app route. Confirm model access, reconnect, approvals, refresh persistence, and project permissions.
6. Review and merge PR #1 into the fork when the owner requests it; do not merge it into upstream automatically.

No passwords, tokens, keys, or Codex authentication contents belong in this document or repository. Preserve the upstream MIT license and third-party notices when distributing the integrated app.
