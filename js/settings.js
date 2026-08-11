import {
  setExcludeUnderusedMonthlyCost,
  shouldExcludeUnderusedMonthlyCost,
} from "./services/app-settings.js";
import {
  createFirebaseLocalBackupData,
  firebaseErrorMessage,
} from "./common.js";
import { isLocalMode } from "./platform/local-db.js";
import { onAuthChanged, registerServiceWorker } from "./services/auth.js";

const excludeUnderusedMonthlyCostInput = document.getElementById("exclude-underused-monthly-cost");
const backButton = document.getElementById("back-button");
const firebaseLocalBackupButton = document.getElementById("firebase-local-backup-button");
const settingsStatus = document.getElementById("settings-status");

const state = {
  uid: null,
  isBusy: false,
};

if (excludeUnderusedMonthlyCostInput instanceof HTMLInputElement) {
  excludeUnderusedMonthlyCostInput.checked = shouldExcludeUnderusedMonthlyCost();
  excludeUnderusedMonthlyCostInput.addEventListener("change", () => {
    setExcludeUnderusedMonthlyCost(excludeUnderusedMonthlyCostInput.checked);
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

function syncFirebaseLocalBackupButton() {
  if (!firebaseLocalBackupButton) return;
  firebaseLocalBackupButton.disabled = isLocalMode() || !state.uid;
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
    state.isBusy = true;
    firebaseLocalBackupButton.disabled = true;
    const backup = await createFirebaseLocalBackupData(state.uid);
    downloadBackupFile(backup, localRestoreFileName());
  } catch (error) {
    setStatus(firebaseErrorMessage(error, "ローカル保存用ファイルの作成に失敗しました。"));
  } finally {
    state.isBusy = false;
    syncFirebaseLocalBackupButton();
  }
});

function showLocalModeBackupMessage() {
  state.uid = null;
  setStatus("ローカル保存用ファイル作成は、通常ログイン時のみ使用できます。");
  syncFirebaseLocalBackupButton();
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
  });
}

registerServiceWorker();
