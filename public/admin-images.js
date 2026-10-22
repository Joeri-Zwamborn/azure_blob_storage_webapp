const search = document.querySelector("#admin-image-search");
const queryInput = document.querySelector("#admin-image-query");
const gallery = document.querySelector("#admin-image-gallery");
const status = document.querySelector("#admin-image-status");
const errorBox = document.querySelector("#admin-image-error");
const more = document.querySelector("#admin-image-more");
let csrfToken;
let cursor = null;
let query = "";
let count = 0;
let busy = false;

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  errorBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll("#admin-actions button, #admin-actions input")) control.disabled = value;
  gallery.setAttribute("aria-busy", String(value));
}

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, cache: "no-store" });
  if (response.status === 401 || response.redirected) throw new Error("Your session expired. Open the admin page again to sign in.");
  if (response.status === 204) return;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "This action could not be completed. Reload the list before retrying.");
  return result;
}

function imageUrl(photo) {
  return `/api/images/${photo.name.split("/").map(encodeURIComponent).join("/")}?v=${encodeURIComponent(photo.etag)}`;
}

function button(label, className = "") {
  const result = document.createElement("button");
  result.type = "button";
  result.textContent = label;
  result.className = className;
  return result;
}

function card(photo) {
  const article = document.createElement("article");
  article.className = "admin-image-card";
  const image = document.createElement("img");
  image.src = imageUrl(photo);
  image.alt = photo.name;
  image.loading = "lazy";
  const content = document.createElement("div");
  content.className = "admin-image-details";
  const heading = document.createElement("h3");
  heading.textContent = photo.name;
  const renameLabel = document.createElement("label");
  renameLabel.textContent = "Filename";
  const filename = document.createElement("input");
  filename.type = "text";
  filename.value = photo.name.slice(photo.name.lastIndexOf("/") + 1);
  filename.maxLength = 1024;
  renameLabel.append(filename);
  const rename = button("Save filename");
  const replaceLabel = document.createElement("label");
  replaceLabel.textContent = "Replacement photo (PNG, up to 20 MB)";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/png,.png";
  replaceLabel.append(file);
  const replace = button("Replace photo");
  const remove = button("Delete photo", "danger-button");
  const hint = document.createElement("p");
  hint.className = "admin-image-hint";
  hint.textContent = "Keep the capture date at the end of the filename so dashboard activity remains accurate.";
  content.append(heading, renameLabel, rename, hint, replaceLabel, replace, remove);
  article.append(image, content);
  const url = () => `/api/admin/images?name=${encodeURIComponent(photo.name)}`;
  const headers = () => ({ "X-CSRF-Token": csrfToken, "If-Match": photo.etag });

  async function change(action, message) {
    if (busy) return;
    errorBox.hidden = true;
    setBusy(true);
    try {
      await action();
      await load(false);
      status.textContent = `${message} ${count} photo(s) shown.`;
      document.querySelector("#photo-count").textContent = "Refreshing…";
      // Refresh dashboard counts independently of the management list.
      window.dispatchEvent(new Event("photos-changed"));
    } catch (error) {
      showError(error.message);
    } finally {
      setBusy(false);
    }
  }

  rename.addEventListener("click", () => {
    if (!filename.value.trim().toLowerCase().endsWith(".png") || /[/\\]/.test(filename.value)) {
      showError("Enter a PNG filename without a folder."); return;
    }
    if (filename.value === photo.name.slice(photo.name.lastIndexOf("/") + 1)) return;
    change(() => api(url(), { method: "PATCH", headers: { ...headers(), "Content-Type": "application/json" }, body: JSON.stringify({ filename: filename.value }) }), "Photo renamed.");
  });
  replace.addEventListener("click", () => {
    const selected = file.files[0];
    if (!selected) { showError("Choose a replacement PNG first."); return; }
    if (selected.size > 20 * 1024 * 1024) { showError("Choose a PNG of at most 20 MB."); return; }
    if (!window.confirm(`Replace the contents of ${photo.name}? This changes the photo in the production archive.`)) return;
    change(() => api(url(), { method: "PUT", headers: { ...headers(), "Content-Type": "image/png" }, body: selected }), "Photo replaced.");
  });
  remove.addEventListener("click", () => {
    if (!window.confirm(`Delete ${photo.name}? This removes it from the production archive. This page cannot undo deletion.`)) return;
    change(() => api(url(), { method: "DELETE", headers: headers() }), "Photo deleted.");
  });
  return article;
}

async function load(append) {
  if (!append) { cursor = null; count = 0; gallery.replaceChildren(); }
  const params = new URLSearchParams({ q: query });
  if (append && cursor) params.set("cursor", cursor);
  const data = await api(`/api/admin/images?${params}`);
  csrfToken = data.csrfToken;
  cursor = data.cursor;
  for (const photo of data.images) { gallery.append(card(photo)); count++; }
  more.hidden = !cursor;
  status.textContent = count ? `${count} photo(s) shown.${cursor ? " More photos are available." : ""}` : cursor ? "No matches in this batch. Load more to continue searching." : "No matching photos.";
}

async function searchImages(append = false) {
  if (busy) return;
  errorBox.hidden = true;
  setBusy(true);
  status.textContent = "Loading photos…";
  try { await load(append); } catch (error) { showError(error.message); status.textContent = "Unable to load photos."; }
  finally { setBusy(false); }
}
search.addEventListener("submit", event => { event.preventDefault(); query = queryInput.value.trim(); searchImages(); });
more.addEventListener("click", () => searchImages(true));
searchImages();
