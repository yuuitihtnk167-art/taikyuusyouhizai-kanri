import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  doc,
  deleteField,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { auth, db } from "./platform/firebase.js";

export const ITEMS_COLLECTION = "durableGoodsItems";
export const LOCAL_DURABLE_ITEMS_STORE = "durableGoodsItems";
export const LOCAL_PC_ITEMS_STORE = "pcItems";
export const DEFAULT_CATEGORY = "other";
export const PC_MODEL_PREFIX = "[pcManagement]";
export const PC_PART_MEMO_PREFIX = "[pcPart]";
const PC_MANAGEMENT_SOURCE_TYPE = "pcManagement";
const PC_MANAGEMENT_DATA_VERSION = 7;
const PC_MANAGEMENT_SCHEMA_TYPE = "pcPartLifecycle";
const LOCAL_STORAGE_MODE_KEY = "monthlyApplianceBook.storageMode";
export const LOCAL_WARNING_DISMISSED_KEY = "monthlyApplianceBook.localWarningDismissed";
const STORAGE_MODE_LOCAL = "local";
const LOCAL_DB_NAME = "monthlyApplianceBookLocal";
const LOCAL_DB_VERSION = 1;
const LOCAL_BACKUP_APP_NAME = "月額家電簿";
const LOCAL_BACKUP_VERSION = 1;
const LOCAL_ASSET_REFERENCE_KEY = "monthlyApplianceBook.assetReferenceData";
const ASSET_REFERENCE_DOC_ID = "__assetReferenceData";
const ASSET_REFERENCE_SOURCE_TYPE = "assetReferenceData";
export const CATEGORY_OPTIONS = [
  { value: "information_device", label: "情報機器" },
  { value: "smartphone", label: "スマホ" },
  { value: "audio_visual", label: "映像・音響" },
  { value: "air_conditioning", label: "空調家電" },
  { value: "living_appliance", label: "生活家電" },
  { value: "cooking_appliance", label: "調理家電" },
  { value: "beauty_health", label: "美容・健康" },
  { value: "car", label: "自動車" },
  { value: "other", label: "その他" },
];

const LEGACY_CATEGORY_MAP = {
  home_appliance: "living_appliance",
  tv: "audio_visual",
  washing_machine: "living_appliance",
  car: "car",
  pc: "information_device",
};

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let isReloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isReloadingForUpdate) return;
    isReloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("../service-worker.js", import.meta.url), {
        scope: "../",
      });
      await registration.update();
    } catch (_error) {
      // SW registration failure is non-fatal.
    }
  });
}

export function storageGetItem(key) {
  try {
    return localStorage.getItem(key);
  } catch (_error) {
    return null;
  }
}

export function storageSetItem(key, value) {
  localStorage.setItem(key, value);
}

function storageRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch (_error) {
    // Removing the mode flag is best-effort only.
  }
}

export function isLocalMode() {
  return storageGetItem(LOCAL_STORAGE_MODE_KEY) === STORAGE_MODE_LOCAL;
}

export function exitLocalMode() {
  storageRemoveItem(LOCAL_STORAGE_MODE_KEY);
}

export function isIndexedDbSupported() {
  return typeof indexedDB !== "undefined";
}

function indexedDbUnavailableError() {
  return new Error("このブラウザではローカル保存を利用できません。通常ログインを使用してください。");
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? indexedDbUnavailableError()));
  });
}

function createLocalStores(database) {
  for (const storeName of [LOCAL_DURABLE_ITEMS_STORE, LOCAL_PC_ITEMS_STORE]) {
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName, { keyPath: "id" });
    }
  }
}

function openLocalDatabase() {
  if (!isIndexedDbSupported()) {
    return Promise.reject(indexedDbUnavailableError());
  }

  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.addEventListener("upgradeneeded", () => createLocalStores(request.result));
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? indexedDbUnavailableError()));
  });
}

export async function ensureLocalStorageReady() {
  const database = await openLocalDatabase();
  database.close();
}

export async function enterLocalMode() {
  await ensureLocalStorageReady();
  if (auth.currentUser) {
    await signOut(auth);
  }
  storageSetItem(LOCAL_STORAGE_MODE_KEY, STORAGE_MODE_LOCAL);
}

async function withLocalStore(storeName, mode, callback) {
  const database = await openLocalDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      let callbackResult;

      transaction.addEventListener("complete", () => resolve(callbackResult));
      transaction.addEventListener("error", () => reject(transaction.error ?? indexedDbUnavailableError()));
      transaction.addEventListener("abort", () => reject(transaction.error ?? indexedDbUnavailableError()));

      try {
        callbackResult = callback(store);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    });
  } finally {
    database.close();
  }
}

export async function loadLocalRecords(storeName) {
  return withLocalStore(storeName, "readonly", (store) => requestToPromise(store.getAll()));
}

export async function loadLocalRecord(storeName, recordId) {
  return withLocalStore(storeName, "readonly", (store) => requestToPromise(store.get(recordId)));
}

export async function saveLocalRecord(storeName, record) {
  if (!record?.id) {
    throw new Error("ローカル保存するデータのIDがありません。");
  }
  await withLocalStore(storeName, "readwrite", (store) => {
    store.put(record);
  });
}

export async function removeLocalRecord(storeName, recordId) {
  await withLocalStore(storeName, "readwrite", (store) => {
    store.delete(recordId);
  });
}

export async function replaceLocalRecords(storeName, records) {
  await withLocalStore(storeName, "readwrite", (store) => {
    store.clear();
    for (const record of records) {
      store.put(record);
    }
  });
}

export async function createLocalBackupData() {
  const durableGoodsItems = normalizeBackupDurableGoodsItems(
    await loadLocalRecords(LOCAL_DURABLE_ITEMS_STORE)
  );
  const pcItems = normalizeBackupPcItems(
    await loadLocalRecords(LOCAL_PC_ITEMS_STORE)
  );

  return {
    app: LOCAL_BACKUP_APP_NAME,
    version: LOCAL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    durableGoodsItems,
    pcItems,
    assetReferenceData: loadLocalAssetReferenceBackupData(),
  };
}

function normalizeBackupDurableGoodsItems(records) {
  return sortStoredItems(
    (Array.isArray(records) ? records : [])
      .filter((record) => record?.sourceType !== ASSET_REFERENCE_SOURCE_TYPE)
      .filter((record) => !isPcManagementItem(record))
      .filter((record) => !isLegacyPcManagementItem(record))
      .map(normalizeStoredItem)
  );
}

function normalizeBackupPcItems(records) {
  return (Array.isArray(records) ? records : [])
    .map(toBackupValue)
    .filter(isPcManagementStorageRecord)
    .map((item) => ({
      ...item,
      hideFromTimeline: Boolean(item.hideFromTimeline),
      excludeFromSummary: Boolean(item.excludeFromSummary),
    }));
}

function toBackupValue(value) {
  if (!value) return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (Array.isArray(value)) return value.map(toBackupValue);
  if (typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [key, toBackupValue(entryValue)])
  );
}

function userReferenceDocRef(uid) {
  return doc(db, "users", uid, ITEMS_COLLECTION, ASSET_REFERENCE_DOC_ID);
}

function normalizeAssetReferenceBackupData(value) {
  if (!value) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("参照データのバックアップ形式が正しくありません。");
  }
  if (!Array.isArray(value.items)) {
    throw new Error("参照データのバックアップに品目一覧が含まれていません。");
  }
  const items = value.items
    .map((item) => {
      const name = String(item?.name ?? item?.label ?? "").trim();
      const usefulLifeYears = Number(String(item?.usefulLifeYears ?? "").replaceAll(",", ""));
      const unitPrice = Number(String(item?.unitPrice ?? "").replaceAll(",", ""));
      if (!name || !Number.isFinite(usefulLifeYears) || usefulLifeYears <= 0) return null;
      if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
      return {
        id: String(item?.id ?? item?.code ?? createId()),
        name,
        usefulLifeYears,
        unitPrice,
      };
    })
    .filter(Boolean);
  return {
    source: "manual",
    updatedAt: value.updatedAt ?? value.importedAt ?? null,
    items,
  };
}

function loadLocalAssetReferenceBackupData() {
  const value = storageGetItem(LOCAL_ASSET_REFERENCE_KEY);
  if (!value) return null;
  try {
    return normalizeAssetReferenceBackupData(JSON.parse(value));
  } catch (_error) {
    return null;
  }
}

async function loadFirebaseAssetReferenceBackupData(uid) {
  const snapshot = await getDoc(userReferenceDocRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.sourceType !== ASSET_REFERENCE_SOURCE_TYPE) return null;
  return normalizeAssetReferenceBackupData(toBackupValue(data));
}

function restoreLocalAssetReferenceBackupData(backup) {
  if (!Object.hasOwn(backup, "assetReferenceData")) return;
  if (!backup.assetReferenceData) {
    storageRemoveItem(LOCAL_ASSET_REFERENCE_KEY);
    return;
  }
  storageSetItem(
    LOCAL_ASSET_REFERENCE_KEY,
    JSON.stringify(normalizeAssetReferenceBackupData(backup.assetReferenceData))
  );
}

export async function createFirebaseLocalBackupData(uid) {
  if (!uid) {
    throw new Error("Firebaseデータの取得に必要なユーザー情報がありません。");
  }

  const snapshot = await getDocs(userItemsCollectionRef(uid));
  const durableGoodsItems = [];
  const pcItems = [];

  snapshot.forEach((documentSnapshot) => {
    const record = toBackupValue({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    });

    if (isPcManagementStorageRecord(record)) {
      pcItems.push(record);
      return;
    }
    if (record.sourceType === ASSET_REFERENCE_SOURCE_TYPE) return;
    if (isPcManagementItem(record)) return;

    durableGoodsItems.push(normalizeStoredItem(record));
  });

  return {
    app: LOCAL_BACKUP_APP_NAME,
    version: LOCAL_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    durableGoodsItems: sortStoredItems(durableGoodsItems),
    pcItems,
    assetReferenceData: await loadFirebaseAssetReferenceBackupData(uid),
  };
}

function validateBackupRecordIds(records, label) {
  for (const record of records) {
    if (!record || typeof record !== "object" || !record.id) {
      throw new Error(`${label}のバックアップ形式が正しくありません。`);
    }
  }
}

export function parseLocalBackupText(text) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch (_error) {
    throw new Error("バックアップファイルを読み込めません。JSON形式を確認してください。");
  }

  if (!backup || typeof backup !== "object") {
    throw new Error("バックアップファイルの形式が正しくありません。");
  }
  if (backup.app !== LOCAL_BACKUP_APP_NAME || Number(backup.version) !== LOCAL_BACKUP_VERSION) {
    throw new Error("このアプリのバックアップファイルではないか、対応していないバージョンです。");
  }
  if (!Array.isArray(backup.durableGoodsItems) || !Array.isArray(backup.pcItems)) {
    throw new Error("バックアップファイルに必要なデータが含まれていません。");
  }

  validateBackupRecordIds(backup.durableGoodsItems, "通常家電");
  validateBackupRecordIds(backup.pcItems, "パソコン管理");
  if (Object.hasOwn(backup, "assetReferenceData")) {
    normalizeAssetReferenceBackupData(backup.assetReferenceData);
  }
  return {
    ...backup,
    durableGoodsItems: normalizeBackupDurableGoodsItems(backup.durableGoodsItems),
    pcItems: normalizeBackupPcItems(backup.pcItems),
  };
}

export async function restoreLocalBackupData(backup) {
  await replaceLocalRecords(LOCAL_DURABLE_ITEMS_STORE, backup.durableGoodsItems);
  await replaceLocalRecords(LOCAL_PC_ITEMS_STORE, backup.pcItems);
  restoreLocalAssetReferenceBackupData(backup);
}

export function onAuthChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function logout() {
  if (isLocalMode()) {
    exitLocalMode();
    return null;
  }
  return signOut(auth);
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function normalizeCategory(value) {
  const normalizedValue = String(value ?? "");
  const mappedValue = LEGACY_CATEGORY_MAP[normalizedValue] ?? normalizedValue;
  return CATEGORY_OPTIONS.some((category) => category.value === mappedValue) ? mappedValue : DEFAULT_CATEGORY;
}

export function getCategoryLabel(value) {
  const normalizedValue = normalizeCategory(value);
  return CATEGORY_OPTIONS.find((category) => category.value === normalizedValue)?.label ?? "その他";
}

export function decodePcPartMemo(value) {
  return parsePrefixedJson(value, PC_PART_MEMO_PREFIX);
}

export function decodePcManagementModel(value) {
  return parsePrefixedJson(value, PC_MODEL_PREFIX);
}

export function isPcManagementItem(item) {
  return item?.sourceType === PC_MANAGEMENT_SOURCE_TYPE || isLegacyPcManagementItem(item);
}

export function isLegacyPcManagementItem(item) {
  return String(item?.model ?? "").startsWith(PC_MODEL_PREFIX);
}

function isPcManagementStorageRecord(item) {
  return (
    item?.sourceType === PC_MANAGEMENT_SOURCE_TYPE &&
    Number(item?.dataVersion ?? 0) === PC_MANAGEMENT_DATA_VERSION &&
    item?.schemaType === PC_MANAGEMENT_SCHEMA_TYPE
  );
}

function parsePrefixedJson(value, prefix) {
  const text = String(value ?? "");
  if (!text.startsWith(prefix)) return null;
  const jsonText = text.slice(prefix.length);
  try {
    return JSON.parse(jsonText);
  } catch (_error) {
    try {
      return JSON.parse(jsonText.replace(/("[^"]+"\s*:\s*"[^"]*")\.(\s*"[^"]+"\s*:)/g, "$1,$2"));
    } catch (_fallbackError) {
      return null;
    }
  }
}

export function pcPartMemoDisplayText(value) {
  const decoded = decodePcPartMemo(value);
  if (!decoded) return String(value ?? "");
  const partName = String(decoded.partName ?? "").trim();
  const memo = String(decoded.memo ?? "").trim();
  if (partName && memo) return `${partName} / ${memo}`;
  return partName || memo || "PCパーツ";
}

export function pcManagementModelDisplayText(value) {
  const decoded = decodePcManagementModel(value);
  if (!decoded) return String(value ?? "");
  const itemName = String(decoded.itemName ?? "").trim();
  return itemName ? `PC管理データ（${itemName}）` : "PC管理データ";
}

export function calculateMonthlyCost(item) {
  return item.purchasePrice / (item.yearsOfUse * 12);
}

export function normalizeAdditionalCosts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((cost) => ({
    id: cost?.id || createId(),
    amount: Number(cost?.amount ?? 0),
    memo: String(cost?.memo ?? ""),
    createdAt: Number.isFinite(Number(cost?.createdAt)) ? Number(cost.createdAt) : null,
  }));
}

export function calculateAdditionalCostTotal(item) {
  return normalizeAdditionalCosts(item.additionalCosts).reduce((total, cost) => {
    if (!Number.isFinite(cost.amount)) return total;
    return total + cost.amount;
  }, 0);
}

export function calculateMonthlyCostWithAdditionalCosts(item) {
  return (item.purchasePrice + calculateAdditionalCostTotal(item)) / (item.yearsOfUse * 12);
}

export function calculateUsageMonths(purchaseDate, endOfUseDate) {
  if (!purchaseDate || !endOfUseDate) return null;
  const startDate = new Date(`${purchaseDate}T00:00:00`);
  const endDate = new Date(`${endOfUseDate}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (endDate < startDate) return 0;

  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  return Math.max(months, 1);
}

export function calculateActualMonthlyCost(item) {
  const usageMonths = calculateUsageMonths(item.purchaseDate, item.endOfUseDate);
  if (!usageMonths) return null;
  return (item.purchasePrice + calculateAdditionalCostTotal(item)) / usageMonths;
}

export function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function userItemsCollectionRef(uid) {
  return collection(db, "users", uid, ITEMS_COLLECTION);
}

function userItemDocRef(uid, itemId) {
  return doc(db, "users", uid, ITEMS_COLLECTION, itemId);
}

function normalizeStoredItem(item) {
  return {
    id: item.id,
    name: item.name ?? "",
    model: item.model ?? "",
    category: normalizeCategory(item.category),
    assetReferenceItemId: String(item.assetReferenceItemId ?? item.assetReferenceItemCode ?? ""),
    assetReferenceItemCode: String(item.assetReferenceItemCode ?? ""),
    sourceType: item.sourceType ?? "",
    purchaseDate: item.purchaseDate ?? "",
    purchasePrice: Number(item.purchasePrice ?? 0),
    yearsOfUse: Number(item.yearsOfUse ?? 0),
    endOfUseDate: item.endOfUseDate ?? "",
    hideFromTimeline: Boolean(item.hideFromTimeline),
    excludeFromSummary: Boolean(item.excludeFromSummary),
    additionalCosts: normalizeAdditionalCosts(item.additionalCosts),
    createdAt: item.createdAt ?? null,
    updatedAt: item.updatedAt ?? null,
  };
}

function sortStoredItems(items) {
  items.sort((a, b) => {
    const dateCompare = String(b.purchaseDate).localeCompare(String(a.purchaseDate));
    if (dateCompare !== 0) return dateCompare;
    const bUpdatedAt = Number(b.updatedAt?.seconds ?? b.updatedAt ?? 0);
    const aUpdatedAt = Number(a.updatedAt?.seconds ?? a.updatedAt ?? 0);
    return bUpdatedAt - aUpdatedAt;
  });
  return items;
}

export async function loadItems(uid) {
  if (isLocalMode()) {
    return sortStoredItems((await loadLocalRecords(LOCAL_DURABLE_ITEMS_STORE))
      .filter((item) => item?.sourceType !== ASSET_REFERENCE_SOURCE_TYPE)
      .filter((item) => !isPcManagementItem(item))
      .map(normalizeStoredItem));
  }

  const snapshot = await getDocs(userItemsCollectionRef(uid));
  const items = [];
  snapshot.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    if (data.sourceType === ASSET_REFERENCE_SOURCE_TYPE) return;
    if (isPcManagementItem(data)) return;
    items.push(normalizeStoredItem({
      id: documentSnapshot.id,
      ...data,
    }));
  });
  return sortStoredItems(items);
}

export async function loadItem(uid, itemId) {
  if (isLocalMode()) {
    const item = await loadLocalRecord(LOCAL_DURABLE_ITEMS_STORE, itemId);
    return item ? normalizeStoredItem(item) : null;
  }

  const snapshot = await getDoc(userItemDocRef(uid, itemId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return normalizeStoredItem({
    id: snapshot.id,
    ...data,
  });
}

export async function saveItem(uid, item) {
  if (isLocalMode()) {
    if (!item.id) item.id = createId();
    const existing = await loadLocalRecord(LOCAL_DURABLE_ITEMS_STORE, item.id);
    await saveLocalRecord(LOCAL_DURABLE_ITEMS_STORE, normalizeStoredItem({
      ...existing,
      id: item.id,
      name: item.name,
      model: item.model,
      category: item.category,
      assetReferenceItemId: item.assetReferenceItemId,
      assetReferenceItemCode: item.assetReferenceItemCode,
      purchaseDate: item.purchaseDate,
      purchasePrice: item.purchasePrice,
      yearsOfUse: item.yearsOfUse,
      endOfUseDate: item.endOfUseDate,
      hideFromTimeline: Boolean(item.hideFromTimeline),
      excludeFromSummary: Boolean(item.excludeFromSummary),
      additionalCosts: normalizeAdditionalCosts(item.additionalCosts),
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    }));
    return;
  }

  const payload = {
    name: item.name,
    model: item.model,
    category: normalizeCategory(item.category),
    assetReferenceItemId: String(item.assetReferenceItemId ?? ""),
    assetReferenceItemCode: String(item.assetReferenceItemCode ?? ""),
    purchaseDate: item.purchaseDate,
    purchasePrice: item.purchasePrice,
    yearsOfUse: item.yearsOfUse,
    endOfUseDate: item.endOfUseDate,
    hideFromTimeline: Boolean(item.hideFromTimeline),
    excludeFromSummary: Boolean(item.excludeFromSummary),
    additionalCosts: normalizeAdditionalCosts(item.additionalCosts),
    updatedAt: serverTimestamp(),
  };
  if (item.isUpdate) payload.monthlyRunningCost = deleteField();
  if (!item.id) item.id = createId();
  if (!item.isUpdate) payload.createdAt = serverTimestamp();
  await setDoc(userItemDocRef(uid, item.id), payload, { merge: true });
}

export async function removeItem(uid, itemId) {
  if (isLocalMode()) {
    await removeLocalRecord(LOCAL_DURABLE_ITEMS_STORE, itemId);
    return;
  }

  await deleteDoc(userItemDocRef(uid, itemId));
}

export function validateItem(item) {
  if (!item.name.trim()) return "商品名を入力してください。";
  if (!item.model.trim()) return "型番を入力してください。";
  if (normalizeCategory(item.category) !== item.category) return "分類を選択してください。";
  if (!item.purchaseDate) return "購入日を入力してください。";
  if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) return "購入価格は0以上で入力してください。";
  if (!Number.isFinite(item.yearsOfUse) || item.yearsOfUse <= 0) return "使用年数は1以上で入力してください。";
  if (item.endOfUseDate && calculateUsageMonths(item.purchaseDate, item.endOfUseDate) === 0) {
    return "使用終了日は購入日以降の日付を入力してください。";
  }
  for (const cost of normalizeAdditionalCosts(item.additionalCosts)) {
    if (!Number.isFinite(cost.amount) || cost.amount < 0) {
      return "追加費用の金額は0以上で入力してください。";
    }
  }
  return null;
}

export function firebaseErrorMessage(error, fallback) {
  const code = typeof error === "object" && error && "code" in error ? error.code : "";
  if (code === "permission-denied") return "権限エラー（permission-denied）です。Firestoreルールを確認してください。";
  if (code === "auth/invalid-credential") return "メールアドレスまたはパスワードが正しくありません。";
  if (code === "auth/email-already-in-use") return "そのメールアドレスは既に登録されています。";
  if (code === "auth/weak-password") return "パスワードは6文字以上で入力してください。";
  if (code === "auth/invalid-email") return "メールアドレスの形式が正しくありません。";
  if (code === "auth/email-not-found") return "Googleアカウントのメールアドレスを取得できませんでした。";
  if (code === "auth/user-not-allowed") return "このアカウントは許可されていません";
  if (code === "auth/account-exists-with-different-credential") return "このメールアドレスは既に別の方法で登録されています。管理者に確認してください。";
  if (code === "auth/popup-closed-by-user") return "ログインをキャンセルしました。";
  if (code === "auth/network-request-failed") return "ネットワークを確認してください。";
  if (code === "unavailable") return "Firebase接続エラー（unavailable）です。ネットワークを確認してください。";
  return fallback;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
