import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../../platform/firebase.js";

export const ITEMS_COLLECTION = "durableGoodsItems";

function userItemsCollectionRef(uid) {
  return collection(db, "users", uid, ITEMS_COLLECTION);
}

function userItemDocRef(uid, itemId) {
  return doc(db, "users", uid, ITEMS_COLLECTION, itemId);
}

export async function getItems(uid) {
  const snapshot = await getDocs(userItemsCollectionRef(uid));
  const items = [];
  snapshot.forEach((documentSnapshot) => {
    items.push({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    });
  });
  return items;
}

export async function getItem(uid, itemId) {
  const snapshot = await getDoc(userItemDocRef(uid, itemId));
  if (!snapshot.exists()) return null;
  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
}

export async function saveItem(uid, item, options = {}) {
  const payload = {
    name: item.name,
    model: item.model,
    category: item.category,
    assetReferenceItemCode: item.assetReferenceItemCode,
    purchaseDate: item.purchaseDate,
    purchasePrice: item.purchasePrice,
    yearsOfUse: item.yearsOfUse,
    endOfUseDate: item.endOfUseDate,
    hideFromTimeline: Boolean(item.hideFromTimeline),
    additionalCosts: item.additionalCosts,
    updatedAt: serverTimestamp(),
  };

  if (options.clearMonthlyRunningCost) {
    payload.monthlyRunningCost = deleteField();
  }
  if (!options.isUpdate) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(userItemDocRef(uid, item.id), payload, { merge: true });
}

export async function deleteItem(uid, itemId) {
  await deleteDoc(userItemDocRef(uid, itemId));
}
