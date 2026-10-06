import { getMonthlySummarySettings, setMonthlySummarySettings } from "./app-settings.js";
import { dateMonthPosition, summaryReferenceLabel } from "./monthly-summary.js";

export function initializeMonthlySummarySettings() {
  const mode = document.getElementById("monthly-summary-mode");
  const day = document.getElementById("monthly-summary-day");
  const adjustment = document.getElementById("monthly-summary-adjustment");
  const preview = document.getElementById("monthly-summary-preview");
  const status = document.getElementById("monthly-summary-status");
  if (!mode || !day || !adjustment || !preview || !status) return;

  for (let value = 1; value <= 31; value += 1) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${value}日`;
    day.appendChild(option);
  }
  let settings = getMonthlySummarySettings();

  function render() {
    mode.value = settings.mode;
    day.value = String(settings.day);
    adjustment.value = settings.adjustToPreviousWeekday ? "previous" : "none";
    day.disabled = adjustment.disabled = settings.mode !== "monthly";
    preview.textContent = summaryReferenceLabel(dateMonthPosition(new Date()), settings);
  }

  function save() {
    const next = {
      mode: mode.value,
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
  [mode, day, adjustment].forEach((input) => input.addEventListener("change", save));
  render();
}
