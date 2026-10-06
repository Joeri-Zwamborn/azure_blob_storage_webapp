# Azure_Blob_Storage_Webapp
A simple frontend webapp for viewing .png photos stored on an Azure Blob Storage

## Docker

Use Linux containers with Docker Engine and Docker Compose **2.30 or newer**.
The image builds the TypeScript code, installs dependencies from the lockfile,
and runs Node as a non-root user. Local dependencies and `.env` files are excluded
from the image. No source-code mounts are required.

1. Copy `.env.docker.example` to `.env.docker`.
2. Fill in the existing Azure settings, generate a random session secret using
   the command below, and fill in your Entra settings. Do not wrap values in
   quotes: Compose passes this file's values literally. Keep the file private.
3. Ask your server team to supply the hostname/certificate and confirm the proxy
   settings described below. The production container rejects HTTP sign-in.
4. Run from this repository on the Docker host:

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 web
```

The app is available on **the Docker host only** at `127.0.0.1:3000`.
The default setup is intended for a reverse proxy running on that host; it is
not accessible directly from crew devices. Have the proxy forward requests to
that address and overwrite forwarded headers. With exactly one trusted proxy
and no direct network access to the app, set `TRUST_PROXY=1` in `.env.docker`.
If your proxy is another container, your server team must connect it to the app's
Docker network and use `web:3000` instead; localhost inside that proxy container
does not refer to this app. Do not expose port 3000 on all host interfaces.

Check process health on the Docker host with:

```sh
curl --fail http://127.0.0.1:3000/healthz
```

This health check verifies the HTTP process only. Verify Azure photo search and
Entra sign-in separately through the final HTTPS URL. Docker reports unhealthy
containers, but `restart: unless-stopped` restarts exited processes, not merely
unhealthy ones. Server monitoring should watch container health.

For temporary local HTTP testing before HTTPS is available, populate
`ADMIN_PASSWORD` in `.env.docker` and run:

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Open `http://localhost:3000` on that machine. This override uses local login and
non-secure development cookies. It is for local testing only. To return to
production, run `docker compose up -d --force-recreate` without the override.

For updates, run `docker compose up -d --build`. To stop the app, run
`docker compose down`. Azure photos remain in Azure; the container stores no
photos locally. Admin sessions currently live in memory and are lost when the
app restarts; production session storage remains a separate launch task.

Never share the output of `docker compose config` or `docker inspect`: they can
contain credentials. Use `docker compose config --quiet` for validation.

## HTTPS and admin sessions

Set `NODE_ENV=production` in the deployed app. Session cookies then require HTTPS,
are inaccessible to browser JavaScript, use `SameSite=Lax` for the Entra GET
callback, and expire after eight hours. Successful sign-in changes the session ID;
sign-out deletes the browser cookie. Production auth routes reject HTTP requests.

Set `TRUST_PROXY` to match your HTTPS reverse proxy **before** enabling production
login. The default is `false`, which ignores forwarded headers. Supported values:

- `loopback` for a proxy on the same server that connects over loopback.
- A comma-separated list of proxy IP addresses or CIDR subnets.
- `1` only if all traffic reaches the app through one trusted proxy hop and direct
  access to the app port is blocked. Other hop counts require the same guarantee.

The proxy must overwrite `X-Forwarded-Proto` with the original request scheme.
Configure HTTP-to-HTTPS redirection at the proxy. Do not use `TRUST_PROXY=true` or
broadly trust the company network simply because users connect internally.

Use a randomly generated `SESSION_SECRET` with at least 32 bytes; keep it stable
across restarts and instances, and store it in the hosting platform's secret
settings. Generate one locally with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

For Entra admin access, set `AUTH_MODE=entra`, set `ENTRA_ALLOWED_OBJECT_IDS` to
your own user object ID, and set `ENTRA_REDIRECT_URI` to
`https://YOUR_HOST/auth/callback`. Register that exact URI as a Web redirect URI
in Entra. Keep the existing tenant, client, and client-secret settings.

After deployment, open `/admin` over HTTPS and complete Entra sign-in. In browser
developer tools, confirm `production-photos-session` has Secure, HttpOnly,
SameSite=Lax, Path=/, and an expiry. Refresh `/admin` to confirm the session works;
sign out and confirm the cookie is removed. Do not share cookie values or secrets.

The app still uses the default in-memory session store. Configure a production
session store separately before launch; otherwise restarts lose sessions and
multiple instances cannot share them.
