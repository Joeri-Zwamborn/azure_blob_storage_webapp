let dialog;
let fullImage;
let title;
let error;
let opener;

function createDialog() {
  dialog = document.createElement("dialog");
  dialog.className = "photo-preview-dialog";
  dialog.setAttribute("aria-labelledby", "photo-preview-title");
  const header = document.createElement("div");
  header.className = "photo-preview-header";
  title = document.createElement("h2");
  title.id = "photo-preview-title";
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.setAttribute("aria-label", "Close photo preview");
  close.addEventListener("click", () => dialog.close());
  header.append(title, close);
  fullImage = document.createElement("img");
  fullImage.className = "photo-preview-full-image";
  error = document.createElement("p");
  error.setAttribute("role", "status");
  error.hidden = true;
  error.textContent = "This photo could not be loaded. Close the preview and refresh the list.";
  fullImage.addEventListener("error", () => { error.hidden = false; });
  dialog.append(header, fullImage, error);
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  // Native dialog handles Escape, focus trapping, and background interaction.
  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("photo-preview-open");
    fullImage.removeAttribute("src");
    if (opener?.isConnected) opener.focus();
  });
  document.body.append(dialog);
}

export function photoPreviewButton(image, name) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "photo-preview-trigger";
  button.setAttribute("aria-label", `Preview photo ${name}`);
  button.setAttribute("aria-haspopup", "dialog");
  button.append(image);
  button.addEventListener("click", () => {
    if (!dialog) createDialog();
    opener = button;
    title.textContent = name.replace(/^production\//i, "");
    fullImage.alt = name;
    error.hidden = true;
    fullImage.src = image.currentSrc || image.src;
    dialog.showModal();
    document.documentElement.classList.add("photo-preview-open");
  });
  return button;
}
