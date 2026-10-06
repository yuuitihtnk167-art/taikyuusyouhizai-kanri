// Run: node --test tests/monthly-summary.test.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

// Only storage is stubbed; the date and PC cost calculations use the real modules.
const pcStorageUrl = new URL("../js/storage/pc-items/index.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    if (resolved.url === pcStorageUrl) {
      return { url: "data:text/javascript,export async function getItems() { return []; }", shortCircuit: true };
    }
    return resolved;
  },
});
const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
const settingsModule = await import("../js/services/app-settings.js");
const { monthlySummaryReference, dateMonthPosition, summaryReferenceLabel } = await import("../js/services/monthly-summary.js");
const { calculatePcSummaryAt } = await import("../js/services/pc-summary.js");
const monthly = { mode: "monthly", day: 15, adjustToPreviousWeekday: true };
const month = (year, number) => year * 12 + number - 1;
const dateKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

test("default settings are monthly, 15th, previous weekday; invalid values recover", () => {
  assert.deepEqual(settingsModule.getMonthlySummarySettings(), monthly);
  assert.deepEqual(settingsModule.normalizeMonthlySummarySettings({ day: 32, mode: "bad" }), monthly);
  values.set("monthlyApplianceBook.monthlySummarySettings", "invalid json");
  assert.deepEqual(settingsModule.getMonthlySummarySettings(), monthly);
  settingsModule.setMonthlySummarySettings({ ...monthly, day: 31, adjustToPreviousWeekday: false });
  assert.equal(settingsModule.getMonthlySummarySettings().day, 31);
  assert.equal(settingsModule.getMonthlySummarySettings().adjustToPreviousWeekday, false);
  values.clear();
});

test("same month always resolves to one reference date", () => {
  const positions = [0, 0.1, 0.5, 0.99].map((part) => monthlySummaryReference(month(2026, 10) + part, monthly).position);
  assert.equal(new Set(positions).size, 1);
  assert.equal(dateKey(monthlySummaryReference(month(2026, 10), monthly).date), "2026-10-15");
});

test("Saturday, Sunday and a holiday on the 15th move to the previous weekday", () => {
  for (const [year, number, expected] of [[2026, 8, "2026-08-14"], [2026, 2, "2026-02-13"], [2025, 9, "2025-09-12"]]) {
    assert.equal(dateKey(monthlySummaryReference(month(year, number), monthly).date), expected);
  }
});

test("substitute holidays and holidays between national holidays skip the whole holiday chain", () => {
  for (const [year, number, day, expected] of [[2026, 5, 6, "2026-05-01"], [2026, 9, 22, "2026-09-18"], [2027, 3, 22, "2027-03-19"]]) {
    assert.equal(dateKey(monthlySummaryReference(month(year, number), { ...monthly, day }).date), expected);
  }
});

test("short months clamp to month end before adjusting holidays", () => {
  assert.equal(dateKey(monthlySummaryReference(month(2026, 2), { ...monthly, day: 31 }).date), "2026-02-27");
  assert.equal(dateKey(monthlySummaryReference(month(2024, 2), { ...monthly, day: 31 }).date), "2024-02-29");
});

test("adjustment can be disabled; legacy mode preserves the exact line position", () => {
  assert.equal(dateKey(monthlySummaryReference(month(2025, 9), { ...monthly, adjustToPreviousWeekday: false }).date), "2025-09-15");
  const position = month(2026, 10) + 0.8;
  assert.equal(monthlySummaryReference(position, { ...monthly, mode: "position" }).position, position);
});

test("cross-year adjustment retains the selected accounting month", () => {
  const reference = monthlySummaryReference(month(2026, 1), { ...monthly, day: 1 });
  assert.equal(reference.selectedMonth, month(2026, 1));
  assert.equal(dateKey(reference.date), "2025-12-31");
  assert.match(summaryReferenceLabel(month(2026, 1), { ...monthly, day: 1 }), /2026年1月分.*\n.*2025\/12\/31/);
});

test("unknown holiday years are visibly provisional", () => {
  assert.equal(monthlySummaryReference(month(2028, 10), monthly).holidaysKnown, false);
  assert.match(summaryReferenceLabel(month(2028, 10), monthly), /祝日データ対象外/);
  assert.doesNotMatch(summaryReferenceLabel(month(2028, 10), { ...monthly, adjustToPreviousWeekday: false }), /祝日データ対象外/);
  assert.equal(monthlySummaryReference(month(1955, 1), { ...monthly, day: 1 }).holidaysKnown, false);
});

test("PC integration includes purchases on the reference date but excludes later purchases", () => {
  const items = [
    { purchaseDate: "2026-10-15", purchasePrice: 12000, yearsOfUse: 1 },
    { purchaseDate: "2026-10-16", purchasePrice: 24000, yearsOfUse: 1 },
    { purchaseDate: "2026-01-01", purchasePrice: 12000, yearsOfUse: 1, excludeFromSummary: true },
  ];
  const position = monthlySummaryReference(month(2026, 10), monthly).position;
  assert.deepEqual(calculatePcSummaryAt(items, position, { exactDate: true }), { monthlyCost: 1000, purchaseTotal: 12000 });
  assert.deepEqual(calculatePcSummaryAt(items, position), { monthlyCost: 3000, purchaseTotal: 36000 });
});

test("underused setting, exact end date and per-item rounding are respected", () => {
  const items = [{ purchaseDate: "2026-01-01", endOfUseDate: "2026-10-14", purchasePrice: 12006, yearsOfUse: 1 }];
  const position = monthlySummaryReference(month(2026, 10), monthly).position;
  settingsModule.setExcludeUnderusedMonthlyCost(false);
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1001);
  settingsModule.setExcludeUnderusedMonthlyCost(true);
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 0);
  items[0].endOfUseDate = "2026-10-15";
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1001);
  values.clear();
});

test("leap-day planned end is clamped and included on its last date", () => {
  const items = [{ purchaseDate: "2024-02-29", purchasePrice: 12000, yearsOfUse: 1 }];
  const position = dateMonthPosition(new Date(2025, 1, 28));
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1000);
  assert.equal(calculatePcSummaryAt(items, dateMonthPosition(new Date(2025, 2, 1)), { exactDate: true }).monthlyCost, 0);
});
