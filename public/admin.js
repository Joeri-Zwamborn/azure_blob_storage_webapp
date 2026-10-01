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

const todayElement = document.querySelector("#today-activity");
const yesterdayElement = document.querySelector("#yesterday-activity");
const weekElement = document.querySelector("#week-activity");

try {
  const response = await fetch("/api/admin/today-activity");

  if (!response.ok) {
    throw new Error(`Dashboard service returned ${response.status}`);
  }

  const activity = await response.json();

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type) =>
    parts.find((part) => part.type === type).value;

  const today =
    `${getPart("year")}-${getPart("month")}-${getPart("day")}`;

  // Subtract one calendar day, including across month/year boundaries.
  const previousDay = new Date(`${today}T12:00:00Z`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const yesterday = previousDay.toISOString().slice(0, 10);

  const monday = new Date(`${today}T12:00:00Z`);
  const daysSinceMonday = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
  const weekStart = monday.toISOString().slice(0, 10);
  const weekCount = Object.entries(activity)
    .filter(([date]) => date >= weekStart && date <= today)
    .reduce((total, [, count]) => total + count, 0);

  todayElement.textContent = (activity[today] ?? 0).toLocaleString();
  yesterdayElement.textContent =
    (activity[yesterday] ?? 0).toLocaleString();
  weekElement.textContent = weekCount.toLocaleString();
} catch (error) {
  console.error(error);
  todayElement.textContent = "Unavailable";
  yesterdayElement.textContent = "Unavailable";
  weekElement.textContent = "Unavailable";
}
