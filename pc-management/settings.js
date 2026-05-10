import {
  setExcludeUnderusedMonthlyCost,
  shouldExcludeUnderusedMonthlyCost,
} from "../js/services/app-settings.js";
import { registerServiceWorker } from "../js/services/auth.js";

const excludeUnderusedMonthlyCostInput = document.getElementById("exclude-underused-monthly-cost");
const backButton = document.getElementById("back-button");

if (excludeUnderusedMonthlyCostInput instanceof HTMLInputElement) {
  excludeUnderusedMonthlyCostInput.checked = shouldExcludeUnderusedMonthlyCost();
  excludeUnderusedMonthlyCostInput.addEventListener("change", () => {
    setExcludeUnderusedMonthlyCost(excludeUnderusedMonthlyCostInput.checked);
  });
}

backButton?.addEventListener("click", () => {
  window.location.href = "index.html";
});

registerServiceWorker();
