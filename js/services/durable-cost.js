import { pcCostSchedule, pcCostMonthlyCostAt, pcSaleSchedule, pcSaleMonthlyCostAt } from "./pc-sale.js?v=164";

// Appliances and cars amortize the purchase price plus their additional costs.
// Keep the stored purchase price intact; the shared installment engine receives the total.
export function durableCostItem(item) {
  const additional = Array.isArray(item.additionalCosts) ? item.additionalCosts.reduce((total, cost) => {
    const amount = Number(cost?.amount ?? 0);
    return total + (Number.isFinite(amount) ? amount : 0);
  }, 0) : 0;
  return { ...item, purchasePrice: Number(item.purchasePrice ?? 0) + additional };
}

export function durableCostSchedule(item) {
  return pcCostSchedule(durableCostItem(item));
}

export function durableSaleSchedule(item) {
  return pcSaleSchedule(durableCostItem(item));
}

export function durableMonthlyCostAt(item, date) {
  const basis = durableCostItem(item);
  return (item.sale ? pcSaleMonthlyCostAt(basis, date) : null) ?? pcCostMonthlyCostAt(basis, date);
}
