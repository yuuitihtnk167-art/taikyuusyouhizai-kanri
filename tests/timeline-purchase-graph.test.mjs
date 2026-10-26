import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";
import { pcCostMonthlyCostAt, dateFromMonthPosition } from "../js/services/pc-sale.js";
import { nextDayPosition, purchaseTotalSeries } from "../js/services/timeline-purchase-graph.js";

const position = (year, month, day) => year * 12 + month - 1 + (day - 1) / new Date(year, month, 0).getDate();
const valueAt = (points, day) => points.filter((p) => p.position <= day).at(-1).total;

test("purchase graph changes only on purchases and the day after an inclusive end date", () => {
  const start = position(2026, 1, 1), end = position(2027, 1, 1);
  const intervals = [
    { start: position(2025, 1, 1), end: position(2026, 1, 31), amount: 10000 },
    { start: position(2026, 1, 31), end: position(2026, 2, 28), amount: 20000 },
    { start: position(2026, 2, 1), end: position(2028, 1, 1), amount: 30000 },
  ];
  const points = purchaseTotalSeries(intervals, start, end);
  assert.equal(valueAt(points, position(2026, 1, 30)), 10000);
  assert.equal(valueAt(points, position(2026, 1, 31)), 30000);
  assert.equal(valueAt(points, position(2026, 2, 1)), 50000);
  assert.equal(valueAt(points, position(2026, 2, 28)), 50000);
  assert.equal(valueAt(points, position(2026, 3, 1)), 30000);
  assert.equal(points.at(-1).position, end);
  assert.deepEqual(purchaseTotalSeries([], start, end), [{ position: start, total: 0 }, { position: end, total: 0 }]);
  assert.equal(nextDayPosition(position(2028, 2, 28)), position(2028, 2, 29));
  assert.equal(nextDayPosition(position(2028, 2, 29)), position(2028, 3, 1));
  assert.equal(nextDayPosition(position(2026, 12, 31)), position(2027, 1, 1));
});

test("the plotted PC total agrees with the actual summary on every calendar day, for both underuse settings and PC filters", () => {
  const source = readFileSync(new URL("../pc-management/app.js", import.meta.url), "utf8");
  const names = ["parseDate", "toMonthIndex", "daysInMonth", "toMonthPosition", "addYearsClamped", "itemStartMonth", "itemPlannedEndMonth", "itemActualEndMonth", "summaryActiveEndMonth", "isActiveInSummaryAtTimelineMarker", "isSummaryExcluded", "summaryItems", "calculateSummaryAt", "summaryMonthlyCost", "monthlyCostAt", "isPastPlannedEnd", "calculateMonthlyCost"];
  const functions = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
  }).join("\n");
  const state = { selectedPcNames: new Set(["main"]), items: [
    { pcName: "main", purchaseDate: "2024-02-29", purchasePrice: 20000, yearsOfUse: 2 },
    { pcName: "main", purchaseDate: "2026-01-31", purchasePrice: 12000, yearsOfUse: 1, endOfUseDate: "2026-06-15" },
    { pcName: "main", purchaseDate: "2026-02-28", purchasePrice: 30000, yearsOfUse: 1, hideFromTimeline: true },
    { pcName: "main", purchaseDate: "2026-09-15", purchasePrice: 40000, yearsOfUse: 1 },
    { pcName: "main", purchaseDate: "2025-01-01", purchasePrice: 100000, yearsOfUse: 5, excludeFromSummary: true },
    { pcName: "sub", purchaseDate: "2025-02-01", purchasePrice: 60000, yearsOfUse: 3 },
  ] };
  let excludeUnderused = false;
  const context = createContext({ state, pcCostMonthlyCostAt, dateFromMonthPosition, TIMELINE_MIN_YEAR: 2015, shouldExcludeUnderusedMonthlyCost: () => excludeUnderused, currentMonthIndex: () => position(2026, 10, 25) });
  runInContext(functions, context);
  for (const flag of [false, true]) {
    excludeUnderused = flag;
    for (const selected of [["main"], ["sub"], ["main", "sub"], []]) {
      state.selectedPcNames = new Set(selected);
      const intervals = runInContext("summaryItems().filter(item => !isSummaryExcluded(item)).map(item => ({ start: itemStartMonth(item), end: summaryActiveEndMonth(item), amount: Number(item.purchasePrice || 0) }))", context);
      const points = purchaseTotalSeries(intervals, position(2026, 1, 1), position(2027, 1, 1));
      for (let date = new Date(2026, 0, 1); date.getFullYear() === 2026; date.setDate(date.getDate() + 1)) {
        const target = position(date.getFullYear(), date.getMonth() + 1, date.getDate());
        context.target = target;
        assert.equal(valueAt(points, target), runInContext("calculateSummaryAt(target).purchaseTotal", context), `${date.toDateString()} underuse=${flag} filters=${selected}`);
      }
    }
  }
});
