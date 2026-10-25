import { getMonthlySummarySettings, setMonthlySummarySettings } from "./app-settings.js";
import { dateMonthPosition, summaryReferenceLabel } from "./monthly-summary.js?v=157";
import { getHolidayUpdate, updateHolidayData } from "./holiday-update.js?v=157";

export function initializeMonthlySummarySettings() {
  const day = document.getElementById("monthly-summary-day");
  const adjustment = document.getElementById("monthly-summary-adjustment");
  const preview = document.getElementById("monthly-summary-preview");
  const status = document.getElementById("monthly-summary-status");
  if (!day || !adjustment || !preview || !status) return;

  for (let value = 1; value <= 31; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value}日`;
    day.appendChild(option);
  }
  let settings = { ...getMonthlySummarySettings(), mode: "monthly" };

  function render() {
    day.value = String(settings.day);
    adjustment.value = settings.adjustToPreviousWeekday ? "previous" : "none";
    preview.textContent = summaryReferenceLabel(dateMonthPosition(new Date()), settings, { details: true });
  }

  function save() {
    const next = {
      mode: "monthly",
      day: Number(day.value),
      adjustToPreviousWeekday: adjustment.value === "previous",
    };
    try {
      setMonthlySummarySettings(next);
      settings = next;
      status.textContent = "設定を保存しました。";
    } catch (_error) {
      status.textContent = "設定を保存できませんでした。ブラウザの保存設定を確認してください。";
    }
    render();
  }
  [day, adjustment].forEach((input) => input.addEventListener("change", save));
  const updateButton = document.getElementById("holiday-update-button");
  const lastChecked = document.getElementById("holiday-last-checked");
  const updateStatus = document.getElementById("holiday-update-status");
  function renderLastChecked() {
    if (!lastChecked) return;
    const saved = getHolidayUpdate();
    lastChecked.textContent = saved
      ? `最終確認日：${new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(saved.checkedAt))}（取得済み：${saved.years[0]}〜${saved.years.at(-1)}年）`
      : "最終確認日：未確認";
  }
  updateButton?.addEventListener("click", async () => {
    updateButton.disabled = true;
    updateButton.textContent = "確認中…";
    updateStatus.textContent = "祝日データを確認しています。";
    try {
      const result = await updateHolidayData();
      updateStatus.textContent = result.changed ? "祝日データを更新しました。家計簿入力日と入力金額に反映されます。" : "祝日データは最新です。最終確認日を更新しました。";
      renderLastChecked();
      render();
    } catch (_error) {
      updateStatus.textContent = "更新できませんでした。通信状態とブラウザの保存設定を確認してください。現在の祝日データを使い続けます。";
    } finally {
      updateButton.disabled = false;
      updateButton.textContent = "祝日データを更新";
    }
  });
  renderLastChecked();
  render();
}
