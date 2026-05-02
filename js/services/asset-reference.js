import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../platform/firebase.js";
import { isLocalMode, storageGetItem, storageSetItem } from "../platform/local-db.js";

const LOCAL_STORAGE_KEY = "monthlyApplianceBook.assetReferenceData";
const REFERENCE_DOC_ID = "__assetReferenceData";
const REFERENCE_SOURCE_TYPE = "assetReferenceData";
const REFERENCE_SCHEMA_TYPE = "manualAssetReference";

function userReferenceDocRef(uid) {
  return doc(db, "users", uid, "durableGoodsItems", REFERENCE_DOC_ID);
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function parseNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function normalizeReferenceItem(item) {
  const name = String(item?.name ?? item?.label ?? "").trim();
  const usefulLifeYears = parseNumber(item?.usefulLifeYears);
  const unitPrice = parseNumber(item?.unitPrice);
  if (!name || !usefulLifeYears || usefulLifeYears <= 0 || unitPrice === null || unitPrice < 0) return null;

  return {
    id: String(item?.id ?? item?.code ?? createId()),
    name,
    usefulLifeYears,
    unitPrice,
  };
}

export function normalizeAssetReferenceData(data) {
  const seenIds = new Set();
  const items = [];

  for (const rawItem of Array.isArray(data?.items) ? data.items : []) {
    const item = normalizeReferenceItem(rawItem);
    if (!item || seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    items.push(item);
  }

  items.sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return {
    source: "manual",
    updatedAt: data?.updatedAt ?? data?.importedAt ?? null,
    items,
  };
}

function localStorageValueToReferenceData(value) {
  if (!value) return normalizeAssetReferenceData(null);
  try {
    return normalizeAssetReferenceData(JSON.parse(value));
  } catch (_error) {
    return normalizeAssetReferenceData(null);
  }
}

export async function loadAssetReferenceData(uid) {
  if (isLocalMode()) {
    return localStorageValueToReferenceData(storageGetItem(LOCAL_STORAGE_KEY));
  }

  if (!uid) return normalizeAssetReferenceData(null);
  const snapshot = await getDoc(userReferenceDocRef(uid));
  if (!snapshot.exists()) return normalizeAssetReferenceData(null);
  const data = snapshot.data();
  if (data.sourceType !== REFERENCE_SOURCE_TYPE) return normalizeAssetReferenceData(null);
  return normalizeAssetReferenceData(data);
}

export async function saveAssetReferenceData(uid, data) {
  const normalizedData = normalizeAssetReferenceData({
    ...data,
    updatedAt: data?.updatedAt ?? new Date().toISOString(),
  });

  if (isLocalMode()) {
    storageSetItem(LOCAL_STORAGE_KEY, JSON.stringify(normalizedData));
    return normalizedData;
  }

  if (!uid) {
    throw new Error("参照データの保存にはログイン情報が必要です。");
  }

  await setDoc(userReferenceDocRef(uid), {
    ...normalizedData,
    sourceType: REFERENCE_SOURCE_TYPE,
    schemaType: REFERENCE_SCHEMA_TYPE,
    updatedAt: serverTimestamp(),
  });
  return normalizedData;
}

export function createAssetReferenceItem({ name, usefulLifeYears, unitPrice }) {
  const item = normalizeReferenceItem({
    id: createId(),
    name,
    usefulLifeYears,
    unitPrice,
  });
  if (!item) {
    throw new Error("項目名、耐用年数、単価を正しく入力してください。");
  }
  return item;
}
