import {
  LOCAL_PC_ITEMS_STORE,
  loadLocalRecord,
  loadLocalRecords,
  removeLocalRecord,
  saveLocalRecord,
} from "../../platform/local-db.js";

const SOURCE_TYPE = "pcManagement";
const DATA_VERSION = 7;
const SCHEMA_TYPE = "pcPartLifecycle";

function isPcManagementStorageRecord(item) {
  return (
    item?.sourceType === SOURCE_TYPE &&
    Number(item?.dataVersion ?? 0) === DATA_VERSION &&
    item?.schemaType === SCHEMA_TYPE
  );
}

export async function getItems() {
  return (await loadLocalRecords(LOCAL_PC_ITEMS_STORE)).filter(isPcManagementStorageRecord);
}

export async function getItem(_uid, itemId) {
  const item = await loadLocalRecord(LOCAL_PC_ITEMS_STORE, itemId);
  return isPcManagementStorageRecord(item) ? item : null;
}

export async function saveItem(_uid, item) {
  await saveLocalRecord(LOCAL_PC_ITEMS_STORE, item);
}

export async function deleteItem(_uid, itemId) {
  await removeLocalRecord(LOCAL_PC_ITEMS_STORE, itemId);
}
