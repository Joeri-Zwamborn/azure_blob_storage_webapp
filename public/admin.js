const countElement = document.querySelector("#photo-count");

try {
  const response = await fetch("/api/admin/photo-count");

  if (!response.ok) {
    throw new Error(`Dashboard service returned ${response.status}`);
  }

  const { photoCount } = await response.json();
  countElement.textContent = photoCount.toLocaleString();
} catch (error) {
  console.error(error);
  countElement.textContent = "Unavailable";
}