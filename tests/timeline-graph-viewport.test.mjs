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

  function mousePanHarness({ band = true, scrollTop = 100, horizontal = true } = {}) {
    const listeners = new Map();
    const page = { scrollY: 200, setTimeout() {}, scrollBy(_x, delta) { this.scrollY = Math.max(0, this.scrollY + delta); } };
    const classes = new Set([band ? "timeline-band-scroll" : "timeline-graph-header-scroll"]);
    const scroll = {
      scrollTop, scrollLeft: 100, scrollHeight: 1000, clientHeight: 300,
      scrollWidth: horizontal ? 2000 : 400, clientWidth: 400,
      classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
      addEventListener: (name, handler) => listeners.set(name, handler),
      focus() {}, setPointerCapture() {}, hasPointerCapture: () => false,
    };
    const context = createContext({
      window: page, scroll, isTimelineMousePanTarget: target => target !== "control",
      TIMELINE_MOUSE_PAN_START_PX: 4,
    });
    runInContext(extract("enableTimelineMousePanning"), context);
    runInContext("enableTimelineMousePanning(scroll)", context);
    const emit = (type, x, y, options = {}) => {
      const event = { pointerType: "mouse", button: 0, buttons: 1, pointerId: 1,
        clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, ...options };
      listeners.get(type)(event);
    };
    return { emit, scroll, page };
  }

  test(`${path}: pulling down moves bands and bottom buttons through page scrolling`, () => {
    const { emit, scroll, page } = mousePanHarness();
    emit("pointerdown", 200, 200);
    emit("pointermove", 200, 260);
    assert.equal(scroll.scrollTop, 100);
    assert.equal(page.scrollY, 140);
    emit("pointermove", 200, 320);
    assert.equal(scroll.scrollTop, 100);
    assert.equal(page.scrollY, 80);
    emit("pointermove", 200, 350);
    assert.equal(page.scrollY, 50);
    emit("pointermove", 200, 340);
    assert.equal(scroll.scrollTop, 100);
    assert.equal(page.scrollY, 60);
    emit("pointerup", 200, 340);
    emit("pointermove", 200, 400);
    assert.equal(scroll.scrollTop, 100);
    assert.equal(page.scrollY, 60);
  });

  test(`${path}: pulling up scrolls the page even without horizontal overflow`, () => {
    const { emit, scroll, page } = mousePanHarness({ scrollTop: 650, horizontal: false });
    emit("pointerdown", 200, 300);
    emit("pointermove", 200, 270);
    assert.equal(scroll.scrollTop, 650);
    assert.equal(page.scrollY, 230);
    emit("pointermove", 200, 220);
    assert.equal(scroll.scrollTop, 650);
    assert.equal(page.scrollY, 280);
    emit("pointermove", 200, 200);
    assert.equal(page.scrollY, 300);
  });

  test(`${path}: header panning stays horizontal and clicks, controls and touch retain their behavior`, () => {
    const header = mousePanHarness({ band: false });
    header.emit("pointerdown", 200, 200);
    header.emit("pointermove", 200, 260);
    assert.equal(header.scroll.scrollLeft, 100);
    assert.equal(header.page.scrollY, 200);
    header.emit("pointermove", 230, 260);
    assert.equal(header.scroll.scrollLeft, 70);
    assert.equal(header.page.scrollY, 200);
    for (const options of [{ target: "control" }, { pointerType: "touch" }, { button: 2 }]) {
      const band = mousePanHarness();
      band.emit("pointerdown", 200, 200, options);
      band.emit("pointermove", 200, 400);
      assert.equal(band.scroll.scrollTop, 100);
      assert.equal(band.page.scrollY, 200);
    }
    const tap = mousePanHarness();
    tap.emit("pointerdown", 200, 200);
    tap.emit("pointermove", 202, 202);
    assert.equal(tap.scroll.scrollTop, 100);
    tap.emit("pointercancel", 202, 202);
    tap.emit("pointermove", 200, 400);
    assert.equal(tap.scroll.scrollTop, 100);
  });

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

  test(`${path}: date marker dragging uses page edges below the locked graph`, () => {
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
        previousElementSibling: { getBoundingClientRect: () => ({ bottom: 300 }) },
      } };
      return runInContext("timelineMarkerVerticalAutoScrollSpeed(drag)", context);
    };
    assert.equal(speed("timeline-graph-header-scroll", 5), 0);
    assert.equal(speed("timeline-band-scroll", 450), 0);
    assert.ok(speed("timeline-band-scroll", 310) < 0);
    assert.equal(speed("timeline-band-scroll", 590), 0);
    assert.ok(speed("timeline-band-scroll", 890) > 0);
    assert.equal(speed("", 450), 0);
    assert.ok(speed("", 890) > 0);
  });
}
