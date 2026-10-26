import { accountingSummaryReference, monthlySummaryReference, dateMonthPosition } from "./monthly-summary.js?v=158";
import { getMonthlySummarySettings, shouldExcludeUnderusedMonthlyCost } from "./app-settings.js";

// All installments use the same accounting periods as the dashboard, including holidays.
function periodAt(date) {
  return accountingSummaryReference(dateMonthPosition(date)).selectedMonth;
}

function closingDate(period) {
  return monthlySummaryReference(period, { ...getMonthlySummarySettings(), mode: "monthly" }).date;
}

function followingDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  return result;
}

function lastPeriodOnOrBefore(date) {
  const period = periodAt(date);
  return closingDate(period) <= date ? period : period - 1;
}

// Sale amounts are net proceeds. Only the explicit update action persists them.
export function saleDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
}

function addMonths(date, months) {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()));
}

export function normalizePcSale(value) {
  if (!value || !saleDate(value.date) || !Number.isSafeInteger(value.amount) || value.amount < 0) return null;
  const months = Number(value.months ?? 12);
  if (!Number.isInteger(months) || months < 1 || months > 1200) return null;
  return { date: value.date, amount: value.amount, months, previousEndOfUseDate: String(value.previousEndOfUseDate ?? "") };
}

export function pcCostSchedule(item) {
  const purchased = saleDate(item.purchaseDate);
  const price = Number(item.purchasePrice ?? item.price);
  const months = Number(item.yearsOfUse) * 12;
  if (!purchased || !Number.isSafeInteger(price) || price < 0 || !Number.isInteger(months) || months < 1 || months > 1200) return null;
  // Records created before this policy retain their historical rounded monthly amount.
  const monthly = item.monthlyCostRounding === "truncate-final" ? Math.trunc(price / months) : Math.round(price / months);
  const firstPeriod = periodAt(purchased);
  const plannedEnd = addMonths(purchased, months);
  // Legacy items retain their original inclusive end date and actual number of billed periods.
  const finalPeriod = item.monthlyCostRounding === "truncate-final" ? firstPeriod + months - 1 : lastPeriodOnOrBefore(plannedEnd);
  const installments = finalPeriod - firstPeriod + 1;
  const adjustment = price - monthly * installments;
  const end = followingDay(item.monthlyCostRounding === "truncate-final" ? closingDate(finalPeriod) : plannedEnd);
  return { purchased, price, months, installments, firstPeriod, finalPeriod, plannedEnd, monthly, adjustment, finalMonthly: monthly + adjustment, end };
}

export function pcCostMonthlyCostAt(item, date) {
  const schedule = pcCostSchedule(item);
  if (!schedule) return null;
  if (date < schedule.purchased || date >= schedule.end) return 0;
  return periodAt(date) >= schedule.finalPeriod ? schedule.finalMonthly : schedule.monthly;
}

export function pcSaleSchedule(item) {
  const sale = normalizePcSale(item.sale);
  const purchased = saleDate(item.purchaseDate);
  const sold = sale && saleDate(sale.date);
  const price = Number(item.purchasePrice ?? item.price);
  const plannedMonths = Number(item.yearsOfUse) * 12;
  if (!sale || !purchased || sold < purchased || !Number.isSafeInteger(price) || price < 0 || !Number.isInteger(plannedMonths) || plannedMonths < 1 || plannedMonths > 1200) return null;
  const cost = pcCostSchedule(item);
  const firstPeriod = periodAt(sold);
  const expired = firstPeriod > cost.finalPeriod;
  const months = expired ? sale.months : cost.finalPeriod - firstPeriod + 1;
  let paidThrough = Math.min(firstPeriod - 1, cost.finalPeriod);
  const beforeSale = pcItemBeforeSale(item);
  const ended = saleDate(beforeSale.endOfUseDate);
  if (ended && shouldExcludeUnderusedMonthlyCost()) paidThrough = Math.min(paidThrough, lastPeriodOnOrBefore(ended));
  const elapsed = Math.max(0, paidThrough - cost.firstPeriod + 1);
  const beforeMonthly = cost.monthly;
  // An expired plan has already included its final adjustment; never charge it twice.
  const accounted = paidThrough >= cost.finalPeriod ? price : beforeMonthly * elapsed;
  const remaining = price - accounted;
  const balance = remaining - sale.amount;
  const monthly = Math.trunc(balance / months);
  const adjustment = balance - monthly * months;
  const finalMonthly = balance - monthly * (months - 1);
  const finalPeriod = firstPeriod + months - 1;
  const end = followingDay(closingDate(finalPeriod));
  return { sale, purchased, sold, end, firstPeriod, finalPeriod, expired, elapsed, months, beforeMonthly, accounted, remaining, balance, monthly, adjustment, finalMonthly };
}

export function pcSaleMonthlyCostAt(item, date) {
  const schedule = pcSaleSchedule(item);
  if (!schedule || date < schedule.sold) return null;
  if (date >= schedule.end) return 0;
  return periodAt(date) === schedule.finalPeriod ? schedule.finalMonthly : schedule.monthly;
}

export function dateFromMonthPosition(position) {
  const month = Math.floor(position);
  const year = Math.floor(month / 12);
  const days = new Date(year, month - year * 12 + 1, 0).getDate();
  return new Date(year, month - year * 12, Math.min(days, 1 + Math.round((position - month) * days)));
}

export function pcSaleItemWithRecord(item, sale) {
  const previous = normalizePcSale(item.sale);
  const originalEnd = previous?.previousEndOfUseDate ?? item.endOfUseDate ?? "";
  let endOfUseDate = item.endOfUseDate ?? "";
  // Restore only the end date that the sale itself supplied, preserving manual dates.
  if (previous && endOfUseDate === previous.date) endOfUseDate = originalEnd;
  if (!sale) return { ...item, sale: null, endOfUseDate };
  const record = normalizePcSale({ ...sale, previousEndOfUseDate: originalEnd });
  if (!record || !pcSaleSchedule({ ...item, sale: record })) throw new Error("売却日・売却価格・使用予定期間を確認してください。");
  if (!endOfUseDate || endOfUseDate > record.date) endOfUseDate = record.date;
  return { ...item, sale: record, endOfUseDate };
}

export function pcItemBeforeSale(item) {
  const sale = normalizePcSale(item.sale);
  return { ...item, sale: null, endOfUseDate: sale && item.endOfUseDate === sale.date ? sale.previousEndOfUseDate : item.endOfUseDate };
}
