import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createContext, runInContext } from "node:vm";
import { durableCostItem, durableCostSchedule, durableSaleSchedule, durableMonthlyCostAt } from "../js/services/durable-cost.js";
import { dateFromMonthPosition, pcItemBeforeSale, normalizePcSale } from "../js/services/pc-sale.js";
import { monthlySummaryReference, dateMonthPosition } from "../js/services/monthly-summary.js";
import { shouldExcludeUnderusedMonthlyCost } from "../js/services/app-settings.js";

registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.includes("/storage/pc-items/index.js")) return { url: "data:text/javascript,export async function getItems(){return []}", shortCircuit: true };
  return result;
} });
const { pcPurchaseIntervals } = await import("../js/services/pc-summary.js");
const values = new Map();
globalThis.localStorage = { getItem: key => values.get(key) ?? null };
const source = readFileSync(new URL("../js/list.js", import.meta.url), "utf8");
const names = ["parseDate", "toMonthIndex", "daysInMonth", "toMonthPosition", "addYearsClamped", "isPcManagementLinkedItem", "itemStartMonth", "itemPlannedEndMonth", "itemActualEndMonth", "summaryActiveEndMonth", "isActiveInSummaryAtTimelineMarker", "isSummaryExcluded", "summaryItems", "totalPurchaseCost", "purchaseGraphIntervals", "calculateSummaryAt", "itemSummaryMonthlyCost", "timelineMonthlyCost"];
const functions = names.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");
function dashboard(items) {
  const state = { pcItems: [], summaryItems: items, selectedCategories: new Set(items.map(item => item.category)) };
  const context = createContext({ state, durableCostItem, durableCostSchedule, durableSaleSchedule, durableMonthlyCostAt, dateFromMonthPosition, pcItemBeforeSale, pcPurchaseIntervals, shouldExcludeUnderusedMonthlyCost,
    calculatePcSummaryAt: () => ({ monthlyCost: 0, purchaseTotal: 0 }),
    calculateAdditionalCostTotal: item => durableCostItem(item).purchasePrice - item.purchasePrice,
    TIMELINE_MIN_YEAR: 2015, TIMELINE_MAX_YEAR: 2055,
  });
  runInContext(functions, context);
  return {
    state,
    at(date) { context.target = dateMonthPosition(date); return runInContext("calculateSummaryAt(summaryItems(), target)", context); },
    intervals() { return runInContext("purchaseGraphIntervals()", context); },
  };
}

test("all nine main-screen categories reconcile total cost minus sale proceeds at real closing dates", () => {
  let cases = 0;
  try {
    for (const settings of [{ mode: "monthly", day: 15, adjustToPreviousWeekday: true }, { mode: "monthly", day: 31, adjustToPreviousWeekday: false }]) {
      values.set("monthlyApplianceBook.monthlySummarySettings", JSON.stringify(settings));
      for (const category of ["information_device", "smartphone", "audio_visual", "air_conditioning", "living_appliance", "cooking_appliance", "beauty_health", "car", "other"]) {
        for (const monthlyCostRounding of [null, "truncate-final"]) {
          for (const sale of [null, ...["2026-10-14", "2034-01-31"].flatMap(date => [30001, 400001].map(amount => ({ date, amount, months: 12, previousEndOfUseDate: "" })))]) {
            const item = { id: "test", category, purchaseDate: "2022-10-26", purchasePrice: 100000, additionalCosts: [{ amount: 12001 }, { amount: 35 }], yearsOfUse: 10, monthlyCostRounding, sale, endOfUseDate: sale?.date ?? "" };
            const d = dashboard([item]);
            let total = 0;
            for (let month = 2022 * 12; month < 2036 * 12; month++) total += d.at(monthlySummaryReference(month, settings).date).monthlyCost;
            assert.equal(total, 112036 - (sale?.amount ?? 0), JSON.stringify({ category, monthlyCostRounding, sale, settings }));
            assert.equal(item.purchasePrice, 100000, "additional costs never overwrite the stored purchase price");
            cases++;
          }
        }
      }
    }
    assert.equal(cases, 180);
  } finally { values.clear(); }
});

test("sale purchase graph agrees with summary across gaps, exclusions, hidden items and category filters", () => {
  const item = { category: "car", purchaseDate: "2022-10-26", purchasePrice: 100000, additionalCosts: [{ amount: 12001 }], yearsOfUse: 2, monthlyCostRounding: "truncate-final", sale: { date: "2026-10-26", amount: 30001, months: 12 }, endOfUseDate: "2026-10-26", hideFromTimeline: true };
  const d = dashboard([item]);
  assert.equal(d.at(new Date(2025, 0, 1)).purchaseTotal, 0);
  assert.equal(d.at(new Date(2026, 9, 26)).monthlyCost, -2500);
  const intervals = d.intervals();
  for (let day = new Date(2022, 0, 1); day < new Date(2028, 0, 1); day.setDate(day.getDate() + 1)) {
    const position = dateMonthPosition(day);
    assert.equal(intervals.filter(i => i.start <= position && position <= i.end).reduce((total, i) => total + i.amount, 0), d.at(day).purchaseTotal, day.toISOString());
  }
  item.excludeFromSummary = true;
  assert.equal(d.at(new Date(2026, 9, 26)).monthlyCost, 0);
  assert.equal(d.intervals().length, 0);
  item.excludeFromSummary = false;
  d.state.selectedCategories.clear();
  assert.equal(d.at(new Date(2026, 9, 26)).monthlyCost, 0);
});

test("main storage normalization and Firestore payload retain and clear sale metadata", async () => {
  let saved;
  const item = { id: "car", category: "car", purchasePrice: 100000, yearsOfUse: 10, monthlyCostRounding: "truncate-final", sale: { date: "2026-10-26", amount: 30001, months: 12 }, additionalCosts: [{ id: "cost", amount: 12001 }], endOfUseDate: "2026-10-26" };
  const service = readFileSync(new URL("../js/storage/durable-items/service.js", import.meta.url), "utf8").replace(/import[\s\S]*?;\s*/g, "").replaceAll("export ", "");
  const context = createContext({ normalizePcSale, CATEGORY_OPTIONS: [{ value: "car" }], DEFAULT_CATEGORY: "other", createId: () => "id", isPcManagementItem: () => false, normalizeAdditionalCosts: value => value ?? [], isLocalMode: () => true,
    storage: { getItem: async () => saved, saveItem: async (_uid, value) => { saved = value; } }, item,
  });
  runInContext(service, context);
  await runInContext('saveItem("local", item)', context);
  assert.equal(saved.sale.amount, 30001);
  assert.equal(saved.monthlyCostRounding, "truncate-final");
  const loaded = await runInContext('loadItem("local", "car")', context);
  assert.equal(loaded.sale.amount, 30001);
  assert.equal(loaded.additionalCosts[0].amount, 12001);
  let payload;
  const firestore = readFileSync(new URL("../js/storage/durable-items/firestore.js", import.meta.url), "utf8").replace(/import[\s\S]*?;\s*/g, "").replaceAll("export ", "");
  const cloud = createContext({ item: saved, db: {}, doc: () => "doc", serverTimestamp: () => "timestamp", setDoc: async (_ref, value) => { payload = value; } });
  runInContext(firestore, cloud);
  await runInContext('saveItem("user", item)', cloud);
  assert.equal(payload.sale.amount, 30001);
  context.item = { ...loaded, sale: null, endOfUseDate: "" };
  await runInContext('saveItem("local", item)', context);
  cloud.item = saved;
  await runInContext('saveItem("user", item)', cloud);
  assert.equal(payload.sale, null, "merge writes must explicitly clear a removed sale");
  assert.equal(payload.monthlyCostRounding, "truncate-final");
});

test("main backup normalization preserves sale details and rounding policy", () => {
  const common = readFileSync(new URL("../js/common.js", import.meta.url), "utf8");
  const names = ["normalizeStoredItem", "normalizeBackupDurableGoodsItems", "sortStoredItems"];
  const functions = names.map(name => {
    const start = common.indexOf(`function ${name}(`);
    return common.slice(start, common.indexOf("\n}", start) + 2);
  }).join("\n");
  const record = { id: "car", sale: { date: "2026-10-26", amount: 30001, months: 12, previousEndOfUseDate: "2026-12-01" }, monthlyCostRounding: "truncate-final" };
  const context = createContext({ normalizePcSale, normalizeCategory: value => value, normalizeAdditionalCosts: value => value ?? [], isPcManagementItem: () => false, isLegacyPcManagementItem: () => false, ASSET_REFERENCE_SOURCE_TYPE: "assetReferenceData", record });
  runInContext(functions, context);
  const result = runInContext("normalizeBackupDurableGoodsItems(JSON.parse(JSON.stringify([record])))", context)[0];
  assert.equal(result.sale.amount, 30001);
  assert.equal(result.sale.previousEndOfUseDate, "2026-12-01");
  assert.equal(result.monthlyCostRounding, "truncate-final");
});
