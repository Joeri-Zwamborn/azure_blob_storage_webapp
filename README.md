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
photos locally. Admin sessions persist in the `session-data` Docker volume.
Keep that volume and the same `SESSION_SECRET` when updating or recreating the
container. `docker compose down` keeps the volume; `down -v` deletes it and
invalidates all sessions.

Never share the output of `docker compose config` or `docker inspect`: they can
contain credentials. Use `docker compose config --quiet` for validation.

## HTTPS and admin sessions

### Test Entra admin sign-in locally

The Entra sign-in flow is already implemented. The `compose.local.yaml` override
forces password login; use `compose.entra-local.yaml` instead to test Entra.

In the Microsoft Entra admin center:

1. Open **App registrations** and create (or select) this web app's registration.
   For a new registration, choose accounts in your organizational directory only.
2. Under **Authentication**, add a **Web** redirect URI:
   `http://localhost:3000/auth/callback`. Do not choose Single-page application.
3. From **Overview**, copy the Directory (tenant) ID and Application (client) ID.
4. Under **Certificates & secrets**, create a client secret. Copy its **Value**,
   not its Secret ID, directly into your private `.env.docker` file.
5. Under **Users**, open your own user's profile and copy its **Object ID**.
   This must be your user's ID, not the app registration or enterprise app ID.

Set these values in `.env.docker`:

```dotenv
AUTH_MODE=entra
ENTRA_TENANT_ID=YOUR_DIRECTORY_TENANT_ID
ENTRA_CLIENT_ID=YOUR_APPLICATION_CLIENT_ID
ENTRA_CLIENT_SECRET=YOUR_CLIENT_SECRET_VALUE
ENTRA_ALLOWED_OBJECT_IDS=YOUR_USER_OBJECT_ID
```

Keep the existing Azure Storage settings and session secret. Do not paste secrets
into chat. Your organization may require an administrator to approve the app.

Run:

```sh
docker compose -f compose.yaml -f compose.entra-local.yaml up -d --build
```

Open `http://localhost:3000/admin`. You should be redirected to Microsoft sign-in
and returned to the dashboard. Only your allowed user ID can access it; other
accounts receive Access denied. The local password endpoint is disabled in this
mode. Photo viewing does not require admin login.

Use `localhost`, not `127.0.0.1`, in the browser so the callback receives the
same session cookie. Test sign-out and refreshing `/admin` after sign-out.
This override enables HTTP solely for localhost testing. Deploy using the base
Compose file and register the eventual HTTPS callback separately.

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

## Persistent admin sessions

The app uses `session-file-store` with authenticated AES-256-GCM encryption,
using a key derived from `SESSION_SECRET`. No Redis or Docker is needed to run
locally. On Windows the default folder is
`%LOCALAPPDATA%\production-photos\sessions`; otherwise it is
`~/.local/share/production-photos/sessions`. This keeps session files outside the
OneDrive checkout. Set `SESSION_STORE_PATH` to override the folder, using a private
local directory outside the repository and outside `public/`. Restrict access to
the account running the app (Windows uses the directory's inherited ACLs).

Sessions survive app restarts if the storage folder and `SESSION_SECRET` stay
unchanged. Existing memory sessions require one fresh sign-in after this update.
Changing the secret invalidates existing cookies and encrypted session records.
Sessions expire after eight hours of inactivity in the store; the browser cookie
also expires, and expired files are cleaned up every fifteen minutes. Signing
out destroys the saved session as well as clearing the browser cookie.

For Docker, Compose mounts the named `session-data` volume at `/app/data` and
sets `SESSION_STORE_PATH=/app/data/sessions`. The rest of the container stays
read-only. Do not delete the volume during ordinary updates.

This configuration is for **one Node process / one container on one server**.
Do not share the files over OneDrive, SMB, NFS, or between multiple app replicas;
use a shared database or Redis session store if you scale out. Store access errors
fail requests/startup rather than falling back to in-memory sessions.

To verify locally, sign in, stop the app, restart with `npm start`, and refresh
`/admin` in the same browser. You should remain signed in. Then sign out and
confirm `/admin` requires a new sign-in. Verify Docker recreation the same way
once Docker hosting is available. Keep the session secret private and stable.
