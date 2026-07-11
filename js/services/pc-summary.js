import { getItems as getPcItems } from "../storage/pc-items/index.js";
import { shouldExcludeUnderusedMonthlyCost } from "./app-settings.js";

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

function plannedEndMonth(item) {
  const start = parseDate(item.purchaseDate);
  const years = Math.max(Number(item.yearsOfUse) || 1, 1);
  return start ? monthIndex(start) + years * 12 : null;
}

function monthlyCost(item) {
  const price = Number(item.purchasePrice ?? item.price ?? 0);
  const years = Number(item.yearsOfUse ?? 0);
  if (!Number.isFinite(price) || !Number.isFinite(years) || years <= 0) return 0;
  return price / (years * 12);
}

function isActiveAtMonth(item, targetMonth) {
  if (item.excludeFromSummary) return false;
  const start = parseDate(item.purchaseDate);
  const plannedEnd = plannedEndMonth(item);
  if (!start || plannedEnd === null) return false;

  const startMonth = monthIndex(start);
  const ended = parseDate(item.endOfUseDate);
  let activeEnd = plannedEnd;
  if (ended) {
    const actualEnd = Math.max(startMonth, monthIndex(ended));
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

export function calculatePcSummaryAt(items, monthPosition) {
  const targetMonth = Math.floor(Number(monthPosition));
  if (!Number.isFinite(targetMonth)) return { monthlyCost: 0, purchaseTotal: 0 };

  return items.reduce((summary, item) => {
    if (!isActiveAtMonth(item, targetMonth)) return summary;
    summary.monthlyCost += Math.round(monthlyCost(item));
    summary.purchaseTotal += Number(item.purchasePrice ?? item.price ?? 0) || 0;
    return summary;
  }, { monthlyCost: 0, purchaseTotal: 0 });
}
