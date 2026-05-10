import { storageGetItem, storageSetItem } from "../platform/local-db.js";

const EXCLUDE_UNDERUSED_MONTHLY_COST_KEY = "monthlyApplianceBook.excludeUnderusedMonthlyCost";

export function shouldExcludeUnderusedMonthlyCost() {
  return storageGetItem(EXCLUDE_UNDERUSED_MONTHLY_COST_KEY) === "true";
}

export function setExcludeUnderusedMonthlyCost(enabled) {
  try {
    storageSetItem(EXCLUDE_UNDERUSED_MONTHLY_COST_KEY, enabled ? "true" : "false");
  } catch (_error) {
    // Settings are best-effort when browser storage is unavailable.
  }
}
