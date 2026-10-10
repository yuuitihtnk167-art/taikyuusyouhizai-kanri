// Run: node --test tests/monthly-summary.test.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

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

test("defaults preserve the start day and holiday adjustment", () => {
  assert.deepEqual(settingsModule.getMonthlySummarySettings(), monthly);
  assert.deepEqual(settingsModule.normalizeMonthlySummarySettings({ day: 32, mode: "bad" }), monthly);
  values.set("monthlyApplianceBook.monthlySummarySettings", "invalid json");
  assert.deepEqual(settingsModule.getMonthlySummarySettings(), monthly);
  settingsModule.setMonthlySummarySettings({ ...monthly, day: 31, adjustToPreviousWeekday: true });
  assert.deepEqual(settingsModule.getMonthlySummarySettings(), { ...monthly, day: 31 });
  values.clear();
});

test("September closes October 14 and stays constant throughout the selected month", () => {
  const positions = [0, 0.1, 0.5, 0.99].map(part => monthlySummaryReference(month(2026, 9) + part, monthly).position);
  assert.equal(new Set(positions).size, 1);
  const reference = monthlySummaryReference(month(2026, 9), monthly);
  assert.equal(dateKey(reference.startDate), "2026-09-15");
  assert.equal(dateKey(reference.date), "2026-10-14");
  assert.equal(summaryReferenceLabel(month(2026, 9), monthly), "2026年9月分\n家計簿入力日：10/14(水)");
  assert.match(summaryReferenceLabel(month(2026, 9), monthly, { details: true }), /対象期間：9月15日〜10月14日/);
});

test("closing dates move to weekdays with holiday adjustment", () => {
  for (const [year, number, day, expected] of [[2026, 10, 15, "2026-11-13"], [2026, 1, 16, "2026-02-13"], [2025, 8, 16, "2025-09-12"]]) {
    assert.equal(dateKey(monthlySummaryReference(month(year, number), { ...monthly, day, adjustToPreviousWeekday: true }).date), expected);
  }
});

test("short months clamp each start and consecutive periods have no gap", () => {
  for (const year of [2024, 2026]) {
    const january = monthlySummaryReference(month(year, 1), { ...monthly, day: 31, adjustToPreviousWeekday: false });
    const february = monthlySummaryReference(month(year, 2), { ...monthly, day: 31, adjustToPreviousWeekday: false });
    const followingDate = new Date(january.date);
    followingDate.setDate(followingDate.getDate() + 1);
    assert.equal(dateKey(followingDate), dateKey(february.startDate));
    assert.equal(dateKey(february.date), `${year}-03-30`);
    assert.equal(february.startDate.getDate(), year === 2024 ? 29 : 28);
  }
});

test("first-day periods close at month end, December carries into next year", () => {
  assert.equal(dateKey(monthlySummaryReference(month(2026, 2), { ...monthly, day: 1 }).date), "2026-02-27");
  const december = monthlySummaryReference(month(2026, 12), monthly);
  assert.equal(december.selectedMonth, month(2026, 12));
  assert.equal(dateKey(december.date), "2027-01-14");
  assert.match(summaryReferenceLabel(month(2026, 12), monthly, { details: true }), /2026年12月分.*\n.*12月15日〜1月14日/);
});

test("legacy mode preserves the exact line position", () => {
  const position = month(2026, 10) + 0.8;
  const reference = monthlySummaryReference(position, { ...monthly, mode: "position" });
  assert.equal(reference.position, position);
  assert.equal(reference.startDate, null);
  assert.equal(summaryReferenceLabel(position, { ...monthly, mode: "position" }), "2026年10月");
});

test("September 11 purchase contributes from August and remains in September", () => {
  const items = [{ purchaseDate: "2026-09-11", purchasePrice: 12000, yearsOfUse: 1 }];
  for (const number of [8, 9, 10]) {
    const position = monthlySummaryReference(month(2026, number), monthly).position;
    assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1000);
  }
  assert.equal(calculatePcSummaryAt(items, monthlySummaryReference(month(2026, 7), monthly).position, { exactDate: true }).monthlyCost, 0);
});

test("PC integration includes purchases on the reference date but excludes later purchases", () => {
  const items = [
    { purchaseDate: "2026-11-13", purchasePrice: 12000, yearsOfUse: 1 },
    { purchaseDate: "2026-11-14", purchasePrice: 24000, yearsOfUse: 1 },
    { purchaseDate: "2026-01-01", purchasePrice: 12000, yearsOfUse: 1, excludeFromSummary: true },
  ];
  const position = monthlySummaryReference(month(2026, 10), monthly).position;
  assert.deepEqual(calculatePcSummaryAt(items, position, { exactDate: true }), { monthlyCost: 1000, purchaseTotal: 12000 });
  assert.deepEqual(calculatePcSummaryAt(items, position), { monthlyCost: 3000, purchaseTotal: 36000 });
});

test("underused setting, exact end date and per-item rounding are respected", () => {
  const items = [{ purchaseDate: "2026-01-01", endOfUseDate: "2026-11-12", purchasePrice: 12006, yearsOfUse: 1 }];
  const position = monthlySummaryReference(month(2026, 10), monthly).position;
  settingsModule.setExcludeUnderusedMonthlyCost(false);
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1001);
  settingsModule.setExcludeUnderusedMonthlyCost(true);
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 0);
  items[0].endOfUseDate = "2026-11-13";
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1001);
  values.clear();
});

test("leap-day planned end is clamped and included on its last date", () => {
  const items = [{ purchaseDate: "2024-02-29", purchasePrice: 12000, yearsOfUse: 1 }];
  const position = dateMonthPosition(new Date(2025, 1, 28));
  assert.equal(calculatePcSummaryAt(items, position, { exactDate: true }).monthlyCost, 1000);
  assert.equal(calculatePcSummaryAt(items, dateMonthPosition(new Date(2025, 2, 1)), { exactDate: true }).monthlyCost, 0);
});


test("October closes on Friday and November 14 purchases start in November", () => {
  const reference = monthlySummaryReference(month(2026, 10), monthly);
  assert.equal(dateKey(reference.date), "2026-11-13");
  assert.equal(dateKey(reference.inputDate), "2026-11-13");
  assert.equal(summaryReferenceLabel(month(2026, 10), monthly), "2026年10月分\n家計簿入力日：11/13(金)");
  const items = [
    { purchaseDate: "2026-11-13", purchasePrice: 12000, yearsOfUse: 1 },
    { purchaseDate: "2026-11-14", purchasePrice: 24000, yearsOfUse: 1 },
  ];
  assert.deepEqual(calculatePcSummaryAt(items, reference.position, { exactDate: true }), { monthlyCost: 1000, purchaseTotal: 12000 });
});

test("input skips holiday chains and can keep the closing date when disabled", () => {
  const settings = { ...monthly, day: 7 };
  const reference = monthlySummaryReference(month(2026, 4), settings);
  assert.equal(dateKey(reference.date), "2026-05-01");
  assert.equal(dateKey(reference.inputDate), "2026-05-01");
  const unadjusted = monthlySummaryReference(month(2026, 4), { ...settings, adjustToPreviousWeekday: false });
  assert.equal(dateKey(unadjusted.inputDate), "2026-05-06");
  assert.notEqual(reference.position, unadjusted.position);
});

test("unknown holiday years show provisional input without changing calculations", () => {
  assert.equal(monthlySummaryReference(month(2028, 10), monthly).holidaysKnown, false);
  assert.match(summaryReferenceLabel(month(2028, 10), monthly), /（仮）/);
  assert.match(summaryReferenceLabel(month(2028, 10), monthly, { details: true }), /祝日データ対象外/);
  assert.doesNotMatch(summaryReferenceLabel(month(2028, 10), { ...monthly, adjustToPreviousWeekday: false }), /仮/);
});


test("adjusted consecutive periods have no gaps or overlaps", () => {
  for (const day of [1, 7, 15, 31]) {
    for (let number = 1; number <= 12; number += 1) {
      const current = monthlySummaryReference(month(2026, number), { ...monthly, day });
      const next = monthlySummaryReference(month(2026, number) + 1, { ...monthly, day });
      const followingDate = new Date(current.date);
      followingDate.setDate(followingDate.getDate() + 1);
      assert.equal(dateKey(followingDate), dateKey(next.startDate));
      assert.equal(dateKey(current.date), dateKey(current.inputDate));
      assert.equal(Math.floor(current.markerPosition), month(2026, number));
    }
  }
  const november = monthlySummaryReference(month(2026, 11), monthly);
  assert.equal(dateKey(november.startDate), "2026-11-14");
  const item = [{ purchaseDate: "2026-11-14", purchasePrice: 24000, yearsOfUse: 1 }];
  assert.equal(calculatePcSummaryAt(item, monthlySummaryReference(month(2026, 10), monthly).position, { exactDate: true }).purchaseTotal, 0);
  assert.equal(calculatePcSummaryAt(item, november.position, { exactDate: true }).purchaseTotal, 24000);
});


test("real PC dashboard, spec total and CSV share the adjusted selected month", () => {
  // Exercise the real app functions without booting authentication or writing product data.
  const source = readFileSync(new URL("../pc-management/app.js", import.meta.url), "utf8");
  const names = ["parseDate", "toMonthIndex", "daysInMonth", "toMonthPosition", "addYearsClamped", "itemStartMonth", "itemPlannedEndMonth", "itemActualEndMonth", "summaryActiveEndMonth", "isActiveInSummaryAtTimelineMarker", "isSummaryExcluded", "timelineMarkerMonth", "summaryItems", "specListPurchaseTotal", "specListCsv", "csvValue", "renderSummary", "summaryMonthlyCost", "monthlyCostAt", "isPastPlannedEnd", "calculateMonthlyCost"];
  const functions = names.map(name => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1);
    return source.slice(start, source.indexOf("\n}", start) + 2);
  }).join("\n");
  const state = {
    timelineMarkerMonth: month(2026, 10),
    selectedPcNames: new Set(["main"]),
    items: [
      { pcName: "main", purchaseDate: "2026-11-12", purchasePrice: 12000, yearsOfUse: 1, hideFromTimeline: true, endOfUseDate: "2026-11-12" },
      { pcName: "main", purchaseDate: "2026-11-13", purchasePrice: 24000, yearsOfUse: 1 },
      { pcName: "main", purchaseDate: "2026-11-14", purchasePrice: 48000, yearsOfUse: 1 },
      { pcName: "main", purchaseDate: "2026-01-01", purchasePrice: 96000, yearsOfUse: 1, excludeFromSummary: true },
      { pcName: "sub", purchaseDate: "2026-11-13", purchasePrice: 192000, yearsOfUse: 1 },
    ],
  };
  const elements = { summaryCount: {}, summaryTotal: {}, summaryMonthly: {} };
  const context = createContext({
    state, elements, monthlySummaryReference, getMonthlySummarySettings: () => monthly,
    shouldExcludeUnderusedMonthlyCost: () => false, specListPcName: () => "main",
    specListRows: () => [], pcNameLabels: { main: "メインPC" },
    currentMonthIndex: () => month(2026, 10) + 9 / 31,
    updateTimelineMarkerDate: () => {}, formatCurrency: value => String(value), formatMonthlyCost: value => String(value),
    TIMELINE_MIN_YEAR: 2015,
  });
  runInContext(functions, context);
  // Hand check: 12,000 + 24,000 = 36,000. The Nov 14 purchase starts next month.
  runInContext("renderSummary()", context);
  assert.equal(elements.summaryTotal.textContent, "36000");
  assert.equal(runInContext("specListPurchaseTotal()", context), 36000);
  assert.match(runInContext("specListCsv()", context), /"総購入金額","36000"/);
  state.timelineMarkerMonth = month(2026, 11);
  runInContext("renderSummary()", context);
  assert.equal(elements.summaryTotal.textContent, "84000");
  assert.equal(runInContext("specListPurchaseTotal()", context), 84000);
  assert.match(runInContext("specListCsv()", context), /"総購入金額","84000"/);
});
