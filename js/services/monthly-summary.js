import { getMonthlySummarySettings } from "./app-settings.js";
import { HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR, JAPANESE_HOLIDAYS } from "./japanese-holidays.js";

export function dateMonthPosition(date) {
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getFullYear() * 12 + date.getMonth() + (date.getDate() - 1) / days;
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function hasHolidayData(date) {
  return date.getFullYear() >= HOLIDAY_FIRST_YEAR && date.getFullYear() <= HOLIDAY_LAST_YEAR;
}

export function monthlySummaryReference(monthPosition, settings = getMonthlySummarySettings()) {
  const selectedMonth = Math.floor(monthPosition);
  const year = Math.floor(selectedMonth / 12);
  const month = selectedMonth - year * 12;
  if (settings.mode === "position") {
    return { selectedMonth, position: monthPosition, date: null, holidaysKnown: true };
  }

  const lastDay = new Date(year, month + 1, 0).getDate();
  const date = new Date(year, month, Math.min(settings.day, lastDay));
  let holidaysKnown = hasHolidayData(date);
  if (settings.adjustToPreviousWeekday) {
    while (date.getDay() === 0 || date.getDay() === 6 || JAPANESE_HOLIDAYS.has(dateKey(date))) {
      date.setDate(date.getDate() - 1);
      holidaysKnown = holidaysKnown && hasHolidayData(date);
    }
  }
  // selectedMonth stays unchanged even when the adjusted date is in the previous month.
  return { selectedMonth, position: dateMonthPosition(date), date, holidaysKnown };
}

export function summaryReferenceLabel(monthPosition, settings = getMonthlySummarySettings()) {
  const reference = monthlySummaryReference(monthPosition, settings);
  const year = Math.floor(reference.selectedMonth / 12);
  const month = reference.selectedMonth - year * 12 + 1;
  if (!reference.date) return `${year}年${month}月`;
  const date = reference.date;
  const weekday = "日月火水木金土"[date.getDay()];
  const warning = settings.adjustToPreviousWeekday && !reference.holidaysKnown
    ? "\n※祝日データ対象外：土日のみ調整（仮）"
    : "";
  return `${year}年${month}月分\n家計簿入力日：${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}（${weekday}）${warning}`;
}
