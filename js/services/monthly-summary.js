import { getMonthlySummarySettings } from "./app-settings.js";
import { japaneseHolidayStatus } from "./japanese-holiday-calendar.js?v=157";

export function dateMonthPosition(date) {
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return date.getFullYear() * 12 + date.getMonth() + (date.getDate() - 1) / days;
}

export function snapToDayPosition(position) {
  const month = Math.floor(position);
  const year = Math.floor(month / 12);
  const days = new Date(year, month - year * 12 + 1, 0).getDate();
  const day = Math.min(days - 1, Math.max(0, Math.floor((position - month) * days + 1e-8)));
  return month + day / days;
}

export function accountingSummaryReference(position) {
  return monthlySummaryReference(position, { ...getMonthlySummarySettings(), mode: "monthly" });
}

export function accountingSummaryLabel(position, amount) {
  const settings = { ...getMonthlySummarySettings(), mode: "monthly" };
  return `${summaryReferenceLabel(position, settings)}　入力金額：${amount}`;
}

function periodStartDate(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

function adjustedClosingDate(year, month, settings) {
  const date = periodStartDate(year, month + 1, settings.day);
  date.setDate(date.getDate() - 1);
  let holidaysKnown = true;
  let holidaysSupported = true;
  if (settings.adjustToPreviousWeekday !== false) {
    while (true) {
      const holiday = japaneseHolidayStatus(date);
      holidaysKnown = holidaysKnown && holiday.confirmed;
      holidaysSupported = holidaysSupported && holiday.supported;
      if (date.getDay() !== 0 && date.getDay() !== 6 && !holiday.isHoliday) break;
      date.setDate(date.getDate() - 1);
    }
  }
  return { date, holidaysKnown, holidaysSupported };
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
    holidaysSupported: closing.holidaysSupported && previousClosing.holidaysSupported,
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
  const inputLabel = `${inputDate.getMonth() + 1}/${inputDate.getDate()}(${"日月火水木金土"[inputDate.getDay()]})`;
  const title = `${year}年${month}月分`;
  if (!details) return `${title}\n家計簿入力日：${inputLabel}`;
  const warning = reference.holidaysKnown ? "" : reference.holidaysSupported
    ? "\n※将来の祝日は現行ルールで計算しています。"
    : "\n※祝日データ対象外：土日のみ調整";
  return `${title}\n対象期間：${monthDayLabel(reference.startDate)}〜${monthDayLabel(reference.date)}\n締め日：${weekdayDateLabel(reference.date)}\n家計簿入力日：${inputLabel}${warning}`;
}
