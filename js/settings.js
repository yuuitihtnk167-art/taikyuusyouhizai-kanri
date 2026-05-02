import {
  setIncludeUnderusedMonthlyCost,
  shouldIncludeUnderusedMonthlyCost,
} from "./services/app-settings.js";
import {
  createFirebaseLocalBackupData,
  firebaseErrorMessage,
} from "./common.js";
import {
  createAssetReferenceItem,
  loadAssetReferenceData,
  saveAssetReferenceData,
} from "./services/asset-reference.js";
import { isLocalMode } from "./platform/local-db.js";
import { onAuthChanged, registerServiceWorker } from "./services/auth.js";
import {
  loadItems,
  saveItem,
} from "./storage/durable-items/service.js";

const includeUnderusedMonthlyCostInput = document.getElementById("include-underused-monthly-cost");
const backButton = document.getElementById("back-button");
const firebaseLocalBackupButton = document.getElementById("firebase-local-backup-button");
const settingsStatus = document.getElementById("settings-status");
const assetReferenceForm = document.getElementById("asset-reference-form");
const assetReferenceIdInput = document.getElementById("asset-reference-id");
const assetReferenceNameInput = document.getElementById("asset-reference-name");
const assetReferenceUsefulLifeYearsInput = document.getElementById("asset-reference-useful-life-years");
const assetReferenceUnitPriceInput = document.getElementById("asset-reference-unit-price");
const assetReferenceSaveButton = document.getElementById("asset-reference-save-button");
const assetReferenceCancelButton = document.getElementById("asset-reference-cancel-button");
const assetReferenceSummary = document.getElementById("asset-reference-summary");
const assetReferenceList = document.getElementById("asset-reference-list");
const assetReferenceStatus = document.getElementById("asset-reference-status");

const state = {
  uid: null,
  assetReferenceData: {
    items: [],
  },
};

if (includeUnderusedMonthlyCostInput instanceof HTMLInputElement) {
  includeUnderusedMonthlyCostInput.checked = shouldIncludeUnderusedMonthlyCost();
  includeUnderusedMonthlyCostInput.addEventListener("change", () => {
    setIncludeUnderusedMonthlyCost(includeUnderusedMonthlyCostInput.checked);
  });
}

backButton?.addEventListener("click", () => {
  window.location.href = "list.html";
});

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function localRestoreFileName() {
  return `月額家電簿-local-restore-${fileTimestamp()}.json`;
}

function downloadBackupFile(backup, fileName) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setStatus(message) {
  if (settingsStatus) settingsStatus.textContent = message;
}

function setAssetReferenceStatus(message) {
  if (assetReferenceStatus) assetReferenceStatus.textContent = message;
}

function updateAssetReferenceSummary(data) {
  if (!assetReferenceSummary) return;
  if (!data?.items?.length) {
    assetReferenceSummary.textContent = "未登録";
    return;
  }

  assetReferenceSummary.textContent = `${data.items.length}件登録済み`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function clearAssetReferenceForm() {
  if (!(assetReferenceForm instanceof HTMLFormElement)) return;
  assetReferenceForm.reset();
  if (assetReferenceIdInput instanceof HTMLInputElement) assetReferenceIdInput.value = "";
  if (assetReferenceSaveButton) assetReferenceSaveButton.textContent = "追加する";
  if (assetReferenceCancelButton) assetReferenceCancelButton.hidden = true;
}

function renderAssetReferenceList() {
  if (!assetReferenceList) return;
  assetReferenceList.innerHTML = "";

  const items = state.assetReferenceData.items ?? [];
  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "settings-muted-text";
    empty.textContent = "参照項目はまだ登録されていません。";
    assetReferenceList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "asset-reference-item";

    const name = document.createElement("strong");
    name.textContent = item.name;

    const usefulLife = document.createElement("span");
    usefulLife.textContent = `${item.usefulLifeYears}年`;

    const unitPrice = document.createElement("span");
    unitPrice.textContent = formatCurrency(item.unitPrice);

    const actions = document.createElement("div");
    actions.className = "asset-reference-item-actions";

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "ghost-button small-button";
    editButton.dataset.action = "edit";
    editButton.dataset.id = item.id;
    editButton.textContent = "編集";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger-button small-button";
    deleteButton.dataset.action = "delete";
    deleteButton.dataset.id = item.id;
    deleteButton.textContent = "削除";

    actions.append(editButton, deleteButton);
    row.append(name, usefulLife, unitPrice, actions);
    assetReferenceList.appendChild(row);
  }
}

function renderAssetReferenceSettings() {
  updateAssetReferenceSummary(state.assetReferenceData);
  renderAssetReferenceList();
}

function syncFirebaseLocalBackupButton() {
  if (!firebaseLocalBackupButton) return;
  firebaseLocalBackupButton.disabled = isLocalMode() || !state.uid;
}

async function syncAssetReferenceSummary() {
  try {
    state.assetReferenceData = await loadAssetReferenceData(state.uid);
    renderAssetReferenceSettings();
  } catch (error) {
    setAssetReferenceStatus(firebaseErrorMessage(error, "参照データの読み込みに失敗しました。"));
  }
}

firebaseLocalBackupButton?.addEventListener("click", async () => {
  setStatus("");

  if (isLocalMode()) {
    setStatus("ローカル保存用ファイル作成は、通常ログイン時のみ使用できます。");
    syncFirebaseLocalBackupButton();
    return;
  }

  if (!state.uid) {
    setStatus("Firebaseデータの取得に必要なログイン情報がありません。");
    syncFirebaseLocalBackupButton();
    return;
  }

  try {
    firebaseLocalBackupButton.disabled = true;
    const backup = await createFirebaseLocalBackupData(state.uid);
    downloadBackupFile(backup, localRestoreFileName());
  } catch (error) {
    setStatus(firebaseErrorMessage(error, "ローカル保存用ファイルの作成に失敗しました。"));
  } finally {
    syncFirebaseLocalBackupButton();
  }
});

assetReferenceForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setAssetReferenceStatus("");

  try {
    const editingId = assetReferenceIdInput instanceof HTMLInputElement ? assetReferenceIdInput.value : "";
    const item = createAssetReferenceItem({
      name: assetReferenceNameInput?.value ?? "",
      usefulLifeYears: assetReferenceUsefulLifeYearsInput?.value ?? "",
      unitPrice: assetReferenceUnitPriceInput?.value ?? "",
    });
    const items = [...(state.assetReferenceData.items ?? [])];
    const existingIndex = items.findIndex((currentItem) => currentItem.id === editingId);

    if (existingIndex === -1) {
      items.push(item);
    } else {
      items[existingIndex] = {
        ...item,
        id: editingId,
      };
    }

    state.assetReferenceData = await saveAssetReferenceData(state.uid, {
      ...state.assetReferenceData,
      updatedAt: new Date().toISOString(),
      items,
    });
    clearAssetReferenceForm();
    renderAssetReferenceSettings();
    setAssetReferenceStatus(existingIndex === -1 ? "参照項目を追加しました。" : "参照項目を更新しました。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "参照データの保存に失敗しました。";
    setAssetReferenceStatus(firebaseErrorMessage(error, message));
  }
});

assetReferenceCancelButton?.addEventListener("click", () => {
  clearAssetReferenceForm();
  setAssetReferenceStatus("");
});

async function resetDeletedAssetReferenceSelections(deletedItemId) {
  const items = await loadItems(state.uid);
  const affectedItems = items.filter((item) => item.assetReferenceItemId === deletedItemId);

  for (const item of affectedItems) {
    await saveItem(state.uid, {
      ...item,
      isUpdate: true,
      assetReferenceItemId: "",
      assetReferenceItemCode: "",
    });
  }

  return affectedItems.length;
}

assetReferenceList?.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest("button[data-action][data-id]");
  if (!(button instanceof HTMLButtonElement)) return;

  const item = state.assetReferenceData.items?.find((currentItem) => currentItem.id === button.dataset.id);
  if (!item) return;

  if (button.dataset.action === "edit") {
    if (assetReferenceIdInput instanceof HTMLInputElement) assetReferenceIdInput.value = item.id;
    if (assetReferenceNameInput instanceof HTMLInputElement) assetReferenceNameInput.value = item.name;
    if (assetReferenceUsefulLifeYearsInput instanceof HTMLInputElement) {
      assetReferenceUsefulLifeYearsInput.value = String(item.usefulLifeYears);
    }
    if (assetReferenceUnitPriceInput instanceof HTMLInputElement) {
      assetReferenceUnitPriceInput.value = String(item.unitPrice);
    }
    if (assetReferenceSaveButton) assetReferenceSaveButton.textContent = "更新する";
    if (assetReferenceCancelButton) assetReferenceCancelButton.hidden = false;
    assetReferenceNameInput?.focus();
    setAssetReferenceStatus("");
    return;
  }

  if (button.dataset.action !== "delete") return;

  const shouldDelete = confirm(
    `「${item.name}」を削除します。この項目を選択している通常品は「なし」に戻ります。よろしいですか？`
  );
  if (!shouldDelete) return;

  setAssetReferenceStatus("");
  try {
    button.disabled = true;
    const items = (state.assetReferenceData.items ?? []).filter((currentItem) => currentItem.id !== item.id);
    const resetCount = await resetDeletedAssetReferenceSelections(item.id);
    state.assetReferenceData = await saveAssetReferenceData(state.uid, {
      ...state.assetReferenceData,
      updatedAt: new Date().toISOString(),
      items,
    });
    clearAssetReferenceForm();
    renderAssetReferenceSettings();
    setAssetReferenceStatus(
      resetCount > 0
        ? `参照項目を削除し、${resetCount}件の通常品を「なし」に戻しました。`
        : "参照項目を削除しました。"
    );
  } catch (error) {
    setAssetReferenceStatus(firebaseErrorMessage(error, "参照項目の削除に失敗しました。"));
  } finally {
    button.disabled = false;
  }
});

function showLocalModeBackupMessage() {
  state.uid = null;
  setStatus("ローカル保存用ファイル作成は、通常ログイン時のみ使用できます。");
  syncFirebaseLocalBackupButton();
  syncAssetReferenceSummary();
}

if (isLocalMode()) {
  showLocalModeBackupMessage();
} else {
  onAuthChanged((user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    state.uid = user.uid;
    setStatus("");
    syncFirebaseLocalBackupButton();
    syncAssetReferenceSummary();
  });
}

registerServiceWorker();
