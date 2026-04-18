import {
  onAuthChanged,
  loadItem,
  saveItem,
  validateItem,
  createId,
  firebaseErrorMessage,
  registerServiceWorker,
} from "./common.js";

const authStatus = document.getElementById("auth-status");
const authError = document.getElementById("auth-error");
const toListButton = document.getElementById("to-list-button");
const form = document.getElementById("item-form");
const formMode = document.getElementById("form-mode");
const formError = document.getElementById("form-error");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");

const idInput = document.getElementById("item-id");
const nameInput = document.getElementById("name");
const modelInput = document.getElementById("model");
const purchaseDateInput = document.getElementById("purchase-date");
const purchasePriceInput = document.getElementById("purchase-price");
const yearsOfUseInput = document.getElementById("years-of-use");
const monthlyRunningCostInput = document.getElementById("monthly-running-cost");

const state = {
  uid: null,
  editingId: new URLSearchParams(window.location.search).get("id"),
};

function fillForm(item) {
  idInput.value = item.id;
  nameInput.value = item.name;
  modelInput.value = item.model;
  purchaseDateInput.value = item.purchaseDate;
  purchasePriceInput.value = item.purchasePrice;
  yearsOfUseInput.value = item.yearsOfUse;
  monthlyRunningCostInput.value = item.monthlyRunningCost;
}

toListButton.addEventListener("click", () => {
  window.location.href = "/list.html";
});

cancelButton.addEventListener("click", () => {
  window.location.href = "/list.html";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.textContent = "";

  const item = {
    id: idInput.value || createId(),
    isUpdate: Boolean(state.editingId),
    name: nameInput.value.trim(),
    model: modelInput.value.trim(),
    purchaseDate: purchaseDateInput.value,
    purchasePrice: Number(purchasePriceInput.value),
    yearsOfUse: Number(yearsOfUseInput.value),
    monthlyRunningCost: Number(monthlyRunningCostInput.value),
  };
  const validation = validateItem(item);
  if (validation) {
    formError.textContent = validation;
    return;
  }
  try {
    submitButton.disabled = true;
    await saveItem(state.uid, item);
    window.location.href = "/list.html";
  } catch (error) {
    formError.textContent = firebaseErrorMessage(error, "保存に失敗しました。");
  } finally {
    submitButton.disabled = false;
  }
});

onAuthChanged(async (user) => {
  if (!user) {
    window.location.href = "/login.html";
    return;
  }
  state.uid = user.uid;
  authStatus.textContent = `状態: ログイン中 (${user.email ?? "メール未設定"})`;

  if (!state.editingId) {
    formMode.textContent = "現在: 新規登録";
    submitButton.textContent = "登録する";
    cancelButton.hidden = true;
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
