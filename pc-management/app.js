import {
  calculateUsageMonths,
  firebaseErrorMessage,
} from "../js/common.js";
import { isLocalMode } from "../js/platform/local-db.js";
import { onAuthChanged, registerServiceWorker } from "../js/services/auth.js";
import { shouldExcludeUnderusedMonthlyCost } from "../js/services/app-settings.js";
import {
  deleteItem as deletePcItem,
  getItems as getPcItems,
  saveItem as savePcItem,
} from "../js/storage/pc-items/index.js";

const PC_ITEMS_COLLECTION = "durableGoodsItems";
const SOURCE_TYPE = "pcManagement";
const DATA_VERSION = 7;
const SCHEMA_TYPE = "pcPartLifecycle";
const HIDDEN_TIMELINE_NOTICE_MESSAGE = "非表示でも使用年数が未達の場合は加算されます。";
const TIMELINE_MIN_YEAR = 2015;
const TIMELINE_MAX_YEAR = 2055;
const DESKTOP_YEAR_WIDTH = 168;
const DESKTOP_LABEL_WIDTH = 230;
const MOBILE_YEAR_WIDTH = 28;
const MOBILE_LABEL_WIDTH = 72;
const TIMELINE_MODE = document.body.dataset.timelineMode || "visible";

const pcNameLabels = {
  main: "メインPC",
  sub: "サブPC",
};

const pcNameOptions = Object.entries(pcNameLabels).map(([value, label]) => ({ value, label }));

const elements = {
  summaryCount: document.getElementById("summary-count"),
  summaryTotal: document.getElementById("summary-total"),
  summaryMonthly: document.getElementById("summary-monthly"),
  authError: document.getElementById("auth-error"),
  createButton: document.getElementById("create-button"),
  categoryFilter: document.getElementById("category-filter"),
  hiddenButton: document.getElementById("hidden-button"),
  settingsButton: document.getElementById("settings-button"),
  backButton: document.getElementById("back-button"),
  helpButton: document.getElementById("help-button"),
  helpDialog: document.getElementById("help-dialog"),
  helpCloseButton: document.getElementById("help-close-button"),
  toListButton: document.getElementById("to-list-button"),
  formPanel: document.getElementById("form-panel"),
  form: document.getElementById("pc-form"),
  formError: document.getElementById("form-error"),
  resetButton: document.getElementById("reset-button"),
  submitButton: document.getElementById("submit-button"),
  itemList: document.getElementById("item-list"),
  calculationTotal: document.getElementById("calculation-total"),
  calculationMonthlyCost: document.getElementById("calculation-monthly-cost"),
  id: document.getElementById("pc-id"),
  partName: document.getElementById("part-name"),
  modelNumber: document.getElementById("model-number"),
  pcName: document.getElementById("pc-name"),
  specDetail: document.getElementById("spec-detail"),
  purchaseDate: document.getElementById("purchase-date"),
  purchasePrice: document.getElementById("purchase-price"),
  yearsOfUse: document.getElementById("years-of-use"),
  endOfUseDate: document.getElementById("end-of-use-date"),
  hideFromTimeline: document.getElementById("hide-from-timeline"),
  itemDialog: document.getElementById("item-dialog"),
  dialogItemName: document.getElementById("dialog-item-name"),
  dialogItemMeta: document.getElementById("dialog-item-meta"),
  dialogEditButton: document.getElementById("dialog-edit-button"),
  dialogDeleteButton: document.getElementById("dialog-delete-button"),
  dialogCloseButton: document.getElementById("dialog-close-button"),
};

const state = {
  uid: null,
  items: [],
  selectedPcNames: new Set(pcNameOptions.map((option) => option.value)),
  selectedItemId: null,
  editingId: new URLSearchParams(window.location.search).get("id"),
  resizeTimer: null,
  isDirty: false,
  isBusy: false,
};
function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function createElement(tagName, className, textContent = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function parseCurrencyInputValue(value) {
  const normalizedValue = String(value ?? "").replaceAll(",", "").trim();
  const amount = Number(normalizedValue);
  return Number.isFinite(amount) && amount >= 0 ? amount : Number.NaN;
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

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function toMonthPosition(date) {
  return toMonthIndex(date) + (date.getDate() - 1) / daysInMonth(date);
}

function addYearsClamped(date, years) {
  const targetYear = date.getFullYear() + years;
  const targetMonth = date.getMonth();
  const targetDay = Math.min(date.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
  return new Date(targetYear, targetMonth, targetDay);
}

function formatYearMonthFromIndex(monthIndex) {
  const normalizedMonthIndex = Math.floor(monthIndex);
  const year = Math.floor(normalizedMonthIndex / 12);
  const month = (normalizedMonthIndex % 12) + 1;
  return `${year}/${String(month).padStart(2, "0")}`;
}

function formatMonthlyCost(value) {
  return `${formatCurrency(value)} /月`;
}

function calculateMonthlyCost(item) {
  const purchasePrice = Number(item.purchasePrice ?? 0);
  const yearsOfUse = Number(item.yearsOfUse ?? 0);
  if (!Number.isFinite(purchasePrice) || !Number.isFinite(yearsOfUse) || yearsOfUse <= 0) return 0;
  return purchasePrice / (yearsOfUse * 12);
}

function calculateActualMonthlyCost(item) {
  const usageMonths = calculateUsageMonths(item.purchaseDate, item.endOfUseDate);
  if (!usageMonths) return null;
  const purchasePrice = Number(item.purchasePrice ?? 0);
  if (!Number.isFinite(purchasePrice)) return null;
  return purchasePrice / usageMonths;
}

function shouldShowHiddenTimelineNotice(item) {
  return Boolean(item.hideFromTimeline);
}

function showHiddenTimelineNoticeDialog() {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "item-name-dialog";
    dialog.innerHTML = `
      <article class="item-name-dialog-card">
        <p class="dialog-item-meta">${HIDDEN_TIMELINE_NOTICE_MESSAGE}</p>
        <div class="dialog-actions">
          <button type="button" class="primary-button">OK</button>
        </div>
      </article>
    `;

    const closeButton = dialog.querySelector("button");
    const closeDialog = () => {
      dialog.close();
    };

    closeButton.addEventListener("click", closeDialog);
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve();
    }, { once: true });

    document.body.appendChild(dialog);
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    closeButton.focus();
  });
}

function summaryMonthlyCost(item) {
  if (isUnderusedEndedItem(item) && !shouldExcludeUnderusedMonthlyCost()) {
    return calculateActualMonthlyCost(item) ?? calculateMonthlyCost(item);
  }
  return calculateMonthlyCost(item);
}

function displayedMonthlyCost(item) {
  return Math.round(summaryMonthlyCost(item));
}

function isMonthlyCostExcluded(item) {
  return isActualUseEnded(item) && itemPlannedEndMonth(item) <= currentMonthIndex();
}

function isActualUseEnded(item) {
  return Boolean(item.endOfUseDate) && itemActualEndMonth(item) <= currentMonthIndex();
}

function isUnderusedEndedItem(item) {
  return (
    isActualUseEnded(item) &&
    itemActualEndMonth(item) < itemPlannedEndMonth(item) &&
    currentMonthIndex() < itemPlannedEndMonth(item)
  );
}

function isMonthlyCostSummaryExcluded(item) {
  if (isMonthlyCostExcluded(item)) {
    return true;
  }
  if (isUnderusedEndedItem(item)) {
    return shouldExcludeUnderusedMonthlyCost();
  }
  return false;
}

function isSummaryExcluded(item) {
  return Boolean(item.excludeFromSummary);
}

function timelineLabelClass(item) {
  const classes = ["timeline-row-label"];
  if (isMonthlyCostSummaryExcluded(item)) classes.push("monthly-cost-excluded");
  if (isSummaryExcluded(item)) classes.push("summary-excluded");
  return classes.join(" ");
}

function normalizePcName(value) {
  return pcNameLabels[value] ? value : "main";
}

function normalizePcPartItem(value) {
  const item = value && typeof value === "object" ? value : {};
  const purchasePrice = Number(item.purchasePrice ?? item.price ?? 0);
  const normalized = {
    id: item.id || createId(),
    sourceType: SOURCE_TYPE,
    partName: String(item.partName ?? item.name ?? item.itemName ?? ""),
    modelNumber: String(item.modelNumber ?? item.model ?? ""),
    pcName: normalizePcName(item.pcName),
    specDetail: String(item.specDetail ?? ""),
    purchaseDate: String(item.purchaseDate ?? ""),
    purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : 0,
    yearsOfUse: Number(item.yearsOfUse ?? 5),
    endOfUseDate: String(item.endOfUseDate ?? ""),
    hideFromTimeline: Boolean(item.hideFromTimeline),
    excludeFromSummary: Boolean(item.excludeFromSummary),
    createdAt: toMillis(item.createdAt),
    updatedAt: toMillis(item.updatedAt),
  };
  return {
    ...normalized,
    monthlyCost: calculateMonthlyCost(normalized),
  };
}

function toFirestorePayload(item) {
  const normalized = normalizePcPartItem(item);
  return {
    id: normalized.id,
    dataVersion: DATA_VERSION,
    schemaType: SCHEMA_TYPE,
    sourceType: SOURCE_TYPE,
    category: "pc",
    name: normalized.partName,
    itemName: normalized.partName,
    partName: normalized.partName,
    model: normalized.modelNumber,
    modelNumber: normalized.modelNumber,
    pcName: normalized.pcName,
    specDetail: normalized.specDetail,
    purchaseDate: normalized.purchaseDate,
    price: normalized.purchasePrice,
    purchasePrice: normalized.purchasePrice,
    yearsOfUse: normalized.yearsOfUse,
    endOfUseDate: normalized.endOfUseDate,
    hideFromTimeline: normalized.hideFromTimeline,
    excludeFromSummary: normalized.excludeFromSummary,
    monthlyCost: calculateMonthlyCost(normalized),
    additionalCosts: [],
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

async function loadFirestoreItems(uid) {
  return sortItems((await getPcItems(uid)).map(normalizePcPartItem));
}

async function saveFirestoreItem(uid, item) {
  const normalized = normalizePcPartItem(item);
  await savePcItem(uid, toFirestorePayload(normalized));
}

async function removeFirestoreItem(uid, itemId) {
  await deletePcItem(uid, itemId);
}

async function loadStorageItems(uid) {
  return loadFirestoreItems(uid);
}

async function saveStorageItem(uid, item) {
  const normalized = normalizePcPartItem(item);
  const existing = state.items.find((currentItem) => currentItem.id === normalized.id);
  await saveFirestoreItem(uid, {
    ...existing,
    ...normalized,
    createdAt: existing?.createdAt ?? normalized.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

async function removeStorageItem(uid, itemId) {
  await removeFirestoreItem(uid, itemId);
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const pcCompare = String(a.pcName).localeCompare(String(b.pcName));
    if (pcCompare !== 0) return pcCompare;
    const dateCompare = String(b.purchaseDate).localeCompare(String(a.purchaseDate));
    if (dateCompare !== 0) return dateCompare;
    return String(a.partName).localeCompare(String(b.partName), "ja");
  });
}

function visibleItems() {
  return state.items.filter((item) =>
    (TIMELINE_MODE === "hidden" ? item.hideFromTimeline : !item.hideFromTimeline) &&
    state.selectedPcNames.has(item.pcName)
  );
}

function summaryItems() {
  return state.items.filter((item) => state.selectedPcNames.has(item.pcName));
}

function syncSelectedItem(items) {
  if (!items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = items[0]?.id ?? null;
  }
}

function itemStartMonth(item) {
  const purchaseDate = parseDate(item.purchaseDate);
  return purchaseDate ? toMonthPosition(purchaseDate) : TIMELINE_MIN_YEAR * 12;
}

function currentMonthIndex() {
  return toMonthPosition(new Date());
}

function itemPlannedEndMonth(item) {
  const purchaseDate = parseDate(item.purchaseDate);
  const yearsOfUse = Math.max(Number(item.yearsOfUse) || 1, 1);
  if (!purchaseDate) return itemStartMonth(item) + yearsOfUse * 12;
  return toMonthPosition(addYearsClamped(purchaseDate, yearsOfUse));
}

function itemActualEndMonth(item) {
  const endOfUseDate = parseDate(item.endOfUseDate);
  if (endOfUseDate) return Math.max(itemStartMonth(item), toMonthPosition(endOfUseDate));
  return currentMonthIndex();
}

function itemEndMonth(item) {
  if (item.endOfUseDate) return itemActualEndMonth(item);
  return Math.max(itemPlannedEndMonth(item), itemActualEndMonth(item));
}

function itemUnusedPeriodEndMonth(item) {
  if (!item.endOfUseDate) return itemEndMonth(item);
  return itemPlannedEndMonth(item);
}

function itemTimelineEndMonth(item) {
  if (item.endOfUseDate) return Math.max(itemEndMonth(item), itemUnusedPeriodEndMonth(item));
  return itemEndMonth(item);
}

function itemEndLabel(item, endMonth) {
  if (item.endOfUseDate) return `${formatYearMonthFromIndex(endMonth)} (使用終了)`;
  return `${formatYearMonthFromIndex(endMonth)} (${item.yearsOfUse}年)`;
}

function calculateLifecycleProgress(item) {
  const startMonth = itemStartMonth(item);
  const durationMonths = Math.max(itemPlannedEndMonth(item) - startMonth, 1);
  return (currentMonthIndex() - startMonth) / durationMonths;
}

function lifecycleStatus(item) {
  if (item.endOfUseDate) return "ended";
  const progress = calculateLifecycleProgress(item);
  if (progress >= 1) return "ended";
  if (progress >= 0.85) return "danger";
  if (progress >= 0.5) return "warning";
  return "normal";
}

function pcNameClass(item) {
  return item.pcName === "sub" ? "category-pc-sub" : "category-pc-main";
}

function pcNameClassFromValue(value) {
  return value === "sub" ? "category-pc-sub" : "category-pc-main";
}

function timelineLayout() {
  const isCompact = window.matchMedia("(max-width: 640px)").matches;
  return {
    isCompact,
    labelWidth: isCompact ? MOBILE_LABEL_WIDTH : DESKTOP_LABEL_WIDTH,
    yearWidth: isCompact ? MOBILE_YEAR_WIDTH : DESKTOP_YEAR_WIDTH,
  };
}

function resolveTimelineRange(items) {
  let minYear = TIMELINE_MIN_YEAR;
  let maxYear = TIMELINE_MAX_YEAR;
  for (const item of items) {
    minYear = Math.min(minYear, Math.floor(itemStartMonth(item) / 12));
    maxYear = Math.max(maxYear, Math.ceil(itemTimelineEndMonth(item) / 12));
  }
  return { minYear, maxYear };
}

function currentLinePosition(minYear, maxYear) {
  const { labelWidth, yearWidth } = timelineLayout();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const nowPosition = currentMonthIndex();
  if (nowPosition < minMonth || nowPosition > maxMonth) return null;
  return labelWidth + ((nowPosition - minMonth) / 12) * yearWidth;
}

function renderAxis(grid, minYear, maxYear, positionClass) {
  const { isCompact, labelWidth, yearWidth } = timelineLayout();
  const axis = createElement("div", `timeline-axis ${positionClass}`);
  const yearCount = maxYear - minYear;

  for (let year = minYear; year <= maxYear; year += 1) {
    if (isCompact && year % 5 !== 0) continue;
    const marker = createElement("span", "timeline-year", String(year));
    marker.style.left = `${labelWidth + (year - minYear) * yearWidth}px`;
    axis.appendChild(marker);
  }

  for (let index = 0; index <= yearCount * 12; index += 1) {
    const tick = createElement("span", index % 12 === 0 ? "timeline-tick major" : "timeline-tick");
    tick.style.left = `${labelWidth + (index / 12) * yearWidth}px`;
    axis.appendChild(tick);
  }

  grid.appendChild(axis);
}

function renderCurrentLine(grid, minYear, maxYear) {
  const currentPosition = currentLinePosition(minYear, maxYear);
  if (currentPosition === null) return;
  const currentLine = createElement("div", "timeline-current-line");
  currentLine.style.left = `${currentPosition}px`;
  currentLine.innerHTML = "<span>現在</span>";
  grid.appendChild(currentLine);
}

function centerCurrentLine(scroll, minYear, maxYear) {
  const currentPosition = currentLinePosition(minYear, maxYear);
  if (currentPosition === null) return;
  const { labelWidth } = timelineLayout();
  requestAnimationFrame(() => {
    const maxScrollLeft = Math.max(scroll.scrollWidth - scroll.clientWidth, 0);
    const visibleTimelineWidth = Math.max(scroll.clientWidth - labelWidth, 1);
    const targetScrollLeft = currentPosition - labelWidth - visibleTimelineWidth / 2;
    scroll.scrollLeft = Math.min(Math.max(targetScrollLeft, 0), maxScrollLeft);
  });
}

function renderEmptyTimeline() {
  if (!elements.itemList) return;
  elements.itemList.innerHTML = "";
  const empty = createElement("div", "timeline-empty");
  const message =
    TIMELINE_MODE === "hidden"
      ? "帯を表示しないパーツはありません。"
      : "パーツを登録すると、購入日から使用年数までのライフサイクル帯を表示します。";
  empty.innerHTML = `
    <strong>登録データがありません</strong>
    <span></span>
  `;
  empty.querySelector("span").textContent = message;
  elements.itemList.appendChild(empty);
}

function renderLoadingTimeline() {
  if (!elements.itemList) return;
  elements.itemList.innerHTML = "";
  const loading = createElement("div", "timeline-empty timeline-loading");
  loading.innerHTML = `
    <strong>読込中です</strong>
    <span>データを準備しています。</span>
  `;
  elements.itemList.appendChild(loading);
}

function renderTimeline() {
  if (!elements.itemList) return;
  const items = sortItems(visibleItems());
  elements.itemList.innerHTML = "";
  if (items.length === 0) {
    renderEmptyTimeline();
    return;
  }

  const { minYear, maxYear } = resolveTimelineRange(items);
  const { labelWidth, yearWidth } = timelineLayout();
  const timelineWidth = labelWidth + (maxYear - minYear) * yearWidth;
  const minMonth = minYear * 12;

  const scroll = createElement("div", "timeline-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", "ライフサイクル年表。横にスクロールできます。");

  const grid = createElement("div", "timeline-grid");
  grid.style.width = `${timelineWidth}px`;
  grid.style.setProperty("--label-width", `${labelWidth}px`);
  grid.style.setProperty("--year-width", `${yearWidth}px`);

  renderAxis(grid, minYear, maxYear, "timeline-axis-top");
  renderCurrentLine(grid, minYear, maxYear);

  const rows = createElement("div", "timeline-rows");
  for (const item of items) {
    const startMonth = itemStartMonth(item);
    const endMonth = itemEndMonth(item);
    const unusedPeriodEndMonth = itemUnusedPeriodEndMonth(item);
    const plannedEndMonth = itemPlannedEndMonth(item);
    const status = lifecycleStatus(item);
    const left = labelWidth + ((startMonth - minMonth) / 12) * yearWidth;
    const width = Math.max(((endMonth - startMonth) / 12) * yearWidth, timelineLayout().isCompact ? 32 : 84);
    const unusedPeriodLeft = labelWidth + ((endMonth - minMonth) / 12) * yearWidth;
    const unusedPeriodWidth = ((unusedPeriodEndMonth - endMonth) / 12) * yearWidth;
    const overuseStartPercent = ((plannedEndMonth - startMonth) / Math.max(endMonth - startMonth, 1)) * 100;
    const isOverused = itemActualEndMonth(item) > plannedEndMonth;
    const isSelected = item.id === state.selectedItemId;
    const colorClass = pcNameClass(item);

    const row = createElement("div", "timeline-row");
    const label = createElement(
      "div",
      timelineLabelClass(item)
    );
    label.dataset.action = "toggle-summary";
    label.dataset.id = item.id;
    label.innerHTML = `<span class="category-swatch ${colorClass}"></span><strong></strong>`;
    label.querySelector("strong").textContent = pcNameLabels[item.pcName] || "メインPC";

    const band = createElement("button", `lifecycle-band ${colorClass}${isOverused ? " overused" : ""}`);
    band.type = "button";
    band.dataset.id = item.id;
    band.setAttribute("aria-pressed", String(isSelected));
    band.setAttribute("aria-label", `${item.partName || "パーツ"}の詳細を表示`);
    band.style.left = `${left}px`;
    band.style.width = `${width}px`;
    if (isOverused) {
      band.style.setProperty("--overuse-start", `${Math.min(Math.max(overuseStartPercent, 0), 100)}%`);
    }

    band.append(
      createElement("span", "band-name", item.partName || "商品名未入力"),
      createElement("span", "band-cost", formatMonthlyCost(calculateMonthlyCost(item)))
    );

    if (item.endOfUseDate && unusedPeriodWidth > 0) {
      const postEndBand = createElement("button", "post-end-band");
      postEndBand.type = "button";
      postEndBand.dataset.id = item.id;
      postEndBand.setAttribute("aria-pressed", String(isSelected));
      postEndBand.setAttribute("aria-label", `${item.partName || "パーツ"}の使わなかった期間`);
      postEndBand.style.left = `${unusedPeriodLeft}px`;
      postEndBand.style.width = `${Math.max(unusedPeriodWidth, 2)}px`;
      row.appendChild(postEndBand);
    }

    const endLabel = createElement("span", `timeline-end-label status-${status}`, itemEndLabel(item, endMonth));
    endLabel.style.left = `${left + width + 10}px`;

    row.append(label, band, endLabel);
    rows.appendChild(row);
  }

  grid.appendChild(rows);
  renderAxis(grid, minYear, maxYear, "timeline-axis-bottom");
  scroll.appendChild(grid);
  elements.itemList.appendChild(scroll);
  centerCurrentLine(scroll, minYear, maxYear);
}

function renderSummary() {
  if (!elements.summaryCount || !elements.summaryTotal || !elements.summaryMonthly) return;
  const items = summaryItems();
  const summaryTargetItems = items.filter((item) => !isSummaryExcluded(item));
  const monthlyCostItems = summaryTargetItems.filter((item) => !isMonthlyCostSummaryExcluded(item));
  const purchaseTotal = monthlyCostItems.reduce((total, item) => total + Number(item.purchasePrice || 0), 0);
  const monthlyCostTotal = monthlyCostItems.reduce((total, item) => total + displayedMonthlyCost(item), 0);
  elements.summaryCount.textContent = `${monthlyCostItems.length} 件`;
  elements.summaryTotal.textContent = formatCurrency(purchaseTotal);
  elements.summaryMonthly.textContent = formatMonthlyCost(monthlyCostTotal);
}

function renderCategoryFilter() {
  if (!elements.categoryFilter) return;

  elements.categoryFilter.innerHTML = "";
  for (const option of pcNameOptions) {
    const isSelected = state.selectedPcNames.has(option.value);
    const button = createElement("button", `category-filter-button ${pcNameClassFromValue(option.value)}`);
    button.type = "button";
    button.dataset.pcName = option.value;
    button.setAttribute("aria-label", `${option.label}を${isSelected ? "非表示" : "表示"}`);
    button.setAttribute("aria-pressed", String(isSelected));
    button.title = option.label;
    elements.categoryFilter.appendChild(button);
  }
}

function render() {
  syncSelectedItem(visibleItems());
  renderCategoryFilter();
  renderSummary();
  renderTimeline();
}

function validatePcItem(item) {
  if (!item.partName.trim()) return "商品名（パーツ）を入力してください。";
  if (!item.modelNumber.trim()) return "型番を入力してください。";
  if (!pcNameLabels[item.pcName]) return "分類（パソコン名）を選択してください。";
  if (!item.purchaseDate) return "購入日を入力してください。";
  if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) return "購入価格は0以上で入力してください。";
  if (!Number.isFinite(item.yearsOfUse) || item.yearsOfUse <= 0) return "使用年数は1以上で入力してください。";
  if (item.endOfUseDate && item.endOfUseDate < item.purchaseDate) {
    return "使用終了日は購入日以降の日付を入力してください。";
  }
  return null;
}

function collectPcItem() {
  const existingItem = state.items.find((item) => item.id === state.editingId);
  return normalizePcPartItem({
    id: elements.id.value || createId(),
    partName: elements.partName.value.trim(),
    modelNumber: elements.modelNumber.value.trim(),
    pcName: elements.pcName.value,
    specDetail: elements.specDetail.value.trim(),
    purchaseDate: elements.purchaseDate.value,
    purchasePrice: parseCurrencyInputValue(elements.purchasePrice.value),
    yearsOfUse: Number(elements.yearsOfUse.value),
    endOfUseDate: elements.endOfUseDate.value,
    hideFromTimeline: elements.hideFromTimeline.checked,
    excludeFromSummary: Boolean(existingItem?.excludeFromSummary),
    createdAt: existingItem?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
}

function resetForm() {
  if (!elements.form) return;
  state.editingId = null;
  elements.form.reset();
  elements.id.value = "";
  elements.pcName.value = "main";
  elements.yearsOfUse.value = "5";
  elements.hideFromTimeline.checked = false;
  elements.submitButton.textContent = "登録する";
  elements.formError.textContent = "";
  state.isDirty = false;
  updateCalculationResult();
}

function updateEndedUseStyle() {
  if (!elements.formPanel || !elements.endOfUseDate) return;
  elements.formPanel.classList.toggle("ended-use", Boolean(elements.endOfUseDate.value));
}

function fillForm(item) {
  if (!elements.form) return;
  state.editingId = item.id;
  elements.id.value = item.id;
  elements.partName.value = item.partName;
  elements.modelNumber.value = item.modelNumber;
  elements.pcName.value = item.pcName;
  elements.specDetail.value = item.specDetail;
  elements.purchaseDate.value = item.purchaseDate;
  elements.purchasePrice.value = item.purchasePrice;
  elements.yearsOfUse.value = item.yearsOfUse;
  elements.endOfUseDate.value = item.endOfUseDate;
  elements.hideFromTimeline.checked = Boolean(item.hideFromTimeline);
  elements.submitButton.textContent = "更新する";
  elements.formError.textContent = "";
  updateEndedUseStyle();
  updateCalculationResult();
}

function updateCalculationResult() {
  if (!elements.calculationMonthlyCost) return;
  const purchasePrice = parseCurrencyInputValue(elements.purchasePrice.value);
  const monthlyCost = calculateMonthlyCost({
    purchasePrice,
    yearsOfUse: Number(elements.yearsOfUse.value),
  });
  if (elements.calculationTotal) {
    elements.calculationTotal.textContent = formatCurrency(purchasePrice);
  }
  elements.calculationMonthlyCost.textContent = formatMonthlyCost(monthlyCost);
}

async function refreshItems() {
  if (!state.uid) return;
  state.items = await loadStorageItems(state.uid);
  render();
  if (state.editingId && elements.form) {
    const item = state.items.find((currentItem) => currentItem.id === state.editingId);
    if (item) fillForm(item);
  }
}

function selectedItem() {
  return visibleItems().find((item) => item.id === state.selectedItemId) ?? null;
}

function openItemDialog(item) {
  if (!item || !elements.itemDialog) return;
  elements.dialogItemName.textContent = item.partName || "商品名未入力";
  elements.dialogItemMeta.textContent =
    `${pcNameLabels[item.pcName] || "メインPC"} / 型番: ${item.modelNumber || "未入力"} / ${formatMonthlyCost(calculateMonthlyCost(item))}`;
  elements.itemDialog.showModal();
}

function selectItem(itemId) {
  state.selectedItemId = itemId;
  renderTimeline();
  openItemDialog(selectedItem());
}

async function toggleSummaryExclusion(itemId) {
  const item = state.items.find((currentItem) => currentItem.id === itemId);
  if (!item || !state.uid) return;

  try {
    await saveStorageItem(state.uid, {
      ...item,
      excludeFromSummary: !isSummaryExcluded(item),
    });
    await refreshItems();
  } catch (error) {
    showError(error, "集計対象の切り替えに失敗しました。");
  }
}

function showError(error, fallback) {
  if (elements.authError) {
    elements.authError.textContent = firebaseErrorMessage(error, fallback);
  }
}

if (elements.form) {
  elements.form.addEventListener("input", updateCalculationResult);
  elements.form.addEventListener("change", updateCalculationResult);
  elements.form.addEventListener("input", () => {
    state.isDirty = true;
  });
  elements.form.addEventListener("change", () => {
    state.isDirty = true;
  });
  elements.endOfUseDate.addEventListener("input", updateEndedUseStyle);

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
      state.isBusy = true;
      elements.submitButton.disabled = true;
      await saveStorageItem(state.uid, item);
      if (shouldShowHiddenTimelineNotice(item)) {
        await showHiddenTimelineNoticeDialog();
      }
      state.isDirty = false;
      window.location.href = "index.html";
    } catch (error) {
      elements.formError.textContent = firebaseErrorMessage(error, "パーツ情報の保存に失敗しました。");
    } finally {
      state.isBusy = false;
      elements.submitButton.disabled = false;
    }
  });

  elements.toListButton.addEventListener("click", () => {
    window.location.href = "index.html";
  });
}

if (elements.createButton) {
  elements.createButton.addEventListener("click", () => {
    window.location.href = "form.html";
  });
}

if (elements.categoryFilter) {
  elements.categoryFilter.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest(".category-filter-button");
    if (!(button instanceof HTMLButtonElement)) return;

    const pcName = button.dataset.pcName;
    if (!pcName) return;

    if (state.selectedPcNames.has(pcName)) {
      state.selectedPcNames.delete(pcName);
    } else {
      state.selectedPcNames.add(pcName);
    }

    render();
  });
}

if (elements.hiddenButton) {
  elements.hiddenButton.addEventListener("click", () => {
    window.location.href = "hidden.html";
  });
}

if (elements.settingsButton) {
  elements.settingsButton.addEventListener("click", () => {
    window.location.href = "settings.html";
  });
}

if (elements.backButton) {
  elements.backButton.addEventListener("click", () => {
    window.location.href = TIMELINE_MODE === "hidden" ? "index.html" : "../list.html";
  });
}

if (elements.helpButton && elements.helpDialog && elements.helpCloseButton) {
  elements.helpButton.addEventListener("click", () => {
    elements.helpDialog.showModal();
  });

  elements.helpCloseButton.addEventListener("click", () => {
    elements.helpDialog.close();
  });

  elements.helpDialog.addEventListener("click", (event) => {
    if (event.target === elements.helpDialog) elements.helpDialog.close();
  });
}

if (elements.itemList) {
  elements.itemList.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const summaryToggle = target.closest("[data-action='toggle-summary']");
    if (summaryToggle instanceof HTMLElement) {
      toggleSummaryExclusion(summaryToggle.dataset.id ?? "");
      return;
    }

    const band = target.closest(".lifecycle-band, .post-end-band");
    if (!(band instanceof HTMLButtonElement)) return;
    selectItem(band.dataset.id ?? "");
  });
}

if (elements.dialogEditButton) {
  elements.dialogEditButton.addEventListener("click", () => {
    const item = selectedItem();
    if (!item) return;
    window.location.href = `form.html?id=${encodeURIComponent(item.id)}`;
  });
}

if (elements.dialogDeleteButton) {
  elements.dialogDeleteButton.addEventListener("click", async () => {
    const item = selectedItem();
    if (!item || !state.uid) return;
    const shouldDelete = confirm(`「${item.partName}」を削除しますか？`);
    if (!shouldDelete) return;

    try {
      elements.dialogDeleteButton.disabled = true;
      await removeStorageItem(state.uid, item.id);
      elements.itemDialog.close();
      state.selectedItemId = null;
      await refreshItems();
      if (state.editingId === item.id) resetForm();
    } catch (error) {
      showError(error, "パーツ情報の削除に失敗しました。");
    } finally {
      elements.dialogDeleteButton.disabled = false;
    }
  });
}

if (elements.dialogCloseButton) {
  elements.dialogCloseButton.addEventListener("click", () => {
    elements.itemDialog.close();
  });
}

if (elements.itemDialog) {
  elements.itemDialog.addEventListener("click", (event) => {
    if (event.target === elements.itemDialog) elements.itemDialog.close();
  });
}

window.addEventListener("resize", () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(renderTimeline, 120);
});

updateCalculationResult();
updateEndedUseStyle();
renderCategoryFilter();
renderLoadingTimeline();

async function initializePcManagement(user) {
  if (isLocalMode()) {
    state.uid = "local";
  } else if (!user) {
    window.location.href = "../login.html";
    return;
  } else {
    state.uid = user.uid;
  }

  if (elements.authError) elements.authError.textContent = "";

  try {
    if (!elements.form) {
      await refreshItems();
      return;
    }

    if (!state.editingId) {
      elements.submitButton.textContent = "登録する";
      elements.pcName.value = "main";
      elements.yearsOfUse.value = elements.yearsOfUse.value || "5";
      updateEndedUseStyle();
      updateCalculationResult();
      state.isDirty = false;
      return;
    }

    state.items = await loadStorageItems(state.uid);
    const item = state.items.find((currentItem) => currentItem.id === state.editingId);
    if (!item) {
      elements.authError.textContent = "編集対象が見つかりません。";
      return;
    }
    fillForm(item);
    state.isDirty = false;
  } catch (error) {
    showError(error, "パーツ情報の取得に失敗しました。");
  }
}

if (isLocalMode()) {
  initializePcManagement(null);
} else {
  onAuthChanged(initializePcManagement);
}

registerServiceWorker();
