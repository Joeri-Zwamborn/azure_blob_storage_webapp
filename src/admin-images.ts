import express from "express";
import crypto from "node:crypto";
import type { ContainerClient } from "@azure/storage-blob";
import sharp from "sharp";

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 25_000_000;

class ImageError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function imageName(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 1024 ||
      !value.toLowerCase().endsWith(".png") || /[\x00-\x1f\x7f\\]/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new ImageError(400, "Choose a valid PNG image.");
  }
  return value;
}

function imageEtag(request: express.Request): string {
  const etag = request.get("If-Match");
  if (!etag || etag === "*" || !/^"[^"\r\n]+"$/.test(etag)) {
    throw new ImageError(428, "Reload the image before changing it.");
  }
  return etag;
}

async function readImage(container: ContainerClient, name: string, etag: string) {
  const blob = container.getBlockBlobClient(name);
  const properties = await blob.getProperties({ conditions: { ifMatch: etag } });
  if ((properties.contentLength ?? MAX_BYTES + 1) > MAX_BYTES) {
    throw new ImageError(413, "Images larger than 20 MB cannot be edited here.");
  }
  const response = await blob.download(0, undefined, { conditions: { ifMatch: etag } });
  const chunks: Buffer[] = [];
  let size = 0;
  if (!response.readableStreamBody) throw new ImageError(502, "Unable to read the image.");
  for await (const chunk of response.readableStreamBody) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) throw new ImageError(413, "Images larger than 20 MB cannot be edited here.");
    chunks.push(bytes);
  }
  return { blob, properties, bytes: Buffer.concat(chunks) };
}

export function adminImages(container: ContainerClient, requireAdmin: express.RequestHandler) {
  const router = express.Router();
  router.use(requireAdmin);
  router.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", async (request, response) => {
    const query = typeof request.query.q === "string" ? request.query.q.trim().toLowerCase() : "";
    const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
    if (query.length > 256 || (cursor?.length ?? 0) > 8192) throw new ImageError(400, "Search is too long.");
    request.session.csrfToken ??= crypto.randomBytes(32).toString("hex");
    const images = [];
    let nextCursor = cursor;
    const pages = container.listBlobsFlat().byPage({ continuationToken: cursor, maxPageSize: 100 });
    for (let count = 0; count < 10; count++) {
      const page = await pages.next();
      if (page.done) { nextCursor = undefined; break; }
      for (const blob of page.value.segment.blobItems) {
        if (blob.name.toLowerCase().endsWith(".png") && blob.name.toLowerCase().includes(query)) {
          // List Blobs returns bare ETags (0x...), while Get Properties and
          // HTTP If-Match use quoted entity tags. Keep the API format uniform.
          const etag = blob.properties.etag;
          images.push({ name: blob.name, etag: etag && !etag.startsWith('"') ? `"${etag}"` : etag, size: blob.properties.contentLength });
        }
      }
      nextCursor = page.value.continuationToken || undefined;
      if (!nextCursor || images.length >= 100) break;
    }
    response.json({ images, cursor: nextCursor ?? null, csrfToken: request.session.csrfToken });
  });
  router.use((request, response, next) => {
    if (process.env.NODE_ENV === "production" && !request.secure) {
      response.status(400).json({ error: "Image changes require HTTPS." }); return;
    }
    const supplied = request.get("X-CSRF-Token") ?? "";
    const expected = request.session.csrfToken;
    if (!expected || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      response.status(403).json({ error: "Your editing session expired. Reload the page." }); return;
    }
    next();
  });
  router.delete("/", async (request, response) => {
    const name = imageName(request.query.name);
    await container.getBlockBlobClient(name).delete({ conditions: { ifMatch: imageEtag(request) } });
    console.info("Admin deleted image", { actor: request.session.user?.objectId, name });
    response.sendStatus(204);
  });
  router.patch("/", express.json({ limit: "4kb" }), async (request, response) => {
    const name = imageName(request.query.name);
    const etag = imageEtag(request);
    const filename = request.body?.filename;
    if (typeof filename !== "string" || filename !== filename.trim() || /[/\\]/.test(filename)) {
      throw new ImageError(400, "Enter a filename without a folder.");
    }
    const target = imageName(name.slice(0, name.lastIndexOf("/") + 1) + filename);
    if (target === name) throw new ImageError(400, "Enter a different filename.");
    const original = await readImage(container, name, etag);
    const copied = await container.getBlockBlobClient(target).uploadData(original.bytes, {
      conditions: { ifNoneMatch: "*" }, metadata: original.properties.metadata,
      blobHTTPHeaders: { blobContentType: "image/png", blobCacheControl: "no-cache" },
    });
    try {
      await original.blob.delete({ conditions: { ifMatch: etag } });
    } catch {
      throw new ImageError(409, `The copy was saved as ${target}, but the original could not be removed. Both photos were kept. Reload the list.`);
    }
    console.info("Admin renamed image", { actor: request.session.user?.objectId, name, target });
    response.json({ name: target, etag: copied.etag });
  });
  router.put("/", express.raw({ type: "image/png", limit: MAX_BYTES }), async (request, response) => {
    const name = imageName(request.query.name);
    const etag = imageEtag(request);
    if (!Buffer.isBuffer(request.body) || !request.body.length) throw new ImageError(415, "Upload a PNG image.");
    let bytes: Buffer;
    try {
      const image = sharp(request.body, { limitInputPixels: MAX_PIXELS, failOn: "warning" });
      const metadata = await image.metadata();
      if (metadata.format !== "png" || (metadata.pages ?? 1) !== 1) throw new Error("Not a single PNG");
      bytes = await image.png().toBuffer();
    } catch {
      throw new ImageError(415, "Choose a valid, non-animated PNG of at most 25 megapixels.");
    }
    if (bytes.length > MAX_BYTES) throw new ImageError(413, "The replacement image exceeds 20 MB.");
    const blob = container.getBlockBlobClient(name);
    const original = await blob.getProperties({ conditions: { ifMatch: etag } });
    const uploaded = await blob.uploadData(bytes, {
      conditions: { ifMatch: etag }, metadata: original.metadata,
      blobHTTPHeaders: { blobContentType: "image/png", blobCacheControl: "no-cache" },
    });
    console.info("Admin replaced image", { actor: request.session.user?.objectId, name });
    response.json({ name, etag: uploaded.etag });
  });
  router.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const status = (error as { statusCode?: number; status?: number }).statusCode ?? (error as { status?: number }).status;
    if (error instanceof ImageError) { response.status(error.status).json({ error: error.message }); return; }
    if (status === 404) { response.status(404).json({ error: "This image no longer exists. Reload the list." }); return; }
    if (status === 409 || status === 412) { response.status(409).json({ error: "The image changed, or that filename already exists. Reload before trying again." }); return; }
    if (status === 413) { response.status(413).json({ error: "Image uploads are limited to 20 MB." }); return; }
    if (status === 400) { response.status(400).json({ error: "Invalid request." }); return; }
    if (status === 403) { response.status(403).json({ error: "Azure did not allow this operation. Check the web app's storage permissions." }); return; }
    console.error("Admin image operation failed", { status });
    response.status(502).json({ error: "Unable to update Azure Storage. Reload the list to check the result before retrying." });
  });
  return router;
}
