export function amsterdamDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const part = type => parts.find(value => value.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function wasTakenOn(name, date) {
  // Match the capture timestamp, not a barcode or Azure's last-modified date.
  // Accept both Pi timestamps and Windows timestamps with hyphenated times.
  const match = name.match(/_(\d{4}-\d{2}-\d{2}) \d{2}[:-]\d{2}[:-]\d{2}(?:\.\d+)?\.png$/i);
  return match?.[1] === date;
}
