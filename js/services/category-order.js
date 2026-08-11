import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { CATEGORY_ORDER_STORAGE_KEY, normalizeCategoryOrder } from "../common.js";
import { db } from "../platform/firebase.js";
import { isLocalMode, storageGetItem, storageSetItem } from "../platform/local-db.js";

function settingsDocRef(uid) {
  return doc(db, "users", uid, "settings", "ui");
}

export function loadCachedCategoryOrder() {
  try {
    return normalizeCategoryOrder(JSON.parse(storageGetItem(CATEGORY_ORDER_STORAGE_KEY) ?? "null"));
  } catch (_error) {
    return normalizeCategoryOrder([]);
  }
}

function cacheCategoryOrder(categoryOrder) {
  storageSetItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(categoryOrder));
}

export async function loadCategoryOrder(uid) {
  const cachedCategoryOrder = loadCachedCategoryOrder();
  if (isLocalMode() || !uid) {
    return { categoryOrder: cachedCategoryOrder, syncError: null };
  }

  try {
    const snapshot = await getDoc(settingsDocRef(uid));
    if (snapshot.exists() && Array.isArray(snapshot.data().categoryOrder)) {
      const categoryOrder = normalizeCategoryOrder(snapshot.data().categoryOrder);
      try {
        cacheCategoryOrder(categoryOrder);
      } catch (error) {
        console.warn("Category order browser cache is unavailable.", error);
      }
      return { categoryOrder, syncError: null };
    }

    await saveCategoryOrder(uid, cachedCategoryOrder);
    return { categoryOrder: cachedCategoryOrder, syncError: null };
  } catch (error) {
    return { categoryOrder: cachedCategoryOrder, syncError: error };
  }
}

export async function saveCategoryOrder(uid, value) {
  const categoryOrder = normalizeCategoryOrder(value);
  if (isLocalMode() || !uid) {
    cacheCategoryOrder(categoryOrder);
    return categoryOrder;
  }

  try {
    cacheCategoryOrder(categoryOrder);
  } catch (error) {
    console.warn("Category order browser cache is unavailable.", error);
  }

  await setDoc(settingsDocRef(uid), {
    categoryOrder,
    updatedAt: serverTimestamp(),
  });
  return categoryOrder;
}
