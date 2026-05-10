import {
  validateItem,
  createId,
  normalizeAdditionalCosts,
  normalizeCategory,
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORY,
  decodePcManagementModel,
  decodePcPartMemo,
  firebaseErrorMessage,
  formatCurrency,
  pcManagementModelDisplayText,
  pcPartMemoDisplayText,
} from "./common.js";
import { isLocalMode } from "./platform/local-db.js";
import { onAuthChanged, registerServiceWorker } from "./services/auth.js";
import {
  loadAssetReferenceData,
} from "./services/asset-reference.js";
import { loadItem, saveItem } from "./storage/durable-items/service.js";

const EDITING_ITEM_ID_KEY = "monthlyApplianceBook.editingItemId";
const HIDDEN_TIMELINE_NOTICE_MESSAGE = "非表示でも使用年数が未達の場合は加算されます。";

const authError = document.getElementById("auth-error");
const toListButton = document.getElementById("to-list-button");
const form = document.getElementById("item-form");
const formPanel = document.getElementById("form-panel");
const formError = document.getElementById("form-error");
const submitButton = document.getElementById("submit-button");

const idInput = document.getElementById("item-id");
const nameInput = document.getElementById("name");
const modelInput = document.getElementById("model");
const categoryInput = document.getElementById("category");
const assetReferenceItemInput = document.getElementById("asset-reference-item");
const purchaseDateInput = document.getElementById("purchase-date");
const purchasePriceInput = document.getElementById("purchase-price");
const yearsOfUseInput = document.getElementById("years-of-use");
const unitPriceReference = document.getElementById("unit-price-reference");
const usefulLifeReference = document.getElementById("useful-life-reference");
const endOfUseDateInput = document.getElementById("end-of-use-date");
const hideFromTimelineInput = document.getElementById("hide-from-timeline");
const addCostButton = document.getElementById("add-cost-button");
const additionalCostList = document.getElementById("additional-cost-list");
const calculationTotal = document.getElementById("calculation-total");
const calculationMonthlyCost = document.getElementById("calculation-monthly-cost");

function sessionStorageGetItem(key) {
  try {
    return sessionStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

function sessionStorageSetItem(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (_error) {
    // Session storage is best-effort only.
  }
}

function sessionStorageRemoveItem(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (_error) {
    // Session storage is best-effort only.
  }
}

function shouldShowHiddenTimelineNotice(item) {
  return Boolean(item.hideFromTimeline);
}

function showHiddenTimelineNoticeDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "item-name-dialog";
    dialog.innerHTML = `
      <article class="item-name-dialog-card">
        <p class="dialog-item-meta">${HIDDEN_TIMELINE_NOTICE_MESSAGE}</p>
        <div class="dialog-actions">
          <button type="button" class="primary-button">OK</button>
        </div>
      </article>
    `;

    const closeButton = dialog.querySelector("button");
    const closeDialog = () => {
      dialog.close();
    };

    closeButton.addEventListener("click", closeDialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    }, { once: true });

    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    closeButton.focus();
  });
}

const state = {
  uid: null,
  editingId: new URLSearchParams(window.location.search).get("id") || sessionStorageGetItem(EDITING_ITEM_ID_KEY),
  assetReferenceData: null,
  excludeFromSummary: false,
  isDirty: false,
  isBusy: false,
};

function updateAssetReferenceDisplay() {
  if (!unitPriceReference || !usefulLifeReference) return;
  const selectedItemId = assetReferenceItemInput?.value ?? "";
  const item = state.assetReferenceData?.items?.find((entry) => entry.id === selectedItemId);

  if (!item) {
    unitPriceReference.textContent = "";
    usefulLifeReference.textContent = "";
    return;
  }

  unitPriceReference.textContent = `参考単価: ${formatCurrency(item.unitPrice)}`;
  usefulLifeReference.textContent = `耐用年数: ${item.usefulLifeYears}年`;
}

function populateAssetReferenceSelect() {
  if (!assetReferenceItemInput) return;

  const currentValue = assetReferenceItemInput.value;
  assetReferenceItemInput.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "なし";
  assetReferenceItemInput.appendChild(emptyOption);

  for (const item of state.assetReferenceData?.items ?? []) {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    assetReferenceItemInput.appendChild(option);
  }

  assetReferenceItemInput.value = [...assetReferenceItemInput.options].some((option) => option.value === currentValue)
    ? currentValue
    : "";
  updateAssetReferenceDisplay();
}

function populateCategorySelect() {
  categoryInput.innerHTML = "";
  for (const category of CATEGORY_OPTIONS) {
    const option = document.createElement("option");
    option.value = category.value;
    option.textContent = category.label;
    categoryInput.appendChild(option);
  }
  categoryInput.value = DEFAULT_CATEGORY;
}

function updateEndedUseStyle() {
  formPanel.classList.toggle("ended-use", Boolean(endOfUseDateInput.value));
}

function formatMonthlyCost(value) {
  return `${formatCurrency(value)} /月`;
}

function parseCurrencyInputValue(value) {
  const normalizedValue = String(value ?? "").replaceAll(",", "").trim();
  const amount = Number(normalizedValue);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function calculateAdditionalCostInputTotal() {
  const rows = additionalCostList.querySelectorAll(".additional-cost-row");
  return [...rows].reduce((total, row) => {
    const amountInput = row.querySelector(".additional-cost-amount");
    if (!(amountInput instanceof HTMLInputElement)) return total;
    return total + parseCurrencyInputValue(amountInput.value);
  }, 0);
}

function updateCalculationResult() {
  const purchasePrice = parseCurrencyInputValue(purchasePriceInput.value);
  const yearsOfUse = Number(yearsOfUseInput.value);
  const total = purchasePrice + calculateAdditionalCostInputTotal();
  const monthlyCost = Number.isFinite(yearsOfUse) && yearsOfUse > 0 ? total / (yearsOfUse * 12) : 0;

  calculationTotal.textContent = formatCurrency(total);
  calculationMonthlyCost.textContent = formatMonthlyCost(monthlyCost);
}

function createAdditionalCostRow(cost = {}) {
  const row = document.createElement("div");
  row.className = "additional-cost-row";
  row.dataset.id = cost.id || createId();
  if (Number.isFinite(Number(cost.createdAt))) {
    row.dataset.createdAt = String(cost.createdAt);
  }

  const amountInput = document.createElement("input");
  amountInput.className = "additional-cost-amount";
  amountInput.type = "number";
  amountInput.inputMode = "numeric";
  amountInput.min = "0";
  amountInput.step = "1";
  amountInput.placeholder = "金額";
  amountInput.value = cost.amount ?? "";
  amountInput.setAttribute("aria-label", "追加費用の金額");

  const memoInput = document.createElement("input");
  memoInput.className = "additional-cost-memo";
  memoInput.type = "text";
  memoInput.autocomplete = "off";
  memoInput.placeholder = "メモ";
  memoInput.value = pcPartMemoDisplayText(cost.memo);
  memoInput.setAttribute("aria-label", "追加費用のメモ");
  if (decodePcPartMemo(cost.memo)) {
    row.dataset.encodedMemo = cost.memo;
    memoInput.readOnly = true;
    memoInput.title = "PC管理のパーツ情報です。編集はパソコン管理画面で行ってください。";
  }

  const deleteButton = document.createElement("button");
  deleteButton.className = "danger-button small-button additional-cost-delete";
  deleteButton.type = "button";
  deleteButton.textContent = "削除";

  row.append(amountInput, memoInput, deleteButton);
  return row;
}

function sortAdditionalCostsForDisplay(costs) {
  return normalizeAdditionalCosts(costs)
    .map((cost, index) => ({ ...cost, index }))
    .sort((a, b) => {
      const aCreatedAt = Number(a.createdAt ?? 0);
      const bCreatedAt = Number(b.createdAt ?? 0);
      if (aCreatedAt || bCreatedAt) return bCreatedAt - aCreatedAt;
      return b.index - a.index;
    });
}

function renderAdditionalCosts(costs) {
  additionalCostList.innerHTML = "";
  for (const cost of sortAdditionalCostsForDisplay(costs)) {
    additionalCostList.appendChild(createAdditionalCostRow(cost));
  }
  if (additionalCostList.children.length === 0) {
    additionalCostList.appendChild(createAdditionalCostRow({ createdAt: Date.now() }));
  }
  updateCalculationResult();
}

function collectAdditionalCosts() {
  const costs = [];
  const rows = additionalCostList.querySelectorAll(".additional-cost-row");
  for (const row of rows) {
    const amountInput = row.querySelector(".additional-cost-amount");
    const memoInput = row.querySelector(".additional-cost-memo");
    if (!(amountInput instanceof HTMLInputElement) || !(memoInput instanceof HTMLInputElement)) continue;

    const rawAmount = amountInput.value.trim();
    const memo = row.dataset.encodedMemo || memoInput.value.trim();
    const createdAt = Number(row.dataset.createdAt);
    if (!rawAmount && !memo) continue;

    costs.push({
      id: row.dataset.id || createId(),
      amount: rawAmount ? Number(rawAmount) : Number.NaN,
      memo,
      createdAt: Number.isFinite(createdAt) ? createdAt : null,
    });
  }
  return costs;
}

function fillForm(item) {
  idInput.value = item.id;
  nameInput.value = item.name;
  if (decodePcManagementModel(item.model)) {
    modelInput.value = pcManagementModelDisplayText(item.model);
    modelInput.dataset.encodedModel = item.model;
    modelInput.readOnly = true;
    modelInput.title = "PC管理の内部データです。編集はパソコン管理画面で行ってください。";
  } else {
    modelInput.value = item.model;
    delete modelInput.dataset.encodedModel;
    modelInput.readOnly = false;
    modelInput.title = "";
  }
  categoryInput.value = normalizeCategory(item.category);
  assetReferenceItemInput.value = item.assetReferenceItemId ?? "";
  purchaseDateInput.value = item.purchaseDate;
  purchasePriceInput.value = item.purchasePrice;
  yearsOfUseInput.value = item.yearsOfUse;
  endOfUseDateInput.value = item.endOfUseDate;
  hideFromTimelineInput.checked = Boolean(item.hideFromTimeline);
  state.excludeFromSummary = Boolean(item.excludeFromSummary);
  updateEndedUseStyle();
  renderAdditionalCosts(item.additionalCosts);
  updateAssetReferenceDisplay();
}

populateCategorySelect();

toListButton.addEventListener("click", () => {
  sessionStorageRemoveItem(EDITING_ITEM_ID_KEY);
  window.location.href = "list.html";
});


addCostButton.addEventListener("click", () => {
  state.isDirty = true;
  const row = createAdditionalCostRow({ createdAt: Date.now() });
  additionalCostList.prepend(row);
  row.querySelector(".additional-cost-amount")?.focus();
  updateCalculationResult();
});

additionalCostList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("additional-cost-delete")) return;
  state.isDirty = true;
  target.closest(".additional-cost-row")?.remove();
  if (additionalCostList.children.length === 0) {
    additionalCostList.appendChild(createAdditionalCostRow({ createdAt: Date.now() }));
  }
  updateCalculationResult();
});

form.addEventListener("input", updateCalculationResult);
form.addEventListener("change", updateCalculationResult);
form.addEventListener("input", () => {
  state.isDirty = true;
});
form.addEventListener("change", () => {
  state.isDirty = true;
});
assetReferenceItemInput?.addEventListener("change", updateAssetReferenceDisplay);
purchasePriceInput.addEventListener("input", updateCalculationResult);
yearsOfUseInput.addEventListener("input", updateCalculationResult);
additionalCostList.addEventListener("input", updateCalculationResult);
additionalCostList.addEventListener("change", updateCalculationResult);

endOfUseDateInput.addEventListener("input", () => {
  updateEndedUseStyle();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";

  const item = {
    id: idInput.value || createId(),
    isUpdate: Boolean(state.editingId),
    name: nameInput.value.trim(),
    model: modelInput.dataset.encodedModel || modelInput.value.trim(),
    category: categoryInput.value,
    assetReferenceItemId: assetReferenceItemInput?.value ?? "",
    assetReferenceItemCode: "",
    purchaseDate: purchaseDateInput.value,
    purchasePrice: Number(purchasePriceInput.value),
    yearsOfUse: Number(yearsOfUseInput.value),
    endOfUseDate: endOfUseDateInput.value,
    hideFromTimeline: hideFromTimelineInput.checked,
    excludeFromSummary: state.excludeFromSummary,
    additionalCosts: collectAdditionalCosts(),
  };
  const validation = validateItem(item);
  if (validation) {
    formError.textContent = validation;
    return;
  }
  try {
    state.isBusy = true;
    submitButton.disabled = true;
    await saveItem(state.uid, item);
    if (shouldShowHiddenTimelineNotice(item)) {
      await showHiddenTimelineNoticeDialog();
    }
    sessionStorageRemoveItem(EDITING_ITEM_ID_KEY);
    state.isDirty = false;
    window.location.href = "list.html";
  } catch (error) {
    formError.textContent = firebaseErrorMessage(error, "保存に失敗しました。");
  } finally {
    state.isBusy = false;
    submitButton.disabled = false;
  }
});

async function initializeForm(user) {
  if (isLocalMode()) {
    state.uid = "local";
  } else if (!user) {
    window.location.href = "login.html";
    return;
  } else {
    state.uid = user.uid;
  }

  try {
    state.assetReferenceData = await loadAssetReferenceData(state.uid);
  } catch (_error) {
    state.assetReferenceData = null;
  }
  populateAssetReferenceSelect();

  if (!state.editingId) {
    sessionStorageRemoveItem(EDITING_ITEM_ID_KEY);
    submitButton.textContent = "登録する";
    updateEndedUseStyle();
    renderAdditionalCosts([]);
    state.isDirty = false;
    return;
  }

  submitButton.textContent = "更新する";

  sessionStorageSetItem(EDITING_ITEM_ID_KEY, state.editingId);
  try {
    const item = await loadItem(state.uid, state.editingId);
    if (!item) {
      sessionStorageRemoveItem(EDITING_ITEM_ID_KEY);
      authError.textContent = "編集対象が見つかりません。";
      return;
    }
    fillForm(item);
    state.isDirty = false;
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "データ取得に失敗しました。");
  }
}

if (isLocalMode()) {
  initializeForm(null);
} else {
  onAuthChanged(initializeForm);
}

registerServiceWorker();
