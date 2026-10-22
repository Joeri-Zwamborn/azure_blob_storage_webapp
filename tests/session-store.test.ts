import session from "express-session";
import express from "express";
import http from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createSessionStore, sessionDirectory } from "../src/session-store.js";
import { configureSessions } from "../src/session-config.js";

let directory: string;
let env: NodeJS.ProcessEnv;
const servers: http.Server[] = [];
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "production-photos-session-test-"));
  env = { SESSION_SECRET: "test-secret-at-least-thirty-two-bytes", SESSION_STORE_PATH: directory };
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  rmSync(directory, { recursive: true, force: true });
});
const data = () => ({ cookie: new session.Cookie({ maxAge: 28800000 }), user: { objectId: "test-admin" }, authState: "private-auth-state" });
const save = (store: session.Store, id: string, value = data()) => new Promise<void>((resolve, reject) => store.set(id, value, error => error ? reject(error) : resolve()));
const load = (store: session.Store, id: string) => new Promise<session.SessionData | null | undefined>((resolve, reject) => store.get(id, (error, value) => error ? reject(error) : resolve(value)));

it("restores encrypted user and auth state with a new store instance", async () => {
  await save(createSessionStore(env), "test-session");
  const text = readFileSync(join(directory, readdirSync(directory)[0]), "utf8");
  expect(text).not.toContain("test-admin");
  expect(text).not.toContain("private-auth-state");
  const restored = await load(createSessionStore(env), "test-session");
  expect(restored?.user?.objectId).toBe("test-admin");
  expect(restored?.authState).toBe("private-auth-state");
});

it("rejects expired sessions", async () => {
  const store = createSessionStore(env);
  const value = data();
  value.cookie = new session.Cookie({ maxAge: 1 });
  await save(store, "expired-session", value);
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(await load(store, "expired-session")).toBeNull();
});

it("rejects a changed encryption key without returning session data", async () => {
  await save(createSessionStore(env), "test-session");
  await expect(load(createSessionStore({ ...env, SESSION_SECRET: "another-secret" }), "test-session")).rejects.toThrow();
});

it("rejects corrupted records without returning session data", async () => {
  const store = createSessionStore(env);
  await save(store, "test-session");
  writeFileSync(join(directory, "test-session.json"), "invalid json");
  await expect(load(store, "test-session")).rejects.toThrow();
});

it("fails startup when the storage path is a file", () => {
  const file = join(directory, "not-a-directory");
  writeFileSync(file, "occupied");
  expect(() => createSessionStore({ ...env, SESSION_STORE_PATH: file })).toThrow();
});

it("defaults to local app data rather than the working checkout", () => {
  expect(sessionDirectory({ LOCALAPPDATA: directory })).toBe(join(directory, "production-photos", "sessions"));
});

async function startApp() {
  const app = express();
  app.use(session({ ...configureSessions(app, env), store: createSessionStore(env) }));
  app.get("/login", (req, res) => { req.session.user = { objectId: "test-admin" }; res.sendStatus(200); });
  app.get("/private", (req, res) => { res.sendStatus(req.session.user ? 200 : 401); });
  app.get("/logout", (req, res, next) => { req.session.destroy(error => error ? next(error) : res.sendStatus(200)); });
  const server = await new Promise<http.Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  return server;
}
function request(server: http.Server, path: string, cookie?: string) {
  const address = server.address() as import("node:net").AddressInfo;
  return new Promise<{ status: number | undefined; cookie: string | undefined }>((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: address.port, path, headers: cookie ? { Cookie: cookie } : {} }, res => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, cookie: res.headers["set-cookie"]?.[0].split(";")[0] }));
    });
    req.on("error", reject);
  });
}

it("keeps a browser session across app recreation and revokes it on logout", async () => {
  const first = await startApp();
  const login = await request(first, "/login");
  expect(login.cookie).toBeDefined();
  await new Promise<void>(resolve => first.close(() => resolve()));
  servers.splice(servers.indexOf(first), 1);
  const second = await startApp();
  expect((await request(second, "/private", login.cookie)).status).toBe(200);
  expect((await request(second, "/logout", login.cookie)).status).toBe(200);
  expect((await request(second, "/private", login.cookie)).status).toBe(401);
});
