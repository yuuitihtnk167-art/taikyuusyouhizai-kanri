import { normalizePcSale, pcSaleSchedule, pcSaleItemWithRecord } from "../js/services/pc-sale.js?v=164";

// Confirm/cancel only edit the form draft. The existing Update button saves it.
export function createPcSaleForm({ form, getItem, setEndOfUseDate, onChange, itemLabel = "パーツ" }) {
  const controls = form.querySelector("#pc-sale-controls");
  const result = form.querySelector("#pc-sale-result");
  const find = (name) => form.querySelector(`[data-sale="${name}"]`);
  const yen = (value) => new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 }).format(Math.trunc(value) || 0);
  let record = null;
  let editing = false;
  let enabled = false;

  function draft() {
    return { date: find("date").value, amount: find("amount").value === "" ? NaN : Number(find("amount").value), months: Number(find("months").value), previousEndOfUseDate: record?.previousEndOfUseDate ?? getItem().endOfUseDate ?? "" };
  }

  function refresh() {
    controls.hidden = !enabled;
    find("entry").hidden = !editing;
    find("open").hidden = editing;
    find("remove").hidden = !record || editing;
    find("open").textContent = record ? "売却内容を変更" : "売却";
    find("open").setAttribute("aria-expanded", String(editing));
    const sale = editing ? draft() : record;
    const schedule = sale && pcSaleSchedule({ ...getItem(), sale });
    // An invalid installment input must stay visible so it can be corrected.
    const fallback = editing && pcSaleSchedule({ ...getItem(), sale: { ...sale, months: 12 } });
    find("months-field").hidden = !(schedule ?? fallback)?.expired;
    find("confirm").disabled = !schedule;
    result.hidden = !enabled || (!editing && !record);
    find("error").textContent = editing && !schedule && find("amount").value !== "" ? "売却日・売却価格（0円以上の整数）・分割月数（1〜1200）を確認してください。" : "";
    find("formula").hidden = !editing || !schedule;
    find("summary").hidden = !schedule;
    if (!schedule) return;
    const accountedAdjustment = schedule.accounted - schedule.beforeMonthly * schedule.elapsed;
    const adjustmentTerm = accountedAdjustment ? ` ${accountedAdjustment < 0 ? "−" : "＋"} ${yen(Math.abs(accountedAdjustment))}（通常分の最終月調整）` : "";
    find("formula").textContent = `計上済み：${yen(schedule.beforeMonthly)} × ${schedule.elapsed}か月${adjustmentTerm} ＝ ${yen(schedule.accounted)}\n残額：${yen(Number(getItem().purchasePrice))} − ${yen(schedule.accounted)} ＝ ${yen(schedule.remaining)}\n売却後月額：(${yen(schedule.remaining)} − ${yen(sale.amount)}) ÷ ${schedule.months}か月 → ${yen(schedule.monthly)}`;
    find("sale-price").textContent = yen(sale.amount);
    find("balance-label").textContent = schedule.balance < 0 ? "回収超過額" : "売却後の残金";
    find("balance").textContent = yen(Math.abs(schedule.balance));
    find("after").textContent = `${yen(schedule.monthly)} /月`;
    find("adjustment").textContent = yen(schedule.adjustment);
    const end = new Date(schedule.end.getFullYear(), schedule.end.getMonth(), schedule.end.getDate() - 1);
    find("period").textContent = `${sale.date}から${schedule.months}回（最終締め日 ${end.getFullYear()}/${end.getMonth() + 1}/${end.getDate()}）`;
    find("rounding").textContent = `調整分は${schedule.adjustment < 0 ? "最終月に差引" : "最終月に加算"}（最終月 ${yen(schedule.finalMonthly)} /月）。売却前の未計上の端数も含みます。`;
  }

  find("open").addEventListener("click", () => {
    editing = true;
    const now = new Date();
    find("date").value = record?.date ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    find("amount").value = record?.amount ?? "";
    find("months").value = record?.months ?? 12;
    refresh();
    find("amount").focus();
  });
  find("cancel").addEventListener("click", () => { editing = false; refresh(); });
  find("confirm").addEventListener("click", () => {
    if (!pcSaleSchedule({ ...getItem(), sale: draft() })) return;
    const item = pcSaleItemWithRecord({ ...getItem(), sale: record }, draft());
    record = item.sale;
    setEndOfUseDate(item.endOfUseDate);
    editing = false;
    refresh();
    onChange();
  });
  find("remove").addEventListener("click", () => {
    const item = pcSaleItemWithRecord({ ...getItem(), sale: record }, null);
    record = null;
    editing = false;
    setEndOfUseDate(item.endOfUseDate);
    refresh();
    onChange();
  });
  for (const name of ["date", "amount", "months"]) find(name).addEventListener("input", refresh);

  return {
    refresh,
    setItem(item) { record = normalizePcSale(item?.sale); enabled = Boolean(item?.id); editing = false; refresh(); },
    getSale() { return record ? { ...record } : null; },
    validationError() {
      if (editing) return "売却内容の「決定」または「キャンセル」を押してから更新してください。";
      if (record && !pcSaleSchedule({ ...getItem(), sale: record })) return "購入日・使用予定年数と売却内容を確認してください。";
      if (record && (!getItem().endOfUseDate || getItem().endOfUseDate > record.date)) return `売却した${itemLabel}の使用終了日は、売却日以前にしてください。`;
      return null;
    },
  };
}
