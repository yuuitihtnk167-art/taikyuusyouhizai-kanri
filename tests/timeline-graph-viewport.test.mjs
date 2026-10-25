import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { test } from "node:test";

for (const path of ["../js/list.js", "../pc-management/app.js"]) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const extract = (name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    return source.slice(start, source.indexOf("\n}", start) + 2);
  };

  test(`${path}: a day step synchronizes header and band markers`, () => {
    const lines = [{ style: {} }, { style: {} }];
    const handles = [{ style: {} }, { style: {} }, { style: {} }];
    const itemList = { querySelectorAll: (selector) => selector === ".timeline-current-line" ? lines : handles };
    const scroll = { scrollLeft: 0, clientWidth: 400 };
    const grid = { dataset: { minYear: "2015", maxYear: "2055" }, closest: () => scroll };
    const handle = { closest: () => grid };
    const state = { timelineMarkerMonth: 100 };
    let summaryCalls = 0;
    const context = createContext({
      state, itemList, elements: { itemList }, handle,
      timelineMarkerMonth: () => state.timelineMarkerMonth,
      shiftTimelineDay: (position, delta) => position + delta,
      currentLinePosition: () => state.timelineMarkerMonth * 2,
      timelineLayout: () => ({ labelWidth: 72 }),
      updatePcSummaryForMonth() {}, updatePcLinkedCostDisplays() {}, summaryItems: () => [],
      summarizeItems: () => { summaryCalls++; }, renderSummary: () => { summaryCalls++; },
      markerDayControls: { sync() {} }, markerDateTooltip: { show() {} },
    });
    runInContext(extract("moveTimelineMarkerByDay"), context);
    assert.equal(runInContext("moveTimelineMarkerByDay(1, handle)", context), true);
    assert.equal(summaryCalls, 1);
    assert.deepEqual(lines.map((line) => line.style.left), ["202px", "202px"]);
    assert.deepEqual(handles.map((current) => current.style.left), ["202px", "202px", "202px"]);
  });

  test(`${path}: dragging the fixed header never scrolls vertically; band edges use the band viewport`, () => {
    const context = createContext({
      TIMELINE_MARKER_VERTICAL_AUTO_SCROLL_EDGE_PX: 72,
      TIMELINE_MARKER_VERTICAL_AUTO_SCROLL_MAX_PX: 16,
      window: { innerHeight: 900 },
    });
    runInContext(extract("timelineMarkerVerticalAutoScrollSpeed"), context);
    const speed = (kind, clientY) => {
      context.drag = { clientY, scroll: {
        classList: { contains: (name) => name === kind },
        getBoundingClientRect: () => ({ top: 300, bottom: 600 }),
      } };
      return runInContext("timelineMarkerVerticalAutoScrollSpeed(drag)", context);
    };
    assert.equal(speed("timeline-graph-header-scroll", 5), 0);
    assert.equal(speed("timeline-band-scroll", 450), 0);
    assert.ok(speed("timeline-band-scroll", 310) < 0);
    assert.ok(speed("timeline-band-scroll", 590) > 0);
    assert.equal(speed("", 450), 0);
    assert.ok(speed("", 890) > 0);
  });
}
