const form = document.querySelector("#search-form");
const searchInput = document.querySelector("#search");
const message = document.querySelector("#message");
const gallery = document.querySelector("#gallery");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const searchTerm = searchInput.value.trim().toLowerCase();

  gallery.replaceChildren();

  if (!searchTerm) {
    message.textContent = "Enter a term to search for images.";
    return;
  }

  message.textContent = "Searching...";

  const response = await fetch("/api/blobs");
  const blobs = await response.json();

  const matches = blobs.filter((blob) =>
    blob.name.toLowerCase().includes(searchTerm),
  );

  if (matches.length === 0) {
    message.textContent = "No matching images found.";
    return;
  }

  message.textContent = `${matches.length} image(s) found.`;

  for (const blob of matches) {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    const caption = document.createElement("figcaption");

    const encodedBlobPath = blob.name
      .split("/")
      .map(encodeURIComponent)
      .join("/");

    image.src = `/api/images/${encodedBlobPath}`;
    image.alt = blob.name;
    image.loading = "lazy";

    caption.textContent = blob.name.replace(/^production\//i, "");

    figure.append(image, caption);
    gallery.append(figure);
  }
});