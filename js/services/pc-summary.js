import { getItems as getPcItems } from "../storage/pc-items/index.js";
import { getMonthlySummarySettings, shouldExcludeUnderusedMonthlyCost } from "./app-settings.js";
import { dateMonthPosition, monthlySummaryReference } from "./monthly-summary.js?v=158";
import { pcCostSchedule, pcCostMonthlyCostAt, pcSaleSchedule, pcSaleMonthlyCostAt, dateFromMonthPosition, pcItemBeforeSale } from "./pc-sale.js?v=164";

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
  if (item.monthlyCostRounding === "truncate-final") {
    const schedule = pcCostSchedule(item);
    if (schedule) {
      const lastDay = new Date(schedule.end.getFullYear(), schedule.end.getMonth(), schedule.end.getDate() - 1);
      return exactDate ? dateMonthPosition(lastDay) : schedule.finalPeriod;
    }
  }
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
  if (item.sale) {
    const schedule = pcSaleSchedule(item);
    if (schedule) {
      const sold = exactDate ? dateMonthPosition(schedule.sold) : schedule.firstPeriod;
      const end = exactDate ? dateMonthPosition(schedule.end) : schedule.finalPeriod + 1;
      return targetMonth < sold ? isActiveAtMonth(pcItemBeforeSale(item), targetMonth, exactDate) : targetMonth < end;
    }
  }
  if (!exactDate && item.monthlyCostRounding === "truncate-final") {
    const schedule = pcCostSchedule(item);
    if (schedule) return schedule.firstPeriod <= targetMonth && targetMonth <= schedule.finalPeriod;
  }
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

// Inclusive date intervals for the same PC purchase totals used by the dashboard.
export function pcPurchaseIntervals(items) {
  return items.flatMap((item) => {
    if (item.excludeFromSummary) return [];
    if (item.sale) {
      const schedule = pcSaleSchedule(item);
      if (schedule) {
        const lastDay = new Date(schedule.end);
        lastDay.setDate(lastDay.getDate() - 1);
        const beforeSale = new Date(schedule.sold);
        beforeSale.setDate(beforeSale.getDate() - 1);
        const previous = pcPurchaseIntervals([pcItemBeforeSale(item)]).map((interval) => ({ ...interval, end: Math.min(interval.end, dateMonthPosition(beforeSale)) })).filter((interval) => interval.start <= interval.end);
        return [...previous, { start: dateMonthPosition(schedule.sold), end: dateMonthPosition(lastDay), amount: Number(item.purchasePrice ?? item.price ?? 0) || 0 }];
      }
    }
    const purchase = parseDate(item.purchaseDate);
    const plannedEnd = plannedEndMonth(item, true);
    if (!purchase || plannedEnd === null) return [];
    const start = dateMonthPosition(purchase);
    const ended = parseDate(item.endOfUseDate);
    let end = plannedEnd;
    if (ended) {
      const actualEnd = Math.max(start, dateMonthPosition(ended));
      end = actualEnd < plannedEnd && !shouldExcludeUnderusedMonthlyCost()
        ? plannedEnd : Math.min(actualEnd, plannedEnd);
    }
    return [{ start, end, amount: Number(item.purchasePrice ?? item.price ?? 0) || 0 }];
  });
}

export function calculatePcSummaryAt(items, monthPosition, { exactDate = false } = {}) {
  const targetMonth = exactDate ? Number(monthPosition) : Math.floor(Number(monthPosition));
  if (!Number.isFinite(targetMonth)) return { monthlyCost: 0, purchaseTotal: 0 };

  return items.reduce((summary, item) => {
    if (!exactDate && item.sale) {
      const reference = monthlySummaryReference(targetMonth, { ...getMonthlySummarySettings(), mode: "monthly" });
      const contribution = calculatePcSummaryAt([item], reference.position, { exactDate: true });
      summary.monthlyCost += contribution.monthlyCost;
      summary.purchaseTotal += contribution.purchaseTotal;
      return summary;
    }
    if (!isActiveAtMonth(item, targetMonth, exactDate)) return summary;
    const saleCost = item.sale ? pcSaleMonthlyCostAt(item, dateFromMonthPosition(targetMonth)) : null;
    const schedule = !exactDate && pcCostSchedule(item);
    const normalCost = exactDate ? pcCostMonthlyCostAt(item, dateFromMonthPosition(targetMonth))
      : schedule ? (targetMonth === schedule.finalPeriod ? schedule.finalMonthly : schedule.monthly) : null;
    summary.monthlyCost += saleCost ?? normalCost ?? Math.round(monthlyCost(item));
    summary.purchaseTotal += Number(item.purchasePrice ?? item.price ?? 0) || 0;
    return summary;
  }, { monthlyCost: 0, purchaseTotal: 0 });
}
