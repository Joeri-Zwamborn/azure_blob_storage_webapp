import express from "express";
import session from "express-session";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { configureSessions } from "../src/session-config.js";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function cookieThroughProxy(trustProxy?: string, forwardedProto?: string) {
  const app = express();
  const options = configureSessions(app, {
    NODE_ENV: "production", SESSION_SECRET: "test-secret-with-at-least-thirty-two-bytes", TRUST_PROXY: trustProxy,
  });
  // An explicit store keeps this test independent of production store selection.
  options.store = new session.MemoryStore();
  app.use(session(options));
  app.get("/", (req, res) => { req.session.authState = "test-state"; res.send("ok"); });
  const server = await new Promise<http.Server>(resolve => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const address = server.address() as import("node:net").AddressInfo;
  return new Promise<string[] | undefined>((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: address.port, path: "/", headers: forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {} }, res => {
      res.resume();
      res.on("end", () => resolve(res.headers["set-cookie"]));
    });
    req.on("error", reject);
  });
}

describe("HTTPS session cookies", () => {
  it("sets a secure cookie behind a trusted HTTPS proxy", async () => {
    const cookies = await cookieThroughProxy("loopback", "https");
    expect(cookies?.[0]).toContain("Secure");
    expect(cookies?.[0]).toContain("HttpOnly");
    expect(cookies?.[0]).toContain("SameSite=Lax");
    expect(cookies?.[0]).toContain("Path=/");
    expect(cookies?.[0]).toContain("Expires=");
  });
  it("ignores HTTPS headers from an untrusted caller", async () => {
    expect(await cookieThroughProxy(undefined, "https")).toBeUndefined();
  });
  it("does not send the production cookie over HTTP", async () => {
    expect(await cookieThroughProxy("loopback", "http")).toBeUndefined();
  });
  it("supports HTTP development with an eight hour cookie lifetime", () => {
    const options = configureSessions(express(), { SESSION_SECRET: "development-only" });
    expect(options.cookie?.secure).toBe(false);
    expect(options.cookie?.maxAge).toBe(28800000);
  });
  it("rejects blanket proxy trust and weak production secrets", () => {
    expect(() => configureSessions(express(), { TRUST_PROXY: "true" })).toThrow("TRUST_PROXY");
    expect(() => configureSessions(express(), { NODE_ENV: "production", SESSION_SECRET: "short" })).toThrow("SESSION_SECRET");
  });
});
