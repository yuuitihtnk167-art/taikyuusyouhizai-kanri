import { getMonthlySummarySettings } from "./app-settings.js";
import { HOLIDAY_FIRST_YEAR, HOLIDAY_LAST_YEAR, JAPANESE_HOLIDAYS } from "./japanese-holidays.js";

export function dateMonthPosition(date) {
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getFullYear() * 12 + date.getMonth() + (date.getDate() - 1) / days;
}

function periodStartDate(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function adjustedClosingDate(year, month, settings) {
  const date = periodStartDate(year, month + 1, settings.day);
  date.setDate(date.getDate() - 1);
  let holidaysKnown = true;
  if (settings.adjustToPreviousWeekday !== false) {
    while (true) {
      holidaysKnown = holidaysKnown && date.getFullYear() >= HOLIDAY_FIRST_YEAR && date.getFullYear() <= HOLIDAY_LAST_YEAR;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      if (date.getDay() !== 0 && date.getDay() !== 6 && !JAPANESE_HOLIDAYS.has(key)) break;
      date.setDate(date.getDate() - 1);
    }
  }
  return { date, holidaysKnown };
}

export function monthlySummaryReference(monthPosition, settings = getMonthlySummarySettings()) {
  const selectedMonth = Math.floor(monthPosition);
  const year = Math.floor(selectedMonth / 12);
  const month = selectedMonth - year * 12;
  if (settings.mode === "position") {
    return { selectedMonth, position: monthPosition, date: null, startDate: null, inputDate: null, holidaysKnown: true };
  }

  const closing = adjustedClosingDate(year, month, settings);
  const previousClosing = adjustedClosingDate(year, month - 1, settings);
  const startDate = new Date(previousClosing.date);
  startDate.setDate(startDate.getDate() + 1);
  return {
    selectedMonth,
    position: dateMonthPosition(closing.date),
    markerPosition: dateMonthPosition(periodStartDate(year, month, settings.day)),
    date: closing.date,
    startDate,
    inputDate: new Date(closing.date),
    holidaysKnown: closing.holidaysKnown && previousClosing.holidaysKnown,
  };
}

function monthDayLabel(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function weekdayDateLabel(date) {
  return `${monthDayLabel(date)}（${"日月火水木金土"[date.getDay()]}）`;
}

export function summaryReferenceLabel(monthPosition, settings = getMonthlySummarySettings(), { details = false } = {}) {
  const reference = monthlySummaryReference(monthPosition, settings);
  const year = Math.floor(reference.selectedMonth / 12);
  const month = reference.selectedMonth - year * 12 + 1;
  if (!reference.date) return `${year}年${month}月`;
  const inputDate = reference.inputDate;
  const provisional = reference.holidaysKnown ? "" : "（仮）";
  const inputLabel = `${inputDate.getMonth() + 1}/${inputDate.getDate()}(${"日月火水木金土"[inputDate.getDay()]})${provisional}`;
  const title = `${year}年${month}月分`;
  if (!details) return `${title}\n家計簿入力日：${inputLabel}`;
  const warning = reference.holidaysKnown ? "" : "\n※祝日データ対象外：土日のみ調整（仮）";
  return `${title}\n対象期間：${monthDayLabel(reference.startDate)}〜${monthDayLabel(reference.date)}\n締め日：${weekdayDateLabel(reference.date)}\n家計簿入力日：${inputLabel}${warning}`;
}
