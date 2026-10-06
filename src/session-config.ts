import type { Express } from "express";
import type { SessionOptions } from "express-session";

export const sessionCookieName = "production-photos-session";

export function configureSessions(app: Express, env: NodeJS.ProcessEnv): SessionOptions {
  const production = env.NODE_ENV === "production";
  const proxy = env.TRUST_PROXY?.trim();
  if (proxy === "true") {
    throw new Error("TRUST_PROXY must specify proxy addresses/subnets or a hop count, not 'true'.");
  }
  if (!proxy || proxy === "false") {
    app.set("trust proxy", false);
  } else if (/^\d+$/.test(proxy)) {
    const hops = Number(proxy);
    if (!Number.isSafeInteger(hops)) throw new Error("Invalid TRUST_PROXY hop count.");
    app.set("trust proxy", hops);
  } else {
    const addresses = proxy.split(",").map(value => value.trim());
    if (addresses.some(value => !value)) throw new Error("TRUST_PROXY contains an empty address.");
    app.set("trust proxy", addresses);
  }
  if (!env.SESSION_SECRET || (production && Buffer.byteLength(env.SESSION_SECRET) < 32)) {
    throw new Error("SESSION_SECRET is required and must be at least 32 bytes in production; use a randomly generated secret.");
  }
  return {
    name: sessionCookieName,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: production,
      path: "/",
      maxAge: 8 * 60 * 60 * 1000,
    },
  };
}
