import { storageGetItem, storageSetItem } from "../platform/local-db.js";

const EXCLUDE_UNDERUSED_MONTHLY_COST_KEY = "monthlyApplianceBook.excludeUnderusedMonthlyCost";
const MONTHLY_SUMMARY_SETTINGS_KEY = "monthlyApplianceBook.monthlySummarySettings";

export function normalizeMonthlySummarySettings(value) {
  const day = Number(value?.day);
  return {
    mode: value?.mode === "position" ? "position" : "monthly",
    day: Number.isInteger(day) && day >= 1 && day <= 31 ? day : 15,
    adjustToPreviousWeekday: value?.adjustToPreviousWeekday !== false,
  };
}

export function getMonthlySummarySettings() {
  try {
    return normalizeMonthlySummarySettings(JSON.parse(storageGetItem(MONTHLY_SUMMARY_SETTINGS_KEY)));
  } catch (_error) {
    return normalizeMonthlySummarySettings(null);
  }
}

export function setMonthlySummarySettings(settings) {
  storageSetItem(MONTHLY_SUMMARY_SETTINGS_KEY, JSON.stringify(normalizeMonthlySummarySettings(settings)));
}

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
