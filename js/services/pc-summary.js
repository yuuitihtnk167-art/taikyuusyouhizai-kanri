import { getItems as getPcItems } from "../storage/pc-items/index.js";
import { shouldExcludeUnderusedMonthlyCost } from "./app-settings.js";
import { dateMonthPosition } from "./monthly-summary.js?v=134";

function parseDate(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (match) {
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(`${text}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function plannedEndMonth(item, exactDate) {
  const start = parseDate(item.purchaseDate);
  const years = Math.max(Number(item.yearsOfUse) || 1, 1);
  if (!start) return null;
  if (!exactDate) return monthIndex(start) + years * 12;
  const year = start.getFullYear() + years;
  const month = start.getMonth();
  const day = Math.min(start.getDate(), new Date(year, month + 1, 0).getDate());
  return dateMonthPosition(new Date(year, month, day));
}

function monthlyCost(item) {
  const price = Number(item.purchasePrice ?? item.price ?? 0);
  const years = Number(item.yearsOfUse ?? 0);
  if (!Number.isFinite(price) || !Number.isFinite(years) || years <= 0) return 0;
  return price / (years * 12);
}

function isActiveAtMonth(item, targetMonth, exactDate) {
  if (item.excludeFromSummary) return false;
  const start = parseDate(item.purchaseDate);
  const plannedEnd = plannedEndMonth(item, exactDate);
  if (!start || plannedEnd === null) return false;

  const startMonth = exactDate ? dateMonthPosition(start) : monthIndex(start);
  const ended = parseDate(item.endOfUseDate);
  let activeEnd = plannedEnd;
  if (ended) {
    const actualEnd = Math.max(startMonth, exactDate ? dateMonthPosition(ended) : monthIndex(ended));
    const isUnderused = actualEnd < plannedEnd;
    activeEnd = isUnderused && !shouldExcludeUnderusedMonthlyCost()
      ? plannedEnd
      : Math.min(actualEnd, plannedEnd);
  }
  return startMonth <= targetMonth && targetMonth <= activeEnd;
}

export async function loadPcSummaryItems(uid) {
  return getPcItems(uid);
}

export function calculatePcSummaryAt(items, monthPosition, { exactDate = false } = {}) {
  const targetMonth = exactDate ? Number(monthPosition) : Math.floor(Number(monthPosition));
  if (!Number.isFinite(targetMonth)) return { monthlyCost: 0, purchaseTotal: 0 };

  return items.reduce((summary, item) => {
    if (!isActiveAtMonth(item, targetMonth, exactDate)) return summary;
    summary.monthlyCost += Math.round(monthlyCost(item));
    summary.purchaseTotal += Number(item.purchasePrice ?? item.price ?? 0) || 0;
    return summary;
  }, { monthlyCost: 0, purchaseTotal: 0 });
}
