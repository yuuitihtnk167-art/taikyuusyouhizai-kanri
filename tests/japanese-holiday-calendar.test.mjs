import assert from "node:assert/strict";
import { test } from "node:test";
import JapaneseHolidays from "../js/vendor/japanese-holidays-1.0.10.js";
import { JAPANESE_HOLIDAYS, HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR } from "../js/services/japanese-holidays.js";
import { createJapaneseHolidayCalendar, japaneseHolidayStatus } from "../js/services/japanese-holiday-calendar.js";

const key = (year, month, day) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

test("all published dates use the official table, preserving exceptional moves", () => {
  for (let date = new Date(HOLIDAY_FIRST_YEAR, 0, 1); date.getFullYear() <= HOLIDAY_LAST_YEAR; date.setDate(date.getDate() + 1)) {
    const result = japaneseHolidayStatus(date);
    assert.equal(result.isHoliday, JAPANESE_HOLIDAYS.has(key(date.getFullYear(), date.getMonth() + 1, date.getDate())));
    assert.equal(result.confirmed, true);
    assert.equal(result.supported, true);
  }
  for (const [year, month, day] of [[2019, 5, 1], [2020, 7, 23], [2021, 8, 9]]) {
    assert.equal(japaneseHolidayStatus(new Date(year, month - 1, day)).isHoliday, true);
  }
});

test("the library agrees with all official holidays under the current post-2021 rules", () => {
  for (let year = 2022; year <= HOLIDAY_LAST_YEAR; year++) {
    const forecast = new Set(JapaneseHolidays.getHolidaysOf(year).map((day) => key(year, day.month, day.date)));
    assert.deepEqual(forecast, new Set([...JAPANESE_HOLIDAYS].filter((day) => day.startsWith(`${year}-`))));
  }
});

test("future forecasts include equinoxes, substitute holidays and citizens' holidays", () => {
  for (const [year, month, day] of [[2028, 3, 20], [2028, 9, 22], [2029, 2, 12], [2032, 9, 21], [2099, 1, 1]]) {
    assert.deepEqual(japaneseHolidayStatus(new Date(year, month - 1, day)), { isHoliday: true, confirmed: false, supported: true }, key(year, month, day));
  }
  assert.deepEqual(japaneseHolidayStatus(new Date(2028, 4, 2)), { isHoliday: false, confirmed: false, supported: true });
  assert.deepEqual(japaneseHolidayStatus(new Date(2100, 0, 1)), { isHoliday: false, confirmed: false, supported: false });
});

test("new official years replace forecasts, including removal of a predicted holiday", () => {
  let forecastCalls = 0;
  const calendar = createJapaneseHolidayCalendar({
    firstYear: 2028, lastYear: 2028, holidays: new Set(["2028-05-02"]),
    forecastHolidays: () => { forecastCalls++; return [{ month: 5, date: 3 }]; },
  });
  assert.deepEqual(calendar(new Date(2028, 4, 2)), { isHoliday: true, confirmed: true, supported: true });
  assert.deepEqual(calendar(new Date(2028, 4, 3)), { isHoliday: false, confirmed: true, supported: true });
  assert.equal(forecastCalls, 0);
  assert.equal(calendar(new Date(2029, 4, 3)).isHoliday, true);
  assert.equal(calendar(new Date(2029, 4, 4)).isHoliday, false);
  assert.equal(forecastCalls, 1);
});
