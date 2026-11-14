import {
  endOfPeriod, pcCostSchedule, pcCostMonthlyCostAt, pcSaleSchedule, pcSaleMonthlyCostAt,
  periodAt, saleDate,
} from "./pc-sale.js?v=166";

// Undated legacy entries keep their original purchase-price allocation.
export function durableCostItem(item) {
  const additional = Array.isArray(item.additionalCosts) ? item.additionalCosts.reduce((total, cost) => {
    const amount = Number(cost?.amount ?? 0);
    return total + (!cost?.expenseDate && Number.isFinite(amount) ? amount : 0);
  }, 0) : 0;
  return { ...item, purchasePrice: Number(item.purchasePrice ?? 0) + additional };
}

export function durableCostSchedule(item) {
  return pcCostSchedule(durableCostItem(item));
}

export function additionalCostNeedsDuration(schedule, date) {
  const start = saleDate(date);
  return Boolean(schedule && start && periodAt(start) > schedule.finalPeriod);
}

export function durableAdditionalCostSchedules(item, base = durableCostSchedule(item)) {
  if (!base || !Array.isArray(item.additionalCosts)) return [];
  return item.additionalCosts.flatMap(cost => {
    const start = saleDate(cost?.expenseDate);
    const price = Number(cost?.amount);
    if (!start || start < base.purchased || !Number.isSafeInteger(price) || price < 0) return [];
    const firstPeriod = periodAt(start);
    // A later closing-date change can move a saved in-plan expense past the final period.
    // Keep it in the ledger even if it did not originally need an explicit duration.
    const months = firstPeriod > base.finalPeriod ? Number(cost.expenseMonths ?? 1) : base.finalPeriod - firstPeriod + 1;
    if (!Number.isInteger(months) || months < 1 || months > 1200) return [];
    const finalPeriod = firstPeriod + months - 1;
    const monthly = Math.trunc(price / months);
    const adjustment = price - monthly * months;
    return [{ start, end: endOfPeriod(finalPeriod), firstPeriod, finalPeriod, price, monthly, adjustment, finalMonthly: monthly + adjustment }];
  });
}

export function durableSaleSchedule(item) {
  const basis = durableCostItem(item);
  return pcSaleSchedule(basis, durableAdditionalCostSchedules(item, pcCostSchedule(basis)));
}

export function durableMonthlyCostAt(item, date) {
  const basis = durableCostItem(item);
  const base = pcCostSchedule(basis);
  if (!base) return null;
  const costs = durableAdditionalCostSchedules(item, base);
  const sale = item.sale ? pcSaleSchedule(basis, costs) : null;
  const saleCost = sale ? pcSaleMonthlyCostAt(basis, date, sale) : null;
  if (saleCost !== null) return saleCost;
  const period = periodAt(date);
  return costs.reduce((total, cost) => {
    if (date < cost.start || date >= cost.end) return total;
    return total + (period === cost.finalPeriod ? cost.finalMonthly : cost.monthly);
  }, pcCostMonthlyCostAt(basis, date));
}
