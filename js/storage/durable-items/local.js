import {
  LOCAL_DURABLE_ITEMS_STORE,
  loadLocalRecord,
  loadLocalRecords,
  removeLocalRecord,
  saveLocalRecord,
} from "../../platform/local-db.js";

export async function getItems() {
  return loadLocalRecords(LOCAL_DURABLE_ITEMS_STORE);
}

export async function getItem(_uid, itemId) {
  return loadLocalRecord(LOCAL_DURABLE_ITEMS_STORE, itemId);
}

export async function saveItem(_uid, item) {
  await saveLocalRecord(LOCAL_DURABLE_ITEMS_STORE, item);
}

export async function deleteItem(_uid, itemId) {
  await removeLocalRecord(LOCAL_DURABLE_ITEMS_STORE, itemId);
}
