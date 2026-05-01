import {
  setIncludeUnderusedMonthlyCost,
  shouldIncludeUnderusedMonthlyCost,
} from "./services/app-settings.js";
import {
  createFirebaseLocalBackupData,
  firebaseErrorMessage,
} from "./common.js";
import {
  loadAssetReferenceData,
  parseAssetReferenceText,
  saveAssetReferenceData,
} from "./services/asset-reference.js";
import { isLocalMode } from "./platform/local-db.js";
import { onAuthChanged, registerServiceWorker } from "./services/auth.js";

const includeUnderusedMonthlyCostInput = document.getElementById("include-underused-monthly-cost");
const backButton = document.getElementById("back-button");
const firebaseLocalBackupButton = document.getElementById("firebase-local-backup-button");
const settingsStatus = document.getElementById("settings-status");
const assetReferenceTextInput = document.getElementById("asset-reference-text");
const assetReferenceImportButton = document.getElementById("asset-reference-import-button");
const assetReferenceSummary = document.getElementById("asset-reference-summary");
const assetReferenceStatus = document.getElementById("asset-reference-status");

const state = {
  uid: null,
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

function formatImportedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function updateAssetReferenceSummary(data) {
  if (!assetReferenceSummary) return;
  if (!data?.items?.length) {
    assetReferenceSummary.textContent = "未インポート";
    return;
  }

  const importedAt = formatImportedAt(data.importedAt);
  assetReferenceSummary.textContent = importedAt
    ? `${data.items.length}件インポート済み（${importedAt}）`
    : `${data.items.length}件インポート済み`;
}

function syncFirebaseLocalBackupButton() {
  if (!firebaseLocalBackupButton) return;
  firebaseLocalBackupButton.disabled = isLocalMode() || !state.uid;
}

async function syncAssetReferenceSummary() {
  try {
    updateAssetReferenceSummary(await loadAssetReferenceData(state.uid));
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

assetReferenceImportButton?.addEventListener("click", async () => {
  setAssetReferenceStatus("");

  try {
    const text = assetReferenceTextInput?.value ?? "";
    const referenceData = parseAssetReferenceText(text);
    const savedData = await saveAssetReferenceData(state.uid, referenceData);
    updateAssetReferenceSummary(savedData);
    if (assetReferenceTextInput) assetReferenceTextInput.value = "";
    setAssetReferenceStatus(`${savedData.items.length}件の参照データをインポートしました。`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "参照データのインポートに失敗しました。";
    setAssetReferenceStatus(firebaseErrorMessage(error, message));
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
