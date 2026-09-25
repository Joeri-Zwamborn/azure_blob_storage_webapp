import express from "express";
import { BlobServiceClient } from "@azure/storage-blob";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME;
const app = express();

if (!connectionString || !containerName) {
    console.error("Environment variables for Azure Storage are not set.");
    process.exit(1);
}
app.use(express.static("public"));

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
    const blobName = request.params.blobPath.join("/");

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

app.get("/admin", (request, response) => {
    response.sendFile("admin.html", { root: "public" });
});

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});