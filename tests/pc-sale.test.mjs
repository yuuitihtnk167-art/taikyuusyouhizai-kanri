import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { normalizePcSale, pcCostSchedule, pcCostMonthlyCostAt, pcSaleSchedule, pcSaleMonthlyCostAt, pcSaleItemWithRecord, dateFromMonthPosition } from "../js/services/pc-sale.js";
import { createPcSaleForm } from "../pc-management/sale-form.js";

const base = { id: "part", purchasePrice: 120000, yearsOfUse: 10, purchaseDate: "2022-10-26", endOfUseDate: "" };
const record = { date: "2026-10-26", amount: 30000, months: 12 };
const date = (text) => new Date(`${text}T00:00:00`);

test("normal cost puts the entire truncation remainder in the last installment", () => {
  const item = { ...base, purchasePrice: 100000, monthlyCostRounding: "truncate-final" };
  const s = pcCostSchedule(item);
  assert.equal(s.monthly, 833);
  assert.equal(s.adjustment, 40);
  assert.equal(s.finalMonthly, 873);
  assert.equal(pcCostMonthlyCostAt(item, date("2022-10-26")), 833);
  assert.equal(pcCostMonthlyCostAt(item, date("2032-09-13")), 833);
  assert.equal(pcCostMonthlyCostAt(item, date("2032-09-26")), 873);
  assert.equal(pcCostMonthlyCostAt(item, date("2032-10-27")), 0);
  assert.equal(s.monthly * 119 + s.finalMonthly, 100000);
});

test("existing records retain the old monthly amount and only reconcile at the end", () => {
  const item = { ...base, purchasePrice: 100050 };
  const s = pcCostSchedule(item);
  assert.equal(s.monthly, 834);
  assert.equal(s.adjustment, -30);
  assert.equal(s.finalMonthly, 804);
  assert.equal(pcCostMonthlyCostAt(item, date("2026-10-26")), 834);
  assert.equal(s.monthly * 119 + s.finalMonthly, 100050);
});

test("early sale carries the original unpaid remainder into the single final sale adjustment", () => {
  const item = { ...base, purchasePrice: 100000, monthlyCostRounding: "truncate-final", sale: record };
  const s = pcSaleSchedule(item);
  assert.equal(s.accounted, 833 * 48);
  assert.equal(s.remaining, 60016);
  assert.equal(s.monthly, 416);
  assert.equal(s.adjustment, 64);
  assert.equal(s.finalMonthly, 480);
  assert.equal(s.accounted + s.monthly * 71 + s.finalMonthly, 70000);
  // Read all monthly installments through the functions used by the dashboards.
  let total = 0;
  for (let i = 0; i < 120; i++) {
    const day = new Date(2022, 9 + i, 26);
    total += pcSaleMonthlyCostAt(item, day) ?? pcCostMonthlyCostAt(item, day);
  }
  assert.equal(total, item.purchasePrice - record.amount);
});

test("sale after the ordinary final adjustment never charges its remainder twice", () => {
  for (const monthlyCostRounding of [null, "truncate-final"]) {
    const item = { ...base, purchasePrice: 100050, monthlyCostRounding, sale: { ...record, date: "2034-01-01", amount: 30001 } };
    const normal = pcCostSchedule(item), sale = pcSaleSchedule(item);
    assert.equal(sale.accounted, item.purchasePrice);
    assert.equal(sale.remaining, 0);
    assert.equal(sale.adjustment, -1);
    assert.equal(normal.monthly * 119 + normal.finalMonthly + sale.monthly * 11 + sale.finalMonthly, item.purchasePrice - item.sale.amount);
  }
});

test("positive and negative balances reconcile to purchase minus proceeds, with final-month adjustment", () => {
  for (const amount of [0, 30000, 72000, 84000, 400001]) {
    const item = { ...base, sale: { ...record, amount } };
    const s = pcSaleSchedule(item);
    assert.equal(s.elapsed, 48);
    assert.equal(s.months, 72);
    assert.equal(s.remaining, 72000);
    assert.equal(s.accounted + s.monthly * 71 + s.finalMonthly, base.purchasePrice - amount);
    assert.equal(pcSaleMonthlyCostAt(item, date("2026-10-25")), null);
    assert.equal(pcSaleMonthlyCostAt(item, date(record.date)), s.monthly);
    assert.equal(pcSaleMonthlyCostAt(item, date("2032-09-26")), s.finalMonthly);
    assert.equal(pcSaleMonthlyCostAt(item, date("2032-10-25")), 0);
    assert.equal(pcSaleMonthlyCostAt(item, date("2032-10-26")), 0);
  }
  assert.equal(pcSaleSchedule({ ...base, sale: record }).monthly, 583);
  assert.equal(pcSaleSchedule({ ...base, sale: record }).finalMonthly, 607);
  assert.equal(pcSaleSchedule({ ...base, sale: { ...record, amount: 400001 } }).monthly, -4555);
});

test("expired plans use an explicit installment duration, and missing sales keep legacy behavior", () => {
  const item = { ...base, sale: { ...record, date: "2034-01-15", amount: 12000, months: 24 } };
  const s = pcSaleSchedule(item);
  assert.equal(s.expired, true);
  assert.equal(s.monthly, -500);
  assert.equal(pcSaleMonthlyCostAt(item, date("2034-01-14")), null);
  assert.equal(pcSaleMonthlyCostAt(item, date("2034-01-15")), -500);
  assert.equal(pcSaleMonthlyCostAt(item, date("2036-01-15")), 0);
  assert.equal(pcSaleSchedule(base), null);
  assert.equal(pcSaleMonthlyCostAt(base, new Date()), null);
});

test("month-end and leap-day sales count paid accounting periods instead of anniversaries", () => {
  const item = { ...base, purchaseDate: "2024-01-31", yearsOfUse: 1, sale: { date: "2024-02-29", amount: 0 } };
  assert.equal(pcSaleSchedule(item).elapsed, 1);
  assert.equal(pcSaleSchedule({ ...item, sale: { date: "2024-02-28", amount: 0 } }).elapsed, 1);
  const leap = pcSaleSchedule({ ...item, purchaseDate: "2024-02-29", sale: { date: "2025-02-28", amount: 12000 } });
  assert.equal(leap.expired, true);
  assert.equal(leap.end.getMonth(), 1);
  assert.equal(leap.end.getDate(), 14);
  for (let day = 1; day <= 31; day++) {
    const position = 2026 * 12 + 9 + (day - 1) / 31;
    assert.equal(dateFromMonthPosition(position).getDate(), day);
  }
});

test("sale data rejects invalid dates, negative or fractional proceeds and zero installments", () => {
  for (const sale of [{ ...record, date: "2026-02-30" }, { ...record, amount: -1 }, { ...record, amount: 0.5 }, { ...record, months: 0 }]) {
    assert.equal(normalizePcSale(sale), null);
    assert.equal(pcSaleSchedule({ ...base, sale }), null);
  }
  assert.equal(pcSaleSchedule({ ...base, sale: { ...record, date: "2020-01-01" } }), null);
});

test("cancelling a sale restores only the end date supplied by that sale", () => {
  const sold = pcSaleItemWithRecord(base, record);
  assert.equal(sold.endOfUseDate, record.date);
  assert.equal(base.endOfUseDate, "");
  assert.equal(pcSaleItemWithRecord(sold, null).endOfUseDate, "");
  const earlier = pcSaleItemWithRecord({ ...base, endOfUseDate: "2026-08-01" }, record);
  assert.equal(earlier.endOfUseDate, "2026-08-01");
  assert.equal(pcSaleItemWithRecord(earlier, null).endOfUseDate, "2026-08-01");
  const resold = pcSaleItemWithRecord(sold, { ...record, date: "2026-11-01" });
  assert.equal(resold.endOfUseDate, "2026-11-01");
  assert.equal(pcSaleItemWithRecord(resold, null).endOfUseDate, "");
  assert.equal(pcSaleItemWithRecord({ ...sold, endOfUseDate: "2026-09-01" }, null).endOfUseDate, "2026-09-01");
});

function formHarness(item = base) {
  const html = readFileSync(new URL("../pc-management/form.html", import.meta.url), "utf8");
  const nodes = new Map();
  for (const match of html.matchAll(/<[^>]+data-sale="([^"]+)"[^>]*>/g)) {
    nodes.set(match[1], { value: "", hidden: false, textContent: "", events: {}, setAttribute() {}, focus() {}, addEventListener(name, handler) { this.events[name] = handler; } });
  }
  nodes.set("#pc-sale-controls", { hidden: true });
  nodes.set("#pc-sale-result", { hidden: true });
  const localItem = { ...item };
  let dirty = 0;
  const form = { querySelector(selector) { const key = selector.startsWith("#") ? selector : selector.match(/data-sale="([^"]+)"/)[1]; assert.ok(nodes.has(key), selector); return nodes.get(key); } };
  const controller = createPcSaleForm({ form, getItem: () => localItem, setEndOfUseDate: value => { localItem.endOfUseDate = value; }, onChange: () => dirty++ });
  return { controller, nodes, localItem, dirty: () => dirty, click: name => nodes.get(name).events.click(), input: (name, value) => { nodes.get(name).value = value; nodes.get(name).events.input(); } };
}

test("sale editor confirms and removes only a draft; Update remains the only persistence boundary", () => {
  const f = formHarness();
  f.controller.setItem(null);
  assert.equal(f.nodes.get("#pc-sale-controls").hidden, true);
  f.controller.setItem(base);
  assert.equal(f.nodes.get("#pc-sale-controls").hidden, false);
  f.click("open");
  f.input("date", record.date);
  f.input("amount", "30000");
  assert.match(f.nodes.get("formula").textContent, /583/);
  assert.ok(f.controller.validationError());
  assert.equal(f.controller.getSale(), null);
  f.click("confirm");
  assert.equal(f.controller.getSale().amount, 30000);
  assert.equal(f.nodes.get("formula").hidden, true);
  assert.equal(f.localItem.endOfUseDate, record.date);
  assert.equal(f.dirty(), 1);
  assert.equal(f.controller.validationError(), null);
  f.click("open");
  f.input("amount", "80000");
  f.click("cancel");
  assert.equal(f.controller.getSale().amount, 30000);
  f.click("remove");
  assert.equal(f.controller.getSale(), null);
  assert.equal(f.localItem.endOfUseDate, "");
  assert.equal(f.dirty(), 2);
  assert.equal(f.nodes.get("#pc-sale-result").hidden, true);
  assert.equal(f.nodes.get("open").textContent, "売却");
  assert.equal(base.endOfUseDate, "");
});

test("sale editor can correct invalid expired-plan duration and validates later form edits", () => {
  const f = formHarness(); f.controller.setItem(base); f.click("open");
  f.input("date", "2034-01-15"); f.input("amount", "12000"); f.input("months", "0");
  assert.equal(f.nodes.get("months-field").hidden, false);
  assert.equal(f.nodes.get("confirm").disabled, true);
  f.input("months", "24"); f.click("confirm");
  assert.equal(f.controller.getSale().months, 24);
  f.localItem.purchaseDate = "2035-01-01";
  assert.ok(f.controller.validationError());
});

test("expired-sale formula explicitly includes the already accounted normal adjustment", () => {
  const f = formHarness({ ...base, purchasePrice: 100050 });
  f.controller.setItem({ ...base, purchasePrice: 100050 });
  f.click("open"); f.input("date", "2034-01-15"); f.input("amount", "12000");
  assert.match(f.nodes.get("formula").textContent, /834.*120.*−.*30.*最終月調整.*100,050/);
});
