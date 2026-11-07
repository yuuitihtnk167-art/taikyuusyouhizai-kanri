import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createContext, runInContext } from "node:vm";
import { additionalCostNeedsDuration, durableAdditionalCostSchedules, durableCostItem, durableCostSchedule, durableSaleSchedule, durableMonthlyCostAt } from "../js/services/durable-cost.js";
import { dateFromMonthPosition, pcItemBeforeSale, normalizePcSale, saleDate } from "../js/services/pc-sale.js";
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
const names = ["parseDate", "toMonthIndex", "daysInMonth", "toMonthPosition", "addYearsClamped", "isPcManagementLinkedItem", "itemStartMonth", "itemPlannedEndMonth", "itemActualEndMonth", "summaryActiveEndMonth", "isActiveInSummaryAtTimelineMarker", "datedCostActiveIntervals", "isSummaryExcluded", "summaryItems", "totalPurchaseCost", "purchaseGraphIntervals", "calculateSummaryAt", "itemSummaryMonthlyCost", "timelineMonthlyCost"];
const functions = names.map(name => {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}).join("\n");
function dashboard(items) {
  const state = { pcItems: [], summaryItems: items, selectedCategories: new Set(items.map(item => item.category)) };
  const context = createContext({ state, durableAdditionalCostSchedules, durableCostItem, durableCostSchedule, durableSaleSchedule, durableMonthlyCostAt, dateFromMonthPosition, pcItemBeforeSale, pcPurchaseIntervals, shouldExcludeUnderusedMonthlyCost,
    calculatePcSummaryAt: () => ({ monthlyCost: 0, purchaseTotal: 0 }),
    calculateAdditionalCostTotal: item => (item.additionalCosts ?? []).reduce((sum, cost) => sum + cost.amount, 0),
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

test("backdated expenses are recognized from their own accounting periods and reconcile in the final month", () => {
  values.set("monthlyApplianceBook.monthlySummarySettings", JSON.stringify({ mode: "monthly", day: 1, adjustToPreviousWeekday: false }));
  try {
    const item = {
      category: "car", purchaseDate: "2026-01-01", purchasePrice: 12000, yearsOfUse: 1, monthlyCostRounding: "truncate-final",
      additionalCosts: [
        { expenseDate: "2026-07-15", amount: 12001, createdAt: Date.UTC(2027, 0, 1) },
        { expenseDate: "2026-10-01", amount: 301 },
      ],
    };
    const d = dashboard([item]);
    assert.equal(d.at(new Date(2026, 6, 14)).monthlyCost, 1000);
    assert.equal(d.at(new Date(2026, 6, 15)).monthlyCost, 3000);
    assert.equal(d.at(new Date(2026, 9, 1)).monthlyCost, 3100);
    assert.equal(d.at(new Date(2026, 11, 31)).monthlyCost, 3102);
    assert.equal(d.at(new Date(2027, 0, 1)).monthlyCost, 0);
    const schedule = durableCostSchedule(item);
    assert.equal(additionalCostNeedsDuration(schedule, "2026-12-31"), false);
    assert.equal(additionalCostNeedsDuration(schedule, "2027-01-01"), true);
    const monthly = Array.from({ length: 12 }, (_, month) => d.at(new Date(2026, month + 1, 0)).monthlyCost);
    assert.equal(monthly.reduce((sum, cost) => sum + cost, 0), 24302);
    for (const day of [new Date(2026, 6, 14), new Date(2026, 6, 15), new Date(2026, 9, 1)]) {
      const position = dateMonthPosition(day);
      const graph = d.intervals().filter(i => i.start <= position && position <= i.end).reduce((sum, i) => sum + i.amount, 0);
      assert.equal(graph, d.at(day).purchaseTotal);
    }
  } finally { values.clear(); }
});

test("post-plan expenses restart monthly costs and carry only the unpaid balance into a sale", () => {
  values.set("monthlyApplianceBook.monthlySummarySettings", JSON.stringify({ mode: "monthly", day: 1, adjustToPreviousWeekday: false }));
  try {
    const item = {
      category: "car", purchaseDate: "2026-01-01", purchasePrice: 12000, yearsOfUse: 1, monthlyCostRounding: "truncate-final",
      additionalCosts: [{ expenseDate: "2027-02-12", expenseMonths: 3, amount: 401 }],
    };
    const d = dashboard([item]);
    assert.equal(d.at(new Date(2027, 0, 31)).monthlyCost, 0);
    assert.equal(d.at(new Date(2027, 1, 11)).monthlyCost, 0);
    assert.equal(d.at(new Date(2027, 1, 28)).monthlyCost, 133);
    assert.equal(d.at(new Date(2027, 3, 30)).monthlyCost, 135);
    assert.equal(d.at(new Date(2027, 4, 1)).monthlyCost, 0);
    item.sale = { date: "2027-03-01", amount: 100, months: 12 };
    item.endOfUseDate = item.sale.date;
    assert.equal(durableSaleSchedule(item).remaining, 268);
    assert.equal(d.at(new Date(2027, 1, 28)).monthlyCost, 133);
    assert.equal(d.at(new Date(2027, 2, 31)).monthlyCost, 84);
    assert.equal(d.at(new Date(2027, 3, 30)).monthlyCost, 84);
  } finally { values.clear(); }
});

test("changing the closing date does not drop a saved expense at the end of the original plan", () => {
  const key = "monthlyApplianceBook.monthlySummarySettings";
  const item = {
    purchaseDate: "2026-01-01", purchasePrice: 12000, yearsOfUse: 1, monthlyCostRounding: "truncate-final",
    additionalCosts: [{ expenseDate: "2026-12-31", expenseMonths: null, amount: 3000 }],
  };
  try {
    values.set(key, JSON.stringify({ mode: "monthly", day: 1, adjustToPreviousWeekday: false }));
    assert.equal(additionalCostNeedsDuration(durableCostSchedule(item), "2026-12-31"), false);
    values.set(key, JSON.stringify({ mode: "monthly", day: 15, adjustToPreviousWeekday: false }));
    assert.equal(additionalCostNeedsDuration(durableCostSchedule(item), "2026-12-31"), true);
    assert.equal(durableMonthlyCostAt(item, new Date(2027, 0, 14)), 3000);
    assert.equal(durableMonthlyCostAt(item, new Date(2027, 0, 15)), 0);
  } finally { values.clear(); }
});

test("expense form requires a date and shows a required duration only for a late expense", () => {
  const form = readFileSync(new URL("../js/form.js", import.meta.url), "utf8");
  const names = ["updateCalculationResult", "createAdditionalCostRow", "collectAdditionalCosts", "validateAdditionalCostDates"];
  const functions = names.map(name => {
    const start = form.indexOf(`function ${name}(`);
    return form.slice(start, form.indexOf("\n}", start) + 2);
  }).join("\n");
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.value = ""; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    appendChild(child) { child.parentElement = this; this.children.push(child); }
    setAttribute() {}
    querySelector(selector) {
      return this.children.find(child => `.${child.className}` === selector)
        ?? this.children.map(child => child.querySelector(selector)).find(Boolean);
    }
    querySelectorAll() { return this.children; }
  }
  const item = { purchaseDate: "2026-01-01", purchasePrice: 12000, yearsOfUse: 1, monthlyCostRounding: "truncate-final" };
  const list = new Element();
  const adjustment = new Element();
  adjustment.parentElement = new Element();
  const context = createContext({
    item, HTMLInputElement: Element, additionalCostList: list, additionalCostNeedsDuration, durableAdditionalCostSchedules,
    durableCostSchedule, durableMonthlyCostAt, durableSaleSchedule, saleDate, createId: () => "new",
    pcPartMemoDisplayText: value => value ?? "", decodePcPartMemo: () => false,
    formCostItem: () => ({ ...item, additionalCosts: runInContext("collectAdditionalCosts()", context) }),
    calculationTotal: new Element(), calculationMonthlyCost: new Element(), formatMonthlyCost: String, formatCurrency: String,
    calculateAdditionalCostTotal: ({ additionalCosts }) => additionalCosts.reduce((sum, cost) => sum + cost.amount, 0),
    saleForm: { getSale: () => null, refresh() {} }, state: {},
    document: { createElement: () => new Element(), getElementById: () => adjustment },
  });
  values.set("monthlyApplianceBook.monthlySummarySettings", JSON.stringify({ mode: "monthly", day: 1, adjustToPreviousWeekday: false }));
  try {
    runInContext(functions, context);
    const row = runInContext("createAdditionalCostRow()", context);
    list.appendChild(row);
    const date = row.querySelector(".additional-cost-date");
    const months = row.querySelector(".additional-cost-months");
    assert.equal(row.children[0], date.parentElement);
    assert.equal(row.children[1], row.querySelector(".additional-cost-amount"));
    assert.match(date.value, /^\d{4}-\d{2}-\d{2}$/);
    row.querySelector(".additional-cost-amount").value = "12000";
    date.value = "";
    assert.match(runInContext("validateAdditionalCostDates(item)", context), /支出日を入力/);
    date.value = "2026-12-31";
    runInContext("updateCalculationResult()", context);
    assert.equal(months.parentElement.hidden, true);
    assert.equal(runInContext("validateAdditionalCostDates(item)", context), null);
    date.value = "2027-01-01";
    runInContext("updateCalculationResult()", context);
    assert.equal(months.parentElement.hidden, false);
    assert.equal(months.required, true);
    assert.match(runInContext("validateAdditionalCostDates(item)", context), /使用予定期間を入力/);
    months.value = "24";
    assert.equal(runInContext("validateAdditionalCostDates(item)", context), null);
    assert.equal(runInContext("collectAdditionalCosts({ forSave: true })", context)[0].expenseMonths, 24);
    date.value = "2026-12-31";
    runInContext("updateCalculationResult()", context);
    assert.equal(months.parentElement.hidden, true);
    assert.equal(runInContext("collectAdditionalCosts({ forSave: true })", context)[0].expenseMonths, null);
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
  const item = { id: "car", category: "car", purchasePrice: 100000, yearsOfUse: 10, monthlyCostRounding: "truncate-final", sale: { date: "2026-10-26", amount: 30001, months: 12 }, additionalCosts: [{ id: "cost", amount: 12001, expenseDate: "2025-11-01", expenseMonths: 24 }], endOfUseDate: "2026-10-26" };
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
  assert.equal(loaded.additionalCosts[0].expenseDate, "2025-11-01");
  assert.equal(loaded.additionalCosts[0].expenseMonths, 24);
  let payload;
  const firestore = readFileSync(new URL("../js/storage/durable-items/firestore.js", import.meta.url), "utf8").replace(/import[\s\S]*?;\s*/g, "").replaceAll("export ", "");
  const cloud = createContext({ item: saved, db: {}, doc: () => "doc", serverTimestamp: () => "timestamp", setDoc: async (_ref, value) => { payload = value; } });
  runInContext(firestore, cloud);
  await runInContext('saveItem("user", item)', cloud);
  assert.equal(payload.sale.amount, 30001);
  assert.equal(payload.additionalCosts[0].expenseDate, "2025-11-01");
  assert.equal(payload.additionalCosts[0].expenseMonths, 24);
  context.item = { ...loaded, sale: null, endOfUseDate: "" };
  await runInContext('saveItem("local", item)', context);
  cloud.item = saved;
  await runInContext('saveItem("user", item)', cloud);
  assert.equal(payload.sale, null, "merge writes must explicitly clear a removed sale");
  assert.equal(payload.monthlyCostRounding, "truncate-final");
});

test("main backup normalization preserves sale details and rounding policy", () => {
  const common = readFileSync(new URL("../js/common.js", import.meta.url), "utf8");
  const names = ["normalizeAdditionalCosts", "normalizeStoredItem", "normalizeBackupDurableGoodsItems", "sortStoredItems"];
  const functions = names.map(name => {
    const start = common.indexOf(`function ${name}(`);
    return common.slice(start, common.indexOf("\n}", start) + 2);
  }).join("\n");
  const record = { id: "car", sale: { date: "2026-10-26", amount: 30001, months: 12, previousEndOfUseDate: "2026-12-01" }, monthlyCostRounding: "truncate-final", additionalCosts: [{ id: "dated", amount: 12000, expenseDate: "2026-09-01", expenseMonths: 24 }, { id: "legacy", amount: 1000 }] };
  const context = createContext({ normalizePcSale, normalizeCategory: value => value, isPcManagementItem: () => false, isLegacyPcManagementItem: () => false, ASSET_REFERENCE_SOURCE_TYPE: "assetReferenceData", record });
  runInContext(functions, context);
  const result = runInContext("normalizeBackupDurableGoodsItems(JSON.parse(JSON.stringify([record])))", context)[0];
  assert.equal(result.sale.amount, 30001);
  assert.equal(result.sale.previousEndOfUseDate, "2026-12-01");
  assert.equal(result.monthlyCostRounding, "truncate-final");
  assert.equal(result.additionalCosts[0].expenseDate, "2026-09-01");
  assert.equal(result.additionalCosts[0].expenseMonths, 24);
  assert.equal(result.additionalCosts[1].expenseDate, "");
});
