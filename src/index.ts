import express from "express";
import { BlobServiceClient } from "@azure/storage-blob";
import { ConfidentialClientApplication } from "@azure/msal-node";
import dotenv from "dotenv";
import session from "express-session";
import crypto from "node:crypto";
import { configureSessions, sessionCookieName } from "./session-config.js";

dotenv.config();

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const tenantId = process.env.ENTRA_TENANT_ID;
const clientId = process.env.ENTRA_CLIENT_ID;
const clientSecret = process.env.ENTRA_CLIENT_SECRET;
const redirectUri = process.env.ENTRA_REDIRECT_URI;
const sessionSecret = process.env.SESSION_SECRET;
const authMode = process.env.AUTH_MODE ?? "local";
const localAdminPassword = process.env.ADMIN_PASSWORD;
const allowedObjectIds = new Set(
  (process.env.ENTRA_ALLOWED_OBJECT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const app = express();

if (!connectionString || !containerName || !sessionSecret) {
  throw new Error("Required Azure Storage or session settings are missing.");
}

if (authMode !== "local" && authMode !== "entra") {
  throw new Error("AUTH_MODE must be either 'local' or 'entra'.");
}

if (authMode === "local" && !localAdminPassword) {
  throw new Error("ADMIN_PASSWORD must be set when AUTH_MODE is 'local'.");
}

if (
  authMode === "entra" &&
  (!tenantId || !clientId || !clientSecret || !redirectUri || allowedObjectIds.size === 0)
) {
  throw new Error("Required Microsoft Entra settings are missing.");
}

declare module "express-session" {
  interface SessionData {
    authState?: string;
    user?: {
      objectId: string;
      name?: string;
      username?: string;
    };
  }
}

const msalClient =
  authMode === "entra"
    ? new ConfidentialClientApplication({
        auth: {
          clientId: clientId!,
          clientSecret: clientSecret!,
          authority: `https://login.microsoftonline.com/${tenantId!}`,
        },
      })
    : undefined;

if (process.env.NODE_ENV === "production" && authMode === "entra" && new URL(redirectUri!).protocol !== "https:") {
  throw new Error("ENTRA_REDIRECT_URI must use HTTPS in production.");
}

// Process health only: this does not verify Azure access or authentication.
app.get("/healthz", (_request, response) => {
  response.status(200).json({ status: "ok" });
});
app.use(session(configureSessions(app, process.env)));
app.use("/auth", (request, response, next) => {
  if (process.env.NODE_ENV === "production" && !request.secure) {
    response.status(400).send("Sign-in requires HTTPS. Check the reverse proxy configuration.");
    return;
  }
  next();
});
app.use(express.urlencoded({ extended: false }));

const authScopes = ["openid", "profile", "email"];

function saveSession(request: express.Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(request: express.Request): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function requireAdmin(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  if (!request.session.user) {
    response.redirect(authMode === "local" ? "/admin/login" : "/auth/signin");
    return;
  }

  if (
    authMode === "entra" &&
    !allowedObjectIds.has(request.session.user.objectId)
  ) {
    response.status(403).send("Access denied.");
    return;
  }

  next();
}

app.get("/auth/signin", async (request, response, next) => {
  if (authMode === "local") {
    response.redirect("/admin/login");
    return;
  }

  try {
    const state = crypto.randomUUID();
    request.session.authState = state;
    await saveSession(request);

    const signInUrl = await msalClient!.getAuthCodeUrl({
      scopes: authScopes,
      redirectUri: redirectUri!,
      state,
    });

    response.redirect(signInUrl);
  } catch (error) {
    next(error);
  }
});

app.get("/auth/callback", async (request, response, next) => {
  if (authMode !== "entra") {
    response.sendStatus(404);
    return;
  }

  try {
    const code = typeof request.query.code === "string" ? request.query.code : undefined;
    const state = typeof request.query.state === "string" ? request.query.state : undefined;

    if (!code || !state || state !== request.session.authState) {
      response.status(400).send("Invalid sign-in response.");
      return;
    }

    const tokenResponse = await msalClient!.acquireTokenByCode({
      code,
      scopes: authScopes,
      redirectUri: redirectUri!,
    });
    const claims = tokenResponse.idTokenClaims as { oid?: unknown } | undefined;
    const objectId = claims?.oid;

    if (typeof objectId !== "string" || !allowedObjectIds.has(objectId)) {
      response.status(403).send("Your account is not authorised to access the admin page.");
      return;
    }

    await regenerateSession(request);
    request.session.user = {
      objectId,
      name: tokenResponse.account?.name,
      username: tokenResponse.account?.username,
    };
    delete request.session.authState;
    await saveSession(request);
    response.redirect("/admin");
  } catch (error) {
    next(error);
  }
});

app.get("/auth/signout", (request, response, next) => {
  request.session.destroy((error) => {
    if (error) {
      next(error);
      return;
    }

    response.clearCookie(sessionCookieName, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });

    if (authMode === "local") {
      response.redirect("/");
      return;
    }

    const homeUrl = new URL(redirectUri!).origin;
    const signOutUrl = new URL(
      `https://login.microsoftonline.com/${tenantId!}/oauth2/v2.0/logout`,
    );
    signOutUrl.searchParams.set("post_logout_redirect_uri", homeUrl);
    response.redirect(signOutUrl.toString());
  });
});

function passwordsMatch(suppliedPassword: string, configuredPassword: string) {
  const supplied = Buffer.from(suppliedPassword);
  const configured = Buffer.from(configuredPassword);

  return (
    supplied.length === configured.length &&
    crypto.timingSafeEqual(supplied, configured)
  );
}

app.get("/admin/login", (request, response) => {
  if (authMode !== "local") {
    response.redirect("/auth/signin");
    return;
  }

  response.sendFile("admin-login.html", { root: "public" });
});

app.post("/auth/local-login", async (request, response, next) => {
  if (authMode !== "local") {
    response.sendStatus(404);
    return;
  }

  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (!passwordsMatch(password, localAdminPassword!)) {
    response.status(401).send("Incorrect password.");
    return;
  }

  try {
    await regenerateSession(request);
    request.session.user = { objectId: "local-admin" };
    await saveSession(request);
    response.redirect("/admin");
  } catch (error) {
    next(error);
  }
});

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);

app.get("/api/blobs", async (request, response, next) => {
    try {
        const blobs = [];
        for await (const blob of containerClient.listBlobsFlat()) {
            if (blob.name.toLowerCase().endsWith(".png")) {
                blobs.push({
                    name: blob.name,
                    size: blob.properties.contentLength,
                    lastModified: blob.properties.lastModified?.toISOString()
                });
            }
        }
        response.json(blobs);
    } catch (error) {
        next(error);
    }
});

app.get("/api/images/*blobPath", async (request, response, next) => {
  try {
    const blobPath = request.params.blobPath;
    const blobName = Array.isArray(blobPath) ? blobPath.join("/") : blobPath;

    if (!blobName.toLowerCase().endsWith(".png")) {
      response.sendStatus(404);
      return;
    }

    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    const downloadResponse = await blockBlobClient.download(0);

    response.setHeader("Content-Type", "image/png");
    downloadResponse.readableStreamBody?.pipe(response);
  } catch (error) {
    next(error);
  }
});

app.get("/admin", requireAdmin, (request, response) => {
  response.sendFile("admin.html", { root: "public" });
});

app.get("/admin.html", requireAdmin, (request, response) => {
  response.sendFile("admin.html", { root: "public" });
});

app.get("/api/admin/today-activity", requireAdmin, async (request, response, next) => {
  try {
    const todayactivity: Record<string, number> = {};
    for await (const blob of containerClient.listBlobsFlat()) {
      if (blob.name.toLowerCase().endsWith(".png") && blob.properties.lastModified) {
        const match = blob.name.match(
         /_(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}(?:\.\d+)?\.png$/i,
        );

        if (match) {
          const dateKey = match[1];
          todayactivity[dateKey] = (todayactivity[dateKey] || 0) + 1;
        }
      }
    }
    response.json(todayactivity);
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/photo-count", requireAdmin, async (request, response, next) => {
  try {
    let count = 0;
    for await (const blob of containerClient.listBlobsFlat()) {
      if (blob.name.toLowerCase().endsWith(".png")) {
        count++;
      }
    }
    response.json({ photoCount: count });
  } catch (error) {
    next(error);
  }
});
app.use(express.static("public"));

const server = app.listen(3000, () => {
    console.log("Server is running on port 3000");
});

function shutdown() {
  console.log("Shutting down HTTP server");
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
