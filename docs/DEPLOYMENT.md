# Deployment and security boundaries

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address; use a TLS reverse proxy for remote access |
| `PORT` | `8080` | HTTP port |
| `CHATBUTTE_ORIGINS` | local hosts only | Comma-separated exact external origins, e.g. `https://chat.example.com` |
| `CHATBUTTE_PASSWORD` | none | Optional shared access password; API requires an HttpOnly session cookie |
| `CHATBUTTE_PUBLIC` | unset | Must explicitly be `1` for configured public origins without a password |
| `CHATBUTTE_TRUST_PROXY` | unset | Set `loopback` only when a trusted local proxy overwrites `X-Real-IP` |
| `CHATBUTTE_ALLOWED_HOSTS` | any public HTTPS host | Optional comma-separated provider hostname allowlist |

Never put passwords or model credentials in committed files. Use the service manager’s protected environment configuration. The checked-in supervisor template intentionally uses explicit public mode, preserving this deployment’s previous bring-your-own-key behavior. If restricting access, replace public mode with a private password configuration.

Example local production:

```bash
npm ci
npm run build
HOST=127.0.0.1 PORT=8080 npm start
```

Example private external deployment:

```bash
CHATBUTTE_ORIGINS=https://chat.example.com \
CHATBUTTE_PASSWORD='set-this-privately' \
PORT=8080 npm start
```

This is a personal workspace with an optional shared gateway password, not a multi-tenant account/authorization system. Browser data is separate per browser profile and not stored on the server.

## Nginx subpath example

```nginx
location = /chatbutte { absolute_redirect off; return 308 /chatbutte/; }
location /chatbutte/ {
    client_max_body_size 32m;
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 330s;
    proxy_send_timeout 330s;
}
```

Use a canonical trailing slash so relative assets/API requests resolve under the intended path. `absolute_redirect off` prevents an internal TLS proxy/listen port from leaking into the redirect Location. Hashed assets are immutable; the HTML shell and manifest revalidate. The server also accepts `/chatbutte/api/*` directly for subpath testing.

## server94 release layout

- Active path: `/home/ubuntu/chatbutte` (symlink to a complete release).
- Releases: `/home/ubuntu/chatbutte-releases/<timestamp>-<commit>/`.
- Process: supervisor `chatbutte`, running `node server/index.mjs`, loopback port 8080.
- Nginx: existing main-page virtual host, `/chatbutte/`.
- Original pre-rewrite deployment is kept **outside** the active directory in `/home/ubuntu/backups/`.

After first-time service bootstrap, `scripts/deploy-server94.sh` builds/tests locally, installs a staged runtime release, changes the symlink, restarts and health-checks it. A failed health check restores the previous release. It does not delete old releases or rewrite unrelated Nginx services. For first-time migration from Python, back up and replace the supervisor configuration with `deploy/chatbutte.supervisor.conf` before using the script.

## Gateway protections

- Only built assets are public; project source, package files, dotfiles and arbitrary paths are not static routes.
- JSON runtime schemas and a 32 MiB body ceiling; six admitted requests, per-address rate limits, bounded provider response/output and a five-minute request timer.
- Admission is reserved before asynchronous body reads. Backpressure/cancellation must return capacity.
- Exact deployment Host/Origin validation; proxy IP headers are ignored unless the proxy is explicitly trusted and the peer is loopback.
- Upstream requires public HTTPS/443 without URL credentials; redirects are not followed. Connection-time DNS lookup rejects private/reserved answers, including mixed public/private DNS and mapped IPv6. No TLS-verification bypass.
- Provider errors have supplied secrets removed before truncation. Model keys and request bodies are not logged by the application.
- Raw model HTML is not rendered; Markdown links use safe URL handling, external links use `noreferrer`; CSP disallows scripts from providers and object embedding.
- No same-origin arbitrary image-download proxy.

These measures are not a third-party penetration test or a guarantee of safety under every deployment. Public mode still exposes a rate-limited relay to **public HTTPS** providers. Restrict provider hosts and enable a password if public relay access is unwanted. Reverse-proxy/firewall policy remains the operator’s responsibility.

## Test scope

Domain/migration/SSE tests; actual HTTP integration with injected provider responses; optional-login child-process test; DNS callback/address tests; backpressure/abort tests; desktop and touch/mobile Chromium E2E with fake provider/Gist fixtures. Tests do not spend model credits or mutate real Gists. Manual Safari/iPhone/Android and real-provider compatibility checks should be performed with the operator’s chosen accounts before making wider compatibility claims.
