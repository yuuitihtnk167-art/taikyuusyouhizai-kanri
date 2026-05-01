export const LOCAL_DURABLE_ITEMS_STORE = "durableGoodsItems";
export const LOCAL_PC_ITEMS_STORE = "pcItems";
export const LOCAL_WARNING_DISMISSED_KEY = "monthlyApplianceBook.localWarningDismissed";

const LOCAL_STORAGE_MODE_KEY = "monthlyApplianceBook.storageMode";
const STORAGE_MODE_LOCAL = "local";
const LOCAL_DB_NAME = "monthlyApplianceBookLocal";
const LOCAL_DB_VERSION = 1;

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
  return new Error("Local storage is unavailable in this browser.");
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
    throw new Error("Local storage records require an id.");
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

export function setLocalModeEnabled() {
  storageSetItem(LOCAL_STORAGE_MODE_KEY, STORAGE_MODE_LOCAL);
}
