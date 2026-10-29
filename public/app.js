import { amsterdamDate, wasTakenOn } from "/photo-dates.js";
import { photoPreviewButton } from "/photo-preview.js";

const form = document.querySelector("#search-form");
const todayButton = document.querySelector("#today-button");
let latestSearch = 0;
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

  searchHistorySection.hidden = false;
  clearHistoryButton.disabled = !history.length;

  historyContainer.replaceChildren(todayButton);

  for (const searchTerm of history) {
    const item = document.createElement("div");
    const searchButton = document.createElement("button");
    const removeButton = document.createElement("button");

    item.className = "search-history-item";

    searchButton.type = "button";
    searchButton.className = "search-history-term";
    searchButton.textContent = searchTerm;

    searchButton.addEventListener("click", () => {
      searchInput.value = searchTerm;
      form.requestSubmit();
    });

    removeButton.type = "button";
    removeButton.className = "search-history-remove";
    removeButton.textContent = "x";
    removeButton.setAttribute("aria-label", `Remove ${searchTerm} from recent searches`);

    removeButton.addEventListener("click", () => {
      const updatedHistory = getSearchHistory()
        .filter((item) => item !== searchTerm);

      localStorage.setItem(
        searchHistoryKey,
        JSON.stringify(updatedHistory),
      );

      renderSearchHistory();
    });

    item.append(searchButton, removeButton);
    historyContainer.append(item);
  }
}

clearHistoryButton.addEventListener("click", () => {
  localStorage.removeItem(searchHistoryKey);
  renderSearchHistory();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const requestId = ++latestSearch;
  const todayOnly = event.submitter === todayButton;
  const today = todayOnly ? amsterdamDate() : null;
  todayButton.setAttribute("aria-pressed", String(todayOnly));
  if (todayOnly) searchInput.value = "";
  const searchTerm = searchInput.value.trim().toLowerCase();

  gallery.replaceChildren();

  if (searchTerm) {
    saveSearch(searchTerm);
    renderSearchHistory();
  }
  message.textContent = todayOnly ? "Loading today's photos…" : searchTerm
    ? `Searching for "${searchTerm}"...`
    : "Loading all images...";

  try {
    const response = await fetch("/api/blobs");

    if (!response.ok) {
      throw new Error(`Search service returned ${response.status}`);
    }

    const blobs = await response.json();
    if (requestId !== latestSearch) return;

    const matches = todayOnly ? blobs.filter(blob => wasTakenOn(blob.name, today)) : searchTerm
      ? blobs.filter((blob) => blob.name.toLowerCase().includes(searchTerm),)
      : blobs;

  if (matches.length === 0) {
    message.textContent = todayOnly ? "No photos taken today yet." : "No matching images found.";
    return;
  }

  message.textContent = todayOnly ? `${matches.length} photo(s) taken today.` : `${matches.length} image(s) found.`;

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

    figure.append(photoPreviewButton(image, blob.name), caption);
    gallery.append(figure);
  }

  } catch (error) {
    if (requestId !== latestSearch) return;
    console.error(error);
    message.textContent =
      "Unable to search Azure Storage. Check your network or VPN connection.";
  }
});
renderSearchHistory();
