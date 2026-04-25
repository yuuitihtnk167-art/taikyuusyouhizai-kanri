import {
  onAuthChanged,
  loadItem,
  saveItem,
  validateItem,
  createId,
  normalizeAdditionalCosts,
  normalizeCategory,
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORY,
  decodePcManagementModel,
  decodePcPartMemo,
  firebaseErrorMessage,
  pcManagementModelDisplayText,
  pcPartMemoDisplayText,
  registerServiceWorker,
} from "./common.js";

const authStatus = document.getElementById("auth-status");
const authError = document.getElementById("auth-error");
const toListButton = document.getElementById("to-list-button");
const form = document.getElementById("item-form");
const formPanel = document.getElementById("form-panel");
const formMode = document.getElementById("form-mode");
const formError = document.getElementById("form-error");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");

const idInput = document.getElementById("item-id");
const nameInput = document.getElementById("name");
const modelInput = document.getElementById("model");
const categoryInput = document.getElementById("category");
const purchaseDateInput = document.getElementById("purchase-date");
const purchasePriceInput = document.getElementById("purchase-price");
const yearsOfUseInput = document.getElementById("years-of-use");
const endOfUseDateInput = document.getElementById("end-of-use-date");
const addCostButton = document.getElementById("add-cost-button");
const additionalCostList = document.getElementById("additional-cost-list");

const state = {
  uid: null,
  editingId: new URLSearchParams(window.location.search).get("id"),
};

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
  purchaseDateInput.value = item.purchaseDate;
  purchasePriceInput.value = item.purchasePrice;
  yearsOfUseInput.value = item.yearsOfUse;
  endOfUseDateInput.value = item.endOfUseDate;
  updateEndedUseStyle();
  renderAdditionalCosts(item.additionalCosts);
}

populateCategorySelect();

toListButton.addEventListener("click", () => {
  window.location.href = "list.html";
});

cancelButton.addEventListener("click", () => {
  window.location.href = "list.html";
});

addCostButton.addEventListener("click", () => {
  const row = createAdditionalCostRow({ createdAt: Date.now() });
  additionalCostList.prepend(row);
  row.querySelector(".additional-cost-amount")?.focus();
});

additionalCostList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("additional-cost-delete")) return;
  target.closest(".additional-cost-row")?.remove();
  if (additionalCostList.children.length === 0) {
    additionalCostList.appendChild(createAdditionalCostRow({ createdAt: Date.now() }));
  }
});

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
    purchaseDate: purchaseDateInput.value,
    purchasePrice: Number(purchasePriceInput.value),
    yearsOfUse: Number(yearsOfUseInput.value),
    endOfUseDate: endOfUseDateInput.value,
    additionalCosts: collectAdditionalCosts(),
  };
  const validation = validateItem(item);
  if (validation) {
    formError.textContent = validation;
    return;
  }
  try {
    submitButton.disabled = true;
    await saveItem(state.uid, item);
    window.location.href = "list.html";
  } catch (error) {
    formError.textContent = firebaseErrorMessage(error, "保存に失敗しました。");
  } finally {
    submitButton.disabled = false;
  }
});

onAuthChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  state.uid = user.uid;
  authStatus.textContent = `状態: ログイン中 (${user.email ?? "メール未設定"})`;

  if (!state.editingId) {
    formMode.textContent = "現在: 新規登録";
    submitButton.textContent = "登録する";
    cancelButton.hidden = true;
    updateEndedUseStyle();
    renderAdditionalCosts([]);
    return;
  }

  formMode.textContent = "現在: 編集中";
  submitButton.textContent = "更新する";
  cancelButton.hidden = false;

  try {
    const item = await loadItem(state.uid, state.editingId);
    if (!item) {
      authError.textContent = "編集対象が見つかりません。";
      return;
    }
    fillForm(item);
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "データ取得に失敗しました。");
  }
});

registerServiceWorker();
