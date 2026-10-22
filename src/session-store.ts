import session from "express-session";
import fileStore from "session-file-store";
import { accessSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FileStore = fileStore(session);

export function sessionDirectory(env: NodeJS.ProcessEnv): string {
  return resolve(env.SESSION_STORE_PATH || join(
    env.LOCALAPPDATA || join(homedir(), ".local", "share"),
    "production-photos", "sessions",
  ));
}

export function createSessionStore(env: NodeJS.ProcessEnv): session.Store {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is required for persistent sessions.");
  const path = sessionDirectory(env);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  accessSync(path, constants.R_OK | constants.W_OK);
  const key = createHash("sha256").update("production-photos/session-store/v1\0").update(env.SESSION_SECRET).digest();
  return new FileStore({
    path,
    ttl: 8 * 60 * 60,
    retries: 0,
    reapInterval: 15 * 60,
    // Use authenticated encryption. Decoder failures are handled by FileStore
    // as invalid sessions rather than authenticating damaged data.
    encoder: (value) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return JSON.stringify({ v: 1, iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: data.toString("hex") });
    },
    decoder: (text) => {
      const record = JSON.parse(text);
      if (record.v !== 1) throw new Error("Invalid session record version.");
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(record.iv, "hex"));
      decipher.setAuthTag(Buffer.from(record.tag, "hex"));
      return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data, "hex")), decipher.final()]).toString("utf8"));
    },
    // Do not log session IDs or file contents.
    logFn: () => {},
  });
}
