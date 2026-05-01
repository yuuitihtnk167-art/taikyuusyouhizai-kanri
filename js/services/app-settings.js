import { storageGetItem, storageSetItem } from "../platform/local-db.js";

const INCLUDE_UNDERUSED_MONTHLY_COST_KEY = "monthlyApplianceBook.includeUnderusedMonthlyCost";

export function shouldIncludeUnderusedMonthlyCost() {
  return storageGetItem(INCLUDE_UNDERUSED_MONTHLY_COST_KEY) === "true";
}

export function setIncludeUnderusedMonthlyCost(enabled) {
  try {
    storageSetItem(INCLUDE_UNDERUSED_MONTHLY_COST_KEY, enabled ? "true" : "false");
  } catch (_error) {
    // Settings are best-effort when browser storage is unavailable.
  }
}
