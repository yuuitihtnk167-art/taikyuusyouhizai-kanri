import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createContext, runInContext } from "node:vm";

for (const [path, renderName] of [
  ["../js/list.js", "summarizeItems"],
  ["../pc-management/app.js", "renderSummary"],
]) {
  test(`${path}: labels follow the same selected-month items as the totals`, () => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const functions = [renderName, "calculateSummaryAt", "timelineLabelClass", "summaryItems", "isSummaryExcluded", "isActiveInSummaryAtTimelineMarker"]
      .map((name) => {
        const start = source.indexOf(`function ${name}(`);
        assert.notEqual(start, -1, name);
        return source.slice(start, source.indexOf("\n}", start) + 2);
      }).join("\n");
    const items = [
      { id: "current", start: 10, end: 11, purchasePrice: 1200 },
      { id: "future", start: 12, end: 13, purchasePrice: 2400 },
      { id: "ended", start: 1, end: 9, purchasePrice: 3600 },
      { id: "excluded", start: 1, end: 20, purchasePrice: 4800, excludeFromSummary: true },
      { id: "hidden", start: 1, end: 20, purchasePrice: 6000, hideFromTimeline: true },
      { id: "filtered", start: 1, end: 20, purchasePrice: 7200, category: "other", pcName: "sub" },
    ].map((item) => ({ category: "home", pcName: "main", ...item }));
    const state = {
      items, summaryItems: items, summaryItemIds: new Set(),
      selectedCategories: new Set(["home"]), selectedPcNames: new Set(["main"]),
      timelineMarkerMonth: 10,
    };
    const labels = items.filter((item) => !item.hideFromTimeline && item.id !== "filtered").map((item) => ({
      dataset: { id: item.id },
      included: false,
      classList: { toggle(name, included) { assert.equal(name, "summary-included"); labels.find((label) => label.dataset.id === item.id).included = included; } },
    }));
    const itemList = { querySelectorAll: () => labels };
    const count = {}, total = {}, monthly = {};
    const context = createContext({
      state, itemList,
      elements: { itemList, summaryCount: count, summaryTotal: total, summaryMonthly: monthly },
      summaryItemCount: count, summaryPurchaseTotal: total, summaryMonthlyCost: monthly,
      timelineMarkerMonth: () => state.timelineMarkerMonth,
      itemStartMonth: (item) => item.start, summaryActiveEndMonth: (item) => item.end,
      updateTimelineMarkerDate: () => {},
      itemSummaryMonthlyCost: (item) => item.purchasePrice / 12,
      calculatePcSummaryAt: () => ({ monthlyCost: 0, purchaseTotal: 0 }),
      isPcManagementLinkedItem: () => false,
      totalPurchaseCost: (item) => item.purchasePrice,
      formatCurrency: String, formatMonthlyCost: String,
      isMonthlyCostSummaryExcluded: () => false,
    });
    // PC uses this name for its per-part cost calculation; the main page uses it for the DOM element.
    if (renderName === "renderSummary") context.summaryMonthlyCost = (item) => item.purchasePrice / 12;
    runInContext(functions, context);
    const render = () => runInContext(renderName === "renderSummary" ? "renderSummary()" : "summarizeItems(summaryItems())", context);
    render();
    assert.equal(count.textContent, "2 件");
    assert.equal(total.textContent, "7200");
    assert.deepEqual(labels.filter((label) => label.included).map((label) => label.dataset.id), ["current"]);
    assert.match(runInContext("timelineLabelClass(state.items[0])", context), /summary-included/);
    assert.doesNotMatch(runInContext("timelineLabelClass(state.items[1])", context), /summary-included/);

    state.timelineMarkerMonth = 12;
    render();
    assert.equal(count.textContent, "2 件");
    assert.equal(total.textContent, "8400");
    assert.deepEqual(labels.filter((label) => label.included).map((label) => label.dataset.id), ["future"]);

    items[1].excludeFromSummary = true;
    render();
    assert.equal(count.textContent, "1 件");
    assert.deepEqual(labels.filter((label) => label.included), []);

    // The hidden page displays a different set of rows, while using the same full summary.
    labels.splice(0, labels.length, { dataset: { id: "hidden" }, classList: { toggle(_name, included) { this.included = included; } } });
    render();
    assert.equal(labels[0].classList.included, true);
  });
}
