import assert from "node:assert/strict";
import { test } from "node:test";
import { timelineMarkerDateLabel } from "../js/services/timeline-marker-tooltip.js";

test("marker tooltip shows month/day at date boundaries without a year", () => {
  for (const [year, month, day] of [[2026, 1, 1], [2026, 10, 25], [2026, 12, 31], [2028, 2, 29], [2027, 3, 1]]) {
    const days = new Date(year, month, 0).getDate();
    const position = year * 12 + month - 1 + (day - 1) / days;
    assert.equal(timelineMarkerDateLabel(position), `${month}/${day}`);
  }
});
