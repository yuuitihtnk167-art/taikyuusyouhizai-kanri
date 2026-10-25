import JapaneseHolidays from "../vendor/japanese-holidays-1.0.10.js";
import { HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR, JAPANESE_HOLIDAYS } from "./japanese-holidays.js?v=156";
import { getHolidayUpdate, BUNDLED_HOLIDAY_REVISION } from "./holiday-update.js?v=157";

// Bundled official years take precedence over computed forecasts.
export const HOLIDAY_FORECAST_LAST_YEAR = 2099;

export function createJapaneseHolidayCalendar({
  firstYear = HOLIDAY_FIRST_YEAR,
  lastYear = HOLIDAY_LAST_YEAR,
  holidays = JAPANESE_HOLIDAYS,
  forecastHolidays = (year) => JapaneseHolidays.getHolidaysOf(year),
} = {}) {
  const forecastCache = new Map();
  return (date) => {
    const year = date.getFullYear();
    const key = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    if (year >= firstYear && year <= lastYear) {
      return { isHoliday: holidays.has(key), confirmed: true, supported: true };
    }
    if (year > lastYear && year >= 2022 && year <= HOLIDAY_FORECAST_LAST_YEAR) {
      if (!forecastCache.has(year)) {
        forecastCache.set(year, new Set(forecastHolidays(year).map((day) => `${day.month}-${day.date}`)));
      }
      return {
        isHoliday: forecastCache.get(year).has(`${date.getMonth() + 1}-${date.getDate()}`),
        confirmed: false, supported: true,
      };
    }
    return { isHoliday: false, confirmed: false, supported: false };
  };
}

const bundledCalendar = createJapaneseHolidayCalendar();
export function japaneseHolidayStatus(date) {
  const update = getHolidayUpdate();
  const year = date.getFullYear();
  if (update?.baseline === BUNDLED_HOLIDAY_REVISION && update.years.includes(year)) {
    const key = `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { isHoliday: update.holidays.has(key), confirmed: year <= HOLIDAY_LAST_YEAR, supported: true };
  }
  return bundledCalendar(date);
}
