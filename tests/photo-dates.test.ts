import { expect, it } from "vitest";
// Browser module: kept shared so date filtering can be checked without Azure.
import { amsterdamDate, wasTakenOn } from "../public/photo-dates.js";

it("uses Amsterdam's calendar date across UTC midnight and summer/winter time", () => {
  expect(amsterdamDate(new Date("2026-07-01T22:30:00Z"))).toBe("2026-07-02");
  expect(amsterdamDate(new Date("2026-10-29T23:30:00Z"))).toBe("2026-10-30");
  expect(amsterdamDate(new Date("2026-10-29T22:30:00Z"))).toBe("2026-10-29");
});
it("matches the capture date for new, legacy and Windows filenames", () => {
  for (const name of [
    "production/00123_abcd_2026-10-29 09:00:00.123456.png",
    "00123_2026-10-29 09:00:00.png",
    "production/00123_abcd_2026-10-29 09-00-00.123456.PNG",
  ]) expect(wasTakenOn(name, "2026-10-29")).toBe(true);
});
it("ignores dates in barcodes, folders, and unrelated filenames", () => {
  expect(wasTakenOn("production/2026-10-29_abcd_2026-10-28 23:59:59.png", "2026-10-29")).toBe(false);
  expect(wasTakenOn("2026-10-29/photo.png", "2026-10-29")).toBe(false);
  expect(wasTakenOn("renamed-photo.png", "2026-10-29")).toBe(false);
});
