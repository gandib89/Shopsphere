# Persistent browser sessions

Container builds use relative `/api/` and `/uploads/` URLs. The nginx container
forwards those paths to its `BACKEND_ORIGIN` environment variable. Use an origin
without a trailing slash or path, for example `https://your-backend.run.app`.
Docker Compose defaults to `http://backend:4000`.

The official nginx entrypoint renders `frontend/nginx.conf` at startup; only
`BACKEND_ORIGIN` is substituted. HTTPS upstreams require a valid certificate and
use TLS server-name indication. API paths, query strings, Authorization headers,
and Set-Cookie responses pass through the proxy.

For Cloud Run, rebuild the frontend image and set `BACKEND_ORIGIN` on the frontend
service. Keep port 80. Keep the backend's `FRONTEND_URL` equal to the frontend URL
users visit, since the original Origin header is preserved. Do not set a browser
API URL to the separate backend site. `VITE_BACKEND_URL` is intentionally empty in
container builds; local Vite development can still use its existing environment.

Refresh cookies retain HttpOnly, Secure in production, SameSite=Strict, a seven-day
lifetime, and the `/api/v1/auth` path. Access tokens remain in memory and expire
after 15 minutes. Reload waits for refresh before mounting account pages. A
refresh 401 clears the session; network, rate-limit, and server failures preserve
UI hints and offer retry without granting authenticated access.

After migrating from cross-site requests, existing visitors may need to sign in
once to obtain a refresh cookie on the frontend host. Cookies and login hints are
host-specific: use the same frontend hostname consistently.

Validation: run `npm test` and `npm run build` in `frontend`; run the container with
the intended BACKEND_ORIGIN and `nginx -t`; verify the frontend's `/api/` returns API
JSON. In a test account, sign in, reload, reopen the same hostname, and confirm
refresh succeeds. Verify logout and expired sessions still require sign-in.
