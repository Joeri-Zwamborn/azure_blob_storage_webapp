const gallery = document.querySelector<HTMLDivElement>("#gallery");
const response = await fetch("/api/blobs");
const blobs = await response.json();

for (const blob of blobs) {
    const figure = document.createElement("figure");
    const img = document.createElement("img");
    const caption = document.createElement("figcaption");

    const encodedBlobPath = blob.name.split("/").map(encodeURIComponent).join("/");
    img.src = `/api/images/${encodedBlobPath}`;
    img.alt = blob.name;
    img.loading = "lazy";
    caption.textContent = blob.name;

    figure.append(img, caption);
    gallery?.append(figure);
}
