# Azure_Blob_Storage_Webapp
A simple frontend webapp for viewing .png photos stored on an Azure Blob Storage

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
