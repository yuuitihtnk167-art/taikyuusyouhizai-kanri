import * as local from "./local.js";
import * as firestore from "./firestore.js";
import { isLocalMode } from "../../platform/local-db.js";

function activeStorage() {
  return isLocalMode() ? local : firestore;
}

export async function getItems(uid) {
  return activeStorage().getItems(uid);
}

export async function getItem(uid, itemId) {
  return activeStorage().getItem(uid, itemId);
}

export async function saveItem(uid, item, options) {
  return activeStorage().saveItem(uid, item, options);
}

export async function deleteItem(uid, itemId) {
  return activeStorage().deleteItem(uid, itemId);
}
