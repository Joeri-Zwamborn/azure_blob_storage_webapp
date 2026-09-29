const form = document.querySelector("#search-form");
const searchInput = document.querySelector("#search");
const message = document.querySelector("#message");
const gallery = document.querySelector("#gallery");
const historyContainer = document.querySelector("#search-history");
const searchHistoryKey = "production-photo-search-history";
const searchHistorySection = document.querySelector("#search-history-section");
const clearHistoryButton = document.querySelector("#clear-history");

function getSearchHistory() {
  return JSON.parse(localStorage.getItem(searchHistoryKey) ?? "[]");
}

function saveSearch(searchTerm) {
  const history = getSearchHistory()
    .filter((item) => item !== searchTerm);

  history.unshift(searchTerm);

  localStorage.setItem(
    searchHistoryKey,
    JSON.stringify(history.slice(0, 10)),
  );
}

function renderSearchHistory() {
  const history = getSearchHistory();

  searchHistorySection.hidden = !history.length;

  historyContainer.replaceChildren();

  for (const searchTerm of history) {
    const button = document.createElement("button");

    button.type = "button";
    button.textContent = searchTerm;

    button.addEventListener("click", () => {
      searchInput.value = searchTerm;
      form.requestSubmit();
    });

    historyContainer.append(button);
  }
}

clearHistoryButton.addEventListener("click", () => {
  localStorage.removeItem(searchHistoryKey);
  renderSearchHistory();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const searchTerm = searchInput.value.trim().toLowerCase();

  gallery.replaceChildren();

  if (searchTerm) {
    saveSearch(searchTerm);
    renderSearchHistory();
  }
  message.textContent = searchTerm
    ? `Searching for "${searchTerm}"...`
    : "Loading all images...";

  try {
    const response = await fetch("/api/blobs");

    if (!response.ok) {
      throw new Error(`Search service returned ${response.status}`);
    }

    const blobs = await response.json();

    const matches = searchTerm
      ? blobs.filter((blob) => blob.name.toLowerCase().includes(searchTerm),)
      : blobs;

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

  } catch (error) {
    console.error(error);
    message.textContent =
      "Unable to search Azure Storage. Check your network or VPN connection.";
  }
});
renderSearchHistory();