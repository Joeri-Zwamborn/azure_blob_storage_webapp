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

app.get("/api/images/:blobName", async (request, response, next) => {
    try {
        const blobName = request.params.blobName;
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        const downloadBlockBlobResponse = await blockBlobClient.download(0);
        response.setHeader("Content-Type", "image/png");
        downloadBlockBlobResponse.readableStreamBody?.pipe(response);
    } catch (error) {
        next(error);
    }
});

app.listen(3000, () => {
    console.log("Server is running on port 3000");
});
//# sourceMappingURL=index.js.map