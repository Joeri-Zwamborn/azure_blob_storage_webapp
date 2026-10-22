import express from "express";
import session from "express-session";
import type { ContainerClient } from "@azure/storage-blob";
import http from "node:http";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { adminImages } from "../src/admin-images.js";

const name = "production/00123_abcd_2026-10-22 10:00:00.png";
const etag = '"original-etag"';
let server: http.Server;
let cookie: string | undefined;
let token: string;
let blob: ReturnType<typeof fakeBlob>;
let container: { getBlockBlobClient: ReturnType<typeof vi.fn>; listBlobsFlat: ReturnType<typeof vi.fn> };

function fakeBlob() {
  return {
    getProperties: vi.fn().mockResolvedValue({ contentLength: 8, metadata: { station: "test" } }),
    download: vi.fn().mockImplementation(() => Promise.resolve({ readableStreamBody: Readable.from([Buffer.from("original")]) })),
    uploadData: vi.fn().mockResolvedValue({ etag: '"updated-etag"' }),
    delete: vi.fn().mockResolvedValue({}),
  };
}

async function send(method: string, path: string, body?: Buffer | string, headers: Record<string, string> = {}) {
  const address = server.address() as import("node:net").AddressInfo;
  return new Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: address.port, method, path,
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}), ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }
        resolve({ status: response.statusCode!, data, headers: response.headers });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function login(who = "admin") {
  const response = await send("POST", `/test-login?who=${who}`);
  cookie = response.headers["set-cookie"]?.[0].split(";")[0];
  const list = await send("GET", "/images");
  token = list.data.csrfToken;
}
const endpoint = () => `/images?name=${encodeURIComponent(name)}`;
const protection = () => ({ "X-CSRF-Token": token, "If-Match": etag });

beforeEach(async () => {
  cookie = undefined;
  blob = fakeBlob();
  container = {
    getBlockBlobClient: vi.fn(() => blob),
    listBlobsFlat: vi.fn(() => ({ byPage: () => ({ next: vi.fn().mockResolvedValue({ done: false, value: {
      segment: { blobItems: [{ name, properties: { etag, contentLength: 8 } }, { name: "notes.txt", properties: {} }] },
    } }) }) })),
  };
  const app = express();
  app.use(session({ secret: "test-secret-for-admin-images", resave: false, saveUninitialized: false }));
  app.post("/test-login", (req, res) => { req.session.user = { objectId: String(req.query.who) }; res.sendStatus(200); });
  app.use("/images", adminImages(container as unknown as ContainerClient, (req, res, next) => {
    if (!req.session.user) { res.sendStatus(401); return; }
    if (req.session.user.objectId !== "admin") { res.sendStatus(403); return; }
    next();
  }));
  server = await new Promise(resolve => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
});
afterEach(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  vi.restoreAllMocks();
});

it("denies all image management routes without authentication", async () => {
  for (const method of ["GET", "DELETE", "PATCH", "PUT"]) expect((await send(method, endpoint())).status).toBe(401);
  expect(container.getBlockBlobClient).not.toHaveBeenCalled();
  expect(container.listBlobsFlat).not.toHaveBeenCalled();
});
it("denies a signed-in user who is not an admin", async () => {
  await login("viewer");
  expect((await send("DELETE", endpoint())).status).toBe(403);
  expect(blob.delete).not.toHaveBeenCalled();
});
it("returns only matching PNGs, with a session-bound token and no-store caching", async () => {
  await login();
  const result = await send("GET", "/images?q=00123");
  expect(result.status).toBe(200);
  expect(result.data.images).toEqual([{ name, etag, size: 8 }]);
  expect(result.data.csrfToken).toBe(token);
  expect(result.headers["cache-control"]).toBe("no-store");
});
it("rejects missing and invalid CSRF tokens without touching storage", async () => {
  await login();
  for (const value of ["", "0".repeat(64), "é".repeat(64)]) {
    expect((await send("DELETE", endpoint(), undefined, { "X-CSRF-Token": value, "If-Match": etag })).status).toBe(403);
  }
  expect(blob.delete).not.toHaveBeenCalled();
});
it("requires an exact version and valid PNG name before deleting", async () => {
  await login();
  expect((await send("DELETE", endpoint(), undefined, { "X-CSRF-Token": token })).status).toBe(428);
  expect((await send("DELETE", "/images?name=notes.txt", undefined, protection())).status).toBe(400);
  expect(blob.delete).not.toHaveBeenCalled();
});
it("deletes only the selected version of the selected image", async () => {
  await login();
  expect((await send("DELETE", endpoint(), undefined, protection())).status).toBe(204);
  expect(container.getBlockBlobClient).toHaveBeenCalledWith(name);
  expect(blob.delete).toHaveBeenCalledWith({ conditions: { ifMatch: etag } });
});
it("normalizes Azure's bare listing ETag so the selected photo can be deleted", async () => {
  container.listBlobsFlat.mockImplementation(() => ({ byPage: () => ({ next: vi.fn().mockResolvedValue({ done: false, value: {
    segment: { blobItems: [{ name, properties: { etag: "0x8DF1E31A554AD35", contentLength: 8 } }] },
  } }) }) }));
  await login();
  const list = await send("GET", "/images");
  const selectedEtag = list.data.images[0].etag;
  expect(selectedEtag).toBe('"0x8DF1E31A554AD35"');
  expect((await send("DELETE", endpoint(), undefined, { "X-CSRF-Token": token, "If-Match": selectedEtag })).status).toBe(204);
  expect(blob.delete).toHaveBeenCalledWith({ conditions: { ifMatch: '"0x8DF1E31A554AD35"' } });
});
it("reports concurrent changes rather than deleting blindly", async () => {
  await login();
  blob.delete.mockRejectedValue({ statusCode: 412 });
  expect((await send("DELETE", endpoint(), undefined, protection())).status).toBe(409);
  expect(blob.delete).toHaveBeenCalledTimes(1);
});
it("renames inside the same folder without overwriting a destination", async () => {
  await login();
  const result = await send("PATCH", endpoint(), JSON.stringify({ filename: "corrected.png" }), { ...protection(), "Content-Type": "application/json" });
  expect(result.status).toBe(200);
  expect(result.data.name).toBe("production/corrected.png");
  expect(blob.uploadData).toHaveBeenCalledWith(Buffer.from("original"), expect.objectContaining({ conditions: { ifNoneMatch: "*" }, metadata: { station: "test" } }));
  expect(blob.delete).toHaveBeenCalledWith({ conditions: { ifMatch: etag } });
});
it("does not delete the source if the destination already exists", async () => {
  await login();
  blob.uploadData.mockRejectedValue({ statusCode: 412 });
  const result = await send("PATCH", endpoint(), JSON.stringify({ filename: "exists.png" }), { ...protection(), "Content-Type": "application/json" });
  expect(result.status).toBe(409);
  expect(blob.delete).not.toHaveBeenCalled();
});
it("keeps the copy if removing the original fails, and explains the partial rename", async () => {
  await login();
  blob.delete.mockRejectedValue({ statusCode: 500 });
  const result = await send("PATCH", endpoint(), JSON.stringify({ filename: "copy.png" }), { ...protection(), "Content-Type": "application/json" });
  expect(result.status).toBe(409);
  expect(result.data.error).toContain("Both photos were kept");
});
it("rejects folder traversal in a new filename", async () => {
  await login();
  const result = await send("PATCH", endpoint(), JSON.stringify({ filename: "../wrong.png" }), { ...protection(), "Content-Type": "application/json" });
  expect(result.status).toBe(400);
  expect(blob.uploadData).not.toHaveBeenCalled();
});
it("validates and saves a replacement PNG with version protection", async () => {
  await login();
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const result = await send("PUT", endpoint(), png, { ...protection(), "Content-Type": "image/png" });
  expect(result.status).toBe(200);
  expect(blob.uploadData).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({ conditions: { ifMatch: etag } }));
  expect((await sharp(blob.uploadData.mock.calls[0][0]).metadata()).format).toBe("png");
});
it("rejects fake PNG content without overwriting storage", async () => {
  await login();
  expect((await send("PUT", endpoint(), "<html>not an image</html>", { ...protection(), "Content-Type": "image/png" })).status).toBe(415);
  expect(blob.uploadData).not.toHaveBeenCalled();
});
it("rejects PNGs with excessive pixel dimensions", async () => {
  await login();
  const png = await sharp({ create: { width: 6000, height: 5000, channels: 3, background: "red" } }).png().toBuffer();
  expect((await send("PUT", endpoint(), png, { ...protection(), "Content-Type": "image/png" })).status).toBe(415);
  expect(blob.uploadData).not.toHaveBeenCalled();
});
