import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  db,
  onAuthChanged,
  firebaseErrorMessage,
  registerServiceWorker,
} from "../js/common.js";

const LOCAL_STORAGE_KEY = "pcManagementItems.v1";
const PC_ITEMS_COLLECTION = "durableGoodsItems";
const SOURCE_TYPE = "pcManagement";
const DATA_VERSION = 6;
const PC_MODEL_PREFIX = "[pcManagement]";
const PART_MEMO_PREFIX = "[pcPart]";

const usageLabels = {
  work: "仕事",
  game: "ゲーム",
  development: "開発",
  other: "その他",
};

const partTypeLabels = {
  cpu: "CPU",
  gpu: "GPU",
  motherboard: "マザーボード",
  memory: "メモリ",
  storage: "ストレージ",
  power_supply: "電源",
  monitor: "モニター",
  os: "OS",
  other: "その他",
};

const currentSpecTypes = [
  "cpu",
  "gpu",
  "motherboard",
  "memory",
  "storage",
  "power_supply",
  "monitor",
  "os",
];
const requiredSpecTypes = currentSpecTypes.filter((specType) => specType !== "gpu");

const elements = {
  summaryCount: document.getElementById("summary-count"),
  summaryTotal: document.getElementById("summary-total"),
  summaryMonthly: document.getElementById("summary-monthly"),
  authStatus: document.getElementById("auth-status"),
  authError: document.getElementById("auth-error"),
  form: document.getElementById("pc-form"),
  formMode: document.getElementById("form-mode"),
  formError: document.getElementById("form-error"),
  resetButton: document.getElementById("reset-button"),
  submitButton: document.getElementById("submit-button"),
  cancelButton: document.getElementById("cancel-button"),
  pcList: document.getElementById("pc-list"),
  addPartButton: document.getElementById("add-part-button"),
  partList: document.getElementById("part-list"),
  partRowTemplate: document.getElementById("part-row-template"),
  partsDialog: document.getElementById("parts-dialog"),
  partsDialogTitle: document.getElementById("parts-dialog-title"),
  partsDialogBody: document.getElementById("parts-dialog-body"),
  partsDialogClose: document.getElementById("parts-dialog-close"),
  exportButton: document.getElementById("export-button"),
  importFile: document.getElementById("import-file"),
  id: document.getElementById("pc-id"),
  itemName: document.getElementById("item-name"),
  usage: document.getElementById("usage"),
  purchaseDate: document.getElementById("purchase-date"),
  yearsOfUse: document.getElementById("years-of-use"),
};

const state = {
  uid: null,
  items: [],
  editingId: null,
};

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeUsage(value) {
  return usageLabels[value] ? value : "other";
}

function normalizePartType(value) {
  return partTypeLabels[value] ? value : "other";
}

function toMillis(value, fallback = Date.now()) {
  const timestampSeconds = Number(value?.seconds);
  if (Number.isFinite(timestampSeconds)) {
    const timestampNanoseconds = Number(value?.nanoseconds ?? 0);
    return (timestampSeconds * 1000) + Math.floor(timestampNanoseconds / 1000000);
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeLegacySpecs(value) {
  const specs = value && typeof value === "object" ? value : {};
  return {
    cpu: String(specs.cpu ?? ""),
    gpu: String(specs.gpu ?? ""),
    motherboard: String(specs.motherboard ?? ""),
    memory: String(specs.memory ?? ""),
    storage: String(specs.storage ?? ""),
    power_supply: String(specs.powerSupply ?? specs.power_supply ?? ""),
    monitor: String(specs.monitor ?? ""),
    os: String(specs.os ?? ""),
  };
}

function normalizeParts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((part) => ({
    id: part?.id || createId(),
    partType: normalizePartType(part?.partType),
    partName: String(part?.partName ?? ""),
    purchaseDate: String(part?.purchaseDate ?? ""),
    price: Number(part?.price ?? 0),
    memo: String(part?.memo ?? ""),
    createdAt: Number.isFinite(Number(part?.createdAt)) ? Number(part.createdAt) : Date.now(),
  }));
}

function parsePrefixedJson(value, prefix) {
  const text = String(value ?? "");
  if (!text.startsWith(prefix)) return null;
  try {
    return JSON.parse(text.slice(prefix.length));
  } catch (_error) {
    return null;
  }
}

function encodePcModel(item) {
  return `${PC_MODEL_PREFIX}${JSON.stringify({
    dataVersion: DATA_VERSION,
    itemName: item.itemName,
    usage: item.usage,
    specs: item.specs,
    parts: item.parts,
  })}`;
}

function decodePcModel(value) {
  return parsePrefixedJson(value, PC_MODEL_PREFIX);
}

function encodePartMemo(part) {
  return `${PART_MEMO_PREFIX}${JSON.stringify({
    partType: part.partType,
    partName: part.partName,
    purchaseDate: part.purchaseDate,
    memo: part.memo,
  })}`;
}

function decodePartsFromAdditionalCosts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((cost) => {
      const decoded = parsePrefixedJson(cost?.memo, PART_MEMO_PREFIX);
      if (!decoded) return null;
      return {
        id: cost?.id || createId(),
        partType: normalizePartType(decoded.partType),
        partName: String(decoded.partName ?? ""),
        purchaseDate: String(decoded.purchaseDate ?? ""),
        price: Number(cost?.amount ?? 0),
        memo: String(decoded.memo ?? ""),
        createdAt: Number.isFinite(Number(cost?.createdAt)) ? Number(cost.createdAt) : Date.now(),
      };
    })
    .filter(Boolean);
}

function sortParts(parts) {
  return normalizeParts(parts).sort((a, b) => {
    const dateCompare = String(b.purchaseDate).localeCompare(String(a.purchaseDate));
    if (dateCompare !== 0) return dateCompare;
    return Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0);
  });
}

function deriveCurrentSpecs(parts, legacySpecs = {}) {
  const specs = normalizeLegacySpecs(legacySpecs);
  for (const part of sortParts(parts).reverse()) {
    if (!currentSpecTypes.includes(part.partType)) continue;
    if (!part.partName.trim()) continue;
    specs[part.partType] = part.partName;
  }
  return specs;
}

function calculatePartsTotal(parts) {
  return normalizeParts(parts).reduce((total, part) => {
    if (!Number.isFinite(part.price)) return total;
    return total + part.price;
  }, 0);
}

function calculateTotalInvestment(item) {
  const partsTotal = calculatePartsTotal(item.parts);
  return item.parts.length > 0 ? partsTotal : Number(item.price ?? 0);
}

function calculateMonthlyCost(item) {
  const yearsOfUse = Number(item.yearsOfUse ?? 0);
  if (!Number.isFinite(yearsOfUse) || yearsOfUse <= 0) return 0;
  return calculateTotalInvestment(item) / (yearsOfUse * 12);
}

function normalizePcItem(value) {
  const item = value && typeof value === "object" ? value : {};
  const decodedModel = decodePcModel(item.model);
  const parts = normalizeParts(
    item.parts ??
      item.upgradeHistory ??
      decodedModel?.parts ??
      decodePartsFromAdditionalCosts(item.additionalCosts)
  );
  const legacySpecs = normalizeLegacySpecs(item.specs ?? decodedModel?.specs);
  const fallbackPrice = Number(item.price ?? item.purchasePrice ?? item.initialPurchaseCost ?? 0);
  const normalized = {
    id: item.id || createId(),
    category: "pc",
    itemName: String(item.itemName ?? decodedModel?.itemName ?? item.name ?? ""),
    usage: normalizeUsage(item.usage ?? decodedModel?.usage),
    purchaseDate: String(item.purchaseDate ?? ""),
    price: parts.length > 0 ? calculatePartsTotal(parts) : fallbackPrice,
    yearsOfUse: Number(item.yearsOfUse ?? 5),
    specs: deriveCurrentSpecs(parts, legacySpecs),
    parts,
    createdAt: toMillis(item.createdAt),
    updatedAt: toMillis(item.updatedAt),
  };
  return {
    ...normalized,
    monthlyCost: calculateMonthlyCost(normalized),
  };
}

function pcItemsCollectionRef(uid) {
  return collection(db, "users", uid, PC_ITEMS_COLLECTION);
}

function pcItemDocRef(uid, itemId) {
  return doc(db, "users", uid, PC_ITEMS_COLLECTION, itemId);
}

function toFirestorePayload(item) {
  const normalized = normalizePcItem(item);
  const totalInvestment = calculateTotalInvestment(normalized);
  return {
    sourceType: SOURCE_TYPE,
    name: normalized.itemName,
    model: encodePcModel(normalized),
    category: "pc",
    itemName: normalized.itemName,
    usage: normalized.usage,
    purchaseDate: normalized.purchaseDate,
    price: totalInvestment,
    purchasePrice: totalInvestment,
    yearsOfUse: normalized.yearsOfUse,
    monthlyCost: calculateMonthlyCost(normalized),
    specs: normalized.specs,
    parts: normalized.parts,
    endOfUseDate: "",
    additionalCosts: normalized.parts.map((part) => ({
      id: part.id,
      amount: Number(part.price ?? 0),
      memo: encodePartMemo(part),
      createdAt: Number.isFinite(Number(part.createdAt)) ? Number(part.createdAt) : Date.now(),
    })),
    createdAt: normalized.createdAt,
    updatedAt: serverTimestamp(),
  };
}

async function loadFirestoreItems(uid) {
  const snapshot = await getDocs(pcItemsCollectionRef(uid));
  const items = [];
  snapshot.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    if (data.sourceType !== SOURCE_TYPE && !decodePcModel(data.model)) return;
    items.push(normalizePcItem({
      id: documentSnapshot.id,
      ...data,
    }));
  });
  return sortItems(items);
}

async function saveFirestoreItem(uid, item) {
  const normalized = normalizePcItem(item);
  await setDoc(pcItemDocRef(uid, normalized.id), toFirestorePayload(normalized));
}

async function removeFirestoreItem(uid, itemId) {
  await deleteDoc(pcItemDocRef(uid, itemId));
}

async function replaceFirestoreItems(uid, items) {
  await Promise.all(state.items.map((item) => removeFirestoreItem(uid, item.id)));
  await Promise.all(items.map((item) => saveFirestoreItem(uid, item)));
}

function loadLocalItemsForMigration() {
  try {
    const rawValue = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    const items = Array.isArray(parsed) ? parsed : parsed.pcItems;
    return Array.isArray(items) ? items.map(normalizePcItem) : [];
  } catch (_error) {
    return [];
  }
}

function saveLocalBackupItems(items) {
  const payload = {
    dataVersion: DATA_VERSION,
    pcItems: items.map(normalizePcItem),
  };
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(payload));
}

async function migrateLocalItemsIfNeeded(uid) {
  if (state.items.length > 0) return;
  const localItems = loadLocalItemsForMigration();
  if (localItems.length === 0) return;
  const shouldMigrate = confirm("このブラウザに保存済みのPCデータがあります。Firestoreへ移行しますか？");
  if (!shouldMigrate) return;
  await Promise.all(localItems.map((item) => saveFirestoreItem(uid, item)));
  localStorage.removeItem(LOCAL_STORAGE_KEY);
  state.items = await loadFirestoreItems(uid);
  render();
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const dateCompare = String(b.purchaseDate).localeCompare(String(a.purchaseDate));
    if (dateCompare !== 0) return dateCompare;
    return Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0);
  });
}

function validatePcItem(item) {
  if (!item.itemName.trim()) return "PC名を入力してください。";
  if (!item.purchaseDate) return "組立日を入力してください。";
  if (!Number.isFinite(item.yearsOfUse) || item.yearsOfUse <= 0) {
    return "想定使用年数は1年以上で入力してください。";
  }
  if (item.parts.length === 0) return "パーツを1件以上入力してください。";

  for (const part of item.parts) {
    if (!part.partName.trim()) return "パーツ名を入力してください。";
    if (!part.purchaseDate) return "パーツの購入日を入力してください。";
    if (!Number.isFinite(part.price) || part.price < 0) {
      return "パーツ費用は0以上で入力してください。";
    }
  }

  for (const specType of requiredSpecTypes) {
    if (!item.specs[specType].trim()) {
      return `${partTypeLabels[specType]}をパーツ入力に追加してください。`;
    }
  }
  return null;
}

function createPartRow(part = {}) {
  const fragment = elements.partRowTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".part-row");
  row.dataset.id = part.id || createId();
  row.dataset.createdAt = Number.isFinite(Number(part.createdAt)) ? String(part.createdAt) : String(Date.now());
  row.querySelector(".part-type").value = normalizePartType(part.partType);
  row.querySelector(".part-purchase-date").value = part.purchaseDate ?? "";
  row.querySelector(".part-name").value = part.partName ?? "";
  row.querySelector(".part-price").value =
    Number.isFinite(Number(part.price)) && Number(part.price) >= 0 ? part.price : "";
  row.querySelector(".part-memo").value = part.memo ?? "";
  return row;
}

function renderPartRows(parts) {
  elements.partList.innerHTML = "";
  for (const part of sortParts(parts)) {
    elements.partList.appendChild(createPartRow(part));
  }
  if (elements.partList.children.length === 0) {
    elements.partList.appendChild(createPartRow({ createdAt: Date.now() }));
  }
}

function collectParts() {
  const rows = elements.partList.querySelectorAll(".part-row");
  const parts = [];
  for (const row of rows) {
    const partType = row.querySelector(".part-type").value;
    const purchaseDate = row.querySelector(".part-purchase-date").value;
    const partName = row.querySelector(".part-name").value.trim();
    const rawPrice = row.querySelector(".part-price").value.trim();
    const memo = row.querySelector(".part-memo").value.trim();
    if (!partName && !purchaseDate && !rawPrice && !memo) continue;

    parts.push({
      id: row.dataset.id || createId(),
      partType,
      partName,
      purchaseDate,
      price: rawPrice ? Number(rawPrice) : Number.NaN,
      memo,
      createdAt: Number(row.dataset.createdAt) || Date.now(),
    });
  }
  return parts;
}

function collectPcItem() {
  const existingItem = state.items.find((item) => item.id === state.editingId);
  const parts = collectParts();
  return normalizePcItem({
    id: elements.id.value || createId(),
    category: "pc",
    itemName: elements.itemName.value.trim(),
    usage: elements.usage.value,
    purchaseDate: elements.purchaseDate.value,
    yearsOfUse: Number(elements.yearsOfUse.value),
    parts,
    createdAt: existingItem?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

function resetForm() {
  state.editingId = null;
  elements.form.reset();
  elements.id.value = "";
  elements.usage.value = "work";
  elements.yearsOfUse.value = "5";
  elements.formMode.textContent = "現在: 新規登録";
  elements.submitButton.textContent = "登録する";
  elements.cancelButton.hidden = true;
  elements.formError.textContent = "";
  renderPartRows([]);
}

function fillForm(item) {
  state.editingId = item.id;
  elements.id.value = item.id;
  elements.itemName.value = item.itemName;
  elements.usage.value = item.usage;
  elements.purchaseDate.value = item.purchaseDate;
  elements.yearsOfUse.value = item.yearsOfUse;
  elements.formMode.textContent = "現在: 編集中";
  elements.submitButton.textContent = "更新する";
  elements.cancelButton.hidden = false;
  elements.formError.textContent = "";
  renderPartRows(item.parts);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderSummary() {
  const totalInvestment = state.items.reduce((total, item) => total + calculateTotalInvestment(item), 0);
  const monthlyCost = state.items.reduce((total, item) => total + calculateMonthlyCost(item), 0);
  elements.summaryCount.textContent = `${state.items.length}台`;
  elements.summaryTotal.textContent = formatCurrency(totalInvestment);
  elements.summaryMonthly.textContent = formatCurrency(monthlyCost);
}

function renderParts(parts) {
  const sortedParts = sortParts(parts);
  if (sortedParts.length === 0) {
    return '<p class="pc-card-meta">パーツはまだ入力されていません。</p>';
  }
  return `
    <div class="history-list">
      ${sortedParts
        .map(
          (part) => `
            <div class="history-row">
              <span>${escapeHtml(part.purchaseDate)}</span>
              <span>${escapeHtml(partTypeLabels[part.partType] ?? "その他")}</span>
              <strong>${escapeHtml(part.partName)}</strong>
              <span>${formatCurrency(part.price)}</span>
              <span>${escapeHtml(part.memo)}</span>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSpecGrid(specs) {
  return currentSpecTypes
    .map((specType) => {
      const emptyText = specType === "gpu" ? "未搭載" : "未入力";
      return `
        <div>
          <dt>${escapeHtml(partTypeLabels[specType])}</dt>
          <dd>${escapeHtml(specs[specType] || emptyText)}</dd>
        </div>
      `;
    })
    .join("");
}

function showPartsDialog(item) {
  elements.partsDialogTitle.textContent = `${item.itemName}のパーツ一覧`;
  elements.partsDialogBody.innerHTML = renderParts(item.parts);

  if (typeof elements.partsDialog.showModal === "function") {
    elements.partsDialog.showModal();
    return;
  }

  elements.partsDialog.setAttribute("open", "");
}

function renderList() {
  elements.pcList.innerHTML = "";
  if (state.items.length === 0) {
    elements.pcList.innerHTML = '<div class="empty">PCはまだ登録されていません。</div>';
    return;
  }

  for (const item of sortItems(state.items)) {
    const totalInvestment = calculateTotalInvestment(item);
    const monthlyCost = calculateMonthlyCost(item);

    const card = document.createElement("article");
    card.className = "pc-card";
    card.innerHTML = `
      <div class="pc-card-header">
        <div>
          <h3 class="pc-card-title">${escapeHtml(item.itemName)}</h3>
          <p class="pc-card-meta">
            用途: ${escapeHtml(usageLabels[item.usage] ?? "その他")} / 組立日: ${escapeHtml(item.purchaseDate)}
          </p>
        </div>
        <div class="card-actions">
          <button class="primary-button small-button edit-button" type="button" data-id="${escapeHtml(item.id)}">編集</button>
          <button class="danger-button small-button delete-button" type="button" data-id="${escapeHtml(item.id)}">削除</button>
        </div>
      </div>

      <div class="pc-cost-summary">
        <div>
          <span class="cost-label">総投資額</span>
          <strong>${formatCurrency(totalInvestment)}</strong>
        </div>
        <div>
          <span class="cost-label">月額換算</span>
          <strong>${formatCurrency(monthlyCost)}</strong>
        </div>
      </div>

      <dl class="spec-grid">
        ${renderSpecGrid(item.specs)}
      </dl>

      <button
        class="part-summary-card parts-dialog-button"
        type="button"
        data-id="${escapeHtml(item.id)}"
        aria-label="${escapeHtml(item.itemName)}のパーツ一覧を表示"
      >
        <span>パーツ一覧</span>
        <strong>${item.parts.length}件</strong>
      </button>
    `;
    elements.pcList.appendChild(card);
  }
}

function render() {
  renderSummary();
  renderList();
}

async function refreshItems() {
  if (!state.uid) return;
  state.items = await loadFirestoreItems(state.uid);
  render();
}

function showError(error, fallback) {
  elements.authError.textContent = firebaseErrorMessage(error, fallback);
}

elements.addPartButton.addEventListener("click", () => {
  const row = createPartRow({ createdAt: Date.now() });
  elements.partList.prepend(row);
  row.querySelector(".part-purchase-date").focus();
});

elements.partList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (!target.classList.contains("part-delete")) return;
  target.closest(".part-row")?.remove();
  if (elements.partList.children.length === 0) {
    elements.partList.appendChild(createPartRow({ createdAt: Date.now() }));
  }
});

elements.partsDialogClose.addEventListener("click", () => {
  elements.partsDialog.close();
});

elements.partsDialog.addEventListener("click", (event) => {
  if (event.target === elements.partsDialog) {
    elements.partsDialog.close();
  }
});

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  elements.formError.textContent = "";
  elements.authError.textContent = "";

  if (!state.uid) {
    elements.formError.textContent = "ログイン状態を確認できません。もう一度ログインしてください。";
    return;
  }

  const item = collectPcItem();
  const validation = validatePcItem(item);
  if (validation) {
    elements.formError.textContent = validation;
    return;
  }

  try {
    elements.submitButton.disabled = true;
    await saveFirestoreItem(state.uid, item);
    await refreshItems();
    resetForm();
  } catch (error) {
    elements.formError.textContent = firebaseErrorMessage(error, "PC情報の保存に失敗しました。");
  } finally {
    elements.submitButton.disabled = false;
  }
});

elements.cancelButton.addEventListener("click", () => {
  resetForm();
});

elements.resetButton.addEventListener("click", () => {
  resetForm();
});

elements.pcList.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const editButton = target.closest(".edit-button");
  if (editButton instanceof HTMLButtonElement) {
    const item = state.items.find((currentItem) => currentItem.id === editButton.dataset.id);
    if (item) fillForm(item);
    return;
  }

  const partsDialogButton = target.closest(".parts-dialog-button");
  if (partsDialogButton instanceof HTMLButtonElement) {
    const item = state.items.find((currentItem) => currentItem.id === partsDialogButton.dataset.id);
    if (item) showPartsDialog(item);
    return;
  }

  const deleteButton = target.closest(".delete-button");
  if (!(deleteButton instanceof HTMLButtonElement)) return;
  if (!state.uid) return;

  const item = state.items.find((currentItem) => currentItem.id === deleteButton.dataset.id);
  if (!item) return;

  const shouldDelete = confirm(`「${item.itemName}」を削除しますか？`);
  if (!shouldDelete) return;

  try {
    deleteButton.disabled = true;
    await removeFirestoreItem(state.uid, item.id);
    await refreshItems();
    if (state.editingId === item.id) resetForm();
  } catch (error) {
    showError(error, "PC情報の削除に失敗しました。");
  } finally {
    deleteButton.disabled = false;
  }
});

elements.exportButton.addEventListener("click", () => {
  const payload = {
    dataVersion: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    pcItems: sortItems(state.items).map(normalizePcItem),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pc-management-data.json";
  link.click();
  URL.revokeObjectURL(url);
});

elements.importFile.addEventListener("change", async () => {
  const file = elements.importFile.files?.[0];
  if (!file || !state.uid) return;
  elements.formError.textContent = "";
  elements.authError.textContent = "";

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const items = Array.isArray(parsed) ? parsed : parsed.pcItems;
    if (!Array.isArray(items)) {
      throw new Error("PC一覧データが見つかりません。");
    }
    const shouldReplace = confirm("読み込んだJSONでFirestore上のPC一覧を置き換えますか？");
    if (!shouldReplace) return;
    const importedItems = items.map(normalizePcItem);
    state.items = sortItems(importedItems);
    saveLocalBackupItems(state.items);
    render();
    resetForm();
    try {
      await replaceFirestoreItems(state.uid, state.items);
      await refreshItems();
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } catch (error) {
      elements.formError.textContent = firebaseErrorMessage(
        error,
        "JSONは画面に反映しましたが、Firestoreへの保存に失敗しました。"
      );
      return;
    }
    resetForm();
  } catch (error) {
    elements.formError.textContent = firebaseErrorMessage(error, "JSONの読み込みに失敗しました。");
  } finally {
    elements.importFile.value = "";
  }
});

renderPartRows([]);
render();

onAuthChanged(async (user) => {
  if (!user) {
    window.location.href = "../login.html";
    return;
  }

  state.uid = user.uid;
  elements.authStatus.textContent = `状態: ログイン中 (${user.email ?? "メール未設定"})`;
  elements.authError.textContent = "";

  try {
    await refreshItems();
    await migrateLocalItemsIfNeeded(user.uid);
  } catch (error) {
    showError(error, "PC情報の取得に失敗しました。");
  }
});

registerServiceWorker();
