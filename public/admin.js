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
  const dailyActivityElement = document.querySelector("#daily-activity");

  try {
    const response = await fetch("/api/admin/daily-activity");

    if (!response.ok) {
      throw new Error(`Dashboard service returned ${response.status}`);
    }

    const dailyActivity = await response.json();

    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const getPart = (type) =>
      parts.find((part) => part.type === type).value;

    const today = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;

    dailyActivityElement.textContent =
      (dailyActivity[today] ?? 0).toLocaleString();
  } catch (error) {
    console.error(error);
    dailyActivityElement.textContent = "Unavailable";
  }
} catch (error) {
  console.error(error);
  dailyActivityElement.textContent = "Unavailable";
}
