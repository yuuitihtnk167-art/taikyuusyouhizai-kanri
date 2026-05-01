import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../../platform/firebase.js";

const PC_ITEMS_COLLECTION = "durableGoodsItems";
const SOURCE_TYPE = "pcManagement";
const DATA_VERSION = 7;
const SCHEMA_TYPE = "pcPartLifecycle";

function pcItemsCollectionRef(uid) {
  return collection(db, "users", uid, PC_ITEMS_COLLECTION);
}

function pcItemDocRef(uid, itemId) {
  return doc(db, "users", uid, PC_ITEMS_COLLECTION, itemId);
}

export async function getItems(uid) {
  const snapshot = await getDocs(pcItemsCollectionRef(uid));
  const items = [];

  snapshot.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    if (data.sourceType !== SOURCE_TYPE) return;
    if (Number(data.dataVersion ?? 0) !== DATA_VERSION) return;
    if (data.schemaType !== SCHEMA_TYPE) return;

    items.push({
      id: documentSnapshot.id,
      ...data,
    });
  });

  return items;
}

export async function saveItem(uid, item) {
  await setDoc(pcItemDocRef(uid, item.id), {
    ...item,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteItem(uid, itemId) {
  await deleteDoc(pcItemDocRef(uid, itemId));
}
