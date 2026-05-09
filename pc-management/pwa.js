import {
  LOCAL_PC_ITEMS_STORE,
  isLocalMode,
  loadLocalRecords,
  replaceLocalRecords,
  setLocalModeEnabled,
} from "../js/platform/local-db.js";

const SOURCE_TYPE = "pcManagement";
const DATA_VERSION = 7;
const SCHEMA_TYPE = "pcPartLifecycle";
const BACKUP_APP_NAME = "pc-management";
const BACKUP_VERSION = 1;
const STANDALONE_SESSION_KEY = "pcManagement.standaloneApp";

const backupButton = document.getElementById("backup-button");
const restoreButton = document.getElementById("restore-button");
const backButton = document.getElementById("back-button");
const authError = document.getElementById("auth-error");

function enableStandaloneAppMode() {
  const params = new URLSearchParams(window.location.search);
  const isStandaloneLaunch =
    params.get("standalone") === "pc" ||
    window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  if (params.get("standalone") === "pc") {
    sessionStorage.setItem(STANDALONE_SESSION_KEY, "true");
    setLocalModeEnabled();
  }

  if (isStandaloneLaunch || sessionStorage.getItem(STANDALONE_SESSION_KEY) === "true") {
    document.body.classList.add("pc-standalone-app");
    if (backButton) backButton.hidden = true;
  }
}

function isPcManagementRecord(record) {
  return (
    record?.sourceType === SOURCE_TYPE &&
    Number(record?.dataVersion ?? 0) === DATA_VERSION &&
    record?.schemaType === SCHEMA_TYPE
  );
}

function syncBackupButtons() {
  const showBackupControls = isLocalMode();
  if (backupButton) backupButton.hidden = !showBackupControls;
  if (restoreButton) restoreButton.hidden = !showBackupControls;
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function setStatus(message) {
  if (authError) authError.textContent = message;
}

function downloadJson(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pc-management-backup-${fileTimestamp()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function createBackupData() {
  const records = await loadLocalRecords(LOCAL_PC_ITEMS_STORE);
  return {
    app: BACKUP_APP_NAME,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    pcItems: records.filter(isPcManagementRecord),
  };
}

function validateBackupData(backup) {
  if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
    throw new Error("バックアップファイルの形式が正しくありません。");
  }
  if (backup.app !== BACKUP_APP_NAME || Number(backup.version) !== BACKUP_VERSION) {
    throw new Error("パソコン管理のバックアップファイルではありません。");
  }
  if (!Array.isArray(backup.pcItems)) {
    throw new Error("バックアップファイルにパソコン管理データが含まれていません。");
  }

  for (const record of backup.pcItems) {
    if (!record?.id || !isPcManagementRecord(record)) {
      throw new Error("パソコン管理データの形式が正しくありません。");
    }
  }

  return backup.pcItems;
}

function parseBackupText(text) {
  try {
    return validateBackupData(JSON.parse(text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("バックアップファイルを読み込めません。JSON形式を確認してください。");
    }
    throw error;
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("ファイルを読み込めません。")));
    reader.readAsText(file);
  });
}

function selectBackupFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

backupButton?.addEventListener("click", async () => {
  setStatus("");
  if (!isLocalMode()) {
    setStatus("保存はローカル保存モードでのみ使用できます。");
    syncBackupButtons();
    return;
  }

  try {
    backupButton.disabled = true;
    downloadJson(await createBackupData());
  } catch (error) {
    setStatus(error?.message || "バックアップの保存に失敗しました。");
  } finally {
    backupButton.disabled = false;
  }
});

restoreButton?.addEventListener("click", async () => {
  setStatus("");
  if (!isLocalMode()) {
    setStatus("復元はローカル保存モードでのみ使用できます。");
    syncBackupButtons();
    return;
  }

  try {
    const file = await selectBackupFile();
    if (!file) return;
    const records = parseBackupText(await readFileAsText(file));
    const shouldRestore = confirm("現在のパソコン管理データをバックアップファイルの内容で上書きします。よろしいですか？");
    if (!shouldRestore) return;

    restoreButton.disabled = true;
    await replaceLocalRecords(LOCAL_PC_ITEMS_STORE, records);
    window.location.reload();
  } catch (error) {
    setStatus(error?.message || "バックアップの復元に失敗しました。");
  } finally {
    restoreButton.disabled = false;
  }
});

enableStandaloneAppMode();
syncBackupButtons();
