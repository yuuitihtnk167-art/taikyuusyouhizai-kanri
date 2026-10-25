import assert from "node:assert/strict";
import { test } from "node:test";
import { JAPANESE_HOLIDAYS } from "../js/services/japanese-holidays.js";
import { getHolidayUpdate, updateHolidayData, HOLIDAY_UPDATE_KEY } from "../js/services/holiday-update.js";
import { japaneseHolidayStatus } from "../js/services/japanese-holiday-calendar.js";
import { dateMonthPosition, monthlySummaryReference, summaryReferenceLabel } from "../js/services/monthly-summary.js";

const entries = new Map();
const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
globalThis.localStorage = storage;
const now = new Date("2026-10-25T00:00:00Z");
const data = () => Object.fromEntries([...JAPANESE_HOLIDAYS].filter((key) => Number(key.slice(0, 4)) >= 2025).map((key) => [key, "祝日"]));
const response = (payload) => async () => new Response(JSON.stringify(payload), { status: 200 });

test("manual update records the check date, detects unchanged data and only writes its own key", async () => {
  entries.clear();
  entries.set("other-product-setting", "keep");
  const result = await updateHolidayData({ fetcher: response(data()), storage, now });
  assert.equal(result.changed, false);
  assert.equal(getHolidayUpdate(storage).checkedAt, now.toISOString());
  assert.deepEqual(result.years, [2025, 2026, 2027]);
  assert.equal(entries.get("other-product-setting"), "keep");
});

test("downloaded additions and removals affect the next input-date calculation, including offline reload", async () => {
  entries.clear();
  const payload = data();
  payload["2026-11-13"] = "臨時の祝日";
  delete payload["2026-11-03"];
  const result = await updateHolidayData({ fetcher: response(payload), storage, now });
  assert.equal(result.changed, true);
  assert.equal(japaneseHolidayStatus(new Date(2026, 10, 13)).isHoliday, true);
  assert.equal(japaneseHolidayStatus(new Date(2026, 10, 3)).isHoliday, false);
  const position = dateMonthPosition(new Date(2026, 9, 25));
  const settings = { mode: "monthly", day: 15, adjustToPreviousWeekday: true };
  assert.equal(monthlySummaryReference(position, settings).date.getDate(), 12);
  const persisted = entries.get(HOLIDAY_UPDATE_KEY);
  const reloaded = new Map([[HOLIDAY_UPDATE_KEY, persisted]]);
  assert.equal(getHolidayUpdate({ getItem: (key) => reloaded.get(key) }).holidays.has("2026-11-13"), true);
  assert.doesNotMatch(summaryReferenceLabel(2028 * 12 + 9, settings), /仮/);
});

test("network, HTTP, malformed, partial, stale and unsavable updates preserve existing data", async () => {
  const before = entries.get(HOLIDAY_UPDATE_KEY);
  const invalidDay = data(); invalidDay["2026-02-30"] = "祝日";
  const partial = data(); delete partial["2026-11-23"];
  const missingYear = Object.fromEntries(Object.entries(data()).filter(([key]) => !key.startsWith("2027-")));
  const fetchers = [
    async () => { throw new Error("offline"); },
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response("bad json"), response([]), response(invalidDay), response(partial), response(missingYear),
    response({ "2026-01-01": "元日" }),
  ];
  for (const fetcher of fetchers) {
    await assert.rejects(updateHolidayData({ fetcher, storage, now }));
    assert.equal(entries.get(HOLIDAY_UPDATE_KEY), before);
  }
  await assert.rejects(updateHolidayData({ fetcher: response(data()), storage, now: new Date("2030-01-01") }));
  await assert.rejects(updateHolidayData({ fetcher: response(data()), storage: { ...storage, setItem() { throw new Error("quota"); } }, now }));
  assert.equal(entries.get(HOLIDAY_UPDATE_KEY), before);
  assert.equal(japaneseHolidayStatus(new Date(2026, 10, 13)).isHoliday, true);
  entries.clear();
});

test("corrupt cached data falls back to the bundled calendar", () => {
  entries.set(HOLIDAY_UPDATE_KEY, "not-json");
  assert.equal(getHolidayUpdate(), null);
  assert.equal(japaneseHolidayStatus(new Date(2026, 10, 3)).isHoliday, true);
  entries.clear();
});

test("a refreshed bundled table supersedes downloads made against an older bundle", async () => {
  const payload = data(); delete payload["2026-11-03"];
  await updateHolidayData({ fetcher: response(payload), storage, now });
  assert.equal(japaneseHolidayStatus(new Date(2026, 10, 3)).isHoliday, false);
  const old = JSON.parse(entries.get(HOLIDAY_UPDATE_KEY));
  old.baseline = "previous-bundled-calendar";
  entries.set(HOLIDAY_UPDATE_KEY, JSON.stringify(old));
  assert.equal(japaneseHolidayStatus(new Date(2026, 10, 3)).isHoliday, true);
  entries.clear();
});
