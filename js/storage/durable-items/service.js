import {
  CATEGORY_OPTIONS,
  DEFAULT_CATEGORY,
  createId,
  isPcManagementItem,
  normalizeAdditionalCosts,
} from "../../common.js";
import { isLocalMode } from "../../platform/local-db.js";
import * as storage from "./index.js";

const LEGACY_CATEGORY_MAP = {
  home_appliance: "living_appliance",
  tv: "audio_visual",
  washing_machine: "living_appliance",
  car: "car",
  pc: "information_device",
};

const ASSET_REFERENCE_SOURCE_TYPE = "assetReferenceData";

function normalizeCategory(value) {
  const normalizedValue = String(value ?? "");
  const mappedValue = LEGACY_CATEGORY_MAP[normalizedValue] ?? normalizedValue;
  return CATEGORY_OPTIONS.some((category) => category.value === mappedValue) ? mappedValue : DEFAULT_CATEGORY;
}

function normalizeStoredItem(item) {
  return {
    id: item.id,
    name: item.name ?? "",
    model: item.model ?? "",
    category: normalizeCategory(item.category),
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
  return sortStoredItems((await storage.getItems(uid))
    .filter((item) => item?.sourceType !== ASSET_REFERENCE_SOURCE_TYPE)
    .filter((item) => !isPcManagementItem(item))
    .map(normalizeStoredItem));
}

export async function loadItem(uid, itemId) {
  const item = await storage.getItem(uid, itemId);
  if (isPcManagementItem(item)) return null;
  return item ? normalizeStoredItem(item) : null;
}

export async function saveItem(uid, item) {
  if (!item.id) item.id = createId();

  const normalizedItem = normalizeStoredItem({
    ...item,
    id: item.id,
  });

  const existing = await storage.getItem(uid, item.id);
  if (existing?.createdAt && !normalizedItem.createdAt) {
    normalizedItem.createdAt = existing.createdAt;
  }
  if (isLocalMode()) {
    normalizedItem.createdAt = normalizedItem.createdAt ?? Date.now();
    normalizedItem.updatedAt = Date.now();
  }

  const options = {
    isUpdate: Boolean(item.isUpdate),
    clearMonthlyRunningCost: Boolean(item.isUpdate),
  };

  await storage.saveItem(uid, normalizedItem, options);
}

export async function removeItem(uid, itemId) {
  await storage.deleteItem(uid, itemId);
}
