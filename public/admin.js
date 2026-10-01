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

const dailyActivityElement = document.querySelector("#daily-activity");

try {
  const response = await fetch("/api/admin/daily-activity");

  if (!response.ok) {
    throw new Error(`Dashboard service returned ${response.status}`);
  }
  
  const dailyActivity = await response.json();
  dailyActivityElement.textContent = Object.values(dailyActivity).reduce((a, b) => a + b, 0).toLocaleString();
} catch (error) {
  console.error(error);
  dailyActivityElement.textContent = "Unavailable";
}
