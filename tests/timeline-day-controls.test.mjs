import assert from "node:assert/strict";
import { test } from "node:test";
import { shiftTimelineDay, createDayRepeater } from "../js/services/timeline-day-controls.js";

const position = (year, month, day) => year * 12 + month - 1 + (day - 1) / new Date(year, month, 0).getDate();

test("one-day steps cross month, year and leap-day boundaries", () => {
  for (const [before, after] of [
    [[2026, 1, 31], [2026, 2, 1]],
    [[2026, 12, 31], [2027, 1, 1]],
    [[2028, 2, 28], [2028, 2, 29]],
    [[2028, 2, 29], [2028, 3, 1]],
  ]) {
    assert.equal(shiftTimelineDay(position(...before), 1, 2015, 2055), position(...after));
    assert.equal(shiftTimelineDay(position(...after), -1, 2015, 2055), position(...before));
  }
  assert.equal(shiftTimelineDay(position(2015, 1, 1), -1, 2015, 2055), position(2015, 1, 1));
  assert.equal(shiftTimelineDay(position(2054, 12, 31), 1, 2015, 2055), position(2054, 12, 31));
});

test("tap steps once, hold repeats after the delay, release cancels pending steps", () => {
  let nextId = 0;
  const pending = new Map();
  const timers = {
    setTimeout(callback, delay) { pending.set(++nextId, { callback, delay }); return nextId; },
    clearTimeout(id) { pending.delete(id); },
  };
  const runNext = () => {
    const [id, timer] = pending.entries().next().value;
    pending.delete(id);
    timer.callback();
    return timer.delay;
  };
  let count = 0;
  const repeater = createDayRepeater(() => { count++; }, timers);
  repeater.start();
  assert.equal(count, 1);
  repeater.stop();
  assert.equal(pending.size, 0);
  repeater.start();
  assert.equal(count, 2);
  assert.equal(runNext(), 450);
  assert.equal(count, 3);
  assert.equal(runNext(), 100);
  assert.equal(count, 4);
  repeater.stop();
  assert.equal(pending.size, 0);
  const bounded = createDayRepeater(() => false, timers);
  bounded.start();
  assert.equal(pending.size, 0);
});
